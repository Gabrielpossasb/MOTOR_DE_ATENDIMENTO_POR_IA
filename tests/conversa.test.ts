/**
 * Testes do estado de conversa, da janela de contexto e do handoff persistido.
 * Offline: embedder e LLM são dublês.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import {
  buscarConversa,
  listarConversas,
  mudarStatus,
  obterOuCriarConversa,
} from '../src/storage/repositories/conversations.js';
import {
  contarMensagens,
  custoAcumulado,
  gravarMensagem,
  ultimasMensagens,
} from '../src/storage/repositories/messages.js';
import {
  listarHandoffs,
  listarHandoffsPendentes,
  listarPerguntasSemResposta,
} from '../src/storage/repositories/handoffs.js';
import { janelaDeContexto } from '../src/core/conversation/conversation-service.js';
import { Motor } from '../src/core/engine.js';
import { config } from '../src/config.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmFake, LlmQueDesiste } from './helpers/fake-llm.js';
import type { LlmClient } from '../src/core/llm/client.js';

const SLUG = 'clinica';
const TEXTO_INDEXADO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';
const PERGUNTA_BOA = 'clínica abre segunda sexta horas';
const PERGUNTA_RUIM = 'vocês vendem pizza calabresa congelada';

let db: Db;

function semearTenant(slug = SLUG): number {
  const tenant = salvarTenant(db, {
    slug,
    nome: `Clínica ${slug}`,
    config: {},
    promptDoSistema: 'Você é o atendente da clínica.',
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

  return tenant.id;
}

/**
 * O dublê padrão desiste na pergunta fora do assunto.
 *
 * Desde que o limiar deixou de barrar, o handoff é decisão do modelo. Quem
 * testa handoff aqui precisa de um modelo que desista; quem testa o resto
 * passa o seu próprio.
 */
function motorCom(llm: LlmClient = new LlmQueDesiste()): Motor {
  return new Motor({ db, embedder: new EmbedderFake(), llm });
}

beforeEach(() => {
  db = abrirBanco(':memory:');
});

describe('estado da conversa', () => {
  it('reaproveita a mesma conversa entre mensagens do mesmo contato', async () => {
    semearTenant();
    const motor = motorCom();

    const primeira = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA, { canal: 'cli' });
    const segunda = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA, { canal: 'cli' });

    expect(primeira.conversaId).toBe(segunda.conversaId);
    expect(listarConversas(db, 1)).toHaveLength(1);
  });

  it('dá conversas separadas para contatos diferentes', async () => {
    semearTenant();
    const motor = motorCom();

    const a = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    const b = await motor.responder(SLUG, 'contato-2', PERGUNTA_BOA);

    expect(a.conversaId).not.toBe(b.conversaId);
  });

  it('não compartilha conversa entre tenants, mesmo com o mesmo contato', async () => {
    // Vazamento aqui seria mostrar a conversa de um cliente para outro.
    const clinicaA = semearTenant('clinica-a');
    const clinicaB = semearTenant('clinica-b');
    const motor = motorCom();

    await motor.responder('clinica-a', 'mesmo-numero', PERGUNTA_BOA);
    await motor.responder('clinica-b', 'mesmo-numero', PERGUNTA_BOA);

    expect(listarConversas(db, clinicaA)).toHaveLength(1);
    expect(listarConversas(db, clinicaB)).toHaveLength(1);
    expect(listarConversas(db, clinicaA)[0]?.id).not.toBe(listarConversas(db, clinicaB)[0]?.id);
  });

  it('começa uma conversa nova depois que a anterior foi fechada', async () => {
    const tenantId = semearTenant();
    const motor = motorCom();

    const primeira = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    mudarStatus(db, primeira.conversaId as number, 'closed');
    const segunda = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(segunda.conversaId).not.toBe(primeira.conversaId);
    expect(listarConversas(db, tenantId)).toHaveLength(2);
  });

  it('grava pergunta e resposta como duas mensagens', async () => {
    semearTenant();
    const motor = motorCom();

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    const mensagens = ultimasMensagens(db, resposta.conversaId as number, 10);

    expect(mensagens).toHaveLength(2);
    expect(mensagens[0]?.papel).toBe('user');
    expect(mensagens[0]?.conteudo).toBe(PERGUNTA_BOA);
    expect(mensagens[1]?.papel).toBe('assistant');
  });

  it('grava tokens, custo e latência na mensagem do bot', async () => {
    semearTenant();
    const motor = motorCom();

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    const doBot = ultimasMensagens(db, resposta.conversaId as number, 10)[1];

    expect(doBot?.tokensEntrada).toBe(120);
    expect(doBot?.tokensSaida).toBe(18);
    expect(doBot?.custoUsd).toBeGreaterThan(0);
    expect(doBot?.latenciaMs).toBeGreaterThanOrEqual(0);
    expect(doBot?.fontes[0]?.arquivo).toBe('faq.md');
  });

  it('não grava nada quando chamado com semPersistir', async () => {
    // É o modo da suíte de avaliação: roda dezenas de perguntas sem sujar o
    // histórico real nem disparar handoffs falsos para a equipe.
    const tenantId = semearTenant();
    const motor = motorCom();

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA, { semPersistir: true });

    expect(resposta.conversaId).toBeUndefined();
    expect(listarConversas(db, tenantId)).toHaveLength(0);
  });

  it('soma o custo acumulado do tenant', async () => {
    const tenantId = semearTenant();
    const motor = motorCom();

    await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    await motor.responder(SLUG, 'contato-2', PERGUNTA_BOA);

    expect(custoAcumulado(db, tenantId)).toBeGreaterThan(0);
  });
});

