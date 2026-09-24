/**
 * Motor de atendimento: recebe uma pergunta em texto, devolve uma resposta.
 *
 * Esta é a ÚNICA porta de entrada do núcleo. O adaptador de CLI, o de web e,
 * mais adiante, o de WhatsApp chamam `Motor.responder()` e não sabem nada do
 * que acontece aqui dentro. Do mesmo jeito, nada aqui sabe qual canal chamou:
 * `contatoId` é só uma string opaca e `canal` só é guardado para relatório.
 */
import { config } from '../config.js';
import type { Db } from '../storage/db.js';
import type { LlmClient } from './llm/client.js';
import { custoDaResposta } from './llm/client.js';
import { montarMensagemComContexto, montarPromptDoSistema } from './llm/prompts.js';
import type { Embedder } from './rag/embedder.js';
import { custoDeEmbedding } from './rag/embedder.js';
import type { BuscaVetorial } from './rag/retriever.js';
import { BuscaPorCossenoEmMemoria } from './rag/retriever.js';
import { carregarTenant, configEfetiva } from './tenant/tenant-service.js';
import { janelaDeContexto } from './conversation/conversation-service.js';
import { gravarMensagem } from '../storage/repositories/messages.js';
import { marcarAtividade, mudarStatus, obterOuCriarConversa } from '../storage/repositories/conversations.js';
import { registrarHandoff, registrarPerguntaSemResposta } from '../storage/repositories/handoffs.js';
import type {
  Fonte,
  MotivoDeHandoff,
  RespostaDoBot,
  ResultadoDeBusca,
  Tenant,
  TurnoDaConversa,
} from './types.js';

export interface DependenciasDoMotor {
  db: Db;
  embedder: Embedder;
  llm: LlmClient;
  /** Opcional: por padrão usa a busca por cosseno em memória. */
  busca?: BuscaVetorial;
}

export interface OpcoesDeResposta {
  /** De onde veio a mensagem. Só é guardado para relatório; o núcleo não lê. */
  canal?: string;
  /**
   * Não gravar nada no banco. Usado pela suíte de avaliação, que roda centenas
   * de perguntas e não deve poluir o histórico real de conversas.
   */
  semPersistir?: boolean;
}

export class Motor {
  private readonly db: Db;
  private readonly embedder: Embedder;
  private readonly llm: LlmClient;
  private readonly busca: BuscaVetorial;

  constructor(deps: DependenciasDoMotor) {
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.llm = deps.llm;
    this.busca = deps.busca ?? new BuscaPorCossenoEmMemoria(deps.db);
  }

