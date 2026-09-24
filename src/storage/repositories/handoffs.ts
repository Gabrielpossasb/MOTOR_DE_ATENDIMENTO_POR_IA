/**
 * Handoffs e perguntas sem resposta.
 *
 * As duas tabelas andam juntas mas respondem a perguntas diferentes:
 * `handoffs` é operacional ("alguém precisa atender esta conversa"),
 * `unanswered` é de produto ("que buraco tem na base de conhecimento").
 */
import type { Db } from '../db.js';
import type { MotivoDeHandoff } from '../../core/types.js';

export interface Handoff {
  id: number;
  conversaId: number;
  motivo: string;
  criadoEm: string;
}

export interface PerguntaSemResposta {
  id: number;
  tenantId: number;
  conversaId: number | null;
  pergunta: string;
  melhorScore: number | null;
  criadaEm: string;
}

export function registrarHandoff(db: Db, conversaId: number, motivo: MotivoDeHandoff): number {
  const resultado = db
    .prepare('INSERT INTO handoffs (conversation_id, reason) VALUES (?, ?)')
    .run(conversaId, motivo);
  return Number(resultado.lastInsertRowid);
}

export function registrarPerguntaSemResposta(
  db: Db,
  tenantId: number,
  conversaId: number | null,
  pergunta: string,
  melhorScore: number,
): number {
  const resultado = db
    .prepare(
      `INSERT INTO unanswered (tenant_id, conversation_id, question, best_score)
       VALUES (?, ?, ?, ?)`,
    )
    .run(tenantId, conversaId, pergunta, melhorScore);
  return Number(resultado.lastInsertRowid);
}

export function listarHandoffs(db: Db, conversaId: number): Handoff[] {
  const linhas = db
    .prepare(
      `SELECT id, conversation_id, reason, created_at
       FROM handoffs WHERE conversation_id = ? ORDER BY id`,
    )
    .all(conversaId) as { id: number; conversation_id: number; reason: string; created_at: string }[];

  return linhas.map((l) => ({
    id: l.id,
    conversaId: l.conversation_id,
    motivo: l.reason,
    criadoEm: l.created_at,
  }));
}

/**
 * Perguntas sem resposta do tenant, da mais recente para a mais antiga.
 * É a lista que o painel da Etapa 3 mostra e a fonte para decidir que
 * documento falta escrever.
 */
export function listarPerguntasSemResposta(db: Db, tenantId: number, limite = 100): PerguntaSemResposta[] {
  const linhas = db
    .prepare(
      `SELECT id, tenant_id, conversation_id, question, best_score, created_at
       FROM unanswered WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(tenantId, limite) as {
    id: number;
    tenant_id: number;
    conversation_id: number | null;
    question: string;
    best_score: number | null;
    created_at: string;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    tenantId: l.tenant_id,
    conversaId: l.conversation_id,
    pergunta: l.question,
    melhorScore: l.best_score,
    criadaEm: l.created_at,
  }));
}
