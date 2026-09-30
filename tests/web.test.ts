/**
 * Testes do adaptador web.
 *
 * Sobem o servidor de verdade numa porta efêmera, com dublês de embedder e LLM.
 * É HTTP real (fetch, status, JSON), mas offline e grátis.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { Motor } from '../src/core/engine.js';
import { criarServidor } from '../src/adapters/web/rotas.js';
import type { RespostaDoBot } from '../src/core/types.js';
import type { PainelDoTenant } from '../src/core/painel/painel-service.js';
import type { MensagemGravada } from '../src/storage/repositories/messages.js';
import { conversaAtiva, obterOuCriarConversa } from '../src/storage/repositories/conversations.js';
import type { RelatorioDeConversa } from '../src/core/conversation/auditoria.js';
import { AgrupadorDeMensagens } from '../src/core/conversation/agrupador.js';
import { mensagensApos } from '../src/storage/repositories/messages.js';
import type { RegistroDeAvaliacao } from '../src/core/avaliacao/log.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmQueDesiste } from './helpers/fake-llm.js';

const SLUG = 'clinica';
const TEXTO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';
const PERGUNTA_BOA = 'clínica abre segunda sexta horas';
const PERGUNTA_RUIM = 'vocês vendem pizza calabresa congelada';

let db: Db;
let servidor: Server;
let base: string;

function semear(): void {
  const tenant = salvarTenant(db, {
    slug: SLUG,
    nome: 'Clínica de Teste',
    config: {},
    promptDoSistema: 'p',
  });

  const documentId = salvarDocumento(db, tenant.id, 'faq.md', TEXTO);
  inserirChunks(db, [
    {
      documentId,
      tenantId: tenant.id,
      indice: 0,
      texto: TEXTO,
      embedding: vetorDeTexto(TEXTO),
      metadados: { secao: 'Horários' },
    },
  ]);
}

/** Lê o corpo já tipado: `Response.json()` devolve `unknown` neste tsconfig. */
async function corpo<T>(resposta: Response): Promise<T> {
  return (await resposta.json()) as T;
}

function mandar(texto: string, contatoId = 'contato-1'): Promise<Response> {
  return fetch(`${base}/api/mensagem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contatoId, texto }),
  });
}

beforeEach(async () => {
  db = abrirBanco(':memory:');
  semear();

  const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmQueDesiste() });
  servidor = criarServidor({ motor, db, slug: SLUG });

  // Porta 0: o sistema escolhe uma livre, então os testes não brigam entre si
  // nem com um servidor que você tenha deixado rodando.
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  db.close();
});

describe('POST /api/mensagem', () => {
  it('responde com o texto e as fontes', async () => {
    const resposta = await mandar(PERGUNTA_BOA);
    const dados = await corpo<RespostaDoBot>(resposta);

    expect(resposta.status).toBe(200);
    expect(dados.texto).toBe('Abrimos de segunda a sexta, das 8h às 18h.');
    expect(dados.fontes[0]?.arquivo).toBe('faq.md');
    expect(dados.precisaDeHumano).toBe(false);
  });

  it('marca o canal como web na conversa criada', async () => {
    await mandar(PERGUNTA_BOA);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.listaDeConversas[0]?.canal).toBe('web');
  });

  it('preserva acentuação no caminho de ida e volta', async () => {
    // Se o corpo não for lido como UTF-8, "crianças" chega quebrado ao
    // embedding e a busca degrada silenciosamente.
    const comAcento = 'vocês atendem crianças? é urgente';
    const resposta = await corpo<RespostaDoBot>(await mandar(comAcento, 'contato-utf8'));

    // Confere na mensagem gravada, e não na lista de perguntas sem resposta:
    // desde que o limiar deixou de barrar, esta pergunta é respondida em vez
    // de virar handoff — mas a acentuação continua tendo de sobreviver.
    const dados = await corpo<{ mensagens: MensagemGravada[] }>(
      await fetch(`${base}/api/conversa?id=${resposta.conversaId}`),
    );

    expect(dados.mensagens[0]?.conteudo).toBe(comAcento);
  });

  it('recusa corpo sem contatoId ou sem texto', async () => {
    const semTexto = await mandar('   ');
    expect(semTexto.status).toBe(400);

    const semContato = await mandar(PERGUNTA_BOA, '');
    expect(semContato.status).toBe(400);
  });

  it('recusa corpo que não é JSON', async () => {
    const resposta = await fetch(`${base}/api/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'isto não é json',
    });

    expect(resposta.status).toBe(500);
    expect((await corpo<{ erro: string }>(resposta)).erro).toMatch(/JSON/);
  });

  it('sinaliza aguardandoHumano depois do handoff, em vez de responder', async () => {
    await mandar(PERGUNTA_RUIM, 'contato-handoff');
    const depois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-handoff'));

    expect(depois.aguardandoHumano).toBe(true);
    expect(depois.texto).toBe('');
  });
});

