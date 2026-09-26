/**
 * Operações da agenda: marcar, alterar, cancelar e listar.
 *
 * Devolvem RESULTADO TIPADO, não exceção. Quem chama do outro lado é o bot,
 * que precisa explicar a falha em português para o cliente — `motivo` é o que
 * ele traduz. Exceção serviria para o programador, não para quem está do outro
 * lado da conversa.
 *
 * Nada aqui sabe o que é HTTP nem o que é LLM.
 */
import type { Db } from '../../storage/db.js';
import type { ConfigDaAgenda } from '../types.js';
import { dataLocal, dentroDaJanelaDeAgendamento, horarioEhValido } from './disponibilidade.js';

export interface Agendamento {
  id: number;
  tenantId: number;
  contatoId: string;
  /** 'YYYY-MM-DD HH:MM' */
  inicio: string;
  duracaoMin: number;
  servico?: string;
  nome: string;
  telefone?: string;
  convenio?: string;
  observacoes?: string;
  status: 'scheduled' | 'cancelled' | 'completed';
}

export type MotivoDeRecusa =
  /** Já existe outro agendamento nesse horário. */
  | 'conflito'
  /** Horário que não existe na grade, ou dia em que a clínica não abre. */
  | 'fora_do_horario'
  /** Data no passado, ou além do horizonte que o cliente aceita. */
  | 'fora_da_janela'
  /** Não existe, ou não é de quem está pedindo. */
  | 'nao_encontrado'
  /** Falta nome, telefone, etc. */
  | 'dados_incompletos';

export type ResultadoDaAgenda =
  | { ok: true; agendamento: Agendamento }
  | { ok: false; motivo: MotivoDeRecusa; detalhe: string };

interface Linha {
  id: number;
  tenant_id: number;
  contact_id: string;
  starts_at: string;
  duration_min: number;
  service: string | null;
  customer_name: string;
  customer_phone: string | null;
  insurance: string | null;
  notes: string | null;
  status: Agendamento['status'];
}

const COLUNAS = `id, tenant_id, contact_id, starts_at, duration_min, service,
                 customer_name, customer_phone, insurance, notes, status`;

function paraAgendamento(l: Linha): Agendamento {
  return {
    id: l.id,
    tenantId: l.tenant_id,
    contatoId: l.contact_id,
    inicio: l.starts_at,
    duracaoMin: l.duration_min,
    ...(l.service ? { servico: l.service } : {}),
    nome: l.customer_name,
    ...(l.customer_phone ? { telefone: l.customer_phone } : {}),
    ...(l.insurance ? { convenio: l.insurance } : {}),
    ...(l.notes ? { observacoes: l.notes } : {}),
    status: l.status,
  };
}

export interface DadosDoAgendamento {
  contatoId: string;
  inicio: string;
  nome: string;
  servico?: string;
  telefone?: string;
  convenio?: string;
  observacoes?: string;
  conversaId?: number;
}

/** O erro que o índice único parcial levanta quando a vaga já é de outro. */
function ehConflitoDeVaga(erro: unknown): boolean {
  return erro instanceof Error && /UNIQUE constraint failed/i.test(erro.message);
}

