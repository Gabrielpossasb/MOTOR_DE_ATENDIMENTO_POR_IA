/**
 * Testes da agenda: horários livres e as operações de marcar, alterar e
 * cancelar. Tudo offline — nada aqui toca rede nem modelo.
 *
 * O relógio é sempre INJETADO. Um teste de agenda que usa `new Date()` de
 * verdade passa de manhã e falha à tarde, e passa de terça e falha no domingo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import {
  agendamentosDoContato,
  alterarAgendamento,
  cancelarAgendamento,
  criarAgendamento,
  listarAgendamentos,
} from '../src/core/agenda/agenda-service.js';
import {
  AGENDA_PADRAO,
  diaDaSemana,
  gradeDoDia,
  horariosLivres,
} from '../src/core/agenda/disponibilidade.js';
import type { ConfigDaAgenda } from '../src/core/types.js';

const SLUG = 'clinica';

// 2026-10-05 é uma segunda-feira; 2026-10-10, um sábado; 2026-10-11, domingo.
const SEGUNDA = '2026-10-05';
const SABADO = '2026-10-10';
const DOMINGO = '2026-10-11';

/** Sexta-feira anterior, 09:00 — referência de "agora" para todos os testes. */
const AGORA = new Date(2026, 9, 2, 9, 0, 0);

let db: Db;
let tenantId: number;

beforeEach(() => {
  db = abrirBanco(':memory:');
  tenantId = salvarTenant(db, { slug: SLUG, nome: 'Clínica', config: {}, promptDoSistema: 'p' }).id;
});

function marcar(inicio: string, contato = 'c1', nome = 'Maria Silva') {
  return criarAgendamento(db, tenantId, AGENDA_PADRAO, { contatoId: contato, inicio, nome }, AGORA);
}