describe('GET /api/painel', () => {
  it('devolve os números do tenant', async () => {
    await mandar(PERGUNTA_BOA);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.tenant.slug).toBe(SLUG);
    expect(painel.ajustes.limiarDeConfianca).toBeGreaterThan(0);
    expect(painel.conversas.total).toBe(1);
    expect(painel.custo.acumuladoUsd).toBeGreaterThan(0);
  });

  it('lista a pergunta sem resposta depois de um handoff', async () => {
    await mandar(PERGUNTA_RUIM);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.perguntasSemResposta).toHaveLength(1);
    expect(painel.taxaDeResolucao).toBe(0);
  });
});

describe('GET /api/conversa', () => {
  it('devolve as mensagens da conversa', async () => {
    const primeira = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA));
    const dados = await corpo<{ mensagens: MensagemGravada[] }>(
      await fetch(`${base}/api/conversa?id=${primeira.conversaId}`),
    );

    expect(dados.mensagens).toHaveLength(2);
    expect(dados.mensagens[0]?.papel).toBe('user');
  });

  it('devolve o relatório de aproveitamento junto', async () => {
    const primeira = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA));
    const dados = await corpo<{ relatorio: RelatorioDeConversa }>(
      await fetch(`${base}/api/conversa?id=${primeira.conversaId}`),
    );

    expect(dados.relatorio.turnos).toBe(1);
    expect(dados.relatorio.aproveitamento).toBe(1);
    expect(dados.relatorio.problemas).toEqual([]);
  });

  it('recusa id inválido', async () => {
    expect((await fetch(`${base}/api/conversa?id=abc`)).status).toBe(400);
    expect((await fetch(`${base}/api/conversa`)).status).toBe(400);
  });

  it('NÃO entrega a conversa de outro cliente', async () => {
    // Sem o filtro por tenant, trocar o número na URL leria o atendimento de
    // outra clínica — e o transcrito tem nome e telefone de gente.
    const outro = salvarTenant(db, {
      slug: 'outra',
      nome: 'Outra',
      config: {},
      promptDoSistema: 'p',
    });
    const conversaAlheia = obterOuCriarConversa(db, outro.id, 'contato-de-fora', 'web');

    const resposta = await fetch(`${base}/api/conversa?id=${conversaAlheia.id}`);

    expect(resposta.status).toBe(404);
    expect(JSON.stringify(await resposta.json())).not.toContain('contato-de-fora');
  });
});

