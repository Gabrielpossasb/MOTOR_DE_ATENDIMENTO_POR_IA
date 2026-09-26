/**
 * Testes da memória compactada da conversa.
 *
 * O que este recurso existe para evitar: numa conversa longa, as primeiras
 * mensagens caem fora da janela de contexto e o cliente precisa repetir o que
 * já contou. O resumo fica no lugar do que saiu.
 *
 * Tudo offline: o LLM é um dublê que responde diferente conforme o prompt, o
 * que permite separar a chamada de resumo da chamada de resposta.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { lerResumo } from '../src/storage/repositories/conversations.js';
import { contarMensagens } from '../src/storage/repositories/messages.js';
import { montarContextoDaConversa } from '../src/core/conversation/conversation-service.js';
import { Motor } from '../src/core/engine.js';
import { config } from '../src/config.js';
import type { LlmClient, RespostaDoLlm } from '../src/core/llm/client.js';
import type { TurnoDaConversa } from '../src/core/types.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';

const SLUG = 'clinica';
const TEXTO_INDEXADO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';
const PERGUNTA = 'clínica abre segunda sexta horas';
const CONTATO = 'contato-1';

/** Marca do prompt de compactação, para separar as duas chamadas. */
const MARCA_DE_RESUMO = 'compacta o histórico';

interface Chamada {
  promptDoSistema: string;
  mensagemDoUsuario: string;
  historico: TurnoDaConversa[];
}

/** Dublê que devolve texto diferente para resumo e para resposta. */
class LlmRoteirizado implements LlmClient {
  readonly modelo = 'fake';
  readonly chamadas: Chamada[] = [];

  constructor(
    private readonly resumo = 'Cliente perguntou sobre horários.',
    private readonly resposta = 'Abrimos em horário comercial.',
  ) {}

  async responder(
    promptDoSistema: string,
    mensagemDoUsuario: string,
    historico: TurnoDaConversa[] = [],
  ): Promise<RespostaDoLlm> {
    this.chamadas.push({ promptDoSistema, mensagemDoUsuario, historico });

    return ehResumo(promptDoSistema)
      ? { texto: this.resumo, tokensEntrada: 200, tokensSaida: 50 }
      : { texto: this.resposta, tokensEntrada: 100, tokensSaida: 20 };
  }

  get deResumo(): Chamada[] {
    return this.chamadas.filter((c) => ehResumo(c.promptDoSistema));
  }

  get deResposta(): Chamada[] {
    return this.chamadas.filter((c) => !ehResumo(c.promptDoSistema));
  }
}

function ehResumo(prompt: string): boolean {
  return prompt.includes(MARCA_DE_RESUMO);
}

let db: Db;

function semear(): void {
  const tenant = salvarTenant(db, {
    slug: SLUG,
    nome: 'Clínica de Teste',
    config: {},
    promptDoSistema: 'Você é o atendente da Clínica de Teste.',
  });

  const documentId = salvarDocumento(db, tenant.id, 'faq.md', TEXTO_INDEXADO);
  inserirChunks(db, [
    {
      documentId,
      tenantId: tenant.id,
      indice: 0,
      texto: TEXTO_INDEXADO,
      embedding: vetorDeTexto(TEXTO_INDEXADO),
      metadados: { secao: 'Horários' },
    },
  ]);
}

/** Roda N turnos completos (pergunta + resposta). */
async function conversar(motor: Motor, turnos: number): Promise<void> {
  for (let i = 0; i < turnos; i++) {
    await motor.responder(SLUG, CONTATO, `${PERGUNTA} ${i}`, { canal: 'teste' });
  }
}

function idDaConversa(): number {
  return (db.prepare('SELECT id FROM conversations LIMIT 1').get() as { id: number }).id;
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  semear();
});

describe('quando compacta', () => {
  it('não compacta enquanto a conversa cabe na janela', async () => {
    // 5 turnos = 10 mensagens, mas a checagem roda ANTES de responder, então
    // no início do 5º turno havia 8 — ainda dentro da janela.
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 5);

    expect(llm.deResumo).toHaveLength(0);
    expect(lerResumo(db, idDaConversa())).toBeUndefined();
  });

  it('compacta quando a conversa passa da janela', async () => {
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 6);

    expect(llm.deResumo).toHaveLength(1);
    expect(lerResumo(db, idDaConversa())?.texto).toBe('Cliente perguntou sobre horários.');
  });

  it('preserva as mensagens recentes íntegras', async () => {
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 6);

    const total = contarMensagens(db, idDaConversa());
    const resumo = lerResumo(db, idDaConversa());
    const naJanela = db
      .prepare('SELECT COUNT(*) AS t FROM messages WHERE conversation_id = ? AND id > ?')
      .get(idDaConversa(), resumo?.ateMensagemId ?? 0) as { t: number };

    // 12 mensagens no total; as 6 primeiras foram compactadas e sobraram as 4
    // preservadas mais as 2 deste turno.
    expect(total).toBe(12);
    expect(naJanela.t).toBe(config.conversa.resumo.mensagensPreservadas + 2);
  });

  it('não compacta na avaliação, que roda sem persistir', async () => {
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    for (let i = 0; i < 8; i++) {
      await motor.responder(SLUG, CONTATO, `${PERGUNTA} ${i}`, { semPersistir: true });
    }

    expect(llm.deResumo).toHaveLength(0);
  });
});

