/**
 * Lembrete da consulta, no dia da consulta.
 *
 * Nada aqui envia nada. O núcleo só ENFILEIRA na tabela `outbox`, e nesta fase
 * quem drena a fila é o comando `npm run lembretes`. Quando a Cloud API entrar,
 * o adaptador dela drena a mesma tabela e este arquivo não muda — é o mesmo
 * princípio do resto do projeto, o canal é adaptador de borda.
 *
 * A idempotência não é checada em código: é o índice único
 * `(appointment_id, kind)` da migration 003 que garante. Rodar o comando cinco
 * vezes no mesmo dia gera um lembrete, como `npm run ingest` rodado duas vezes
 * não duplica chunk.
 */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import { listarAgendamentos, type Agendamento } from './agenda-service.js';
import { dataLocal, momentoLocal } from './disponibilidade.js';

export interface Lembrete {
  id: number;
  agendamentoId: number | null;
  contatoId: string;
  tipo: string;
  corpo: string;
  /** 'YYYY-MM-DD HH:MM' — quando a mensagem deve sair. */
  previstoPara: string;
  /** Ausente enquanto não saiu. */
  enviadoEm?: string;
}

interface LinhaDoOutbox {
  id: number;
  appointment_id: number | null;
  contact_id: string;
  kind: string;
  body: string;
  scheduled_for: string;
  sent_at: string | null;
}

function paraLembrete(l: LinhaDoOutbox): Lembrete {
  return {
    id: l.id,
    agendamentoId: l.appointment_id,
    contatoId: l.contact_id,
    tipo: l.kind,
    corpo: l.body,
    previstoPara: l.scheduled_for,
    ...(l.sent_at ? { enviadoEm: l.sent_at } : {}),
  };
}

/**
 * O texto que o cliente vai receber.
 *
 * Fica no core e não no script porque é decisão de negócio — é o bot falando
 * com o cliente — e assim tem teste offline. Primeiro nome só: "Oi, Maria
 * Aparecida da Silva!" não é como ninguém escreve no WhatsApp.
 */
export function textoDoLembrete(agendamento: Agendamento, nomeDoTenant: string): string {
  const primeiroNome = agendamento.nome.trim().split(/\s+/)[0] ?? agendamento.nome;
  const hora = agendamento.inicio.slice(11, 16);
  const oQue = agendamento.servico ? `seu horário de ${agendamento.servico}` : 'sua consulta';

  return (
    `Oi, ${primeiroNome}! Passando para lembrar: ${oQue} na ${nomeDoTenant} é hoje às ${hora}. ` +
    'Se precisar remarcar ou cancelar, é só me responder por aqui.'
  );
}

export interface ResultadoDaGeracao {
  criados: Lembrete[];
  /** Consultas do dia que já tinham lembrete. É o número que prova a idempotência. */
  jaTinham: number;
  /** Consultas do dia que já começaram, e por isso ficaram de fora. */
  tardeDemais: number;
}

/**
 * Enfileira o lembrete de cada consulta do dia que ainda não tem um.
 *
 * @param data dia da consulta. Por padrão, hoje.
 * @param agora instante de referência, injetado para o teste não depender do
 *        relógio — um teste de lembrete preso ao relógio real passa de manhã e
 *        falha à tarde.
 */
export function gerarLembretes(
  db: Db,
  tenantId: number,
  nomeDoTenant: string,
  opcoes: { data?: string; agora?: Date } = {},
): ResultadoDaGeracao {
  const agora = opcoes.agora ?? new Date();
  const data = opcoes.data ?? dataLocal(agora);
  const tipo = config.agenda.lembrete.tipo;

  // `desde: data` já ordena por horário, então as consultas do dia são as
  // primeiras da lista e o limite da listagem não as corta. Cancelada não vem:
  // `listarAgendamentos` esconde por padrão, e lembrete de consulta cancelada
  // faria o cliente aparecer na clínica.
  const doDia = listarAgendamentos(db, tenantId, { desde: data }).filter(
    (a) => a.inicio.slice(0, 10) === data,
  );

  // Consulta que já começou não recebe lembrete: avisar alguém sobre um
  // horário que passou é pior que não avisar — ou ele já está lá, ou já
  // faltou, e a mensagem só confunde.
  const agoraTexto = momentoLocal(agora);
  const aTempo = doDia.filter((a) => a.inicio > agoraTexto);

  const inserir = db.prepare(
    `INSERT INTO outbox (tenant_id, contact_id, appointment_id, kind, body, scheduled_for)
     VALUES (?, ?, ?, ?, ?, ?)
     -- Conflito ALVEJADO no índice de idempotência, e não um "INSERT OR
     -- IGNORE": o IGNORE engoliria também um NOT NULL violado, e a falha
     -- apareceria como "nenhum lembrete gerado hoje", sem dizer por quê.
     ON CONFLICT (appointment_id, kind) DO NOTHING`,
  );

  const criados: Lembrete[] = [];

  db.transaction(() => {
    for (const agendamento of aTempo) {
      const resultado = inserir.run(
        tenantId,
        agendamento.contatoId,
        agendamento.id,
        tipo,
        textoDoLembrete(agendamento, nomeDoTenant),
        previstoPara(agendamento),
      );

      // `changes === 0` é o conflito: já existia lembrete para esta consulta.
      // `lastInsertRowid` não serve para decidir — ele continua valendo o da
      // inserção anterior quando nada foi inserido.
      if (resultado.changes === 1) {
        criados.push(buscarLembrete(db, Number(resultado.lastInsertRowid)) as Lembrete);
      }
    }
  })();

  return {
    criados,
    jaTinham: aTempo.length - criados.length,
    tardeDemais: doDia.length - aTempo.length,
  };
}

