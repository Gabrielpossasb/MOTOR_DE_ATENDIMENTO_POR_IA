/**
 * Embedder falso, determinístico e offline.
 *
 * Os testes precisam de vetores previsíveis e de custo zero. Este embedder
 * monta um vetor a partir das palavras do texto (saco de palavras com hash),
 * então textos que compartilham vocabulário ficam próximos — o suficiente para
 * testar ordenação e corte por limiar sem tocar em rede nem em crédito.
 */
import type { Embedder, ResultadoDeEmbedding } from '../../src/core/rag/embedder.js';

const DIMENSOES = 64;

export class EmbedderFake implements Embedder {
  readonly modelo = 'fake-determinista';

  async gerar(textos: string[]): Promise<ResultadoDeEmbedding> {
    return {
      vetores: textos.map((t) => vetorDeTexto(t)),
      tokens: textos.reduce((soma, t) => soma + Math.ceil(t.length / 4), 0),
    };
  }
}

export function vetorDeTexto(texto: string): number[] {
  const vetor = new Array<number>(DIMENSOES).fill(0);

  const palavras = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2);

  for (const palavra of palavras) {
    const posicao = hash(palavra) % DIMENSOES;
    vetor[posicao] = (vetor[posicao] ?? 0) + 1;
  }

  return vetor;
}

function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
