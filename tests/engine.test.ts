/**
 * Testes do motor: o fluxo pergunta -> busca -> (LLM ou handoff) -> resposta.
 * Tudo com dublês, então a suíte não usa rede nem crédito.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { Motor, limitarLinhas, pediuAjudaHumana } from '../src/core/engine.js';
import { config } from '../src/config.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmFake } from './helpers/fake-llm.js';
import type { ConfigDoTenant } from '../src/core/types.js';

const SLUG = 'clinica';

let db: Db;

function semear(textos: string[], configDoTenant: ConfigDoTenant = {}): void {
  const tenant = salvarTenant(db, {
    slug: SLUG,
    nome: 'Clínica de Teste',
    config: configDoTenant,
    promptDoSistema: 'Você é o atendente da Clínica de Teste.',
  });

  const documentId = salvarDocumento(db, tenant.id, 'faq.md', textos.join('\n\n'));

  inserirChunks(
    db,
    textos.map((texto, i) => ({
      documentId,
      tenantId: tenant.id,
      indice: i,
      texto,
      embedding: vetorDeTexto(texto),
      metadados: { secao: `Seção ${i}` },
    })),
  );
}

beforeEach(() => {
  db = abrirBanco(':memory:');
});

describe('Motor.responder', () => {
  it('responde e cita a fonte quando encontra contexto relevante', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(resposta.precisaDeHumano).toBe(false);
    expect(resposta.texto).toBe('Abrimos de segunda a sexta, das 8h às 18h.');
    expect(resposta.fontes[0]?.arquivo).toBe('faq.md');
    expect(resposta.fontes[0]?.secao).toBe('Seção 0');
    expect(llm.chamadas).toHaveLength(1);
  });

  it('manda ao modelo o contexto recuperado e as regras obrigatórias', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    const chamada = llm.chamadas[0];
    expect(chamada?.promptDoSistema).toContain('Clínica de Teste');
    expect(chamada?.promptDoSistema).toContain('NUNCA invente preço');
    expect(chamada?.mensagemDoUsuario).toContain('CONTEXTO:');
    expect(chamada?.mensagemDoUsuario).toContain('dezoito horas');
  });

  it('CHAMA o LLM mesmo com confiança baixa, em vez de desistir sozinho', async () => {
    // Esta regra já foi o contrário: score abaixo do limiar virava handoff sem
    // passar pelo modelo, "para proteger o bolso". Rodando de verdade, um
    // "bom diaa" tirou 0.288 e acionou a equipe para retribuir um cumprimento
    // — e o handoff calou o bot pelo resto da conversa.
    //
    // O limiar continua escolhendo o contexto; quem decide se dá para
    // responder é o modelo, que tem a regra 2 para conversar e a 3 para
    // escalar. O preço disso é uma chamada barata onde antes havia zero.
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(SLUG, 'contato-1', 'vocês vendem pizza calabresa');

    expect(llm.chamadas).toHaveLength(1);
    expect(resposta.precisaDeHumano).toBe(false);
  });

  it('manda os melhores trechos, marcados como fracos, quando nada passa do limiar', async () => {
    // O limiar parou de barrar a mensagem, mas continuava matando o contexto
    // de fome. Medido: "ta entao marca dia 16 mesmo" tira 0.376 e o trecho
    // perdido por essa margem era justamente o "Como agendar", que responde a
    // pergunta. Melhor o modelo ver e descartar do que nunca ver.
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.'], {
      limiarDeConfianca: 0.99,
    });

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta');

    const enviado = llm.chamadas[0]?.mensagemDoUsuario ?? '';
    expect(enviado).toContain('nenhum trecho claramente relevante');
    expect(enviado).toContain('dezoito horas');
  });

  it('não marca como fraco o contexto que passou do limiar', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(llm.chamadas[0]?.mensagemDoUsuario).not.toContain('claramente relevante');
  });

  it('faz handoff com motivo "sem_chunks" quando o tenant não tem nada indexado', async () => {
    salvarTenant(db, { slug: SLUG, nome: 'Vazia', config: {}, promptDoSistema: 'p' });

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(SLUG, 'contato-1', 'qualquer pergunta');

    expect(resposta.motivoDoHandoff).toBe('sem_chunks');
    expect(llm.chamadas).toHaveLength(0);
  });

  it('respeita o limiar configurado no tenant, não só o global', async () => {
    // O limiar do tenant continua valendo — só que agora ele decide se o
    // contexto vai marcado como firme ou como fraco, em vez de decidir se
    // alguém é chamado.
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.'], {
      limiarDeConfianca: 0.99,
    });

    const llmRigoroso = new LlmFake();
    await new Motor({ db, embedder: new EmbedderFake(), llm: llmRigoroso }).responder(
      SLUG,
      'contato-1',
      'clínica abre segunda sexta',
    );

    expect(llmRigoroso.chamadas[0]?.mensagemDoUsuario).toContain('nenhum trecho claramente');
  });

  it('trata como handoff a resposta em que o próprio modelo desiste', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const llm = new LlmFake(config.resposta.fraseDeHandoff);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(resposta.precisaDeHumano).toBe(true);
    expect(resposta.fontes).toEqual([]);
  });

  it('detecta o handoff mesmo com a frase reescrita no meio da resposta', async () => {
    // Caso real observado com gpt-5.4-mini na pergunta "vocês atendem pelo SUS?":
    // o modelo responde o que sabe, emenda a frase de desistência em minúscula
    // e segue. Se isso passar como resposta resolvida, ninguém é chamado para
    // atender o cliente — e o erro é silencioso.
    const hibrida =
      'Não atendemos planos de servidor público. Se o seu atendimento for pelo SUS, ' +
      'não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.';

    semear(['Atendemos Amil Dental. Não atendemos planos de servidor público.']);

    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake(hibrida) });
    const resposta = await motor.responder(SLUG, 'contato-1', 'atendemos planos servidor');

    expect(resposta.precisaDeHumano).toBe(true);
    expect(resposta.fontes).toEqual([]);
  });

  it('corta a resposta no máximo de linhas mesmo se o modelo falar demais', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const tagarela = new LlmFake('linha 1\nlinha 2\nlinha 3\nlinha 4\nlinha 5');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: tagarela });

    const resposta = await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(resposta.texto.split('\n')).toHaveLength(config.resposta.maximoDeLinhas);
  });

  it('devolve tokens, custo e latência de cada resposta', async () => {
    semear(['A clínica abre de segunda a sexta das oito às dezoito horas.']);

    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake() });
    const resposta = await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(resposta.uso.tokensEntrada).toBe(120);
    expect(resposta.uso.tokensSaida).toBe(18);
    expect(resposta.uso.custoEstimadoUsd).toBeGreaterThan(0);
    expect(resposta.uso.latenciaMs).toBeGreaterThanOrEqual(0);
  });

  it('faz handoff em mensagem vazia, sem chamar embedder nem LLM', async () => {
    semear(['qualquer coisa indexada']);

    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(SLUG, 'contato-1', '   ');

    expect(resposta.precisaDeHumano).toBe(true);
    expect(llm.chamadas).toHaveLength(0);
  });

  it('avisa com mensagem clara quando o tenant não existe', async () => {
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake() });

    await expect(motor.responder('inexistente', 'contato-1', 'oi')).rejects.toThrow(
      /Tenant "inexistente" não encontrado/,
    );
  });
});

describe('turno social', () => {
  const DOCUMENTO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';

  /** Embedder que conta chamadas: um turno social não pode nem buscar. */
  class EmbedderEspiao extends EmbedderFake {
    chamadas = 0;

    override async gerar(textos: string[]) {
      this.chamadas += 1;
      return super.gerar(textos);
    }
  }

  it('NÃO chama a equipe por causa de um "boa tarde"', async () => {
    // O caso real: "boa tarde" tirou 0.370 na busca, abaixo do limiar de 0.40,
    // e virou handoff. Um atendente era acionado para responder a um
    // cumprimento.
    semear([DOCUMENTO]);
    const motor = new Motor({
      db,
      embedder: new EmbedderFake(),
      llm: new LlmFake('Boa tarde! Como posso ajudar você hoje?'),
    });

    const resposta = await motor.responder(SLUG, 'contato-1', 'boa tarde');

    expect(resposta.precisaDeHumano).toBe(false);
    expect(resposta.motivoDoHandoff).toBeUndefined();
    expect(resposta.turnoSocial).toBe('saudacao');
    expect(resposta.texto).toBe('Boa tarde! Como posso ajudar você hoje?');
  });

  it('deixa a conversa aberta, então a pergunta seguinte é respondida', async () => {
    // A consequência mais grave do bug antigo: o handoff marcava a conversa e
    // `bloquearBotAposHandoff` calava o bot. Quem dissesse "boa tarde" antes
    // de perguntar nunca receberia resposta.
    semear([DOCUMENTO]);
    const motor = new Motor({
      db,
      embedder: new EmbedderFake(),
      llm: new LlmFake('Boa tarde! Como posso ajudar?'),
    });

    await motor.responder(SLUG, 'contato-1', 'boa tarde');
    const depois = await motor.responder(SLUG, 'contato-1', 'clínica abre segunda sexta horas');

    expect(depois.aguardandoHumano).toBe(false);
    expect(depois.texto.length).toBeGreaterThan(0);
    expect(depois.fontes[0]?.arquivo).toBe('faq.md');
  });

  it('não registra pergunta sem resposta, que suja a lista de buracos da base', async () => {
    // A lista de `unanswered` é o que diz qual documento falta escrever.
    // "boa tarde" ali dentro é ruído puro.
    semear([DOCUMENTO]);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake('Olá!') });

    await motor.responder(SLUG, 'contato-1', 'boa tarde');

    const total = db.prepare('SELECT COUNT(*) AS t FROM unanswered').get() as { t: number };
    expect(total.t).toBe(0);
  });

  it('não busca nem gasta embedding', async () => {
    semear([DOCUMENTO]);
    const embedder = new EmbedderEspiao();
    const motor = new Motor({ db, embedder, llm: new LlmFake('Olá!') });

    const resposta = await motor.responder(SLUG, 'contato-1', 'oi');

    expect(embedder.chamadas).toBe(0);
    expect(resposta.fontes).toEqual([]);
    expect(resposta.melhorScore).toBe(0);
  });

  it('usa o prompt social, e não o de contexto', async () => {
    // O prompt normal manda responder a frase de handoff quando o contexto não
    // tem a resposta. Reaproveitá-lo com contexto vazio devolveria o bug.
    semear([DOCUMENTO]);
    const llm = new LlmFake('Olá! Como posso ajudar?');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder(SLUG, 'contato-1', 'oi');

    const chamada = llm.chamadas[0];
    expect(chamada?.promptDoSistema).toContain('apenas social');
    expect(chamada?.promptDoSistema).toContain('Clínica de Teste');
    expect(chamada?.promptDoSistema).not.toContain('CONTEXTO');
    expect(chamada?.mensagemDoUsuario).toBe('oi');
  });

  it('manda o histórico junto, para "boa noite" no fim virar despedida', async () => {
    semear([DOCUMENTO]);
    const llm = new LlmFake('Até logo!');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder(SLUG, 'contato-1', 'oi');
    await motor.responder(SLUG, 'contato-1', 'obrigado');

    expect(llm.chamadas[1]?.historico.length).toBeGreaterThan(0);
  });

  it('continua respondendo normalmente a pergunta com saudação junto', async () => {
    semear([DOCUMENTO]);
    const llm = new LlmFake();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const resposta = await motor.responder(
      SLUG,
      'contato-1',
      'oi, clínica abre segunda sexta horas',
    );

    expect(resposta.turnoSocial).toBeUndefined();
    expect(resposta.fontes[0]?.arquivo).toBe('faq.md');
    expect(llm.chamadas[0]?.mensagemDoUsuario).toContain('CONTEXTO:');
  });

  it('escala assim mesmo se o modelo prometer chamar alguém', async () => {
    // O prompt social proíbe, mas já aconteceu duas vezes neste projeto de o
    // modelo prometer atendente e a promessa passar batida. Promessa feita,
    // alguém é chamado.
    semear([DOCUMENTO]);
    const motor = new Motor({
      db,
      embedder: new EmbedderFake(),
      llm: new LlmFake('Oi! Vou chamar alguém da equipe para te ajudar.'),
    });

    const resposta = await motor.responder(SLUG, 'contato-1', 'oi');

    expect(resposta.precisaDeHumano).toBe(true);
    expect(resposta.motivoDoHandoff).toBe('baixa_confianca');
  });
});

