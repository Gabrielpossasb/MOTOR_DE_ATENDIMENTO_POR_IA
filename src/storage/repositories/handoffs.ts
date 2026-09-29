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

/** Handoff que ninguém da equipe olhou ainda, com o contexto para olhar. */
export interface HandoffPendente {
  id: number;
  conversaId: number;
  contatoId: string;
  motivo: string;
  /** A mensagem que fez o bot desistir, quando houver. */
  pergunta: string | null;
  /** O bot voltou a responder esta conversa depois do handoff? */
  botVoltou: boolean;
  criadoEm: string;
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

/**
 * Handoffs que ninguém revisou, do mais recente para o mais antigo.
 *
 * `botVoltou` é o que o colaborador mais precisa ver: quer dizer que o cliente
 * tocou em "falar com o atendente virtual" e seguiu sozinho. O atendimento
 * talvez não precise mais dele, mas a pergunta continua valendo — por que o
 * bot chamou?
 */
export function listarHandoffsPendentes(db: Db, tenantId: number, limite = 50): HandoffPendente[] {
  const linhas = db
    .prepare(
      `SELECT h.id, h.conversation_id, h.reason, h.created_at,
              c.contact_id, c.status,
              (SELECT u.question FROM unanswered u
                WHERE u.conversation_id = h.conversation_id
                ORDER BY u.id DESC LIMIT 1) AS question
       FROM handoffs h
       JOIN conversations c ON c.id = h.conversation_id
       WHERE c.tenant_id = ? AND h.resolved_at IS NULL
       ORDER BY h.id DESC
       LIMIT ?`,
    )
    .all(tenantId, limite) as {
    id: number;
    conversation_id: number;
    reason: string;
    created_at: string;
    contact_id: string;
    status: string;
    question: string | null;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    conversaId: l.conversation_id,
    contatoId: l.contact_id,
    motivo: l.reason,
    pergunta: l.question,
    // A conversa saiu de 'handoff' com o handoff ainda pendente: só o botão
    // faz isso.
    botVoltou: l.status !== 'handoff',
    criadoEm: l.created_at,
  }));
}

/** Marca como revisado. Devolve false se o id não existe ou já estava. */
export function marcarHandoffRevisado(db: Db, tenantId: number, id: number): boolean {
  const resultado = db
    .prepare(
      `UPDATE handoffs SET resolved_at = datetime('now')
       WHERE id = ? AND resolved_at IS NULL
         AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ?)`,
    )
    .run(id, tenantId);

  return resultado.changes > 0;
}

/**
 * Conversas que tiveram ALGUM handoff, revisado ou não.
 *
 * É o que a taxa de resolução conta, e não o status atual: depois do botão a
 * conversa volta para 'open', e olhar só o status faria uma conversa que
 * precisou de gente contar como resolvida pelo bot.
 */
export function conversasQueTiveramHandoff(db: Db, tenantId: number): number {
  const linha = db
    .prepare(
      `SELECT COUNT(DISTINCT h.conversation_id) AS total
       FROM handoffs h
       JOIN conversations c ON c.id = h.conversation_id
       WHERE c.tenant_id = ?`,
    )
    .get(tenantId) as { total: number };

  return linha.total;
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