describe('grade de horários', () => {
  it('confirma os dias de referência usados nos testes', () => {
    // Se esta falhar, as datas acima deixaram de ser os dias que eu suponho.
    expect(diaDaSemana(SEGUNDA)).toBe(1);
    expect(diaDaSemana(SABADO)).toBe(6);
    expect(diaDaSemana(DOMINGO)).toBe(0);
  });

  it('quebra a grade no almoço, sem oferecer horário fechado', () => {
    const grade = gradeDoDia(AGENDA_PADRAO, SEGUNDA);

    expect(grade).toEqual(['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
    expect(grade).not.toContain('12:00');
  });

  it('não oferece horário que não caberia antes de fechar', () => {
    // Consulta de 90min na tarde que vai das 13h às 18h: 13:00, 14:30 e 16:00
    // cabem; 17:30 terminaria 19:00, com a clínica fechada. Oferecer o 17:30
    // marcaria alguém para um horário que não existe.
    const noventa: ConfigDaAgenda = { ...AGENDA_PADRAO, duracaoMin: 90 };
    const grade = gradeDoDia(noventa, SEGUNDA);

    expect(grade).toEqual(['08:00', '09:30', '13:00', '14:30', '16:00']);
    expect(grade).not.toContain('17:30');
  });

  it('devolve grade vazia em dia sem atendimento', () => {
    expect(gradeDoDia(AGENDA_PADRAO, SABADO)).toEqual([]);
    expect(gradeDoDia(AGENDA_PADRAO, DOMINGO)).toEqual([]);
  });
});

describe('horários livres', () => {
  it('tira da lista o horário já ocupado', () => {
    marcar(`${SEGUNDA} 09:00`);
    const livres = horariosLivres(db, tenantId, AGENDA_PADRAO, SEGUNDA, AGORA).map((s) => s.hora);

    expect(livres).not.toContain('09:00');
    expect(livres).toContain('10:00');
  });

  it('devolve o horário de volta depois do cancelamento', () => {
    const criado = marcar(`${SEGUNDA} 09:00`);
    if (!criado.ok) throw new Error('deveria ter marcado');

    cancelarAgendamento(db, tenantId, criado.agendamento.id);
    const livres = horariosLivres(db, tenantId, AGENDA_PADRAO, SEGUNDA, AGORA).map((s) => s.hora);

    expect(livres).toContain('09:00');
  });

  it('respeita a antecedência mínima, mas só hoje', () => {
    // Agora são 09:00 de sexta, com 2h de antecedência: hoje só a partir das
    // 11:00; na segunda, a grade inteira continua valendo.
    const hoje = horariosLivres(db, tenantId, AGENDA_PADRAO, '2026-10-02', AGORA).map((s) => s.hora);
    const depois = horariosLivres(db, tenantId, AGENDA_PADRAO, SEGUNDA, AGORA).map((s) => s.hora);

    expect(hoje).not.toContain('10:00');
    expect(hoje).toContain('11:00');
    expect(depois).toContain('08:00');
  });

  it('não oferece nada para data passada nem além do horizonte', () => {
    expect(horariosLivres(db, tenantId, AGENDA_PADRAO, '2026-09-28', AGORA)).toEqual([]);
    expect(horariosLivres(db, tenantId, AGENDA_PADRAO, '2027-06-07', AGORA)).toEqual([]);
  });

  it('não vaza ocupação entre tenants', () => {
    const outro = salvarTenant(db, {
      slug: 'outra',
      nome: 'Outra',
      config: {},
      promptDoSistema: 'p',
    }).id;
    marcar(`${SEGUNDA} 09:00`);

    const livresDoOutro = horariosLivres(db, outro, AGENDA_PADRAO, SEGUNDA, AGORA).map((s) => s.hora);
    expect(livresDoOutro).toContain('09:00');
  });
});

describe('marcar', () => {
  it('marca e guarda os dados que o faq.md exige', () => {
    const r = criarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      {
        contatoId: 'c1',
        inicio: `${SEGUNDA} 09:00`,
        nome: 'Maria Silva',
        telefone: '(67) 99999-0000',
        convenio: 'Amil',
        servico: 'limpeza',
      },
      AGORA,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agendamento.nome).toBe('Maria Silva');
    expect(r.agendamento.convenio).toBe('Amil');
    expect(r.agendamento.duracaoMin).toBe(AGENDA_PADRAO.duracaoMin);
  });

  it('RECUSA dupla marcação no mesmo horário', () => {
    // Garantido pelo índice único parcial, não por checagem em código: entre
    // o SELECT e o INSERT cabe outra mensagem pegando a mesma vaga.
    marcar(`${SEGUNDA} 09:00`, 'c1');
    const segunda = marcar(`${SEGUNDA} 09:00`, 'c2');

    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.motivo).toBe('conflito');
  });

  it('deixa remarcar um horário que foi cancelado', () => {
    // O índice é PARCIAL justamente para isto: cancelado não ocupa vaga.
    const criado = marcar(`${SEGUNDA} 09:00`, 'c1');
    if (!criado.ok) throw new Error('deveria ter marcado');
    cancelarAgendamento(db, tenantId, criado.agendamento.id);

    expect(marcar(`${SEGUNDA} 09:00`, 'c2').ok).toBe(true);
  });

  it('recusa horário fora da grade e dia fechado', () => {
    expect(marcar(`${SEGUNDA} 12:00`)).toMatchObject({ ok: false, motivo: 'fora_do_horario' });
    expect(marcar(`${SEGUNDA} 09:30`)).toMatchObject({ ok: false, motivo: 'fora_do_horario' });
    expect(marcar(`${SABADO} 09:00`)).toMatchObject({ ok: false, motivo: 'fora_do_horario' });
  });

  it('recusa data passada e data longe demais', () => {
    expect(marcar('2026-09-28 09:00')).toMatchObject({ ok: false, motivo: 'fora_da_janela' });
    expect(marcar('2027-06-07 09:00')).toMatchObject({ ok: false, motivo: 'fora_da_janela' });
  });

  it('recusa horário de hoje que não respeita a antecedência', () => {
    expect(marcar('2026-10-02 10:00')).toMatchObject({ ok: false, motivo: 'fora_da_janela' });
    expect(marcar('2026-10-02 11:00').ok).toBe(true);
  });

  it('recusa sem nome, que é dado obrigatório', () => {
    const r = criarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      { contatoId: 'c1', inicio: `${SEGUNDA} 09:00`, nome: '   ' },
      AGORA,
    );

    expect(r).toMatchObject({ ok: false, motivo: 'dados_incompletos' });
  });

  it('recusa formato de horário inválido em vez de gravar lixo', () => {
    expect(marcar('05/10/2026 09:00')).toMatchObject({ ok: false, motivo: 'fora_do_horario' });
    expect(marcar(`${SEGUNDA}T09:00`)).toMatchObject({ ok: false, motivo: 'fora_do_horario' });
  });
});

