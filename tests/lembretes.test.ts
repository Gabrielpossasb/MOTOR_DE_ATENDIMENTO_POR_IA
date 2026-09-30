/**
 * Testes dos lembretes do dia da consulta.
 *
 * Tudo offline: gerar lembrete não chama modelo nem embedding, então este
 * arquivo inteiro é grátis.
 *
 * O relógio é sempre INJETADO. Lembrete é a frente do projeto mais dependente
 * de data que existe — um teste que use `new Date()` de verdade passa de manhã
 * e falha à tarde, e passa de terça e falha no domingo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import {
  alterarAgendamento,
  cancelarAgendamento,
  criarAgendamento,
} from '../src/core/agenda/agenda-service.js';
import { AGENDA_PADRAO } from '../src/core/agenda/disponibilidade.js';
import {
  gerarLembretes,
  lembretesAEnviar,
  listarLembretes,
  marcarEnviados,
  textoDoLembrete,
} from '../src/core/agenda/lembretes.js';
import { montarPainel } from '../src/core/painel/painel-service.js';

const SLUG = 'clinica';
const NOME = 'Clínica Sorriso';

// 2026-10-05 é uma segunda-feira; 2026-10-06, terça.
const SEGUNDA = '2026-10-05';
const TERCA = '2026-10-06';

/** Segunda, 06:00 — antes do expediente, para a grade do dia inteiro valer. */
const MADRUGADA = new Date(2026, 9, 5, 6, 0, 0);
/** A mesma segunda, 10:30 — já passou das consultas da manhã. */
const MEIO_DA_MANHA = new Date(2026, 9, 5, 10, 30, 0);

let db: Db;
let tenantId: number;

beforeEach(() => {
  db = abrirBanco(':memory:');
  tenantId = salvarTenant(db, { slug: SLUG, nome: NOME, config: {}, promptDoSistema: 'p' }).id;
});

function marcar(
  inicio: string,
  extras: { contato?: string; nome?: string; servico?: string } = {},
  agora = MADRUGADA,
) {
  const r = criarAgendamento(
    db,
    tenantId,
    AGENDA_PADRAO,
    {
      contatoId: extras.contato ?? 'c1',
      inicio,
      nome: extras.nome ?? 'Maria Silva',
      ...(extras.servico ? { servico: extras.servico } : {}),
    },
    agora,
  );

  if (!r.ok) throw new Error(`deveria ter marcado ${inicio}: ${r.detalhe}`);
  return r.agendamento;
}

describe('texto do lembrete', () => {
  it('chama pelo primeiro nome e diz a hora', () => {
    const agendamento = marcar(`${SEGUNDA} 14:00`, { nome: 'Maria Aparecida da Silva' });
    const texto = textoDoLembrete(agendamento, NOME);

    expect(texto).toContain('Oi, Maria!');
    expect(texto).not.toContain('Aparecida');
    expect(texto).toContain('14:00');
    expect(texto).toContain(NOME);
  });

  it('usa o serviço quando ele foi informado', () => {
    const comServico = textoDoLembrete(marcar(`${SEGUNDA} 09:00`, { servico: 'limpeza' }), NOME);
    const sem = textoDoLembrete(marcar(`${SEGUNDA} 10:00`), NOME);

    expect(comServico).toContain('limpeza');
    expect(sem).toContain('sua consulta');
  });

  it('oferece remarcar e cancelar, que é o que o bot sabe fazer', () => {
    // O lembrete é o bot falando primeiro. Mandar "responda por aqui" só faz
    // sentido porque as ferramentas de remarcar e cancelar existem.
    const texto = textoDoLembrete(marcar(`${SEGUNDA} 09:00`), NOME);

    expect(texto).toMatch(/remarcar/i);
    expect(texto).toMatch(/cancelar/i);
  });
});

