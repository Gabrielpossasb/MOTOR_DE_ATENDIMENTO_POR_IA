/**
 * Geração de embeddings.
 *
 * O núcleo depende da interface `Embedder`, não da OpenAI. Trocar de provedor
 * (ou voltar para um modelo local) é acrescentar uma classe aqui — nada mais
 * do núcleo muda. Os testes usam um embedder falso, então não gastam crédito.
 */
import OpenAI from 'openai';
import { config } from '../../config.js';

export interface ResultadoDeEmbedding {
  vetores: number[][];
  /** Tokens consumidos — entra no cálculo de custo da ingestão. */
  tokens: number;
}

export interface Embedder {
  /** Nome do modelo, guardado nos metadados do chunk. */
  readonly modelo: string;
  /** Gera o vetor de vários textos de uma vez. */
  gerar(textos: string[]): Promise<ResultadoDeEmbedding>;
}

/** Embedder da OpenAI, com envio em lotes. */
export class EmbedderOpenAI implements Embedder {
  readonly modelo: string;
  private readonly cliente: OpenAI;
  private readonly tamanhoDoLote: number;

  constructor(apiKey: string = config.openai.apiKey, modelo: string = config.embeddings.modelo) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada. Copie .env.example para .env e preencha a chave.');
    }
    this.cliente = new OpenAI({ apiKey });
    this.modelo = modelo;
    this.tamanhoDoLote = config.embeddings.tamanhoDoLote;
  }

  async gerar(textos: string[]): Promise<ResultadoDeEmbedding> {
    if (textos.length === 0) return { vetores: [], tokens: 0 };

    const vetores: number[][] = [];
    let tokens = 0;

    for (let i = 0; i < textos.length; i += this.tamanhoDoLote) {
      const lote = textos.slice(i, i + this.tamanhoDoLote);
      const resposta = await this.cliente.embeddings.create({
        model: this.modelo,
        input: lote,
      });

      // A API pode devolver fora de ordem; `index` é a garantia de alinhamento.
      const ordenados = [...resposta.data].sort((a, b) => a.index - b.index);
      vetores.push(...ordenados.map((d) => d.embedding));
      tokens += resposta.usage?.total_tokens ?? 0;
    }

    return { vetores, tokens };
  }
}

/** Custo em dólares de uma ingestão, a partir dos tokens consumidos. */
export function custoDeEmbedding(tokens: number): number {
  return (tokens / 1_000_000) * config.embeddings.precoPorMilhaoDeTokens;
}