describe('janela de contexto', () => {
  it('manda o histórico ao modelo, do mais antigo para o mais recente', async () => {
    semearTenant();
    const llm = new LlmFake();
    const motor = motorCom(llm);

    await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);
    await motor.responder(SLUG, 'contato-1', 'e no sábado, clínica abre horas');

    const historicoDaSegunda = llm.chamadas[1]?.historico ?? [];
    expect(historicoDaSegunda).toHaveLength(2);
    expect(historicoDaSegunda[0]?.papel).toBe('user');
    expect(historicoDaSegunda[0]?.conteudo).toBe(PERGUNTA_BOA);
    expect(historicoDaSegunda[1]?.papel).toBe('assistant');
  });

  it('a primeira mensagem de uma conversa vai sem histórico', async () => {
    semearTenant();
    const llm = new LlmFake();
    const motor = motorCom(llm);

    await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(llm.chamadas[0]?.historico).toEqual([]);
  });

  it('respeita o limite da janela e mantém a ordem cronológica', () => {
    semearTenant();
    const conversa = obterOuCriarConversa(db, 1, 'contato-1', 'cli');

    for (let i = 1; i <= 10; i++) {
      gravarMensagem(db, { conversaId: conversa.id, papel: 'user', conteudo: `pergunta ${i}` });
    }

    const janela = janelaDeContexto(db, conversa.id, 4);

    expect(janela).toHaveLength(4);
    // As 4 últimas (7,8,9,10), não as 4 primeiras.
    expect(janela.map((t) => t.conteudo)).toEqual([
      'pergunta 7',
      'pergunta 8',
      'pergunta 9',
      'pergunta 10',
    ]);
  });

  it('tira a frase de handoff do histórico', () => {
    // Deixá-la no contexto ensina o modelo a repeti-la na próxima pergunta.
    semearTenant();
    const conversa = obterOuCriarConversa(db, 1, 'contato-1', 'cli');

    gravarMensagem(db, { conversaId: conversa.id, papel: 'user', conteudo: 'algo sem resposta' });
    gravarMensagem(db, {
      conversaId: conversa.id,
      papel: 'assistant',
      conteudo: config.resposta.fraseDeHandoff,
    });

    const janela = janelaDeContexto(db, conversa.id, 10);

    expect(janela).toHaveLength(1);
    expect(janela[0]?.papel).toBe('user');
  });
});

