/** Mensagens trocadas, com o que cada uma custou. */
import type { Db } from '../db.js';
import type { Fonte } from '../../core/types.js';

export type PapelDaMensagem = 'user' | 'assistant' | 'system';

export interface MensagemGravada {
  id: number;
  conversaId: number;
  papel: PapelDaMensagem;
  conteudo: string;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
  latenciaMs: number | null;
  fontes: Fonte[];
  criadaEm: string;
}

export interface MensagemParaGravar {
  conversaId: number;
  papel: PapelDaMensagem;
  conteudo: string;
  tokensEntrada?: number;
  tokensSaida?: number;
  custoUsd?: number;
  latenciaMs?: number;
  fontes?: Fonte[];
}

export function gravarMensagem(db: Db, mensagem: MensagemParaGravar): number {
  const resultado = db
    .prepare(
      `INSERT INTO messages
         (conversation_id, role, content, tokens_in, tokens_out,
          estimated_cost_usd, latency_ms, sources)
       VALUES (@conversaId, @papel, @conteudo, @tokensEntrada, @tokensSaida,
               @custoUsd, @latenciaMs, @fontes)`,
    )
    .run({
      conversaId: mensagem.conversaId,
      papel: mensagem.papel,
      conteudo: mensagem.conteudo,
      tokensEntrada: mensagem.tokensEntrada ?? null,
      tokensSaida: mensagem.tokensSaida ?? null,
      custoUsd: mensagem.custoUsd ?? null,
      latenciaMs: mensagem.latenciaMs ?? null,
      fontes: mensagem.fontes ? JSON.stringify(mensagem.fontes) : null,
    });

  return Number(resultado.lastInsertRowid);
}

interface LinhaMensagem {
  id: number;
  conversation_id: number;
  role: PapelDaMensagem;
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  sources: string | null;
  created_at: string;
}

function paraMensagem(linha: LinhaMensagem): MensagemGravada {
  return {
    id: linha.id,
    conversaId: linha.conversation_id,
    papel: linha.role,
    conteudo: linha.content,
    tokensEntrada: linha.tokens_in,
    tokensSaida: linha.tokens_out,
    custoUsd: linha.estimated_cost_usd,
    latenciaMs: linha.latency_ms,
    fontes: linha.sources ? (JSON.parse(linha.sources) as Fonte[]) : [],
    criadaEm: linha.created_at,
  };
}

/**
 * Últimas `limite` mensagens da conversa, em ordem cronológica.
 *
 * A consulta pega as mais recentes (ORDER BY id DESC + LIMIT) e só então
 * inverte: buscar as primeiras e cortar o fim traria o começo da conversa, que
 * é justamente a parte menos relevante para a próxima resposta.
 */
export function ultimasMensagens(db: Db, conversaId: number, limite: number): MensagemGravada[] {
  if (limite <= 0) return [];

  const linhas = db
    .prepare(
      `SELECT id, conversation_id, role, content, tokens_in, tokens_out,
              estimated_cost_usd, latency_ms, sources, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(conversaId, limite) as LinhaMensagem[];

  return linhas.reverse().map(paraMensagem);
}

/**
 * Mensagens posteriores a um id, em ordem cronológica.
 *
 * É o outro lado da marca d'água do resumo: o que ainda NÃO foi compactado e
 * portanto precisa ir íntegro ao modelo. `apos = 0` traz a conversa inteira.
 */
export function mensagensApos(db: Db, conversaId: number, apos: number): MensagemGravada[] {
  const linhas = db
    .prepare(
      `SELECT id, conversation_id, role, content, tokens_in, tokens_out,
              estimated_cost_usd, latency_ms, sources, created_at
       FROM messages
       WHERE conversation_id = ? AND id > ?
       ORDER BY id ASC`,
    )
    .all(conversaId, apos) as LinhaMensagem[];

  return linhas.map(paraMensagem);
}

export function contarMensagens(db: Db, conversaId: number): number {
  const linha = db
    .prepare('SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?')
    .get(conversaId) as { total: number };
  return linha.total;
}

/** Custo acumulado de um tenant — alimenta o painel da Etapa 3. */
export function custoAcumulado(db: Db, tenantId: number): number {
  const linha = db
    .prepare(
      `SELECT COALESCE(SUM(m.estimated_cost_usd), 0) AS total
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.tenant_id = ?`,
    )
    .get(tenantId) as { total: number };
  return linha.total;
}