describe('POST /api/conversa/reiniciar', () => {
  function reiniciar(contatoId: string): Promise<Response> {
    return fetch(`${base}/api/conversa/reiniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contatoId }),
    });
  }

  it('encerra a conversa em andamento e a próxima mensagem começa outra', async () => {
    const primeira = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-r'));
    await reiniciar('contato-r');
    const segunda = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-r'));

    expect(segunda.conversaId).not.toBe(primeira.conversaId);
  });

  it('DESTRAVA uma conversa presa em handoff', async () => {
    // A razão de existir do botão. Depois de um handoff o bot fica mudo de
    // propósito; sem uma forma de encerrar, o único jeito de voltar a
    // conversar era trocar de contato.
    await mandar(PERGUNTA_RUIM, 'contato-preso');
    const mudo = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-preso'));
    expect(mudo.aguardandoHumano).toBe(true);

    await reiniciar('contato-preso');
    const depois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-preso'));

    expect(depois.aguardandoHumano).toBe(false);
    expect(depois.texto.length).toBeGreaterThan(0);
  });

  it('não apaga o histórico, que é o que alimenta o painel', async () => {
    // Testar de novo não pode jogar fora o que o teste anterior produziu.
    await mandar(PERGUNTA_BOA, 'contato-h');
    await reiniciar('contato-h');

    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));
    expect(painel.mensagens.total).toBe(2);
    expect(painel.conversas.fechadas).toBe(1);
  });

  it('não zera o histórico de outro contato', async () => {
    await mandar(PERGUNTA_BOA, 'contato-a');
    const doB = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-b'));

    await reiniciar('contato-a');
    const bDepois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-b'));

    expect(bDepois.conversaId).toBe(doB.conversaId);
  });

  it('responde sem erro quando não há conversa para encerrar', async () => {
    const resposta = await reiniciar('contato-que-nunca-falou');

    expect(resposta.status).toBe(200);
    expect((await corpo<{ encerrada: number | null }>(resposta)).encerrada).toBeNull();
  });

  it('recusa corpo sem contatoId', async () => {
    expect((await reiniciar('')).status).toBe(400);
  });
});

describe('agenda', () => {
  /** Segunda-feira longe o bastante para caber em qualquer horizonte. */
  const SEGUNDA = proximaSegunda();

  function proximaSegunda(): string {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function marcar(corpoDaRequisicao: Record<string, unknown>): Promise<Response> {
    return fetch(`${base}/api/agenda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoDaRequisicao),
    });
  }

  it('lista os horários livres do dia pedido', async () => {
    const dados = await corpo<{ livres: { hora: string }[]; duracaoMin: number }>(
      await fetch(`${base}/api/agenda?data=${SEGUNDA}`),
    );

    expect(dados.duracaoMin).toBeGreaterThan(0);
    expect(dados.livres.map((s) => s.hora)).toContain('09:00');
  });

  it('marca e devolve o agendamento', async () => {
    const resposta = await marcar({
      inicio: `${SEGUNDA} 09:00`,
      nome: 'Maria Silva',
      servico: 'limpeza',
    });
    const dados = await corpo<{ agendamento: { nome: string; inicio: string } }>(resposta);

    expect(resposta.status).toBe(200);
    expect(dados.agendamento.nome).toBe('Maria Silva');
    expect(dados.agendamento.inicio).toBe(`${SEGUNDA} 09:00`);
  });

  it('responde 409 na dupla marcação, e não 400', async () => {
    // Conflito não é erro de quem preencheu: o horário estava livre quando a
    // tela carregou. A página usa o status para pedir que recarregue, em vez
    // de acusar o usuário.
    await marcar({ inicio: `${SEGUNDA} 10:00`, nome: 'Maria' });
    const segunda = await marcar({ inicio: `${SEGUNDA} 10:00`, nome: 'João' });

    expect(segunda.status).toBe(409);
    expect((await corpo<{ motivo: string }>(segunda)).motivo).toBe('conflito');
  });

  it('responde 400 com o motivo quando o horário não existe na grade', async () => {
    const resposta = await marcar({ inicio: `${SEGUNDA} 12:00`, nome: 'Maria' });

    expect(resposta.status).toBe(400);
    expect((await corpo<{ motivo: string }>(resposta)).motivo).toBe('fora_do_horario');
  });

  it('o horário some dos livres depois de marcado e volta ao cancelar', async () => {
    const criado = await corpo<{ agendamento: { id: number } }>(
      await marcar({ inicio: `${SEGUNDA} 11:00`, nome: 'Maria' }),
    );

    const ocupado = await corpo<{ livres: { hora: string }[] }>(
      await fetch(`${base}/api/agenda?data=${SEGUNDA}`),
    );
    expect(ocupado.livres.map((s) => s.hora)).not.toContain('11:00');

    await fetch(`${base}/api/agenda?id=${criado.agendamento.id}`, { method: 'DELETE' });

    const livre = await corpo<{ livres: { hora: string }[] }>(
      await fetch(`${base}/api/agenda?data=${SEGUNDA}`),
    );
    expect(livre.livres.map((s) => s.hora)).toContain('11:00');
  });

  it('altera o horário', async () => {
    const criado = await corpo<{ agendamento: { id: number } }>(
      await marcar({ inicio: `${SEGUNDA} 14:00`, nome: 'Maria' }),
    );

    const resposta = await fetch(`${base}/api/agenda`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: criado.agendamento.id, inicio: `${SEGUNDA} 15:00` }),
    });

    expect(resposta.status).toBe(200);
    expect((await corpo<{ agendamento: { inicio: string } }>(resposta)).agendamento.inicio).toBe(
      `${SEGUNDA} 15:00`,
    );
  });

  it('recusa id inválido em alterar e cancelar', async () => {
    expect((await fetch(`${base}/api/agenda?id=abc`, { method: 'DELETE' })).status).toBe(400);

    const semId = await fetch(`${base}/api/agenda`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inicio: `${SEGUNDA} 15:00` }),
    });
    expect(semId.status).toBe(400);
  });
});