describe('handoff persistido', () => {
  it('grava handoff, pergunta sem resposta e muda o status da conversa', async () => {
    const tenantId = semearTenant();
    const motor = motorCom();

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);
    const conversaId = resposta.conversaId as number;

    expect(resposta.precisaDeHumano).toBe(true);
    expect(buscarConversa(db, conversaId)?.status).toBe('handoff');

    const handoffs = listarHandoffs(db, conversaId);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.motivo).toBe('baixa_confianca');

    const semResposta = listarPerguntasSemResposta(db, tenantId);
    expect(semResposta).toHaveLength(1);
    expect(semResposta[0]?.pergunta).toBe(PERGUNTA_RUIM);
  });

  it('guarda o best_score em unanswered, que é o dado para calibrar o limiar', async () => {
    const tenantId = semearTenant();
    const motor = motorCom();

    await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);

    const [registro] = listarPerguntasSemResposta(db, tenantId);
    expect(registro?.melhorScore).toBeGreaterThanOrEqual(0);
    expect(registro?.melhorScore).toBeLessThan(config.busca.limiarDeConfianca);
  });

  it('o bot para de responder depois que a conversa vai para um humano', async () => {
    // Continuar respondendo atropelaria o atendente no meio do atendimento.
    semearTenant();
    const llm = new LlmQueDesiste();
    const motor = motorCom(llm);

    await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);
    const chamadasAntes = llm.chamadas.length;

    const seguinte = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(seguinte.aguardandoHumano).toBe(true);
    expect(seguinte.texto).toBe('');
    expect(seguinte.motivoDoHandoff).toBe('aguardando_humano');
    expect(llm.chamadas).toHaveLength(chamadasAntes);
  });

  it('mas oferece a ação de trazer o bot de volta, em toda mensagem muda', async () => {
    // Antes isto era porta sem maçaneta: o cliente escrevia de novo, levava
    // "o bot não responde mais" e ficava sem saída nenhuma.
    semearTenant();
    const motor = motorCom();

    const comHandoff = await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);
    const muda = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(comHandoff.acoes?.[0]?.id).toBe('voltar_ao_bot');
    expect(muda.acoes?.[0]?.id).toBe('voltar_ao_bot');
  });

  it('a ação destrava a conversa e o bot volta a responder', async () => {
    semearTenant();
    const motor = motorCom();

    await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);
    const volta = await motor.executarAcao(SLUG, 'contato-1', 'voltar_ao_bot');
    const depois = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(volta.texto).toBe(config.resposta.fraseDeRetomada);
    expect(buscarConversa(db, volta.conversaId as number)?.status).toBe('open');
    expect(depois.aguardandoHumano).toBe(false);
    expect(depois.texto.length).toBeGreaterThan(0);
  });

  it('o handoff CONTINUA pendente depois de o bot voltar', async () => {
    // O colaborador ainda precisa ver por que foi chamado, mesmo que o cliente
    // tenha seguido sozinho. Destravar a conversa não apaga o aviso.
    const tenantId = semearTenant();
    const motor = motorCom();

    await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);
    await motor.executarAcao(SLUG, 'contato-1', 'voltar_ao_bot');

    const pendentes = listarHandoffsPendentes(db, tenantId);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.botVoltou).toBe(true);
  });

  it('a ação não quebra quando não há nada para destravar', async () => {
    semearTenant();
    const motor = motorCom();

    const semConversa = await motor.executarAcao(SLUG, 'contato-novo', 'voltar_ao_bot');
    expect(semConversa.aguardandoHumano).toBe(false);
    expect(semConversa.texto.length).toBeGreaterThan(0);
  });

  it('recusa ação desconhecida em vez de fazer algo silencioso', async () => {
    semearTenant();
    await expect(motorCom().executarAcao(SLUG, 'contato-1', 'apagar_tudo')).rejects.toThrow(
      /desconhecida/,
    );
  });

  it('também registra handoff quando é o modelo que desiste', async () => {
    const tenantId = semearTenant();
    const motor = motorCom(new LlmFake(config.resposta.fraseDeHandoff));

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_BOA);

    expect(listarHandoffs(db, resposta.conversaId as number)).toHaveLength(1);
    expect(listarPerguntasSemResposta(db, tenantId)).toHaveLength(1);
  });

  it('grava a mensagem do handoff na conversa, para o histórico ficar completo', async () => {
    semearTenant();
    const motor = motorCom();

    const resposta = await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM);

    expect(contarMensagens(db, resposta.conversaId as number)).toBe(2);
  });

  it('não cria handoff nem unanswered no modo semPersistir', async () => {
    const tenantId = semearTenant();
    const motor = motorCom();

    await motor.responder(SLUG, 'contato-1', PERGUNTA_RUIM, { semPersistir: true });

    expect(listarPerguntasSemResposta(db, tenantId)).toHaveLength(0);
  });
});
