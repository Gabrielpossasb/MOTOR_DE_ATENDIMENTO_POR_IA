/**
 * Tipos compartilhados do núcleo.
 *
 * Nada aqui menciona WhatsApp, terminal ou web: o núcleo recebe texto e
 * devolve texto. Quem sabe de canal são os adaptadores em src/adapters/.
 */

/** Ajustes por cliente que sobrescrevem os defaults de config.ts. */
export interface ConfigDoTenant {
  topK?: number;
  limiarDeConfianca?: number;
  agenda?: ConfigDaAgenda;
}

/**
 * Agenda do cliente, em dado estruturado.
 *
 * Fica no tenant.json e NÃO nos documentos de propósito: o .txt de horários é
 * texto para o RAG ler em voz alta, e agenda precisa de algo que dê para
 * calcular. Os dois vão existir em paralelo e precisam concordar — se o
 * documento disser que abre sábado e isto aqui não, o bot informa um horário
 * que não consegue marcar.
 */
export interface ConfigDaAgenda {
  /** Minutos por consulta. Define a grade de horários. */
  duracaoMin: number;
  /**
   * Janelas de funcionamento por dia da semana (0 = domingo).
   * Dia ausente ou lista vazia = fechado. Duas janelas cobrem o almoço.
   */
  janelas: Record<string, [string, string][]>;
  /** Antecedência mínima para marcar, em horas. Evita marcar para daqui a 5min. */
  antecedenciaMinimaHoras: number;
  /** Até quantos dias à frente aceita marcar. */
  diasNoFuturo: number;
}

export interface Tenant {
  id: number;
  slug: string;
  nome: string;
  config: ConfigDoTenant;
  promptDoSistema: string;
}

/** Metadados guardados junto de cada chunk, para citar a fonte depois. */
export interface MetadadosDoChunk {
  /** Título da seção de onde o texto veio (ex.: "Horários"). */
  secao?: string;
  /** Modelo de embedding usado — permite detectar chunks de modelo antigo. */
  modeloDeEmbedding?: string;
}

export interface Chunk {
  id: number;
  documentId: number;
  tenantId: number;
  indice: number;
  texto: string;
  metadados: MetadadosDoChunk;
}

/** Um chunk recuperado pela busca, com sua similaridade com a pergunta. */
export interface ResultadoDeBusca {
  chunk: Chunk;
  /** Similaridade de cosseno, de -1 a 1 (na prática 0 a 1 com estes modelos). */
  score: number;
  /** Nome do arquivo de origem — usado para citar a fonte. */
  arquivo: string;
}

/** A fonte citada ao usuário. */
export interface Fonte {
  arquivo: string;
  secao?: string;
  score: number;
}

/** Quanto custou produzir uma resposta. */
export interface Uso {
  tokensEntrada: number;
  tokensSaida: number;
  custoEstimadoUsd: number;
  latenciaMs: number;
}

/** Por que a conversa foi passada para um humano. */
export type MotivoDeHandoff =
  | 'baixa_confianca'
  | 'sem_chunks'
  | 'pedido_do_usuario'
  /** A conversa ja estava com um humano quando a mensagem chegou. */
  | 'aguardando_humano';

/**
 * Turno de conversa que não é pergunta sobre o negócio.
 *
 * Existe porque o motor tinha só dois modos — responder pelos documentos ou
 * chamar um humano — e uma saudação não é nenhum dos dois. Sem esta terceira
 * categoria, "boa tarde" pontua baixo na busca, cai no limiar e aciona a
 * equipe.
 */
export type CategoriaSocial = 'saudacao' | 'agradecimento' | 'despedida' | 'confirmacao';

/**
 * Uma ação que o cliente pode tomar, oferecida junto com a resposta.
 *
 * O núcleo NÃO sabe que existe botão: devolve a ação, e cada borda desenha do
 * seu jeito — botão de resposta no WhatsApp, botão na página, comando no
 * terminal. É o que faz o canal continuar sendo adaptador.
 */
export interface AcaoSugerida {
  /** Identificador estável; é o que a borda manda de volta. */
  id: 'voltar_ao_bot';
  rotulo: string;
}

/** O que o núcleo devolve para qualquer adaptador. */
export interface RespostaDoBot {
  texto: string;
  fontes: Fonte[];
  /** true quando o bot desistiu e pediu ajuda humana. */
  precisaDeHumano: boolean;
  motivoDoHandoff?: MotivoDeHandoff;
  /** Preenchido quando a mensagem foi tratada como turno social, sem busca. */
  turnoSocial?: CategoriaSocial;
  /** Ações oferecidas ao cliente. Hoje, só a de trazer o bot de volta. */
  acoes?: AcaoSugerida[];
  /** Melhor score encontrado na busca — guardado para calibrar o limiar. */
  melhorScore: number;
  uso: Uso;
  /** Conversa em que a mensagem entrou. Ausente quando nao houve persistencia. */
  conversaId?: number;
  /**
   * true quando a conversa ja esta com um humano e o bot deliberadamente nao
   * respondeu. O adaptador usa isso para nao enviar mensagem nenhuma.
   */
  aguardandoHumano: boolean;
}

/** Um turno já trocado, do jeito que vai para a janela de contexto. */
export interface TurnoDaConversa {
  papel: 'user' | 'assistant';
  conteudo: string;
}