describe('bateria de testes', () => {
  function rodarTestes(perguntas: unknown): Promise<Response> {
    return fetch(`${base}/api/testes/rodar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perguntas }),
    });
  }

  it('GET devolve o modelo e o limiar em vigor', async () => {
    const dados = await corpo<{
      tenant: { slug: string };
      modelo: string;
      limiar: number;
      existe: boolean;
      perguntas: unknown[];
    }>(await fetch(`${base}/api/testes`));

    expect(dados.tenant.slug).toBe(SLUG);
    expect(dados.modelo.length).toBeGreaterThan(0);
    expect(dados.limiar).toBeGreaterThan(0);
    // O tenant deste teste não tem pasta em data/tenants, então não há arquivo.
    expect(dados.existe).toBe(false);
    expect(dados.perguntas).toEqual([]);
  });

  it('roda uma pergunta e devolve o veredito com as métricas', async () => {
    const resposta = await rodarTestes([
      { id: 'fora-do-dominio', pergunta: PERGUNTA_RUIM, esperaHandoff: true },
    ]);
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(resposta);
    const resultado = dados.resultados[0];

    expect(resposta.status).toBe(200);
    expect(resultado?.id).toBe('fora-do-dominio');
    expect(resultado?.passou).toBe(true);
    expect(resultado?.houveHandoff).toBe(true);
    expect(resultado?.latenciaMs).toBeGreaterThanOrEqual(0);
  });

  it('aplica a regra global de número inventado, igual ao npm run avaliar', async () => {
    // O dublê responde "das 8h às 18h" enquanto o chunk diz "das oito às
    // dezoito horas": os horários da resposta não têm origem documental. Se a
    // página julgasse com outro código que o da suíte, isto passaria aqui e
    // falharia lá — e nenhum dos dois serviria para calibrar.
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(
      await rodarTestes([{ id: 'horario', pergunta: PERGUNTA_BOA, esperaHandoff: false }]),
    );
    const resultado = dados.resultados[0];

    expect(resultado?.passou).toBe(false);
    expect(resultado?.falhas.map((f) => f.regra)).toContain('numeroInventado');
  });

  it('roda um grupo inteiro numa chamada, preservando a ordem', async () => {
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(
      await rodarTestes([
        { id: 'primeira', pergunta: PERGUNTA_RUIM, esperaHandoff: true },
        { id: 'segunda', pergunta: PERGUNTA_BOA, esperaHandoff: false },
      ]),
    );

    expect(dados.resultados.map((r) => r.id)).toEqual(['primeira', 'segunda']);
  });

  it('NÃO cria conversa nem handoff ao rodar', async () => {
    // A suíte roda com semPersistir. Sem isso, calibrar pela página encheria o
    // painel de conversas que nunca existiram e a fila da equipe de handoffs
    // que nenhum cliente pediu.
    await rodarTestes([{ id: 'fora', pergunta: PERGUNTA_RUIM, esperaHandoff: true }]);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.conversas.total).toBe(0);
    expect(painel.perguntasSemResposta).toEqual([]);
  });

  it('recusa rodar com campo desconhecido, antes de gastar', async () => {
    // Rodar assim custaria dinheiro para produzir um "passou" que não checou
    // nada: `deveConterr` com dois r não é regra nenhuma.
    const resposta = await rodarTestes([
      { id: 'a', pergunta: 'quanto custa?', deveConterr: ['180'] },
    ]);

    expect(resposta.status).toBe(400);
    expect((await corpo<{ erros: string[] }>(resposta)).erros.join(' ')).toContain('deveConterr');
  });

  it('recusa rodar lista vazia ou ausente', async () => {
    expect((await rodarTestes([])).status).toBe(400);
    expect((await rodarTestes(undefined)).status).toBe(400);
  });

  it('PUT recusa suíte inválida sem escrever nada', async () => {
    const resposta = await fetch(`${base}/api/testes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        perguntas: [
          { id: 'mesmo', pergunta: 'primeira?' },
          { id: 'mesmo', pergunta: 'segunda?' },
        ],
      }),
    });

    expect(resposta.status).toBe(400);
    expect((await corpo<{ erros: string[] }>(resposta)).erros.join(' ')).toContain('repetido');
  });
});