describe('limitarLinhas', () => {
  it('descarta linhas em branco antes de contar', () => {
    expect(limitarLinhas('a\n\n\nb', 3)).toBe('a\nb');
  });

  it('não mexe em resposta que já cabe', () => {
    expect(limitarLinhas('uma linha só', 3)).toBe('uma linha só');
  });
});

describe('pediuAjudaHumana', () => {
  const frase = config.resposta.fraseDeHandoff;

  it('reconhece a frase exata', () => {
    expect(pediuAjudaHumana(frase)).toBe(true);
  });

  it('reconhece a frase em minúsculas e no meio do texto', () => {
    expect(pediuAjudaHumana(`Sobre isso, ${frase.toLowerCase()} Até logo.`)).toBe(true);
  });

  it('reconhece a frase sem acentos e com espaços a mais', () => {
    expect(pediuAjudaHumana('Nao  tenho essa  informacao aqui. Vou chamar alguem da equipe para te ajudar.')).toBe(true);
  });

  it('reconhece a promessa de escalar mesmo com a primeira oração parafraseada', () => {
    // Caso real observado medindo estabilidade em 5 rodadas (2026-09-24):
    // o modelo trocou "não tenho essa informação" por "não tenho informação
    // sobre desconto à vista" e escapou da detecção. A resposta foi marcada
    // como resolvida embora o bot tivesse prometido chamar alguém.
    const parafraseada =
      'Os valores de tabela particular são válidos para pagamento à vista. ' +
      'Não tenho informação sobre desconto à vista aqui. Vou chamar alguém da equipe para te ajudar.';

    expect(pediuAjudaHumana(parafraseada)).toBe(true);
  });

  it('reconhece a promessa de escalar sozinha, sem a frase completa', () => {
    expect(pediuAjudaHumana('Vou chamar alguém da equipe para te ajudar com isso.')).toBe(true);
    expect(pediuAjudaHumana('vou chamar alguem da equipe')).toBe(true);
  });

  it('não confunde uma resposta normal com handoff', () => {
    expect(pediuAjudaHumana('Aos sábados, o atendimento é das 8h às 12h.')).toBe(false);
    expect(pediuAjudaHumana('A clínica tem três dentistas na equipe.')).toBe(false);
    expect(pediuAjudaHumana('Um responsável precisa acompanhar a criança.')).toBe(false);
  });
});
