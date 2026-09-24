/**
 * Busca dos chunks mais parecidos com a pergunta.
 *
 * A implementação atual varre os chunks do tenant em memória. Ela fica atrás da
 * interface `BuscaVetorial` justamente para que trocar por sqlite-vec mais
 * tarde seja uma classe nova, e não uma refatoração.
 */
import type { Db } from '../../storage/db.js';
import { carregarChunksDoTenant } from '../../storage/repositories/chunks.js';
import type { ResultadoDeBusca } from '../types.js';
import { similaridadeDeCosseno } from './vector.js';

export interface BuscaVetorial {
  buscar(tenantId: number, vetorDaPergunta: number[] | Float32Array, topK: number): ResultadoDeBusca[];
}

export class BuscaPorCossenoEmMemoria implements BuscaVetorial {
  constructor(private readonly db: Db) {}

  buscar(tenantId: number, vetorDaPergunta: number[] | Float32Array, topK: number): ResultadoDeBusca[] {
    if (topK <= 0) return [];

    // O filtro por tenant acontece na consulta: um cliente nunca vê o chunk de
    // outro, nem por acidente de ordenação.
    const chunks = carregarChunksDoTenant(this.db, tenantId);

    const pontuados: ResultadoDeBusca[] = chunks.map((c) => ({
      chunk: {
        id: c.id,
        documentId: c.documentId,
        tenantId: c.tenantId,
        indice: c.indice,
        texto: c.texto,
        metadados: c.metadados,
      },
      arquivo: c.arquivo,
      score: similaridadeDeCosseno(vetorDaPergunta, c.embedding),
    }));

    pontuados.sort((a, b) => b.score - a.score);
    return pontuados.slice(0, topK);
  }
}
