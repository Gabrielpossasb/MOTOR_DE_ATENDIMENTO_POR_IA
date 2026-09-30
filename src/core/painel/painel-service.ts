/**
 * Números do painel.
 *
 * A agregação fica no core, e não no adaptador web, por dois motivos: é lógica
 * de negócio (o que conta como "resolvido" é uma decisão, não formatação), e
 * assim ela tem teste offline. O adaptador só serializa para JSON.
 */
import type { Db } from '../../storage/db.js';
import { carregarTenant, configEfetiva } from '../tenant/tenant-service.js';
import {
  conversasQueTiveramHandoff,
  listarHandoffsPendentes,
  listarPerguntasSemResposta,
  type HandoffPendente,
  type PerguntaSemResposta,
} from '../../storage/repositories/handoffs.js';
import { listarLembretes, type Lembrete } from '../agenda/lembretes.js';

export interface ResumoDeConversa {
  id: number;
  contatoId: string;
  canal: string;
  status: 'open' | 'handoff' | 'closed';
  totalDeMensagens: number;
  custoUsd: number;
  ultimaMensagem: string;
  atualizadaEm: string;
}

export interface PainelDoTenant {
  tenant: { slug: string; nome: string };
  /** Ajustes em vigor — o painel mostra o limiar ao lado dos scores. */
  ajustes: { topK: number; limiarDeConfianca: number };
  conversas: {
    total: number;
    abertas: number;
    emHandoff: number;
    fechadas: number;
  };
  /**
   * Fração de conversas que o bot atendeu sem precisar de humano.
   *
   * Conta por CONVERSA, não por mensagem: uma conversa que precisou de humano
   * no fim não foi resolvida pelo bot, por mais que ele tenha acertado as
   * cinco perguntas anteriores. É essa a métrica que diz se o bot está
   * economizando trabalho da equipe.
   */
  taxaDeResolucao: number;
  mensagens: {
    total: number;
    doBot: number;
    latenciaMediaMs: number;
  };
  custo: {
    acumuladoUsd: number;
    medioPorMensagemUsd: number;
  };
  /** Handoffs que ninguem da equipe revisou ainda. */
  handoffsPendentes: HandoffPendente[];
  /**
   * Lembretes enfileirados que ainda não saíram.
   *
   * Nesta fase nada sai sozinho: quem drena é `npm run lembretes -- <slug>`.
   * A fila aparecer no painel é o que faz a recepção notar que o comando não
   * rodou hoje — senão o lembrete não sair passaria em silêncio.
   */
  lembretesPendentes: Lembrete[];
  perguntasSemResposta: PerguntaSemResposta[];
  listaDeConversas: ResumoDeConversa[];
}

export function montarPainel(db: Db, slug: string, limiteDeConversas = 50): PainelDoTenant {
  const tenant = carregarTenant(db, slug);

  const porStatus = db
    .prepare('SELECT status, COUNT(*) AS total FROM conversations WHERE tenant_id = ? GROUP BY status')
    .all(tenant.id) as { status: string; total: number }[];

  const contar = (status: string) => porStatus.find((l) => l.status === status)?.total ?? 0;
  const abertas = contar('open');
  const emHandoff = contar('handoff');
  const fechadas = contar('closed');
  const totalDeConversas = abertas + emHandoff + fechadas;

  const mensagens = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS do_bot,
              COALESCE(SUM(m.estimated_cost_usd), 0) AS custo,
              COALESCE(AVG(m.latency_ms), 0) AS latencia
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.tenant_id = ?`,
    )
    .get(tenant.id) as { total: number; do_bot: number | null; custo: number; latencia: number };

  const doBot = mensagens.do_bot ?? 0;

  // Conta conversas que TIVERAM handoff, e não as que estão em handoff agora.
  //
  // Desde que existe o botão de trazer o bot de volta, a conversa volta para
  // `open` com o handoff ainda pendente. Olhar só o status faria uma conversa
  // que precisou chamar a equipe aparecer como resolvida pelo bot — e é
  // justamente esse caso que a métrica existe para não esconder.
  const tiveramHandoff = conversasQueTiveramHandoff(db, tenant.id);

  return {
    tenant: { slug: tenant.slug, nome: tenant.nome },
    ajustes: configEfetiva(tenant),
    conversas: { total: totalDeConversas, abertas, emHandoff, fechadas },
    taxaDeResolucao:
      totalDeConversas === 0 ? 0 : (totalDeConversas - tiveramHandoff) / totalDeConversas,
    handoffsPendentes: listarHandoffsPendentes(db, tenant.id),
    lembretesPendentes: listarLembretes(db, tenant.id, { limite: 50 }),
    mensagens: {
      total: mensagens.total,
      doBot,
      latenciaMediaMs: Math.round(mensagens.latencia),
    },
    custo: {
      acumuladoUsd: mensagens.custo,
      medioPorMensagemUsd: doBot === 0 ? 0 : mensagens.custo / doBot,
    },
    perguntasSemResposta: listarPerguntasSemResposta(db, tenant.id),
    listaDeConversas: listarResumoDeConversas(db, tenant.id, limiteDeConversas),
  };
}

/** Uma linha por conversa, com o que o painel precisa mostrar sem abrir cada uma. */
export function listarResumoDeConversas(db: Db, tenantId: number, limite = 50): ResumoDeConversa[] {
  const linhas = db
    .prepare(
      `SELECT c.id, c.contact_id, c.channel, c.status, c.updated_at,
              COUNT(m.id) AS total_mensagens,
              COALESCE(SUM(m.estimated_cost_usd), 0) AS custo,
              (SELECT content FROM messages
                WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS ultima
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.tenant_id = ?
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT ?`,
    )
    .all(tenantId, limite) as {
    id: number;
    contact_id: string;
    channel: string;
    status: 'open' | 'handoff' | 'closed';
    updated_at: string;
    total_mensagens: number;
    custo: number;
    ultima: string | null;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    contatoId: l.contact_id,
    canal: l.channel,
    status: l.status,
    totalDeMensagens: l.total_mensagens,
    custoUsd: l.custo,
    ultimaMensagem: l.ultima ?? '',
    atualizadaEm: l.updated_at,
  }));
}
