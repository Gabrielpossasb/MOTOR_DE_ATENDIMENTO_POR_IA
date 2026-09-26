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
  const existente = conversaAtiva(db, tenantId, contatoId);
  if (existente) return existente;

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

/**
 * A conversa em andamento do contato, se houver.
 *
 * "Em andamento" é tudo que não está `closed`, inclusive `handoff` — pela mesma
 * razão explicada em `obterOuCriarConversa`.
 */
export function conversaAtiva(db: Db, tenantId: number, contatoId: string): Conversa | undefined {
  const linha = db
    .prepare(
      `SELECT id, tenant_id, contact_id, channel, status
       FROM conversations
       WHERE tenant_id = ? AND contact_id = ? AND status != 'closed'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(tenantId, contatoId) as LinhaConversa | undefined;

  return linha ? paraConversa(linha) : undefined;
}

export function mudarStatus(db: Db, conversaId: number, status: StatusDaConversa): void {
  db.prepare("UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    conversaId,
  );
}

/** Memória compactada da conversa e até onde ela cobre. */
export interface ResumoDaConversa {
  texto: string;
  /** Tudo até esta mensagem já está dentro do resumo. */
  ateMensagemId: number;
}

export function lerResumo(db: Db, conversaId: number): ResumoDaConversa | undefined {
  const linha = db
    .prepare('SELECT summary, summary_until_message_id FROM conversations WHERE id = ?')
    .get(conversaId) as { summary: string | null; summary_until_message_id: number | null } | undefined;

  if (!linha?.summary || linha.summary_until_message_id === null) return undefined;

  return { texto: linha.summary, ateMensagemId: linha.summary_until_message_id };
}

export function salvarResumo(db: Db, conversaId: number, resumo: ResumoDaConversa): void {
  db.prepare(
    `UPDATE conversations
     SET summary = ?, summary_until_message_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(resumo.texto, resumo.ateMensagemId, conversaId);
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
