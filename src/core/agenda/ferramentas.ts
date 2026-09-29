/**
 * As ferramentas de agenda que o bot pode chamar.
 *
 * Duas regras de segurança valem para tudo aqui, e nenhuma depende do prompt:
 *
 * 1. **`tenantId` e `contatoId` são injetados pelo servidor**, nunca lidos dos
 *    argumentos. Um modelo que alucina um id de contato não alcança a agenda de
 *    outra pessoa, porque o id que ele escrever simplesmente não é usado.
 * 2. **Cancelar e alterar exigem `confirmado: true`.** Com `false` a ferramenta
 *    devolve os dados para o bot ler de volta e não escreve nada. Prompt pode
 *    ser desobedecido; assinatura de função, não.
 *
 * E `semPersistir` vale aqui também: `npm run avaliar` e a página `/testes`
 * rodam com essa flag, e sem tratá-la avaliar criaria agendamentos de verdade
 * no banco do cliente.
 */
import type { Ferramenta } from '../llm/client.js';
import type { Db } from '../../storage/db.js';
import type { ConfigDaAgenda } from '../types.js';
import {
  agendamentosDoContato,
  alterarAgendamento,
  cancelarAgendamento,
  criarAgendamento,
  type Agendamento,
} from './agenda-service.js';
import { dataLocal, horariosLivres } from './disponibilidade.js';

export interface ContextoDasFerramentas {
  db: Db;
  tenantId: number;
  contatoId: string;
  agenda: ConfigDaAgenda;
  conversaId?: number;
  /** Modo seco: calcula e devolve o que aconteceria, sem gravar. */
  semPersistir: boolean;
  agora?: Date;
}

const DATA = { type: 'string', description: 'Data no formato AAAA-MM-DD.' };
const INICIO = {
  type: 'string',
  description: 'Data e hora no formato "AAAA-MM-DD HH:MM", exatamente como veio dos horários livres.',
};

export const FERRAMENTAS_DA_AGENDA: Ferramenta[] = [
  {
    nome: 'consultar_horarios_livres',
    descricao:
      'Lista os horários livres de um dia. Use SEMPRE antes de oferecer horário: nunca invente disponibilidade.',
    parametros: {
      type: 'object',
      properties: { data: DATA },
      required: ['data'],
      additionalProperties: false,
    },
  },
  {
    nome: 'meus_agendamentos',
    descricao:
      'Lista os agendamentos futuros de quem está conversando. Use antes de alterar ou cancelar, para saber o id.',
    parametros: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nome: 'criar_agendamento',
    descricao:
      'Marca uma consulta. Só chame depois de ter o horário livre confirmado e o nome completo do paciente.',
    parametros: {
      type: 'object',
      properties: {
        inicio: INICIO,
        nome: { type: 'string', description: 'Nome completo do paciente.' },
        servico: { type: 'string', description: 'Procedimento desejado, se o cliente disse.' },
        telefone: { type: 'string', description: 'Telefone de contato, se o cliente deu.' },
        convenio: { type: 'string', description: 'Nome do convênio, se houver.' },
      },
      required: ['inicio', 'nome'],
      additionalProperties: false,
    },
  },
  {
    nome: 'alterar_agendamento',
    descricao:
      'Muda o horário de um agendamento. Chame primeiro com confirmado=false para conferir com o cliente, e só depois com confirmado=true.',
    parametros: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Id vindo de meus_agendamentos.' },
        novo_inicio: INICIO,
        confirmado: {
          type: 'boolean',
          description: 'false apenas consulta o que seria alterado; true executa.',
        },
      },
      required: ['id', 'novo_inicio', 'confirmado'],
      additionalProperties: false,
    },
  },
  {
    nome: 'cancelar_agendamento',
    descricao:
      'Cancela um agendamento. Chame primeiro com confirmado=false para conferir com o cliente, e só depois com confirmado=true.',
    parametros: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Id vindo de meus_agendamentos.' },
        confirmado: {
          type: 'boolean',
          description: 'false apenas consulta o que seria cancelado; true executa.',
        },
      },
      required: ['id', 'confirmado'],
      additionalProperties: false,
    },
  },
];

/** Só o que o cliente precisa ver de um agendamento. */
function resumir(a: Agendamento) {
  return {
    id: a.id,
    inicio: a.inicio,
    duracao_min: a.duracaoMin,
    nome: a.nome,
    ...(a.servico ? { servico: a.servico } : {}),
  };
}

/**
 * Executa uma ferramenta e devolve o resultado em JSON.
 *
 * Nunca lança: erro de ferramenta vira `{ erro }` para o modelo ler e explicar
 * ao cliente. Uma exceção aqui derrubaria a resposta inteira e o cliente
 * ficaria sem nada.
 */
