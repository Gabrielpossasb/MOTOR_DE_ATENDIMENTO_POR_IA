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
import {
  montarMensagemComContexto,
  montarPromptDoSistema,
  montarPromptSocial,
} from './llm/prompts.js';
import { normalizar } from './texto.js';
import { classificarTurnoSocial } from './conversation/turno-social.js';
import type { Embedder } from './rag/embedder.js';
import { custoDeEmbedding } from './rag/embedder.js';
import type { BuscaVetorial } from './rag/retriever.js';
import { BuscaPorCossenoEmMemoria } from './rag/retriever.js';
import { carregarTenant, configEfetiva } from './tenant/tenant-service.js';
import {
  compactarSeNecessario,
  janelaDeContexto,
  montarContextoDaConversa,
  SEM_CUSTO,
  ultimaPerguntaDoCliente,
} from './conversation/conversation-service.js';
import { gravarMensagem } from '../storage/repositories/messages.js';
import { marcarAtividade, mudarStatus, obterOuCriarConversa } from '../storage/repositories/conversations.js';
import { registrarHandoff, registrarPerguntaSemResposta } from '../storage/repositories/handoffs.js';
import type {
  CategoriaSocial,
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

    // 1. Turno social (oi, obrigado, tchau): não é pergunta sobre o negócio.
    //    Precisa sair ANTES da busca — uma saudação pontua baixo, cairia no
    //    limiar e acionaria a equipe para responder a um cumprimento. Pior:
    //    o handoff deixa o bot mudo, e a pergunta de verdade, que viria na
    //    mensagem seguinte, nunca seria respondida.
    const categoriaSocial = config.social.ativo
      ? classificarTurnoSocial(textoDaPergunta)
      : undefined;

    if (categoriaSocial) {
      return this.responderSocialmente({
        tenant,
        conversaId: conversa?.id,
        categoria: categoriaSocial,
        pergunta: textoDaPergunta,
        inicio,
        persistir,
      });
    }

    // 2. Vetor da pergunta.
    const { vetores, tokens: tokensDeEmbedding } = await this.embedder.gerar([textoDaPergunta]);
    const vetorDaPergunta = vetores[0];
    if (!vetorDaPergunta) {
      throw new Error('O embedder não devolveu vetor para a pergunta.');
    }
    let custoEmbedding = custoDeEmbedding(tokensDeEmbedding);

    // 3. Chunks mais parecidos, apenas deste tenant.
    let resultados = this.busca.buscar(tenant.id, vetorDaPergunta, ajustes.topK);
    let melhorScore = resultados[0]?.score ?? 0;

    // 3b. Score baixo numa conversa em andamento costuma ser pergunta que se
    //     apoia na anterior. Medido na clínica: "e o canal?" sozinho tira
    //     0.369 e é barrado; junto com a pergunta anterior ("quanto custa um
    //     implante?") tira 0.672. O LLM recebe o histórico, mas a BUSCA não —
    //     e sem chunk não há resposta, por mais contexto que o modelo tenha.
    //
    //     Só tenta de novo quando a primeira busca falhou, então o caso comum
    //     não paga nada. E o que se paga é um embedding, não uma chamada ao
    //     modelo: ordem de centavos de milésimo.
    if (
      conversa &&
      config.busca.tentarComContextoDaConversa &&
      melhorScore < ajustes.limiarDeConfianca
    ) {
      const anterior = ultimaPerguntaDoCliente(this.db, conversa.id);

      if (anterior) {
        const combinada = `${anterior} ${textoDaPergunta}`;
        const { vetores: comContexto, tokens } = await this.embedder.gerar([combinada]);
        const vetor = comContexto[0];
        custoEmbedding += custoDeEmbedding(tokens);

        if (vetor) {
          const outros = this.busca.buscar(tenant.id, vetor, ajustes.topK);
          const outroScore = outros[0]?.score ?? 0;

          if (outroScore > melhorScore) {
            resultados = outros;
            melhorScore = outroScore;
          }
        }
      }
    }

    // 4. Confiança baixa: nem chama o LLM. Economiza dinheiro e evita que o
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

    // 5. Só os chunks acima do limiar viram contexto — um chunk ruim no meio do
    //    prompt só confunde o modelo e ainda é pago por token.
    const relevantes = resultados.filter((r) => r.score >= ajustes.limiarDeConfianca);

    // Compacta antes de montar o contexto, para este turno já ver a memória.
    const compactacao = conversa
      ? await compactarSeNecessario(this.db, this.llm, conversa.id)
      : SEM_CUSTO;

    const contexto = conversa
      ? montarContextoDaConversa(this.db, conversa.id)
      : { historico: [] as TurnoDaConversa[] };

    const resposta = await this.llm.responder(
      montarPromptDoSistema(tenant.promptDoSistema, contexto.resumo),
      montarMensagemComContexto(textoDaPergunta, relevantes),
      contexto.historico,
    );

    const texto = limitarLinhas(resposta.texto, config.resposta.maximoDeLinhas);
    // O modelo pode concluir, lendo o contexto, que não tem a informação.
    // Nesse caso a resposta também vira handoff.
    const desistiu = pediuAjudaHumana(texto);

    const custo =
      custoDaResposta(resposta.tokensEntrada, resposta.tokensSaida) +
      custoEmbedding +
      compactacao.custoUsd;

    // Os tokens da compactação entram na conta: ela é uma chamada de verdade,
    // e custo reportado que ignora uma chamada paga é ficção.
    const tokensEntrada = resposta.tokensEntrada + compactacao.tokensEntrada;
    const tokensSaida = resposta.tokensSaida + compactacao.tokensSaida;

    const latenciaMs = Date.now() - inicio;
    const fontes = desistiu ? [] : paraFontes(relevantes);

    if (persistir && conversa) {
      gravarMensagem(this.db, { conversaId: conversa.id, papel: 'user', conteudo: textoDaPergunta });
      gravarMensagem(this.db, {
        conversaId: conversa.id,
        papel: 'assistant',
        conteudo: texto,
        tokensEntrada,
        tokensSaida,
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
        tokensEntrada,
        tokensSaida,
        custoEstimadoUsd: custo,
        latenciaMs,
      },
      ...(conversa ? { conversaId: conversa.id } : {}),
      aguardandoHumano: false,
    };
  }

  /**
   * Responde um turno social: sem busca, sem contexto e sem handoff.
   *
   * Vai ao LLM em vez de devolver frase pronta porque uma saudação é a
   * primeira impressão do cliente, e resposta enlatada se denuncia na segunda
   * vez que a pessoa escreve. O histórico da conversa vai junto: é o que faz
   * "boa noite" no fim de um atendimento ser lido como despedida, e não como
   * um novo cumprimento.
   *
   * Não gera custo de embedding: a busca nem acontece.
   */
  private async responderSocialmente(dados: {
    tenant: Tenant;
    conversaId: number | undefined;
    categoria: CategoriaSocial;
    pergunta: string;
    inicio: number;
    persistir: boolean;
  }): Promise<RespostaDoBot> {
    const historico: TurnoDaConversa[] =
      dados.conversaId !== undefined ? janelaDeContexto(this.db, dados.conversaId) : [];

    const resposta = await this.llm.responder(
      montarPromptSocial(dados.tenant.promptDoSistema, dados.categoria),
      dados.pergunta,
      historico,
    );

    const texto = limitarLinhas(resposta.texto, config.resposta.maximoDeLinhas);

    // O prompt social proíbe prometer atendente, mas a checagem fica assim
    // mesmo: já aconteceu duas vezes neste projeto de o modelo prometer chamar
    // alguém e a promessa passar despercebida. Se ele prometeu, alguém vai.
    const desistiu = pediuAjudaHumana(texto);

    const custo = custoDaResposta(resposta.tokensEntrada, resposta.tokensSaida);
    const latenciaMs = Date.now() - dados.inicio;

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
        tokensEntrada: resposta.tokensEntrada,
        tokensSaida: resposta.tokensSaida,
        custoUsd: custo,
        latenciaMs,
        fontes: [],
      });

      if (desistiu) {
        this.registrarDesistencia(
          dados.tenant.id,
          dados.conversaId,
          dados.pergunta,
          0,
          'baixa_confianca',
        );
      } else {
        marcarAtividade(this.db, dados.conversaId);
      }
    }

    return {
      texto,
      fontes: [],
      precisaDeHumano: desistiu,
      ...(desistiu ? { motivoDoHandoff: 'baixa_confianca' as const } : {}),
      turnoSocial: dados.categoria,
      melhorScore: 0,
      uso: {
        tokensEntrada: resposta.tokensEntrada,
        tokensSaida: resposta.tokensSaida,
        custoEstimadoUsd: custo,
        latenciaMs,
      },
      ...(dados.conversaId !== undefined ? { conversaId: dados.conversaId } : {}),
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
 * Quando isto erra, a conversa fica marcada como resolvida e ninguém é chamado
 * para atender o cliente — o pior erro possível neste sistema, porque é
 * silencioso. Duas formas de escape já foram observadas com modelo real:
 *
 *   1. A frase exata com a maiúscula trocada, encaixada no meio de outra
 *      ("Não atendemos X. Se for Y, não tenho essa informação...").
 *   2. A primeira oração parafraseada ("Não tenho informação SOBRE DESCONTO À
 *      VISTA aqui. Vou chamar alguém da equipe para te ajudar.").
 *
 * Contra a primeira, comparamos normalizado. Contra a segunda, procuramos
 * também o marcador — a promessa de escalar, que é a parte estável da frase.
 * Não adianta o modelo variar como diz que não sabe: se ele prometeu chamar
 * alguém, alguém precisa ser chamado.
 */
export function pediuAjudaHumana(texto: string): boolean {
  const normalizado = normalizar(texto);
  return (
    normalizado.includes(normalizar(config.resposta.fraseDeHandoff)) ||
    normalizado.includes(normalizar(config.resposta.marcadorDeHandoff))
  );
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