  /**
   * Responde uma mensagem.
   *
   * @param tenantSlug de qual cliente é esta conversa
   * @param contatoId identificador opaco do contato (número, id de sessão…)
   * @param pergunta texto que a pessoa escreveu
   */
  async responder(
    tenantSlug: string,
    contatoId: string,
    pergunta: string,
    opcoes: OpcoesDeResposta = {},
  ): Promise<RespostaDoBot> {
    const inicio = Date.now();
    const persistir = opcoes.semPersistir !== true;

    const tenant = carregarTenant(this.db, tenantSlug);
    const ajustes = configEfetiva(tenant);

    const conversa = persistir
      ? obterOuCriarConversa(this.db, tenant.id, contatoId, opcoes.canal ?? 'desconhecido')
      : undefined;

    // Conversa já entregue a um humano: o bot cala a boca. Continuar
    // respondendo atropelaria o atendente no meio do atendimento.
    if (conversa && conversa.status === 'handoff' && config.conversa.bloquearBotAposHandoff) {
      return {
        texto: '',
        fontes: [],
        precisaDeHumano: true,
        motivoDoHandoff: 'aguardando_humano',
        melhorScore: 0,
        uso: { tokensEntrada: 0, tokensSaida: 0, custoEstimadoUsd: 0, latenciaMs: Date.now() - inicio },
        conversaId: conversa.id,
        aguardandoHumano: true,
      };
    }

    const textoDaPergunta = pergunta.trim();
    if (textoDaPergunta.length === 0) {
      return this.encerrarSemResposta({
        tenant,
        conversaId: conversa?.id,
        pergunta: textoDaPergunta,
        motivo: 'sem_chunks',
        melhorScore: 0,
        custoEmbedding: 0,
        inicio,
        persistir,
      });
    }

    // 1. Vetor da pergunta.
    const { vetores, tokens: tokensDeEmbedding } = await this.embedder.gerar([textoDaPergunta]);
    const vetorDaPergunta = vetores[0];
    if (!vetorDaPergunta) {
      throw new Error('O embedder não devolveu vetor para a pergunta.');
    }
    const custoEmbedding = custoDeEmbedding(tokensDeEmbedding);

    // 2. Chunks mais parecidos, apenas deste tenant.
    const resultados = this.busca.buscar(tenant.id, vetorDaPergunta, ajustes.topK);
    const melhorScore = resultados[0]?.score ?? 0;

    // 3. Confiança baixa: nem chama o LLM. Economiza dinheiro e evita que o
    //    modelo invente resposta em cima de contexto irrelevante.
    if (resultados.length === 0 || melhorScore < ajustes.limiarDeConfianca) {
      return this.encerrarSemResposta({
        tenant,
        conversaId: conversa?.id,
        pergunta: textoDaPergunta,
        motivo: resultados.length === 0 ? 'sem_chunks' : 'baixa_confianca',
        melhorScore,
        custoEmbedding,
        inicio,
        persistir,
      });
    }

    // 4. Só os chunks acima do limiar viram contexto — um chunk ruim no meio do
    //    prompt só confunde o modelo e ainda é pago por token.
    const relevantes = resultados.filter((r) => r.score >= ajustes.limiarDeConfianca);

    const historico: TurnoDaConversa[] = conversa ? janelaDeContexto(this.db, conversa.id) : [];

    const resposta = await this.llm.responder(
      montarPromptDoSistema(tenant.promptDoSistema),
      montarMensagemComContexto(textoDaPergunta, relevantes),
      historico,
    );

    const texto = limitarLinhas(resposta.texto, config.resposta.maximoDeLinhas);
    // O modelo pode concluir, lendo o contexto, que não tem a informação.
    // Nesse caso a resposta também vira handoff.
    const desistiu = pediuAjudaHumana(texto);

    const custo = custoDaResposta(resposta.tokensEntrada, resposta.tokensSaida) + custoEmbedding;
    const latenciaMs = Date.now() - inicio;
    const fontes = desistiu ? [] : paraFontes(relevantes);

    if (persistir && conversa) {
      gravarMensagem(this.db, { conversaId: conversa.id, papel: 'user', conteudo: textoDaPergunta });
      gravarMensagem(this.db, {
        conversaId: conversa.id,
        papel: 'assistant',
        conteudo: texto,
        tokensEntrada: resposta.tokensEntrada,
        tokensSaida: resposta.tokensSaida,
        custoUsd: custo,
        latenciaMs,
        fontes,
      });

      if (desistiu) {
        this.registrarDesistencia(tenant.id, conversa.id, textoDaPergunta, melhorScore, 'baixa_confianca');
      } else {
        marcarAtividade(this.db, conversa.id);
      }
    }

    return {
      texto,
      fontes,
      precisaDeHumano: desistiu,
      ...(desistiu ? { motivoDoHandoff: 'baixa_confianca' as const } : {}),
      melhorScore,
      uso: {
        tokensEntrada: resposta.tokensEntrada,
        tokensSaida: resposta.tokensSaida,
        custoEstimadoUsd: custo,
        latenciaMs,
      },
      ...(conversa ? { conversaId: conversa.id } : {}),
      aguardandoHumano: false,
    };
  }