export function executarFerramenta(
  ctx: ContextoDasFerramentas,
  nome: string,
  argumentos: Record<string, unknown>,
): string {
  try {
    return JSON.stringify(despachar(ctx, nome, argumentos));
  } catch (erro) {
    return JSON.stringify({ erro: erro instanceof Error ? erro.message : String(erro) });
  }
}

function despachar(
  ctx: ContextoDasFerramentas,
  nome: string,
  a: Record<string, unknown>,
): unknown {
  const agora = ctx.agora ?? new Date();

  switch (nome) {
    case 'consultar_horarios_livres': {
      const data = texto(a.data);
      const livres = horariosLivres(ctx.db, ctx.tenantId, ctx.agenda, data, agora);
      return {
        data,
        horarios: livres.map((s) => s.hora),
        ...(livres.length === 0
          ? { aviso: 'Nenhum horário livre nesse dia. Ofereça outra data.' }
          : {}),
      };
    }

    case 'meus_agendamentos':
      return {
        agendamentos: agendamentosDoContato(ctx.db, ctx.tenantId, ctx.contatoId, agora).map(resumir),
      };

    case 'criar_agendamento': {
      if (ctx.semPersistir) {
        return { simulado: true, aviso: 'Modo de avaliação: nada foi gravado.' };
      }

      const r = criarAgendamento(
        ctx.db,
        ctx.tenantId,
        ctx.agenda,
        {
          // O contato vem do servidor. O que o modelo escrever é ignorado.
          contatoId: ctx.contatoId,
          inicio: texto(a.inicio),
          nome: texto(a.nome),
          ...(texto(a.servico) ? { servico: texto(a.servico) } : {}),
          ...(texto(a.telefone) ? { telefone: texto(a.telefone) } : {}),
          ...(texto(a.convenio) ? { convenio: texto(a.convenio) } : {}),
          ...(ctx.conversaId !== undefined ? { conversaId: ctx.conversaId } : {}),
        },
        agora,
      );

      return r.ok ? { ok: true, agendamento: resumir(r.agendamento) } : recusa(r.motivo, r.detalhe);
    }

    case 'alterar_agendamento': {
      const id = inteiro(a.id);
      const alvo = acharDoContato(ctx, id, agora);
      if (!alvo) return recusa('nao_encontrado', 'não achei esse agendamento no seu nome');

      if (a.confirmado !== true) {
        return {
          confirmacao_pendente: true,
          de: resumir(alvo),
          para: texto(a.novo_inicio),
          instrucao: 'Confirme com o cliente e chame de novo com confirmado=true.',
        };
      }

      if (ctx.semPersistir) {
        return { simulado: true, aviso: 'Modo de avaliação: nada foi gravado.' };
      }

      const r = alterarAgendamento(
        ctx.db,
        ctx.tenantId,
        ctx.agenda,
        id,
        texto(a.novo_inicio),
        ctx.contatoId,
        agora,
      );

      return r.ok ? { ok: true, agendamento: resumir(r.agendamento) } : recusa(r.motivo, r.detalhe);
    }

    case 'cancelar_agendamento': {
      const id = inteiro(a.id);
      const alvo = acharDoContato(ctx, id, agora);
      if (!alvo) return recusa('nao_encontrado', 'não achei esse agendamento no seu nome');

      if (a.confirmado !== true) {
        return {
          confirmacao_pendente: true,
          cancelaria: resumir(alvo),
          instrucao: 'Confirme com o cliente e chame de novo com confirmado=true.',
        };
      }

      if (ctx.semPersistir) {
        return { simulado: true, aviso: 'Modo de avaliação: nada foi gravado.' };
      }

      const r = cancelarAgendamento(ctx.db, ctx.tenantId, id, ctx.contatoId);
      return r.ok ? { ok: true, cancelado: resumir(r.agendamento) } : recusa(r.motivo, r.detalhe);
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

/** Confere que o agendamento é de quem está falando, antes de qualquer coisa. */
function acharDoContato(
  ctx: ContextoDasFerramentas,
  id: number,
  agora: Date,
): Agendamento | undefined {
  return agendamentosDoContato(ctx.db, ctx.tenantId, ctx.contatoId, agora).find((a) => a.id === id);
}

function recusa(motivo: string, detalhe: string) {
  return { ok: false, motivo, detalhe };
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function inteiro(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isInteger(n) ? n : -1;
}

/**
 * Linha que diz ao modelo que dia é hoje.
 *
 * Sem isto ele não tem como transformar "próxima sexta" numa data, e chuta —
 * marcando consulta em dia errado com toda a confiança do mundo.
 */
export function hojeParaOPrompt(agora: Date = new Date()): string {
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  return `Hoje é ${dataLocal(agora)} (${dias[agora.getDay()]}).`;
}