describe('gerar', () => {
  it('gera um lembrete por consulta do dia', () => {
    marcar(`${SEGUNDA} 09:00`, { contato: 'c1' });
    marcar(`${SEGUNDA} 14:00`, { contato: 'c2' });

    const r = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(r.criados).toHaveLength(2);
    expect(r.jaTinham).toBe(0);
    expect(r.criados.map((l) => l.contatoId)).toEqual(['c1', 'c2']);
  });

  it('rodar duas vezes NÃO duplica', () => {
    // Idempotência pelo índice único (appointment_id, kind), na mesma
    // disciplina do ingest. Sem ela, o cron rodando de hora em hora mandaria
    // oito lembretes iguais para a mesma pessoa.
    marcar(`${SEGUNDA} 09:00`);

    const primeira = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });
    const segunda = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(primeira.criados).toHaveLength(1);
    expect(segunda.criados).toHaveLength(0);
    expect(segunda.jaTinham).toBe(1);
    expect(listarLembretes(db, tenantId)).toHaveLength(1);
  });

  it('só gera para o dia pedido', () => {
    marcar(`${SEGUNDA} 09:00`);
    marcar(`${TERCA} 09:00`);

    const r = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(r.criados).toHaveLength(1);
    expect(r.criados[0]?.previstoPara.slice(0, 10)).toBe(SEGUNDA);
  });

  it('NÃO gera para consulta cancelada', () => {
    // Lembrete de consulta cancelada é pior que lembrete nenhum: o cliente
    // aparece na clínica.
    const agendamento = marcar(`${SEGUNDA} 09:00`);
    cancelarAgendamento(db, tenantId, agendamento.id);

    expect(gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA }).criados).toEqual(
      [],
    );
  });

  it('NÃO gera para consulta que já começou', () => {
    // São 10:30 e a consulta era 09:00: ou a pessoa já está lá, ou já faltou.
    // Lembrar agora só confunde.
    marcar(`${SEGUNDA} 09:00`, { contato: 'passou' });
    marcar(`${SEGUNDA} 14:00`, { contato: 'ainda-vem' });

    const r = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MEIO_DA_MANHA });

    expect(r.criados.map((l) => l.contatoId)).toEqual(['ainda-vem']);
    expect(r.tardeDemais).toBe(1);
  });

  it('agenda o envio antes da consulta, sempre', () => {
    // Lembrete que sai depois da consulta não é lembrete. O caso apertado é a
    // primeira consulta do dia, às 08:00 — a hora de envio configurada precisa
    // cair antes dela, e a trava do `min` garante isso mesmo se alguém
    // configurar uma agenda que abre mais cedo.
    marcar(`${SEGUNDA} 08:00`);

    const r = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(r.criados).toHaveLength(1);
    expect(r.criados[0]?.previstoPara.slice(11)).toBe('07:30');
  });

  it('não vaza lembrete entre tenants', () => {
    const outro = salvarTenant(db, {
      slug: 'outra',
      nome: 'Outra',
      config: {},
      promptDoSistema: 'p',
    }).id;
    marcar(`${SEGUNDA} 09:00`);

    gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(listarLembretes(db, outro)).toEqual([]);
    expect(listarLembretes(db, tenantId)).toHaveLength(1);
  });
});

describe('remarcar', () => {
  it('apaga o lembrete pendente, e o novo sai com o horário novo', () => {
    // Regressão: o corpo do lembrete tem o horário escrito dentro, e o índice
    // único impediria gerar um segundo. Sem apagar na alteração, remarcar de
    // 09:00 para 15:00 mandaria o cliente para as 09:00 no dia da consulta.
    const agendamento = marcar(`${SEGUNDA} 09:00`);
    gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    const alterado = alterarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      agendamento.id,
      `${SEGUNDA} 15:00`,
      'c1',
      MADRUGADA,
    );
    expect(alterado.ok).toBe(true);
    expect(listarLembretes(db, tenantId)).toEqual([]);

    const r = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(r.criados).toHaveLength(1);
    expect(r.criados[0]?.corpo).toContain('15:00');
    expect(r.criados[0]?.corpo).not.toContain('09:00');
  });

  it('NÃO apaga lembrete que já saiu', () => {
    // O que já foi enviado é histórico do que aconteceu, não fila.
    const agendamento = marcar(`${SEGUNDA} 09:00`);
    const gerados = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });
    marcarEnviados(
      db,
      tenantId,
      gerados.criados.map((l) => l.id),
    );

    alterarAgendamento(
      db,
      tenantId,
      AGENDA_PADRAO,
      agendamento.id,
      `${SEGUNDA} 15:00`,
      'c1',
      MADRUGADA,
    );

    expect(listarLembretes(db, tenantId, { incluirEnviados: true })).toHaveLength(1);
  });
});

