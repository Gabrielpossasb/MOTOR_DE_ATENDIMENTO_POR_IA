/** Conversas: uma linha por atendimento de um contato. */
import type { Db } from '../db.js';

export type StatusDaConversa = 'open' | 'handoff' | 'closed';

export interface Conversa {
  id: number;
  tenantId: number;
  contatoId: string;
  canal: string;
  status: StatusDaConversa;
}

interface LinhaConversa {
  id: number;
  tenant_id: number;
  contact_id: string;
  channel: string;
  status: StatusDaConversa;
}

function paraConversa(linha: LinhaConversa): Conversa {
  return {
    id: linha.id,
    tenantId: linha.tenant_id,
    contatoId: linha.contact_id,
    canal: linha.channel,
    status: linha.status,
  };
}

/**
 * Devolve a conversa em andamento do contato, ou cria uma.
 *
 * "Em andamento" inclui `handoff`: uma conversa que foi passada para um humano
 * continua sendo a mesma conversa. Só `closed` faz o próximo contato começar
 * do zero — senão o histórico de um atendimento resolvido meses atrás voltaria
 * a ser enviado ao modelo, caro e confuso.
 */
export function obterOuCriarConversa(
  db: Db,
  tenantId: number,
  contatoId: string,
  canal: string,
): Conversa {
  const existente = db
    .prepare(
      `SELECT id, tenant_id, contact_id, channel, status
       FROM conversations
       WHERE tenant_id = ? AND contact_id = ? AND status != 'closed'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(tenantId, contatoId) as LinhaConversa | undefined;

  if (existente) return paraConversa(existente);

  const resultado = db
    .prepare('INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (?, ?, ?)')
    .run(tenantId, contatoId, canal);

  return {
    id: Number(resultado.lastInsertRowid),
    tenantId,
    contatoId,
    canal,
    status: 'open',
  };
}

export function mudarStatus(db: Db, conversaId: number, status: StatusDaConversa): void {
  db.prepare("UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    conversaId,
  );
}

/** Marca que houve atividade, sem mexer no status. */
export function marcarAtividade(db: Db, conversaId: number): void {
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversaId);
}

export function buscarConversa(db: Db, conversaId: number): Conversa | undefined {
  const linha = db
    .prepare('SELECT id, tenant_id, contact_id, channel, status FROM conversations WHERE id = ?')
    .get(conversaId) as LinhaConversa | undefined;
  return linha ? paraConversa(linha) : undefined;
}

export function listarConversas(db: Db, tenantId: number): Conversa[] {
  const linhas = db
    .prepare(
      `SELECT id, tenant_id, contact_id, channel, status
       FROM conversations WHERE tenant_id = ? ORDER BY updated_at DESC`,
    )
    .all(tenantId) as LinhaConversa[];
  return linhas.map(paraConversa);
}