describe('o que o modelo recebe', () => {
  it('põe o resumo no prompt de sistema da resposta seguinte', async () => {
    const llm = new LlmRoteirizado('Cliente quer saber sobre implante.');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 7);

    const ultima = llm.deResposta[llm.deResposta.length - 1];
    expect(ultima?.promptDoSistema).toContain('RESUMO DA CONVERSA ATÉ AQUI');
    expect(ultima?.promptDoSistema).toContain('Cliente quer saber sobre implante.');
  });

  it('avisa que o resumo NÃO é fonte sobre o negócio', async () => {
    // Sem esta linha, o modelo trataria a memória como documento e responderia
    // preço de cabeça, furando a regra de só responder pelo CONTEXTO.
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 7);

    const ultima = llm.deResposta[llm.deResposta.length - 1];
    expect(ultima?.promptDoSistema).toContain('NÃO é');
    expect(ultima?.promptDoSistema).toContain('CONTEXTO');
  });

  it('não manda mais as mensagens que já estão no resumo', async () => {
    // Mandar as duas coisas pagaria duas vezes pelo mesmo conteúdo e encheria
    // a janela de novo, que é o problema que o resumo veio resolver.
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 7);

    const ultima = llm.deResposta[llm.deResposta.length - 1];
    expect(ultima?.historico.length).toBeLessThanOrEqual(config.conversa.mensagensNaJanela);
    expect(ultima?.historico.some((t) => t.conteudo.includes(`${PERGUNTA} 0`))).toBe(false);
  });

  it('a memória é cumulativa: a segunda compactação leva a primeira junto', async () => {
    // Sem isso, a segunda compactação esqueceria o começo da conversa — o bug
    // que este recurso existe para não ter.
    const llm = new LlmRoteirizado('Memória anterior.');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 9);

    expect(llm.deResumo).toHaveLength(2);
    expect(llm.deResumo[1]?.mensagemDoUsuario).toContain('RESUMO ATÉ AGORA:');
    expect(llm.deResumo[1]?.mensagemDoUsuario).toContain('Memória anterior.');
  });

  it('manda a transcrição rotulada por quem falou', async () => {
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 6);

    expect(llm.deResumo[0]?.mensagemDoUsuario).toContain('Cliente:');
    expect(llm.deResumo[0]?.mensagemDoUsuario).toContain('Atendente:');
  });
});

describe('contabilidade e robustez', () => {
  it('cobra os tokens e o custo da compactação no turno em que ela acontece', async () => {
    // Custo reportado que ignora uma chamada paga é ficção.
    const llm = new LlmRoteirizado();
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 5);
    const comCompactacao = await motor.responder(SLUG, CONTATO, PERGUNTA, { canal: 'teste' });
    const semCompactacao = await motor.responder(SLUG, CONTATO, PERGUNTA, { canal: 'teste' });

    expect(llm.deResumo).toHaveLength(1);
    expect(comCompactacao.uso.tokensEntrada).toBe(300); // 100 da resposta + 200 do resumo
    expect(semCompactacao.uso.tokensEntrada).toBe(100);
    expect(comCompactacao.uso.custoEstimadoUsd).toBeGreaterThan(
      semCompactacao.uso.custoEstimadoUsd,
    );
  });

  it('resumo vazio não apaga a memória que já existia', async () => {
    const llm = new LlmRoteirizado('   ');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 6);

    expect(llm.deResumo).toHaveLength(1);
    expect(lerResumo(db, idDaConversa())).toBeUndefined();
  });

  it('montarContextoDaConversa devolve resumo e janela juntos', async () => {
    const llm = new LlmRoteirizado('A memória.');
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await conversar(motor, 6);
    const contexto = montarContextoDaConversa(db, idDaConversa());

    expect(contexto.resumo).toBe('A memória.');
    expect(contexto.historico.length).toBeGreaterThan(0);
  });

  it('sem resumo, o contexto é só a janela de sempre', () => {
    const contexto = montarContextoDaConversa(db, 999);

    expect(contexto.resumo).toBeUndefined();
    expect(contexto.historico).toEqual([]);
  });
});