describe('alterar e cancelar', () => {
  it('altera o horário', () => {
    const criado = marcar(`${SEGUNDA} 09:00`);
    if (!criado.ok) throw new Error('deveria ter marcado');

    const r = alterarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      criado.agendamento.id,
      `${SEGUNDA} 14:00`,
      'c1',
      AGORA,
    );

    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.agendamento.inicio).toBe(`${SEGUNDA} 14:00`);
  });

  it('recusa alterar para horário ocupado', () => {
    const primeiro = marcar(`${SEGUNDA} 09:00`, 'c1');
    marcar(`${SEGUNDA} 14:00`, 'c2');
    if (!primeiro.ok) throw new Error('deveria ter marcado');

    const r = alterarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      primeiro.agendamento.id,
      `${SEGUNDA} 14:00`,
      'c1',
      AGORA,
    );

    expect(r).toMatchObject({ ok: false, motivo: 'conflito' });
  });

  it('IMPEDE um contato de mexer no agendamento de outro', () => {
    // Sem este filtro, bastaria o cliente chutar um id para cancelar a
    // consulta de outra pessoa.
    const daMaria = marcar(`${SEGUNDA} 09:00`, 'contato-maria');
    if (!daMaria.ok) throw new Error('deveria ter marcado');

    const cancelar = cancelarAgendamento(db, tenantId, daMaria.agendamento.id, 'contato-joao');
    const alterar = alterarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      daMaria.agendamento.id,
      `${SEGUNDA} 15:00`,
      'contato-joao',
      AGORA,
    );

    expect(cancelar).toMatchObject({ ok: false, motivo: 'nao_encontrado' });
    expect(alterar).toMatchObject({ ok: false, motivo: 'nao_encontrado' });
    expect(agendamentosDoContato(db, tenantId, 'contato-maria', AGORA)).toHaveLength(1);
  });

  it('a recepção (sem contatoId) mexe em qualquer agendamento', () => {
    const daMaria = marcar(`${SEGUNDA} 09:00`, 'contato-maria');
    if (!daMaria.ok) throw new Error('deveria ter marcado');

    expect(cancelarAgendamento(db, tenantId, daMaria.agendamento.id)).toMatchObject({ ok: true });
  });

  it('cancelar apaga o lembrete que ainda não saiu', () => {
    // Lembrete pendente de consulta cancelada é pior que lembrete nenhum: o
    // cliente aparece na clínica.
    const criado = marcar(`${SEGUNDA} 09:00`);
    if (!criado.ok) throw new Error('deveria ter marcado');

    db.prepare(
      `INSERT INTO outbox (tenant_id, contact_id, appointment_id, kind, body, scheduled_for)
       VALUES (?, 'c1', ?, 'lembrete', 'corpo', ?)`,
    ).run(tenantId, criado.agendamento.id, SEGUNDA);

    cancelarAgendamento(db, tenantId, criado.agendamento.id);

    const pendentes = db
      .prepare('SELECT COUNT(*) AS t FROM outbox WHERE appointment_id = ?')
      .get(criado.agendamento.id) as { t: number };
    expect(pendentes.t).toBe(0);
  });

  it('NÃO apaga lembrete que já foi enviado', () => {
    // O que já saiu é histórico do que aconteceu, não fila.
    const criado = marcar(`${SEGUNDA} 09:00`);
    if (!criado.ok) throw new Error('deveria ter marcado');

    db.prepare(
      `INSERT INTO outbox (tenant_id, contact_id, appointment_id, kind, body, scheduled_for, sent_at)
       VALUES (?, 'c1', ?, 'lembrete', 'corpo', ?, datetime('now'))`,
    ).run(tenantId, criado.agendamento.id, SEGUNDA);

    cancelarAgendamento(db, tenantId, criado.agendamento.id);

    const restantes = db
      .prepare('SELECT COUNT(*) AS t FROM outbox WHERE appointment_id = ?')
      .get(criado.agendamento.id) as { t: number };
    expect(restantes.t).toBe(1);
  });

  it('cancelar duas vezes não quebra', () => {
    const criado = marcar(`${SEGUNDA} 09:00`);
    if (!criado.ok) throw new Error('deveria ter marcado');

    expect(cancelarAgendamento(db, tenantId, criado.agendamento.id)).toMatchObject({ ok: true });
    expect(cancelarAgendamento(db, tenantId, criado.agendamento.id)).toMatchObject({
      ok: false,
      motivo: 'nao_encontrado',
    });
  });
});

describe('listagens', () => {
  it('lista em ordem de horário e esconde cancelado por padrão', () => {
    marcar(`${SEGUNDA} 14:00`, 'c1');
    marcar(`${SEGUNDA} 09:00`, 'c2');
    const terceiro = marcar(`${SEGUNDA} 16:00`, 'c3');
    if (!terceiro.ok) throw new Error('deveria ter marcado');
    cancelarAgendamento(db, tenantId, terceiro.agendamento.id);

    const lista = listarAgendamentos(db, tenantId, { desde: SEGUNDA });
    expect(lista.map((a) => a.inicio)).toEqual([`${SEGUNDA} 09:00`, `${SEGUNDA} 14:00`]);

    const comCancelados = listarAgendamentos(db, tenantId, {
      desde: SEGUNDA,
      incluirCancelados: true,
    });
    expect(comCancelados).toHaveLength(3);
  });

  it('o contato só enxerga os próprios agendamentos futuros', () => {
    marcar(`${SEGUNDA} 09:00`, 'contato-maria');
    marcar(`${SEGUNDA} 10:00`, 'contato-joao');

    const daMaria = agendamentosDoContato(db, tenantId, 'contato-maria', AGORA);
    expect(daMaria).toHaveLength(1);
    expect(daMaria[0]?.inicio).toBe(`${SEGUNDA} 09:00`);
  });
});
