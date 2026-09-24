/** Chunks e seus embeddings. */
import type { Db } from '../db.js';
import type { Chunk, MetadadosDoChunk } from '../../core/types.js';
import { blobParaVetor, vetorParaBlob } from '../../core/rag/vector.js';

export interface ChunkParaGravar {
  documentId: number;
  tenantId: number;
  indice: number;
  texto: string;
  embedding: number[] | Float32Array;
  metadados: MetadadosDoChunk;
}

/** Um chunk lido do banco, já com o vetor e o arquivo de origem. */
export interface ChunkComVetor extends Chunk {
  embedding: Float32Array;
  arquivo: string;
}

/** Insere todos os chunks de uma vez, numa transação só. */
export function inserirChunks(db: Db, chunks: ChunkParaGravar[]): void {
  const insert = db.prepare(
    `INSERT INTO chunks (document_id, tenant_id, chunk_index, text, embedding, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const inserirTodos = db.transaction((lista: ChunkParaGravar[]) => {
    for (const c of lista) {
      insert.run(
        c.documentId,
        c.tenantId,
        c.indice,
        c.texto,
        vetorParaBlob(c.embedding),
        JSON.stringify(c.metadados),
      );
    }
  });

  inserirTodos(chunks);
}

/**
 * Carrega todos os chunks de um tenant.
 *
 * Na fase local o corpus de cada cliente cabe folgado na memória, então a busca
 * varre tudo. Quando isso deixar de valer, esta função vira a fronteira onde o
 * sqlite-vec entra — o resto do código não percebe.
 */
export function carregarChunksDoTenant(db: Db, tenantId: number): ChunkComVetor[] {
  const linhas = db
    .prepare(
      `SELECT c.id, c.document_id, c.tenant_id, c.chunk_index, c.text, c.embedding, c.metadata,
              d.filename
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.tenant_id = ?
       ORDER BY d.filename, c.chunk_index`,
    )
    .all(tenantId) as {
    id: number;
    document_id: number;
    tenant_id: number;
    chunk_index: number;
    text: string;
    embedding: Buffer;
    metadata: string;
    filename: string;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    documentId: l.document_id,
    tenantId: l.tenant_id,
    indice: l.chunk_index,
    texto: l.text,
    metadados: JSON.parse(l.metadata) as MetadadosDoChunk,
    embedding: blobParaVetor(l.embedding),
    arquivo: l.filename,
  }));
}

export function contarChunks(db: Db, tenantId: number): number {
  const linha = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE tenant_id = ?').get(tenantId) as {
    total: number;
  };
  return linha.total;
}
