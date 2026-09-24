/** Documentos brutos de cada tenant. */
import crypto from 'node:crypto';
import type { Db } from '../db.js';

export interface Documento {
  id: number;
  tenantId: number;
  arquivo: string;
  conteudo: string;
  hash: string;
}

export function hashDoConteudo(conteudo: string): string {
  return crypto.createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

export function buscarDocumento(db: Db, tenantId: number, arquivo: string): Documento | undefined {
  const linha = db
    .prepare(
      `SELECT id, tenant_id, filename, content, content_hash
       FROM documents WHERE tenant_id = ? AND filename = ?`,
    )
    .get(tenantId, arquivo) as
    | { id: number; tenant_id: number; filename: string; content: string; content_hash: string }
    | undefined;

  if (!linha) return undefined;
  return {
    id: linha.id,
    tenantId: linha.tenant_id,
    arquivo: linha.filename,
    conteudo: linha.content,
    hash: linha.content_hash,
  };
}

/**
 * Grava (ou regrava) o documento e devolve o id.
 * Os chunks antigos são apagados pelo ON DELETE CASCADE quando o documento é
 * substituído — por isso o caminho de atualização apaga e reinsere.
 */
export function salvarDocumento(db: Db, tenantId: number, arquivo: string, conteudo: string): number {
  const hash = hashDoConteudo(conteudo);
  const existente = buscarDocumento(db, tenantId, arquivo);

  if (existente) {
    db.prepare('DELETE FROM documents WHERE id = ?').run(existente.id);
  }

  const resultado = db
    .prepare(
      `INSERT INTO documents (tenant_id, filename, content, content_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .run(tenantId, arquivo, conteudo, hash);

  return Number(resultado.lastInsertRowid);
}

export function listarDocumentos(db: Db, tenantId: number): Documento[] {
  const linhas = db
    .prepare(
      `SELECT id, tenant_id, filename, content, content_hash
       FROM documents WHERE tenant_id = ? ORDER BY filename`,
    )
    .all(tenantId) as {
    id: number;
    tenant_id: number;
    filename: string;
    content: string;
    content_hash: string;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    tenantId: l.tenant_id,
    arquivo: l.filename,
    conteudo: l.content,
    hash: l.content_hash,
  }));
}