describe('enviar', () => {
  it('marca como enviado e tira da fila', () => {
    marcar(`${SEGUNDA} 09:00`);
    const gerados = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });
    const ids = gerados.criados.map((l) => l.id);

    expect(marcarEnviados(db, tenantId, ids)).toBe(1);
    expect(listarLembretes(db, tenantId)).toEqual([]);

    const todos = listarLembretes(db, tenantId, { incluirEnviados: true });
    expect(todos[0]?.enviadoEm).toBeTruthy();
  });

  it('marcar duas vezes não reescreve a data do primeiro envio', () => {
    marcar(`${SEGUNDA} 09:00`);
    const gerados = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });
    const ids = gerados.criados.map((l) => l.id);

    expect(marcarEnviados(db, tenantId, ids)).toBe(1);
    expect(marcarEnviados(db, tenantId, ids)).toBe(0);
  });

  it('não marca lembrete de outro tenant', () => {
    // O id vem de quem chama; a filtragem por tenant é no banco, não na
    // confiança de quem passou o número.
    const outro = salvarTenant(db, {
      slug: 'outra',
      nome: 'Outra',
      config: {},
      promptDoSistema: 'p',
    }).id;
    marcar(`${SEGUNDA} 09:00`);
    const gerados = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(
      marcarEnviados(
        db,
        outro,
        gerados.criados.map((l) => l.id),
      ),
    ).toBe(0);
    expect(listarLembretes(db, tenantId)).toHaveLength(1);
  });
});

describe('o que o canal vai drenar', () => {
  it('só entrega o que já passou da hora de sair', () => {
    // É a consulta que o adaptador de WhatsApp vai usar. Testada agora, antes
    // de existir adaptador, porque é onde o fuso morde: `scheduled_for` é hora
    // local e `sent_at` sai em UTC — comparar os dois adianta o lembrete.
    marcar(`${SEGUNDA} 09:00`, { contato: 'cedo' });
    marcar(`${SEGUNDA} 14:00`, { contato: 'tarde' });
    gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    const antesDaHora = new Date(2026, 9, 5, 7, 0, 0);
    const depois = new Date(2026, 9, 5, 7, 45, 0);

    expect(lembretesAEnviar(db, tenantId, antesDaHora)).toEqual([]);
    expect(lembretesAEnviar(db, tenantId, depois)).toHaveLength(2);
  });

  it('não entrega de novo o que já saiu', () => {
    marcar(`${SEGUNDA} 14:00`);
    const gerados = gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });
    const depois = new Date(2026, 9, 5, 8, 0, 0);

    expect(lembretesAEnviar(db, tenantId, depois)).toHaveLength(1);
    marcarEnviados(
      db,
      tenantId,
      gerados.criados.map((l) => l.id),
    );
    expect(lembretesAEnviar(db, tenantId, depois)).toEqual([]);
  });
});

describe('fila', () => {
  it('ordena por horário de envio', () => {
    // Duas consultas no mesmo dia saem no mesmo horário de envio; o desempate
    // por id mantém a ordem estável em vez de depender do plano do SQLite.
    marcar(`${TERCA} 09:00`, { contato: 'terca' });
    marcar(`${SEGUNDA} 09:00`, { contato: 'segunda' });

    gerarLembretes(db, tenantId, NOME, { data: TERCA, agora: MADRUGADA });
    gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    expect(listarLembretes(db, tenantId).map((l) => l.contatoId)).toEqual(['segunda', 'terca']);
  });

  it('o painel mostra a fila pendente', () => {
    marcar(`${SEGUNDA} 09:00`);
    gerarLembretes(db, tenantId, NOME, { data: SEGUNDA, agora: MADRUGADA });

    const painel = montarPainel(db, SLUG);

    expect(painel.lembretesPendentes).toHaveLength(1);
    expect(painel.lembretesPendentes[0]?.corpo).toContain('09:00');
  });
});