  /** Caminho de handoff sem chamada ao LLM: grava tudo e devolve a frase fixa. */
  private encerrarSemResposta(dados: {
    tenant: Tenant;
    conversaId: number | undefined;
    pergunta: string;
    motivo: MotivoDeHandoff;
    melhorScore: number;
    custoEmbedding: number;
    inicio: number;
    persistir: boolean;
  }): RespostaDoBot {
    const texto = config.resposta.fraseDeHandoff;

    if (dados.persistir && dados.conversaId !== undefined) {
      gravarMensagem(this.db, {
        conversaId: dados.conversaId,
        papel: 'user',
        conteudo: dados.pergunta,
      });
      gravarMensagem(this.db, {
        conversaId: dados.conversaId,
        papel: 'assistant',
        conteudo: texto,
        tokensEntrada: 0,
        tokensSaida: 0,
        custoUsd: dados.custoEmbedding,
        latenciaMs: Date.now() - dados.inicio,
        fontes: [],
      });

      this.registrarDesistencia(
        dados.tenant.id,
        dados.conversaId,
        dados.pergunta,
        dados.melhorScore,
        dados.motivo,
      );
    }

    return {
      texto,
      fontes: [],
      precisaDeHumano: true,
      motivoDoHandoff: dados.motivo,
      melhorScore: dados.melhorScore,
      uso: {
        tokensEntrada: 0,
        tokensSaida: 0,
        custoEstimadoUsd: dados.custoEmbedding,
        latenciaMs: Date.now() - dados.inicio,
      },
      ...(dados.conversaId !== undefined ? { conversaId: dados.conversaId } : {}),
      aguardandoHumano: false,
    };
  }

  /**
   * Grava o handoff, a pergunta sem resposta e muda o status da conversa.
   *
   * As três coisas juntas numa transação: uma conversa marcada como `handoff`
   * sem a linha correspondente em `handoffs` seria uma conversa travada que
   * nenhum painel mostra — o cliente ficaria esperando para sempre.
   */
  private registrarDesistencia(
    tenantId: number,
    conversaId: number,
    pergunta: string,
    melhorScore: number,
    motivo: MotivoDeHandoff,
  ): void {
    const gravar = this.db.transaction(() => {
      registrarPerguntaSemResposta(this.db, tenantId, conversaId, pergunta, melhorScore);
      registrarHandoff(this.db, conversaId, motivo);
      mudarStatus(this.db, conversaId, 'handoff');
    });
    gravar();
  }
}

/**
 * Detecta se o modelo desistiu e pediu ajuda humana.
 *
 * Comparar com `includes` e a frase literal não serve: o modelo costuma
 * encaixar a frase no meio de outra ("Não atendemos X. Se for Y, não tenho
 * essa informação...") e trocar a maiúscula inicial. Quando isso escapa, a
 * conversa fica marcada como resolvida e ninguém é chamado para atender o
 * cliente — o pior erro possível neste sistema, porque é silencioso.
 *
 * Por isso comparamos os dois lados normalizados.
 */
export function pediuAjudaHumana(texto: string): boolean {
  return normalizar(texto).includes(normalizar(config.resposta.fraseDeHandoff));
}

/** Minúsculas, sem acento e com espaços colapsados, para comparar texto livre. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Converte os chunks usados nas fontes citadas ao usuário, sem repetir arquivo. */
function paraFontes(resultados: ResultadoDeBusca[]): Fonte[] {
  const vistas = new Map<string, Fonte>();

  for (const r of resultados) {
    const secao = r.chunk.metadados.secao;
    const chave = `${r.arquivo}#${secao ?? ''}`;
    if (!vistas.has(chave)) {
      vistas.set(chave, {
        arquivo: r.arquivo,
        ...(secao !== undefined ? { secao } : {}),
        score: r.score,
      });
    }
  }

  return [...vistas.values()];
}

/**
 * Corta a resposta no número máximo de linhas.
 *
 * É a última barreira: o prompt já pede resposta curta, mas o custo de uma
 * mensagem longa no WhatsApp é real demais para depender só do modelo obedecer.
 */
export function limitarLinhas(texto: string, maximo: number): string {
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return linhas.slice(0, maximo).join('\n');
}