describe('arquivos estáticos', () => {
  it('serve a página de conversa na raiz', async () => {
    const resposta = await fetch(`${base}/`);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('text/html');
    expect(await resposta.text()).toContain('<title>Simulador de atendimento</title>');
  });

  it('serve o painel', async () => {
    expect((await fetch(`${base}/painel`)).status).toBe(200);
  });

  it('serve a agenda', async () => {
    const resposta = await fetch(`${base}/agenda`);

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain('<title>Agenda</title>');
  });

  it('serve a bateria de testes', async () => {
    const resposta = await fetch(`${base}/testes`);

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain('<title>Bateria de testes</title>');
  });

  it('serve o CSS com o tipo certo', async () => {
    const resposta = await fetch(`${base}/estilo.css`);
    expect(resposta.headers.get('content-type')).toContain('text/css');
  });

  it('devolve 404 para arquivo que não existe', async () => {
    expect((await fetch(`${base}/nao-existe.html`)).status).toBe(404);
  });

  it('NÃO serve arquivo de fora da pasta de páginas', async () => {
    // Sem esta barreira, "../../../.env" entregaria a chave da OpenAI a
    // qualquer um que soubesse pedir.
    const tentativas = [
      '/%2e%2e%2f%2e%2e%2f%2e%2e%2f.env',
      '/..%2f..%2f..%2f.env',
      '/%2e%2e/%2e%2e/%2e%2e/package.json',
    ];

    for (const caminho of tentativas) {
      const resposta = await fetch(`${base}${caminho}`);
      expect([403, 404]).toContain(resposta.status);

      const corpo = await resposta.text();
      expect(corpo).not.toContain('OPENAI_API_KEY');
      expect(corpo).not.toContain('"dependencies"');
    }
  });
});

