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
  },

  /** Adaptador web (simulador e painel). */
  web: {
    porta: Number(process.env.WEB_PORT ?? 3000),
    /** Teto do corpo da requisição: mensagem de atendimento não tem megabytes. */
    tamanhoMaximoDoCorpo: 64 * 1024,
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
     * Conversa passada a um humano não volta a ser respondida pelo bot.
     * Deixar o bot continuar atropelaria o atendente no meio do atendimento.
     */
    bloquearBotAposHandoff: true,
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
  },
} as const;

export type Config = typeof config;