export function criarAgendamento(
  db: Db,
  tenantId: number,
  agenda: ConfigDaAgenda,
  dados: DadosDoAgendamento,
  agora: Date = new Date(),
): ResultadoDaAgenda {
  const nome = dados.nome?.trim() ?? '';
  if (nome.length === 0) {
    return {
      ok: false,
      motivo: 'dados_incompletos',
      detalhe: 'falta o nome de quem vai ser atendido',
    };
  }

  const problema = validarHorario(agenda, dados.inicio, agora);
  if (problema) return problema;

  try {
    const resultado = db
      .prepare(
        `INSERT INTO appointments
           (tenant_id, contact_id, conversation_id, starts_at, duration_min,
            service, customer_name, customer_phone, insurance, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenantId,
        dados.contatoId,
        dados.conversaId ?? null,
        dados.inicio,
        agenda.duracaoMin,
        dados.servico ?? null,
        nome,
        dados.telefone ?? null,
        dados.convenio ?? null,
        dados.observacoes ?? null,
      );

    return {
      ok: true,
      agendamento: buscarPorId(db, Number(resultado.lastInsertRowid)) as Agendamento,
    };
  } catch (erro) {
    // A vaga não é conferida antes de inserir de propósito: entre o SELECT e o
    // INSERT cabe outra mensagem pegando o mesmo horário. Quem garante é o
    // índice único parcial, e aqui só traduzimos o erro dele.
    if (ehConflitoDeVaga(erro)) {
      return { ok: false, motivo: 'conflito', detalhe: 'esse horário acabou de ser ocupado' };
    }
    throw erro;
  }
}

/** Valida data e hora contra a grade e o horizonte de agendamento. */
function validarHorario(
  agenda: ConfigDaAgenda,
  inicio: string,
  agora: Date,
): { ok: false; motivo: MotivoDeRecusa; detalhe: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(inicio)) {
    return { ok: false, motivo: 'fora_do_horario', detalhe: 'horário em formato inválido' };
  }

  const data = inicio.slice(0, 10);

  if (!dentroDaJanelaDeAgendamento(agenda, data, agora)) {
    return {
      ok: false,
      motivo: 'fora_da_janela',
      detalhe: data < dataLocal(agora) ? 'essa data já passou' : 'essa data está longe demais',
    };
  }

  if (!horarioEhValido(agenda, inicio)) {
    return { ok: false, motivo: 'fora_do_horario', detalhe: 'não atendemos nesse horário' };
  }

  if (data === dataLocal(agora)) {
    const minimo = agora.getHours() * 60 + agora.getMinutes() + agenda.antecedenciaMinimaHoras * 60;
    const [h, m] = inicio.slice(11, 16).split(':').map(Number);

    if ((h ?? 0) * 60 + (m ?? 0) < minimo) {
      return {
        ok: false,
        motivo: 'fora_da_janela',
        detalhe: 'é cedo demais para marcar hoje nesse horário',
      };
    }
  }

  return undefined;
}

export function buscarPorId(db: Db, id: number): Agendamento | undefined {
  const linha = db.prepare(`SELECT ${COLUNAS} FROM appointments WHERE id = ?`).get(id) as
    | Linha
    | undefined;

  return linha ? paraAgendamento(linha) : undefined;
}

/**
 * Altera o horário de um agendamento.
 *
 * `contatoId` presente restringe ao dono: é assim que o bot não alcança a
 * consulta de outra pessoa. O painel chama sem, porque do outro lado está a
 * recepção.
 */
export function alterarAgendamento(
  db: Db,
  tenantId: number,
  agenda: ConfigDaAgenda,
  id: number,
  novoInicio: string,
  contatoId?: string,
  agora: Date = new Date(),
): ResultadoDaAgenda {
  if (!buscarAtivo(db, tenantId, id, contatoId)) {
    return { ok: false, motivo: 'nao_encontrado', detalhe: 'não achei esse agendamento' };
  }

  const problema = validarHorario(agenda, novoInicio, agora);
  if (problema) return problema;

  try {
    db.prepare("UPDATE appointments SET starts_at = ?, updated_at = datetime('now') WHERE id = ?").run(
      novoInicio,
      id,
    );
  } catch (erro) {
    if (ehConflitoDeVaga(erro)) {
      return { ok: false, motivo: 'conflito', detalhe: 'esse horário já está ocupado' };
    }
    throw erro;
  }

  return { ok: true, agendamento: buscarPorId(db, id) as Agendamento };
}

/**
 * Cancela, e apaga o lembrete que ainda não saiu.
 *
 * As duas coisas na mesma transação: lembrete pendente de consulta cancelada é
 * pior que lembrete nenhum — o cliente aparece na clínica.
 */
export function cancelarAgendamento(
  db: Db,
  tenantId: number,
  id: number,
  contatoId?: string,
): ResultadoDaAgenda {
  if (!buscarAtivo(db, tenantId, id, contatoId)) {
    return { ok: false, motivo: 'nao_encontrado', detalhe: 'não achei esse agendamento' };
  }

  db.transaction(() => {
    db.prepare(
      "UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    db.prepare('DELETE FROM outbox WHERE appointment_id = ? AND sent_at IS NULL').run(id);
  })();

  return { ok: true, agendamento: buscarPorId(db, id) as Agendamento };
}

function buscarAtivo(
  db: Db,
  tenantId: number,
  id: number,
  contatoId?: string,
): Agendamento | undefined {
  const linha = db
    .prepare(
      `SELECT ${COLUNAS} FROM appointments
       WHERE id = ? AND tenant_id = ? AND status = 'scheduled'
         AND (? IS NULL OR contact_id = ?)`,
    )
    .get(id, tenantId, contatoId ?? null, contatoId ?? null) as Linha | undefined;

  return linha ? paraAgendamento(linha) : undefined;
}

/** Agendamentos do tenant a partir de uma data. É o que o painel lista. */
export function listarAgendamentos(
  db: Db,
  tenantId: number,
  opcoes: { desde?: string; incluirCancelados?: boolean; limite?: number } = {},
): Agendamento[] {
  const linhas = db
    .prepare(
      `SELECT ${COLUNAS} FROM appointments
       WHERE tenant_id = ? AND starts_at >= ?
         AND (? = 1 OR status = 'scheduled')
       ORDER BY starts_at ASC
       LIMIT ?`,
    )
    .all(
      tenantId,
      opcoes.desde ?? dataLocal(),
      opcoes.incluirCancelados ? 1 : 0,
      opcoes.limite ?? 200,
    ) as Linha[];

  return linhas.map(paraAgendamento);
}

/** O que o bot enxerga: sempre e só os agendamentos de quem está falando. */
export function agendamentosDoContato(
  db: Db,
  tenantId: number,
  contatoId: string,
  agora: Date = new Date(),
): Agendamento[] {
  const linhas = db
    .prepare(
      `SELECT ${COLUNAS} FROM appointments
       WHERE tenant_id = ? AND contact_id = ? AND status = 'scheduled' AND starts_at >= ?
       ORDER BY starts_at ASC`,
    )
    .all(tenantId, contatoId, dataLocal(agora)) as Linha[];

  return linhas.map(paraAgendamento);
}
