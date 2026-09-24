/** Testes dos números do painel. Offline. */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { mudarStatus } from '../src/storage/repositories/conversations.js';
import { montarPainel } from '../src/core/painel/painel-service.js';
import { Motor } from '../src/core/engine.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmFake } from './helpers/fake-llm.js';

const SLUG = 'clinica';
const TEXTO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';
const PERGUNTA_BOA = 'clínica abre segunda sexta horas';
const PERGUNTA_RUIM = 'vocês vendem pizza calabresa congelada';

let db: Db;

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

function motor(): Motor {
  return new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake() });
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  semear();
});

describe('montarPainel', () => {
  it('devolve painel zerado, e não erro, para tenant sem movimento', async () => {
    const painel = montarPainel(db, SLUG);

    expect(painel.conversas.total).toBe(0);
    expect(painel.taxaDeResolucao).toBe(0);
    expect(painel.custo.acumuladoUsd).toBe(0);
    expect(painel.custo.medioPorMensagemUsd).toBe(0);
    expect(painel.perguntasSemResposta).toEqual([]);
  });

  it('conta conversas por status', async () => {
    const m = motor();
    await m.responder(SLUG, 'c1', PERGUNTA_BOA, { canal: 'web' });
    await m.responder(SLUG, 'c2', PERGUNTA_RUIM, { canal: 'web' });

    const c3 = await m.responder(SLUG, 'c3', PERGUNTA_BOA, { canal: 'web' });
    mudarStatus(db, c3.conversaId as number, 'closed');

    const painel = montarPainel(db, SLUG);

    expect(painel.conversas.total).toBe(3);
    expect(painel.conversas.abertas).toBe(1);
    expect(painel.conversas.emHandoff).toBe(1);
    expect(painel.conversas.fechadas).toBe(1);
  });

  it('a taxa de resolução conta por conversa, não por mensagem', async () => {
    // Uma conversa com 5 acertos e 1 handoff no fim NÃO foi resolvida pelo bot:
    // alguém da equipe teve de entrar. Contar por mensagem esconderia isso.
    const m = motor();

    await m.responder(SLUG, 'c1', PERGUNTA_BOA, { canal: 'web' });
    await m.responder(SLUG, 'c1', PERGUNTA_BOA, { canal: 'web' });
    await m.responder(SLUG, 'c1', PERGUNTA_RUIM, { canal: 'web' });

    await m.responder(SLUG, 'c2', PERGUNTA_BOA, { canal: 'web' });

    const painel = montarPainel(db, SLUG);

    expect(painel.conversas.total).toBe(2);
    expect(painel.taxaDeResolucao).toBe(0.5);
  });

  it('soma o custo acumulado e calcula o médio por resposta do bot', async () => {
    const m = motor();
    await m.responder(SLUG, 'c1', PERGUNTA_BOA, { canal: 'web' });
    await m.responder(SLUG, 'c2', PERGUNTA_BOA, { canal: 'web' });

    const painel = montarPainel(db, SLUG);

    expect(painel.mensagens.total).toBe(4);
    expect(painel.mensagens.doBot).toBe(2);
    expect(painel.custo.acumuladoUsd).toBeGreaterThan(0);
    expect(painel.custo.medioPorMensagemUsd).toBeCloseTo(painel.custo.acumuladoUsd / 2, 10);
  });

  it('lista as perguntas sem resposta com o score, para calibrar o limiar', async () => {
    await motor().responder(SLUG, 'c1', PERGUNTA_RUIM, { canal: 'web' });

    const painel = montarPainel(db, SLUG);

    expect(painel.perguntasSemResposta).toHaveLength(1);
    expect(painel.perguntasSemResposta[0]?.pergunta).toBe(PERGUNTA_RUIM);
    expect(painel.perguntasSemResposta[0]?.melhorScore).toBeGreaterThanOrEqual(0);
  });

  it('resume cada conversa com contagem, custo e última mensagem', async () => {
    await motor().responder(SLUG, 'contato-1', PERGUNTA_BOA, { canal: 'web' });

    const [conversa] = montarPainel(db, SLUG).listaDeConversas;

    expect(conversa?.contatoId).toBe('contato-1');
    expect(conversa?.canal).toBe('web');
    expect(conversa?.totalDeMensagens).toBe(2);
    expect(conversa?.custoUsd).toBeGreaterThan(0);
    expect(conversa?.ultimaMensagem).toContain('Abrimos');
  });

  it('não mistura os números de tenants diferentes', async () => {
    // O painel de um cliente não pode mostrar movimento de outro.
    salvarTenant(db, { slug: 'outra', nome: 'Outra', config: {}, promptDoSistema: 'p' });
    await motor().responder(SLUG, 'c1', PERGUNTA_BOA, { canal: 'web' });

    expect(montarPainel(db, SLUG).conversas.total).toBe(1);
    expect(montarPainel(db, 'outra').conversas.total).toBe(0);
  });

  it('respeita o limite da lista de conversas', async () => {
    const m = motor();
    for (let i = 0; i < 5; i++) {
      await m.responder(SLUG, `contato-${i}`, PERGUNTA_BOA, { canal: 'web' });
    }

    expect(montarPainel(db, SLUG, 3).listaDeConversas).toHaveLength(3);
    expect(montarPainel(db, SLUG).conversas.total).toBe(5);
  });
});
