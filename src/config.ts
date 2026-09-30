/**
 * Configuração centralizada do motor.
 *
 * Regra do projeto: nenhum valor mágico solto no código. Tudo que é ajustável
 * (modelo, preço, tamanho de chunk, limiar de confiança) mora aqui.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const raizDoProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  /** Caminhos do projeto. */
  caminhos: {
    raiz: raizDoProjeto,
    banco: path.join(raizDoProjeto, 'data', 'motor.db'),
    /** Onde ficam os documentos brutos de cada cliente: data/tenants/<slug>/ */
    documentosTenant: (slug: string) => path.join(raizDoProjeto, 'data', 'tenants', slug),
    migrations: path.join(raizDoProjeto, 'src', 'storage', 'migrations'),
  },

  /** Credenciais. Lidas do .env — nunca versionadas. */
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },

  /** Modelo de embeddings. Trocar aqui exige reingestão de todos os documentos. */
  embeddings: {
    modelo: 'text-embedding-3-small',
    dimensoes: 1536,
    /** Quantos textos mandar por requisição na ingestão. */
    tamanhoDoLote: 64,
    /** Preço em dólares por milhão de tokens (para o cálculo de custo). */
    precoPorMilhaoDeTokens: 0.02,
  },

  /** Modelo de chat. O id pode ser sobrescrito pelo .env sem mexer no código. */
  llm: {
    modelo: process.env.LLM_MODEL ?? 'gpt-5.4-mini',
    /** Resposta curta: no WhatsApp cada mensagem enviada custa dinheiro. */
    maxTokensDeResposta: 300,
    temperatura: 0.2,
    /**
     * Preços em dólares por milhão de tokens, conferidos na tabela da OpenAI
     * em 23/09/2026. Se trocar de modelo, atualize estes dois valores — senão
     * o custo reportado em cada mensagem vira ficção.
     */
    precoEntradaPorMilhaoDeTokens: 0.75,
    precoSaidaPorMilhaoDeTokens: 4.5,
  },

  /** Divisão dos documentos em pedaços indexáveis. */
  chunking: {
    /** Tamanho alvo de cada chunk, em caracteres. */
    tamanhoAlvo: 500,
    /** Sobreposição entre chunks vizinhos, em caracteres — preserva contexto na borda. */
    sobreposicao: 80,
    /** Abaixo disso o pedaço é grudado no anterior em vez de virar chunk próprio. */
    tamanhoMinimo: 80,
  },

  /** Busca por similaridade. */
  busca: {
    /** Quantos chunks recuperar por pergunta. */
    topK: 4,
    /**
     * Limiar de confiança (similaridade de cosseno, 0 a 1).
     * Abaixo disso o bot nem chama o LLM: responde a frase de handoff direto.
     *
     * O limiar é PORTEIRO, não juiz. Medido com `src/scripts/calibrar.ts` na
     * base da clínica de exemplo, os dois grupos se sobrepõem: perguntas
     * legítimas ficam entre 0.426 e 0.733, e perguntas sem resposta na base
     * chegam a 0.593 ("qual o CNPJ da clínica?" fala da clínica, mas a resposta
     * não está nos documentos). Nenhum número separa os dois.
     *
     * Então o valor é escolhido para NUNCA barrar pergunta legítima: fica
     * abaixo de 0.426. O que passa daqui é julgado pelo LLM, que tem a regra de
     * recusar quando o contexto não responde. Rode o calibrar.ts de novo sempre
     * que trocar o modelo de embeddings ou mudar muito os documentos.
     */
    limiarDeConfianca: 0.4,

    /**
     * Quando a busca falha numa conversa em andamento, tentar de novo com a
     * pergunta anterior do cliente junto.
     *
     * O LLM recebe o histórico, mas a busca não recebia — então uma pergunta
     * que se apoia na anterior morria antes de chegar ao modelo. Medido na
     * clínica: "e o canal?" sozinho tira 0.369 e é barrado; junto com
     * "quanto custa um implante?" tira 0.672.
     *
     * Só roda quando a primeira busca já falhou, e custa um embedding — não
     * uma chamada ao modelo.
     */
    tentarComContextoDaConversa: true,

    /**
     * Quantos trechos mandar quando NENHUM passa do limiar.
     *
     * Dois, e nao os quatro do topK: se nem o melhor era bom, encher o
     * prompt de trecho fraco so confunde o modelo e custa token.
     */
    chunksQuandoNadaPassa: 2,
  },

  /** Adaptador web (simulador, painel e bateria de testes). */
  web: {
    porta: Number(process.env.WEB_PORT ?? 3000),
    /**
     * Teto do corpo da requisição. Uma mensagem de atendimento não tem
     * megabytes, e o maior corpo que a página de testes manda é a suíte de
     * perguntas inteira — uns 6 KB no tenant de exemplo.
     */
    tamanhoMaximoDoCorpo: 64 * 1024,
  },

  /** Suíte de avaliação. */
  avaliacao: {
    /**
     * Custo médio de uma pergunta, em dólares. Serve SÓ para a página de testes
     * avisar quanto vai gastar antes de você clicar em rodar — o custo real de
     * cada resposta é medido e reportado individualmente.
     *
     * Medido em 2026-09-24: US$ 0,000311 na barbearia, US$ 0,00042 na clínica.
     * Arredondado para cima de propósito: estimativa que engana para baixo é
     * pior que estimativa nenhuma.
     */
    custoEstimadoPorPerguntaUsd: 0.0005,
  },

  /** Agenda: o que o bot pode fazer nela. */
  agenda: {
    /**
     * Oferecer as ferramentas em toda mensagem.
     *
     * As definicoes entram no input sempre (~400 tokens). Comeca ligado e
     * MEDE-SE; filtrar por intencao antes de ter o numero seria otimizar no
     * escuro, e um filtro por palavra-chave erraria justamente nos pedidos
     * tortos, que sao a maioria.
     */
    ferramentasSempre: true,
    /**
     * Teto de idas e voltas com ferramenta numa mesma mensagem.
     *
     * Sem teto, um modelo confuso repete a chamada e queima credito em
     * silencio. Tres cobre o caso normal: consultar horarios, criar, e
     * responder.
     */
    maximoDeVoltas: 3,

    /** Lembrete enviado no dia da consulta. */
    lembrete: {
      /**
       * `kind` da linha no outbox.
       *
       * É metade do índice único `(appointment_id, kind)`, que é o que garante
       * a idempotência. Mudar este valor faz o comando gerar de novo tudo que
       * já tinha sido gerado — um lembrete repetido por consulta.
       */
      tipo: 'lembrete_dia',
      /**
       * Hora em que o lembrete deve sair, no dia da consulta.
       *
       * Precisa ser ANTES do primeiro horário da grade, senão o lembrete da
       * consulta das 08:00 sairia depois dela. Se alguma agenda abrir mais
       * cedo, baixe este valor — `previstoPara` tem uma trava que nunca deixa
       * o lembrete cair depois da consulta, mas trava é rede de segurança, não
       * configuração.
       */
      horaDeEnvio: '07:30',
    },
  },

  /** Estado e janela de contexto da conversa. */
  conversa: {
    /**
     * Quantas mensagens anteriores vão junto com a pergunta.
     * Histórico longo é caro e dilui as regras do prompt; 8 dá uns 4 turnos,
     * que cobre o "e o preço disso?" logo depois de uma pergunta.
     */
    mensagensNaJanela: 8,
    /**
     * Agrupar mensagens seguidas do cliente num turno só.
     *
     * Ninguém escreve um parágrafo no WhatsApp: escreve "quero marcar", depois
     * "pra sexta", depois "as 9". Sem isto o bot responde três vezes a um
     * pedido só, e paga três chamadas ao modelo por ele.
     *
     * Esperar o cliente parar de digitar seria melhor e NÃO é possível: no
     * WhatsApp oficial o indicador de digitação só vai do negócio para o
     * cliente, e nenhum webhook carrega presença. Então o contador reinicia a
     * cada mensagem que chega, que é o único sinal que existe.
     */
    agrupamento: {
      ativo: true,
      /** Silêncio necessário para fechar o turno. Reinicia a cada mensagem. */
      esperaMs: 2500,
      /**
       * Teto desde a primeira mensagem do lote. Sem ele, quem digita sem
       * parar nunca receberia resposta.
       */
      esperaMaximaMs: 12000,
    },
    /**
     * Conversa passada a um humano não volta a ser respondida pelo bot.
     * Deixar o bot continuar atropelaria o atendente no meio do atendimento.
     */
    bloquearBotAposHandoff: true,

    /**
     * Memória compactada: quando a conversa passa da janela, as mensagens mais
     * antigas viram um resumo em vez de simplesmente sumirem.
     *
     * Sem isto, numa conversa de 12 mensagens o começo cai fora da janela e o
     * cliente precisa repetir o que já contou — que é exatamente o que um
     * atendimento não pode fazer.
     */
    resumo: {
      ativo: true,
      /**
       * Quantas mensagens continuam ÍNTEGRAS depois de uma compactação.
       *
       * Governa a frequência: com janela 8 e 4 preservadas, compacta a cada 4
       * mensagens novas, ou seja a cada 2 turnos. Preservar menos economiza
       * chamadas e perde literalidade; preservar mais faz o contrário.
       */
      mensagensPreservadas: 4,
      /** Teto do resumo. Memória que cresce sem limite vira outra janela cheia. */
      maximoDeLinhas: 8,
    },
  },

  /**
   * Turno social: saudação, agradecimento, despedida e confirmação.
   *
   * Mensagens assim não são pergunta sobre o negócio e não podem passar pelo
   * caminho de busca. Medido de verdade: "boa tarde" tira 0.370 na clínica,
   * abaixo do limiar, e sem este desvio o bot chamaria um atendente para
   * responder a um cumprimento — e ainda se calaria pelo resto da conversa,
   * porque depois de um handoff o bot para de responder.
   */
  social: {
    /** Desligue para voltar ao comportamento antigo (tudo vira busca). */
    ativo: true,
    /**
     * Expressões que caracterizam cada tipo de turno, já sem acento e em
     * minúsculas — é assim que o texto chega na comparação.
     *
     * Só entra aqui o que NÃO cabe no meio de uma pergunta de verdade. Por
     * isso "até" sozinho ficou de fora e só as formas compostas ("até logo")
     * entraram: "até que horas vocês abrem?" é pergunta, não despedida.
     */
    expressoes: {
      saudacao: [
        'bom dia',
        'boa tarde',
        'boa noite',
        'boa madrugada',
        'tudo bem',
        'tudo bom',
        'td bem',
        'td bom',
        'como vai',
        'como voce esta',
        'como esta',
        'oi',
        'oie',
        'ola',
        'opa',
        'alo',
        'e ai',
        'eai',
        'eae',
        'salve',
        'hey',
      ],
      agradecimento: [
        'muito obrigado',
        'muito obrigada',
        'obrigadao',
        'obrigado',
        'obrigada',
        'brigado',
        'brigada',
        'agradeco',
        'valeu',
        'grato',
        'grata',
        'obg',
        'vlw',
      ],
      despedida: [
        'bom fim de semana',
        'ate a proxima',
        'ate amanha',
        'ate breve',
        'ate logo',
        'ate mais',
        'boa semana',
        'bom descanso',
        'abracos',
        'abraco',
        'adeus',
        'falou',
        'tchau',
        'xau',
        'flw',
      ],
      confirmacao: [
        'tudo certo',
        'isso mesmo',
        'ta bom',
        'ta bem',
        'entendi',
        'beleza',
        'perfeito',
        'bacana',
        'certo',
        'exato',
        'otimo',
        'legal',
        'okay',
        'show',
        'uhum',
        'aham',
        'blz',
        'sim',
        'ok',
      ],
    },
    /**
     * Palavras que não carregam pergunta nenhuma. Saem junto com as expressões
     * sociais, então "oi, por favor" continua sendo só uma saudação.
     */
    ruido: [
      'por favor',
      'pessoal',
      'senhora',
      'senhor',
      'entao',
      'amiga',
      'amigo',
      'gente',
      'muito',
      'moca',
      'moco',
      'pfv',
      'mto',
      'sra',
      'ne',
      'sr',
      'ai',
    ],
  },

  /** Regras de comportamento do bot — viram instruções no prompt do sistema. */
  resposta: {
    maximoDeLinhas: 3,
    /** Frase fixa quando não há base para responder. */
    fraseDeHandoff: 'Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.',
    /**
     * Trecho que caracteriza a INTENÇÃO de escalar, independente da redação.
     *
     * Existe porque procurar a frase inteira não basta: medindo estabilidade
     * em 5 rodadas, o modelo produziu "Não tenho informação sobre desconto à
     * vista aqui. Vou chamar alguém da equipe para te ajudar." — parafraseou a
     * primeira oração e escapou da detecção. A resposta foi marcada como
     * resolvida e ninguém seria chamado, embora o bot tivesse acabado de
     * prometer que chamaria.
     *
     * A promessa de escalar é a parte estável da frase, então é ela que
     * detectamos. Se você mudar `fraseDeHandoff`, ajuste este trecho também.
     */
    marcadorDeHandoff: 'vou chamar alguém da equipe',

    /**
     * Resposta ao cliente que tocou em "falar com o atendente virtual".
     *
     * Curta de proposito: quem tocou no botao quer continuar o assunto, nao
     * ler uma saudacao nova.
     */
    fraseDeRetomada: 'Voltei! Pode continuar, estou aqui.',
  },
} as const;

export type Config = typeof config;
