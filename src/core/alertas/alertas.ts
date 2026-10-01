/**
 * Avisos para o dono do negócio, sem calar o bot.
 *
 * Handoff e alerta são coisas diferentes, e misturá-las quebra as duas:
 *
 * - **Handoff** é desistência. O bot não soube, um humano assume, e o bot fica
 *   mudo para não atropelar o atendimento. Conta contra a taxa de resolução.
 * - **Alerta** é tarefa. O bot sabe o que fazer e continua a conversa, mas
 *   alguém precisa agir — confirmar um horário, decidir um desconto. NÃO conta
 *   contra a taxa, porque acontece por desenho: se toda venda precisa de
 *   confirmação de horário, uma métrica que marca todas como não resolvidas
 *   não mede nada.
 *
 * Nasceu de três pedidos concretos da Polpa Santa Helena, que é uma pessoa só
 * fazendo as entregas: avisar quando pedem desconto, confirmar o horário antes
 * de prometer, e sinalizar quando o bot não tem certeza da área de cobertura.
 */
import type { Db } from '../../storage/db.js';

export type TipoDeAlerta =
  /** Cliente pediu desconto, condição especial ou preço de atacado. */
  | 'desconto'
  /** Há um horário de entrega a confirmar com quem entrega. */
  | 'confirmar_entrega'
  /** Perguntaram de um lugar, prazo ou condição que não está documentado. */
  | 'fora_de_cobertura'
  /** Qualquer outro caso que o modelo julgou que o dono precisa ver. */
  | 'outro';

export const TIPOS_DE_ALERTA: TipoDeAlerta[] = [
  'desconto',
  'confirmar_entrega',
  'fora_de_cobertura',
  'outro',
];

/** De onde veio o aviso. Serve para medir se a rede determinística está valendo. */
export type OrigemDoAlerta = 'ferramenta' | 'palavra-chave';

export interface Alerta {
  id: number;
  conversaId: number | null;
  tipo: TipoDeAlerta;
  detalhe: string;
  /** A mensagem do cliente que disparou. É o que permite julgar falso positivo. */
  mensagemDoCliente?: string;
  origem: OrigemDoAlerta;
  criadoEm: string;
  resolvidoEm?: string;
}

interface LinhaDeAlerta {
  id: number;
  conversation_id: number | null;
  kind: TipoDeAlerta;
  detail: string;
  trigger_message: string | null;
  source: OrigemDoAlerta;
  created_at: string;
  resolved_at: string | null;
}

function paraAlerta(l: LinhaDeAlerta): Alerta {
  return {
    id: l.id,
    conversaId: l.conversation_id,
    tipo: l.kind,
    detalhe: l.detail,
    ...(l.trigger_message ? { mensagemDoCliente: l.trigger_message } : {}),
    origem: l.source,
    criadoEm: l.created_at,
    ...(l.resolved_at ? { resolvidoEm: l.resolved_at } : {}),
  };
}

export interface AlertaParaRegistrar {
  tenantId: number;
  conversaId?: number;
  tipo: TipoDeAlerta;
  detalhe: string;
  mensagemDoCliente?: string;
  origem: OrigemDoAlerta;
}

/**
 * Registra um aviso, ou não faz nada se já houver um pendente do mesmo tipo
 * nesta conversa.
 *
 * @returns o id criado, ou `undefined` quando já existia um pendente.
 */
export function registrarAlerta(db: Db, a: AlertaParaRegistrar): number | undefined {
  const resultado = db
    .prepare(
      `INSERT INTO alerts (tenant_id, conversation_id, kind, detail, trigger_message, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id, kind) WHERE resolved_at IS NULL DO NOTHING`,
    )
    .run(a.tenantId, a.conversaId ?? null, a.tipo, a.detalhe, a.mensagemDoCliente ?? null, a.origem);

  return resultado.changes === 1 ? Number(resultado.lastInsertRowid) : undefined;
}

export function listarAlertasPendentes(db: Db, tenantId: number, limite = 50): Alerta[] {
  const linhas = db
    .prepare(
      `SELECT id, conversation_id, kind, detail, trigger_message, source, created_at, resolved_at
       FROM alerts
       WHERE tenant_id = ? AND resolved_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(tenantId, limite) as LinhaDeAlerta[];

  return linhas.map(paraAlerta);
}

/** `tenant_id` no WHERE mesmo recebendo id: aviso de outro cliente não se resolve por aqui. */
export function marcarAlertaResolvido(db: Db, tenantId: number, id: number): boolean {
  return (
    db
      .prepare(
        "UPDATE alerts SET resolved_at = datetime('now') WHERE id = ? AND tenant_id = ? AND resolved_at IS NULL",
      )
      .run(id, tenantId).changes === 1
  );
}

/**
 * Regra de palavra-chave de um cliente: a rede determinística.
 *
 * Existe junto da ferramenta, e não no lugar dela, porque as duas erram de
 * formas opostas. O modelo pega o pedido torto ("dá pra fazer mais barato?")
 * mas pode esquecer de chamar; a lista nunca esquece, e é ela que garante que
 * nada escape enquanto o negócio ainda está sendo calibrado.
 */
export interface RegraDeAlerta {
  tipo: TipoDeAlerta;
  palavras: string[];
  detalhe: string;
}

/**
 * Quais regras a mensagem do cliente dispara.
 *
 * Compara por `includes` e não por fronteira de palavra de propósito:
 * "descontinho" e "descontão" são pedidos de desconto, e perder um deles custa
 * mais caro que um falso positivo — que o dono descarta lendo a mensagem citada
 * no próprio aviso.
 */
export function alertasDaMensagem(
  mensagem: string,
  regras: RegraDeAlerta[],
  normalizar: (t: string) => string,
): RegraDeAlerta[] {
  const texto = normalizar(mensagem);
  return regras.filter((r) => r.palavras.some((p) => texto.includes(normalizar(p))));
}
