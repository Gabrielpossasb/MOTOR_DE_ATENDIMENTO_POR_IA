import { describe, expect, it } from 'vitest';
import { blobParaVetor, similaridadeDeCosseno, vetorParaBlob } from '../src/core/rag/vector.js';

describe('similaridadeDeCosseno', () => {
  it('dá 1 para vetores idênticos', () => {
    expect(similaridadeDeCosseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('dá 1 para vetores na mesma direção mas de módulos diferentes', () => {
    // O cosseno mede direção, não tamanho.
    expect(similaridadeDeCosseno([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
  });

  it('dá 0 para vetores ortogonais', () => {
    expect(similaridadeDeCosseno([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('dá -1 para vetores opostos', () => {
    expect(similaridadeDeCosseno([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('trata vetor nulo como similaridade 0 em vez de NaN', () => {
    expect(similaridadeDeCosseno([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('recusa vetores de tamanhos diferentes', () => {
    expect(() => similaridadeDeCosseno([1, 2], [1, 2, 3])).toThrow(/tamanhos diferentes/);
  });

  it('funciona com Float32Array, que é o formato vindo do banco', () => {
    const a = Float32Array.from([0.1, 0.9, 0.3]);
    expect(similaridadeDeCosseno(a, [0.1, 0.9, 0.3])).toBeCloseTo(1, 6);
  });
});

describe('serialização do embedding', () => {
  it('sobrevive à ida e à volta pelo BLOB', () => {
    const original = [0.5, -0.25, 0.125, 1];
    const volta = blobParaVetor(vetorParaBlob(original));

    expect(volta.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(volta[i]).toBeCloseTo(original[i] as number, 6);
    }
  });

  it('gera 4 bytes por dimensão', () => {
    expect(vetorParaBlob(new Array(1536).fill(0)).byteLength).toBe(1536 * 4);
  });

  it('recusa BLOB com tamanho que não é múltiplo de 4', () => {
    expect(() => blobParaVetor(Buffer.alloc(7))).toThrow(/tamanho inválido/);
  });
});