/**
 * Quando o lembrete deve sair.
 *
 * `Math.min` com o início da consulta é trava, não regra: a hora de envio é
 * configurada para ser antes do expediente, mas se alguém configurar uma
 * agenda que abre mais cedo, o lembrete ainda sai antes da consulta em vez de
 * depois dela.
 */
function previstoPara(agendamento: Agendamento): string {
  const data = agendamento.inicio.slice(0, 10);
  const hora = agendamento.inicio.slice(11, 16);
  const envio = config.agenda.lembrete.horaDeEnvio;

  return `${data} ${envio < hora ? envio : hora}`;
}

export function buscarLembrete(db: Db, id: number): Lembrete | undefined {
  const linha = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id) as
    | LinhaDoOutbox
    | undefined;

  return linha ? paraLembrete(linha) : undefined;
}

/**
 * A fila de lembretes. Por padrão só o que ainda não saiu — é o que o painel
 * mostra e o que o comando envia.
 */
export function listarLembretes(
  db: Db,
  tenantId: number,
  opcoes: { incluirEnviados?: boolean; data?: string; limite?: number } = {},
): Lembrete[] {
  const linhas = db
    .prepare(
      `SELECT * FROM outbox
       WHERE tenant_id = ?
         AND (? = 1 OR sent_at IS NULL)
         AND (? IS NULL OR scheduled_for LIKE ? || '%')
       ORDER BY scheduled_for ASC, id ASC
       LIMIT ?`,
    )
    .all(
      tenantId,
      opcoes.incluirEnviados ? 1 : 0,
      opcoes.data ?? null,
      opcoes.data ?? null,
      opcoes.limite ?? 200,
    ) as LinhaDoOutbox[];

  return linhas.map(paraLembrete);
}

/**
 * O que já passou da hora de sair — é ESTA a consulta que o adaptador de canal
 * vai drenar.
 *
 * Existe agora, antes de existir canal, para ninguém precisar inventá-la depois:
 * `scheduled_for` é hora de PAREDE local, e `sent_at`/`created_at` saem em UTC,
 * porque vêm do `datetime('now')` do SQLite. Um `WHERE scheduled_for <=
 * datetime('now')` escrito de boa-fé compara os dois e, em Campo Grande, manda
 * o lembrete quatro horas adiantado. O `agora` entra por parâmetro e vira texto
 * local aqui dentro, e é por isso que não há `datetime('now')` neste WHERE.
 */
export function lembretesAEnviar(db: Db, tenantId: number, agora: Date = new Date()): Lembrete[] {
  const linhas = db
    .prepare(
      `SELECT * FROM outbox
       WHERE tenant_id = ? AND sent_at IS NULL AND scheduled_for <= ?
       ORDER BY scheduled_for ASC, id ASC`,
    )
    .all(tenantId, momentoLocal(agora)) as LinhaDoOutbox[];

  return linhas.map(paraLembrete);
}

/**
 * Marca como enviado o que o canal já entregou.
 *
 * `tenant_id` no WHERE mesmo recebendo id: um id de outro tenant não pode ser
 * marcado por aqui, e a filtragem é no banco e não em quem chama.
 * `sent_at IS NULL` evita reescrever a data de algo que já tinha saído.
 */
export function marcarEnviados(db: Db, tenantId: number, ids: number[]): number {
  if (ids.length === 0) return 0;

  const marcar = db.prepare(
    "UPDATE outbox SET sent_at = datetime('now') WHERE id = ? AND tenant_id = ? AND sent_at IS NULL",
  );

  let marcados = 0;
  db.transaction(() => {
    for (const id of ids) marcados += marcar.run(id, tenantId).changes;
  })();

  return marcados;
}
