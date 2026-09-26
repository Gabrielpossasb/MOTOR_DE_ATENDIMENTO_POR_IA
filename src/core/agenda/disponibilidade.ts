/**
 * Horários livres da agenda.
 *
 * Lógica pura de negócio, no core e não no adaptador, pelo mesmo motivo do
 * painel-service: o que conta como "horário disponível" é uma decisão da
 * clínica, não formatação de tela — e assim tem teste offline, de graça.
 *
 * Datas e horas andam como texto 'YYYY-MM-DD' e 'HH:MM', hora local da clínica.
 * Não se usa `Date` para representar o horário marcado de propósito: `Date` é
 * um instante em UTC, e no momento em que alguém rodar isto num servidor com
 * outro fuso, "14:00 na clínica" viraria outro horário. O que a clínica marca
 * é um horário de parede.
 */
import type { Db } from '../../storage/db.js';
import type { ConfigDaAgenda } from '../types.js';

/** Padrões de quem não configurou agenda no tenant.json. */
export const AGENDA_PADRAO: ConfigDaAgenda = {
  duracaoMin: 60,
  janelas: {
    '1': [['08:00', '12:00'], ['13:00', '18:00']],
    '2': [['08:00', '12:00'], ['13:00', '18:00']],
    '3': [['08:00', '12:00'], ['13:00', '18:00']],
    '4': [['08:00', '12:00'], ['13:00', '18:00']],
    '5': [['08:00', '12:00'], ['13:00', '18:00']],
  },
  antecedenciaMinimaHoras: 2,
  diasNoFuturo: 60,
};

export interface Slot {
  /** 'YYYY-MM-DD HH:MM' */
  inicio: string;
  /** 'HH:MM', só para exibir. */
  hora: string;
}

/** Minutos desde a meia-noite. Comparar 'HH:MM' como número evita fuso. */
export function emMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function paraHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Dia da semana de 'YYYY-MM-DD' (0 = domingo), sem passar por fuso. */
export function diaDaSemana(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  // Date.UTC e getUTCDay: montar a data em UTC e ler em UTC é o único caminho
  // que devolve o mesmo dia da semana em qualquer fuso da máquina.
  return new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1)).getUTCDay();
}

/** Todos os horários que a grade prevê para o dia, ocupados ou não. */
export function gradeDoDia(agenda: ConfigDaAgenda, data: string): string[] {
  const janelas = agenda.janelas[String(diaDaSemana(data))] ?? [];
  const horarios: string[] = [];

  for (const [abre, fecha] of janelas) {
    const fim = emMinutos(fecha);
    // `+ duracaoMin <= fim`: uma consulta que começa às 17:30 e dura 60min não
    // cabe num expediente que fecha às 18:00. Oferecer esse horário marcaria
    // alguém para um momento em que a clínica está fechada.
    for (let t = emMinutos(abre); t + agenda.duracaoMin <= fim; t += agenda.duracaoMin) {
      horarios.push(paraHora(t));
    }
  }

  return horarios;
}

/** Horários já ocupados nesse dia, neste tenant. */
export function horariosOcupados(db: Db, tenantId: number, data: string): Set<string> {
  const linhas = db
    .prepare(
      `SELECT starts_at FROM appointments
       WHERE tenant_id = ? AND status = 'scheduled' AND starts_at LIKE ?`,
    )
    .all(tenantId, `${data}%`) as { starts_at: string }[];

  return new Set(linhas.map((l) => l.starts_at.slice(11, 16)));
}

/**
 * Horários livres de um dia.
 *
 * @param agora instante de referência, injetado para o teste não depender do
 *        relógio. Um teste que usa `new Date()` de verdade passa de manhã e
 *        falha à tarde.
 */
export function horariosLivres(
  db: Db,
  tenantId: number,
  agenda: ConfigDaAgenda,
  data: string,
  agora: Date = new Date(),
): Slot[] {
  if (!dentroDaJanelaDeAgendamento(agenda, data, agora)) return [];

  const ocupados = horariosOcupados(db, tenantId, data);
  const limite = minutosMinimosPara(agenda, data, agora);

  return gradeDoDia(agenda, data)
    .filter((hora) => !ocupados.has(hora))
    .filter((hora) => limite === undefined || emMinutos(hora) >= limite)
    .map((hora) => ({ inicio: `${data} ${hora}`, hora }));
}

/** A data está entre hoje e o horizonte que o cliente aceita? */
export function dentroDaJanelaDeAgendamento(
  agenda: ConfigDaAgenda,
  data: string,
  agora: Date = new Date(),
): boolean {
  const hoje = dataLocal(agora);
  if (data < hoje) return false;

  const limite = somarDias(hoje, agenda.diasNoFuturo);
  return data <= limite;
}

/**
 * A partir de que minuto do dia ainda dá para marcar.
 *
 * Só restringe o dia de hoje: em qualquer dia futuro a grade inteira vale.
 */
function minutosMinimosPara(
  agenda: ConfigDaAgenda,
  data: string,
  agora: Date,
): number | undefined {
  if (data !== dataLocal(agora)) return undefined;
  return agora.getHours() * 60 + agora.getMinutes() + agenda.antecedenciaMinimaHoras * 60;
}

/** 'YYYY-MM-DD' do relógio local. */
export function dataLocal(momento: Date = new Date()): string {
  const ano = momento.getFullYear();
  const mes = String(momento.getMonth() + 1).padStart(2, '0');
  const dia = String(momento.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** O horário cai na grade de um dia em que a clínica abre? */
export function horarioEhValido(agenda: ConfigDaAgenda, inicio: string): boolean {
  const data = inicio.slice(0, 10);
  const hora = inicio.slice(11, 16);
  return gradeDoDia(agenda, data).includes(hora);
}