describe('agrupamento de mensagens seguidas', () => {
  // Um servidor à parte, com agrupador e espera curta. Os outros testes
  // sobem sem agrupador de propósito: uma resposta por mensagem mantém
  // simples tudo que não trata deste assunto.
  let comAgrupador: Server;
  let baseAgrupada: string;
  let agrupador: AgrupadorDeMensagens;

  beforeEach(async () => {
    // Espera folgada de propósito: sob carga, um setTimeout de 20ms estoura
    // fácil os 60ms, e o teste virava moeda. O que se mede aqui é o
    // agrupamento, não a precisão do relógio.
    agrupador = new AgrupadorDeMensagens({ esperaMs: 300, esperaMaximaMs: 3000 });
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmQueDesiste() });
    comAgrupador = criarServidor({ motor, db, slug: SLUG, agrupador });

    await new Promise<void>((resolve) => comAgrupador.listen(0, '127.0.0.1', resolve));
    baseAgrupada = `http://127.0.0.1:${(comAgrupador.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    agrupador.encerrar();
    await new Promise<void>((resolve) => comAgrupador.close(() => resolve()));
  });

  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Três mensagens como gente digita: espaçadas, não simultâneas.
   *
   * Disparar as três no mesmo instante fazia o teste oscilar — a ordem de
   * chegada de requisições HTTP concorrentes não é garantida, e o lote sai na
   * ordem em que chegou. A limitação é real: quando o adaptador de WhatsApp
   * entrar, ele vai precisar ordenar pelo timestamp do webhook.
   */
  async function tresSeguidas(): Promise<Promise<Response>[]> {
    const primeira = mandarAgrupada(PERGUNTA_BOA);
    await esperar(15);
    const segunda = mandarAgrupada('pra sexta');
    await esperar(15);
    const terceira = mandarAgrupada('as 9');

    return [primeira, segunda, terceira];
  }

  function mandarAgrupada(texto: string, contatoId = 'contato-junto'): Promise<Response> {
    return fetch(`${baseAgrupada}/api/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contatoId, texto }),
    });
  }

  it('três mensagens seguidas viram UMA resposta', async () => {
    // O caso real: o cliente escreveu o pedido em três mensagens e levou três
    // respostas, uma para cada pedaço.
    const respostas = await Promise.all(await tresSeguidas());

    const corpos = await Promise.all(respostas.map((r) => corpo<Record<string, unknown>>(r)));
    const agrupadas = corpos.filter((c) => c.agrupada === true);
    const respondidas = corpos.filter((c) => c.agrupada !== true);

    expect(agrupadas).toHaveLength(2);
    expect(respondidas).toHaveLength(1);
  });

  it('grava UM par user/assistant, com os três pedaços na linha do cliente', async () => {
    await Promise.all(await tresSeguidas());

    const conversa = conversaAtiva(db, 1, 'contato-junto');
    const mensagens = mensagensApos(db, conversa?.id ?? 0, 0);

    expect(mensagens).toHaveLength(2);
    expect(mensagens[0]?.papel).toBe('user');
    expect(mensagens[0]?.conteudo).toBe([PERGUNTA_BOA, 'pra sexta', 'as 9'].join('\n'));
    expect(mensagens[1]?.papel).toBe('assistant');
  });

  it('mensagem isolada continua respondida normalmente', async () => {
    const dados = await corpo<RespostaDoBot>(await mandarAgrupada(PERGUNTA_BOA));

    expect(dados.texto.length).toBeGreaterThan(0);
    expect(dados.conversaId).toBeDefined();
  });

  it('continua recusando corpo inválido antes de agrupar', async () => {
    // A validação vem primeiro: mensagem vazia não pode nem abrir um lote.
    const resposta = await fetch(`${baseAgrupada}/api/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contatoId: 'c', texto: '   ' }),
    });

    expect(resposta.status).toBe(400);
  });
});
