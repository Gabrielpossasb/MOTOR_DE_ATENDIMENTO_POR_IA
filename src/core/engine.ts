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
import type { Ferramenta, RespostaDoLlm, TurnoDeFerramenta } from './llm/client.js';
import { FERRAMENTA_DE_AVISO, executarAviso } from './alertas/ferramenta.js';
import {
  FERRAMENTAS_DO_PEDIDO,
  avisoDeUnidade,
  executarFerramentaDoPedido,
} from './pedido/ferramentas.js';
import { carregarCatalogoDeProdutos, emReais } from './pedido/catalogo-de-produtos.js';
import {
  comTaxa,
  descontoAplicavel,
  faltaParaFechar,
  rascunhoDaConversa,
  resumirPedido,
} from './pedido/pedido-service.js';
import { alertasDaMensagem, registrarAlerta } from './alertas/alertas.js';
import { AGENDA_PADRAO } from './agenda/disponibilidade.js';
import {
  executarFerramenta,
  FERRAMENTAS_DA_AGENDA,
  hojeParaOPrompt,
  type ContextoDasFerramentas,
} from './agenda/ferramentas.js';
import {
  montarMensagemComContexto,
  montarPromptDoSistema,
  montarPromptSocial,
  regrasDaAgenda,
  regrasDeAviso,
  regrasDoPedido,
  pedidoAtualParaOPrompt,
} from './llm/prompts.js';
import { normalizar } from './texto.js';
import { classificarTurnoSocial } from './conversation/turno-social.js';
import type { Embedder } from './rag/embedder.js';
import { custoDeEmbedding } from './rag/embedder.js';
import type { BuscaVetorial } from './rag/retriever.js';
import { BuscaPorCossenoEmMemoria } from './rag/retriever.js';
import { carregarTenant, configEfetiva } from './tenant/tenant-service.js';
import {
  botPediuAlgo,
  compactarSeNecessario,
  janelaDeContexto,
  montarContextoDaConversa,
  SEM_CUSTO,
  ultimaPerguntaDoCliente,
} from './conversation/conversation-service.js';
import { gravarMensagem } from '../storage/repositories/messages.js';
import {
  conversaAtiva,
  marcarAtividade,
  mudarStatus,
  obterOuCriarConversa,
} from '../storage/repositories/conversations.js';
import { registrarHandoff, registrarPerguntaSemResposta } from '../storage/repositories/handoffs.js';
import type {
  AcaoSugerida,
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

/**
 * A ação de trazer o bot de volta depois de um handoff.
 *
 * O rótulo mora aqui e não no adaptador porque é texto que o cliente lê — e o
 * núcleo é quem sabe o que a ação significa. O canal escolhe só a forma:
 * botão de resposta no WhatsApp, botão na página, comando no terminal.
 */
const ACAO_VOLTAR: AcaoSugerida = {
  id: 'voltar_ao_bot',
  rotulo: 'Falar com o atendente virtual',
};

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
    //
    // Mas a ação vai junto em TODA resposta muda, e não só na que gerou o
    // handoff. Antes isto era uma porta sem maçaneta: o cliente escrevia
    // "opa", levava "o bot não responde mais" e não tinha o que fazer. Com o
    // botão sempre à vista ele nunca fica sem saída, e ninguém precisa
    // adivinhar intenção a partir do texto.
    if (conversa && conversa.status === 'handoff' && config.conversa.bloquearBotAposHandoff) {
      return {
        texto: '',
        // Nenhuma mensagem a enviar: o bot esta calado de proposito. A borda nao
        // desenha balao nenhum, so a acao de trazer o bot de volta.
        mensagens: [],
        fontes: [],
        precisaDeHumano: true,
        motivoDoHandoff: 'aguardando_humano',
        melhorScore: 0,
        uso: { tokensEntrada: 0, tokensSaida: 0, custoEstimadoUsd: 0, latenciaMs: Date.now() - inicio },
        conversaId: conversa.id,
        aguardandoHumano: true,
        acoes: [ACAO_VOLTAR],
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

    // "ok", "beleza", "certo" depois de o bot PEDIR algo não são turno
    // social: são o cliente reconhecendo um pedido pendente. O prompt social
    // não recebe documento nenhum, então responder por ali é prometer silêncio
    // — foi o turno 3 da conversa 33, "Perfeito, fico no aguardo 😊" logo
    // depois de o bot ter pedido quatro informações.
    //
    // Só a confirmação muda: um "obrigado" ou um "tchau" continuam sociais,
    // mesmo vindo depois de pergunta.
    const confirmacaoPendente =
      categoriaSocial === 'confirmacao' &&
      conversa !== undefined &&
      botPediuAlgo(this.db, conversa.id);

    if (categoriaSocial && !confirmacaoPendente) {
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

    // 4. Base literalmente vazia: aí sim não há o que responder, e pagar uma
    //    chamada para descobrir isso seria desperdício.
    //
    //    O que NÃO está mais aqui: a saída seca por score abaixo do limiar.
    //    Ela matava conversa — "bom diaa" tirou 0.288, foi barrado antes do
    //    modelo e acionou a equipe para retribuir um cumprimento. O limiar
    //    continua escolhendo o contexto e alimentando `melhorScore`, mas quem
    //    julga se dá para responder passou a ser o modelo, que tem a regra 2
    //    para conversar e a 3 para escalar.
    if (resultados.length === 0) {
      return this.encerrarSemResposta({
        tenant,
        conversaId: conversa?.id,
        pergunta: textoDaPergunta,
        motivo: 'sem_chunks',
        melhorScore,
        custoEmbedding,
        inicio,
        persistir,
      });
    }

    // 5. Só os chunks acima do limiar viram contexto — um chunk ruim no meio do
    //    prompt só confunde o modelo e ainda é pago por token.
    const acimaDoLimiar = resultados.filter((r) => r.score >= ajustes.limiarDeConfianca);

    // Quando NADA passa, manda os melhores assim mesmo, avisando que são
    // fracos. O limiar deixou de barrar a mensagem, mas continuava matando o
    // contexto de fome: medido, "ta entao marca dia 16 mesmo" tira 0.376 e o
    // trecho perdido por essa margem era o "Como agendar", que responde a
    // pergunta. Melhor o modelo ver e descartar do que nunca ver.
    const incerto = acimaDoLimiar.length === 0;
    const relevantes = incerto
      ? resultados.slice(0, config.busca.chunksQuandoNadaPassa)
      : acimaDoLimiar;

    // Compacta antes de montar o contexto, para este turno já ver a memória.
    const compactacao = conversa
      ? await compactarSeNecessario(this.db, this.llm, conversa.id)
      : SEM_CUSTO;

    // A rede determinística, antes de qualquer chamada paga: palavra do tenant
    // na mensagem do cliente aciona o responsável mesmo que o modelo não chame
    // a ferramenta. As duas erram de formas opostas, e por isso existem as duas.
    if (persistir && conversa) {
      for (const regra of alertasDaMensagem(
        textoDaPergunta,
        tenant.config.alertas ?? [],
        normalizar,
      )) {
        registrarAlerta(this.db, {
          tenantId: tenant.id,
          conversaId: conversa.id,
          tipo: regra.tipo,
          detalhe: regra.detalhe,
          mensagemDoCliente: textoDaPergunta,
          origem: 'palavra-chave',
        });
      }
    }

    const contexto = conversa
      ? montarContextoDaConversa(this.db, conversa.id)
      : { historico: [] as TurnoDaConversa[] };

    const agenda = tenant.config.agenda ?? AGENDA_PADRAO;

    // A agenda é OPT-IN por cliente: só entra para quem configurou `agenda` no
    // tenant.json. Nem todo negócio marca horário — uma revendedora de polpa
    // vende e entrega —, e as ferramentas falam "consulta", "paciente" e
    // "convênio". Oferecê-las a quem não agenda vaza vocabulário errado na
    // conversa e ainda paga ~700 tokens por mensagem para não usar nada.
    const comFerramentas =
      config.agenda.ferramentasSempre &&
      conversa !== undefined &&
      tenant.config.agenda !== undefined;

    // O pedido é opt-in pela mesma porta que a agenda: `config.vende` mais um
    // `produtos.json` na pasta do tenant. Uma clínica não monta carrinho, e as
    // ferramentas falam "produto", "quilo" e "entrega" — oferecê-las a quem não
    // vende vaza vocabulário errado e paga token para não usar nada.
    const comPedido = ajustes.vende && conversa !== undefined;

    // A ferramenta de avisar o responsável vale para TODO cliente: chamar quem
    // é dono do negócio não é recurso de clínica. Só entra quando há conversa,
    // pela mesma razão das de agenda — a avaliação roda sem conversa, e assim o
    // prompt que ela mede continua sendo o mesmo de antes.
    const ferramentasOferecidas: Ferramenta[] =
      conversa === undefined
        ? []
        : [
            FERRAMENTA_DE_AVISO,
            ...(comFerramentas ? FERRAMENTAS_DA_AGENDA : []),
            ...(comPedido ? FERRAMENTAS_DO_PEDIDO : []),
          ];

    // O pedido vai ao modelo como DADO, a cada mensagem, em vez de depender de
    // ele lembrar ou de chamar `ver_pedido`. Ver `pedidoAtualParaOPrompt`.
    const pedidoAtual =
      comPedido && conversa
        ? this.pedidoParaOPrompt(tenant.slug, tenant.id, conversa.id, contatoId)
        : undefined;

    // Rede determinística de unidade: "5 polpas" não pode virar 5 quilos. Roda
    // sobre o texto do cliente, antes de qualquer chamada paga, porque a regra
    // de prompt sozinha erra 1 em 5 vezes — medido. Ver `avisoDeUnidade`.
    //
    // Depende de `vende`, e NÃO de haver conversa: o aviso é sobre o texto do
    // cliente e o catálogo, não sobre o carrinho. Quem pergunta "quanto fica 5
    // polpas?" na primeira mensagem precisa dele tanto quanto quem já está
    // montando pedido — e é assim que a suíte paga consegue medi-lo, já que ela
    // roda sem conversa.
    const unidade = ajustes.vende
      ? avisoDeUnidade(carregarCatalogoDeProdutos(tenant.slug), textoDaPergunta)
      : undefined;

    const resposta = await this.conversarComFerramentas({
      promptDoSistema: montarPromptDoSistema(
        tenant.promptDoSistema,
        { vende: ajustes.vende, maximoDeLinhas: ajustes.maximoDeLinhas },
        contexto.resumo,
        comFerramentas ? regrasDaAgenda(hojeParaOPrompt()) : undefined,
        ferramentasOferecidas.length > 0 ? regrasDeAviso() : undefined,
        comPedido ? regrasDoPedido() : undefined,
        juntarBlocos(pedidoAtual, unidade),
      ),
      mensagem: montarMensagemComContexto(textoDaPergunta, relevantes, incerto),
      historico: contexto.historico,
      ferramentas: ferramentasOferecidas,
      executar: (nome, argumentos) => {
        // A ferramenta de aviso vale para todo cliente; as da agenda, só para
        // quem configurou. O despacho fica aqui, e não dentro de um executor
        // só, porque são dois assuntos com contextos diferentes.
        if (nome === FERRAMENTA_DE_AVISO.nome) {
          return executarAviso(
            {
              db: this.db,
              tenantId: tenant.id,
              semPersistir: !persistir,
              mensagemDoCliente: textoDaPergunta,
              ...(conversa ? { conversaId: conversa.id } : {}),
            },
            argumentos,
          );
        }

        if (FERRAMENTAS_DO_PEDIDO.some((f) => f.nome === nome)) {
          return executarFerramentaDoPedido(
            {
              db: this.db,
              tenantId: tenant.id,
              tenantSlug: tenant.slug,
              contatoId,
              semPersistir: !persistir,
              mensagemDoCliente: textoDaPergunta,
              ...(conversa ? { conversaId: conversa.id } : {}),
            },
            nome,
            argumentos,
          );
        }

        return executarFerramenta(
          {
            db: this.db,
            tenantId: tenant.id,
            contatoId,
            agenda,
            semPersistir: !persistir,
            ...(conversa ? { conversaId: conversa.id } : {}),
          },
          nome,
          argumentos,
        );
      },
    });

    const texto = limitarLinhas(resposta.texto, ajustes.maximoDeLinhas);
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
        usouFerramenta: resposta.usouFerramenta,
      });

      if (desistiu) {
        this.registrarDesistencia(tenant.id, conversa.id, textoDaPergunta, melhorScore, 'baixa_confianca');
      } else {
        marcarAtividade(this.db, conversa.id);
      }
    }

    return {
      texto,
      mensagens: dividirEmMensagens(texto, ajustes.maximoDeLinhas),
      fontes,
      precisaDeHumano: desistiu,
      ...(desistiu ? { motivoDoHandoff: 'baixa_confianca' as const } : {}),
      ...(desistiu && conversa ? { acoes: [ACAO_VOLTAR] } : {}),
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
   * O bloco "PEDIDO ATUAL" do prompt, ou `undefined` se ainda não há pedido.
   *
   * Carrinho vazio não vira bloco: dizer "o pedido está vazio" em toda mensagem
   * de quem só perguntou um preço é ruído, e ainda sugere ao modelo que ele
   * deveria estar montando algo.
   */
  private pedidoParaOPrompt(
    tenantSlug: string,
    tenantId: number,
    conversaId: number,
    contatoId: string,
  ): string | undefined {
    const rascunho = rascunhoDaConversa(this.db, conversaId);
    if (!rascunho || rascunho.itens.length === 0) return undefined;

    const catalogo = carregarCatalogoDeProdutos(tenantSlug);
    const pedido = comTaxa(this.db, rascunho.id, catalogo);
    if (!pedido) return undefined;

    // Rede POSITIVA: avisa que o cliente tem direito a um desconto cadastrado e
    // que ele ainda nao foi aplicado. Ver `descontoAplicavel`.
    const disponivel = descontoAplicavel({
      db: this.db,
      tenantId,
      conversaId,
      contatoId,
      catalogo,
    });

    return pedidoAtualParaOPrompt(
      resumirPedido(pedido),
      faltaParaFechar(pedido),
      disponivel
        ? `O cliente TEM DIREITO ao ${disponivel.nome}, de ` +
            `${emReais(disponivel.valorCentavos)}, e ele ainda NÃO foi aplicado. Chame ` +
            `\`aplicar_desconto\` com a chave "${disponivel.chave}" ANTES de informar ` +
            `qualquer total. Este desconto É CADASTRADO: não é caso de avisar a responsável ` +
            `nem de dizer que vai confirmar — é caso de chamar a ferramenta agora.`
        : undefined,
    );
  }

  /**
   * Conversa com o modelo, executando as ferramentas que ele pedir.
   *
   * O laço tem TETO. Sem ele, um modelo confuso repete a mesma chamada e
   * queima crédito em silêncio — e o cliente fica esperando uma resposta que
   * não vem. Estourado o teto, devolve o que houver: melhor uma resposta
   * imperfeita que um laço infinito pago por chamada.
   *
   * Os tokens de TODAS as voltas são somados. Custo reportado que conta só a
   * última chamada é ficção.
   */
  private async conversarComFerramentas(p: {
    promptDoSistema: string;
    mensagem: string;
    historico: TurnoDaConversa[];
    /** O que oferecer ao modelo. Vazio = nenhuma ferramenta nesta conversa. */
    ferramentas: Ferramenta[];
    /** Despacha a chamada. Nunca lança: erro vira texto para o modelo ler. */
    executar: (nome: string, argumentos: Record<string, unknown>) => string;
  }): Promise<RespostaDoLlm & { usouFerramenta: boolean }> {
    const temFerramentas = p.ferramentas.length > 0;
    const opcoes = temFerramentas ? { ferramentas: p.ferramentas } : {};

    let resposta = await this.llm.responder(p.promptDoSistema, p.mensagem, p.historico, opcoes);
    let tokensEntrada = resposta.tokensEntrada;
    let tokensSaida = resposta.tokensSaida;

    const turnos: TurnoDeFerramenta[] = [];
    let volta = 0;

    while (
      temFerramentas &&
      resposta.ferramentas &&
      resposta.ferramentas.length > 0 &&
      volta < config.agenda.maximoDeVoltas
    ) {
      for (const chamada of resposta.ferramentas) {
        turnos.push({
          chamada,
          resultado: p.executar(chamada.nome, chamada.argumentos),
        });
      }

      resposta = await this.llm.responder(p.promptDoSistema, p.mensagem, p.historico, {
        ferramentas: p.ferramentas,
        turnosDeFerramenta: turnos,
      });

      tokensEntrada += resposta.tokensEntrada;
      tokensSaida += resposta.tokensSaida;
      volta += 1;
    }

    // `turnos` vazio quer dizer que o modelo respondeu direto, sem consultar
    // nada. Quem grava a mensagem usa isto para registrar de onde veio a
    // resposta — a auditoria de conversa não pode cobrar score de busca de uma
    // resposta que saiu da agenda.
    return { texto: resposta.texto, tokensEntrada, tokensSaida, usouFerramenta: turnos.length > 0 };
  }

  /**
   * Executa uma ação que o cliente tocou, em vez de uma mensagem que escreveu.
   *
   * Entrada separada de `responder()` de propósito: tocar num botão não é
   * mandar uma mensagem. Se viesse como texto, o motor teria de adivinhar a
   * intenção a partir da frase do rótulo — que é exatamente o que o botão
   * existe para não precisar.
   *
   * Hoje só existe `voltar_ao_bot`, que devolve a conversa para `open`. O
   * handoff NÃO é tocado: o colaborador continua tendo de olhar por que foi
   * chamado, mesmo que o cliente tenha seguido sozinho.
   */
  async executarAcao(
    tenantSlug: string,
    contatoId: string,
    acaoId: string,
  ): Promise<RespostaDoBot> {
    const inicio = Date.now();

    if (acaoId !== 'voltar_ao_bot') {
      throw new Error(`Ação desconhecida: ${acaoId}`);
    }

    const tenant = carregarTenant(this.db, tenantSlug);
    const conversa = conversaAtiva(this.db, tenant.id, contatoId);

    const semCusto = {
      tokensEntrada: 0,
      tokensSaida: 0,
      custoEstimadoUsd: 0,
      latenciaMs: Date.now() - inicio,
    };

    // Nada a destravar: conversa nova, ou o bot já estava respondendo.
    if (!conversa || conversa.status !== 'handoff') {
      return {
        texto: config.resposta.fraseDeRetomada,
        mensagens: [config.resposta.fraseDeRetomada],
        fontes: [],
        precisaDeHumano: false,
        melhorScore: 0,
        uso: semCusto,
        ...(conversa ? { conversaId: conversa.id } : {}),
        aguardandoHumano: false,
      };
    }

    mudarStatus(this.db, conversa.id, 'open');

    const texto = config.resposta.fraseDeRetomada;
    gravarMensagem(this.db, {
      conversaId: conversa.id,
      papel: 'assistant',
      conteudo: texto,
      tokensEntrada: 0,
      tokensSaida: 0,
      custoUsd: 0,
      latenciaMs: Date.now() - inicio,
      fontes: [],
    });

    return {
      texto,
      mensagens: [texto],
      fontes: [],
      precisaDeHumano: false,
      melhorScore: 0,
      uso: semCusto,
      conversaId: conversa.id,
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

    const texto = limitarLinhas(resposta.texto, configEfetiva(dados.tenant).maximoDeLinhas);

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
      mensagens: dividirEmMensagens(texto, configEfetiva(dados.tenant).maximoDeLinhas),
      fontes: [],
      precisaDeHumano: desistiu,
      ...(desistiu ? { motivoDoHandoff: 'baixa_confianca' as const } : {}),
      ...(desistiu && dados.conversaId !== undefined ? { acoes: [ACAO_VOLTAR] } : {}),
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
      mensagens: [texto],
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
      ...(dados.persistir && dados.conversaId !== undefined ? { acoes: [ACAO_VOLTAR] } : {}),
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

/** Junta os blocos de prompt que existem, ou `undefined` se nenhum existe. */
function juntarBlocos(...blocos: (string | undefined)[]): string | undefined {
  const presentes = blocos.filter((b): b is string => b !== undefined && b.length > 0);
  return presentes.length === 0 ? undefined : presentes.join('\n\n');
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
 * Quebra a resposta nas mensagens que o canal vai enviar, uma por linha.
 *
 * A quebra de linha SEMPRE foi a fronteira entre as ideias da resposta — o
 * modelo já separava assim, e era o `limitarLinhas` que juntava tudo de volta
 * numa string só. Quem conversou com o bot resumiu o efeito: *"se não, a
 * mensagem fica muito grande e artificial"*. Ninguém manda parágrafo no
 * WhatsApp.
 *
 * Então a fronteira passa a ser respeitada, e quem decide a FORMA é a borda:
 * balão por mensagem na página, mensagens separadas no WhatsApp, linhas no
 * terminal. O núcleo continua sem saber o que é um balão.
 *
 * O corte no máximo é a última barreira: o prompt pede resposta curta, e
 * depender só de o modelo obedecer já falhou antes neste projeto.
 */
export function dividirEmMensagens(texto: string, maximo: number): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, maximo);
}

/**
 * A resposta como texto único, com as mensagens separadas por `\n`.
 *
 * Continua existindo porque é o que vai para o BANCO, e é de propósito: uma
 * linha por turno. Se cada mensagem virasse uma linha de `messages`, cada uma
 * contaria como um turno do bot e todo aproveitamento já medido deixaria de ser
 * comparável — e a auditoria já trata `\n` como separador de frase.
 */
export function limitarLinhas(texto: string, maximo: number): string {
  return dividirEmMensagens(texto, maximo).join('\n');
}
