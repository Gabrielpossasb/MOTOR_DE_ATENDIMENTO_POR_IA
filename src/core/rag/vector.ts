/**
 * Matemática de vetores e conversão para o formato guardado no SQLite.
 *
 * Os embeddings vão para o banco como BLOB de Float32 (4 bytes por dimensão):
 * metade do espaço de Float64 e precisão de sobra para similaridade.
 */

/**
 * Similaridade de cosseno entre dois vetores.
 *
 * Os embeddings da OpenAI já vêm normalizados, então na prática isto é um
 * produto escalar — mas normalizamos mesmo assim para a função ficar correta
 * com qualquer implementação de Embedder (inclusive a fake dos testes).
 */
export function similaridadeDeCosseno(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vetores de tamanhos diferentes: ${a.length} e ${b.length}`);
  }

  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] as number;
    const vb = b[i] as number;
    produto += va * vb;
    normaA += va * va;
    normaB += vb * vb;
  }

  // Vetor nulo não tem direção: similaridade indefinida vira 0.
  if (normaA === 0 || normaB === 0) return 0;

  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/** Serializa um vetor para o BLOB guardado na coluna `chunks.embedding`. */
export function vetorParaBlob(vetor: readonly number[] | Float32Array): Buffer {
  const float32 = vetor instanceof Float32Array ? vetor : Float32Array.from(vetor);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/** Lê de volta o vetor guardado no BLOB. */
export function blobParaVetor(blob: Buffer): Float32Array {
  if (blob.byteLength % 4 !== 0) {
    throw new Error(`BLOB de embedding com tamanho inválido: ${blob.byteLength} bytes`);
  }
  // Copiamos: o Buffer do better-sqlite3 pode compartilhar memória com o driver.
  const copia = Buffer.from(blob);
  return new Float32Array(copia.buffer, copia.byteOffset, copia.byteLength / 4);
}
