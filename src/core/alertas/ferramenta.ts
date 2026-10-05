/**
 * A ferramenta com que o bot chama o dono do negócio.
 *
 * Fica separada das ferramentas de agenda e vale para TODO cliente: avisar
 * alguém não é um recurso de clínica, é o mínimo para um bot que atende em nome
 * de outra pessoa. É barata — uma definição contra as cinco da agenda.
 *
 * Ela NÃO cala o bot, e é essa a diferença para o handoff. O bot avisa e segue
 * conversando; quem lê o aviso é o dono, no painel, depois.
 */
import type { Ferramenta } from '../llm/client.js';
import type { Db } from '../../storage/db.js';
import {
  registrarAlerta,
  TIPOS_DE_ALERTA,
  type TipoDeAlerta,
} from './alertas.js';

export const FERRAMENTA_DE_AVISO: Ferramenta = {
  nome: 'avisar_responsavel',
  descricao:
    'Deixa um aviso para a pessoa responsável pelo negócio, sem interromper a conversa. ' +
    'Use quando o caso depender de uma decisão ou confirmação que só ela pode dar — ' +
    'desconto, horário de entrega, ou algo que você não tem certeza. ' +
    'Depois de avisar, CONTINUE atendendo normalmente e diga ao cliente que vai confirmar.',
  parametros: {
    type: 'object',
    properties: {
      motivo: {
        type: 'string',
        enum: TIPOS_DE_ALERTA,
        description:
          'desconto: pediu abatimento ou preço de atacado. ' +
          'confirmar_entrega: há horário de entrega a confirmar. ' +
          'fora_de_cobertura: perguntou de lugar, prazo ou condição que não está nos documentos. ' +
          'brinde: pediu brinde, amostra ou cortesia. ' +
          'outro: qualquer outro caso que o responsável precise ver.',
      },
      detalhe: {
        type: 'string',
        description:
          'Uma frase dizendo o que o responsável precisa decidir ou confirmar. ' +
          'Escreva para quem não leu a conversa.',
      },
    },
    required: ['motivo', 'detalhe'],
    additionalProperties: false,
  },
};

export interface ContextoDoAviso {
  db: Db;
  tenantId: number;
  conversaId?: number;
  /** A mensagem que o cliente mandou neste turno, guardada junto do aviso. */
  mensagemDoCliente?: string;
  /** Modo seco: a avaliação não pode encher o painel de aviso de teste. */
  semPersistir: boolean;
}

/** Executa a ferramenta. Nunca lança: erro vira texto para o modelo explicar. */
export function executarAviso(ctx: ContextoDoAviso, argumentos: Record<string, unknown>): string {
  const motivo = typeof argumentos.motivo === 'string' ? argumentos.motivo : '';
  const detalhe = typeof argumentos.detalhe === 'string' ? argumentos.detalhe.trim() : '';

  if (!(TIPOS_DE_ALERTA as string[]).includes(motivo)) {
    return JSON.stringify({
      ok: false,
      erro: `motivo inválido. Use um destes: ${TIPOS_DE_ALERTA.join(', ')}.`,
    });
  }

  if (detalhe.length === 0) {
    return JSON.stringify({ ok: false, erro: 'detalhe é obrigatório: diga o que precisa ser decidido.' });
  }

  if (ctx.semPersistir) {
    return JSON.stringify({ ok: true, simulado: true, aviso: 'Modo de avaliação: nada foi gravado.' });
  }

  const id = registrarAlerta(ctx.db, {
    tenantId: ctx.tenantId,
    ...(ctx.conversaId !== undefined ? { conversaId: ctx.conversaId } : {}),
    tipo: motivo as TipoDeAlerta,
    detalhe,
    ...(ctx.mensagemDoCliente ? { mensagemDoCliente: ctx.mensagemDoCliente } : {}),
    origem: 'ferramenta',
  });

  // `undefined` quer dizer que já havia um aviso pendente deste tipo nesta
  // conversa. Para o modelo dá no mesmo: o responsável já foi avisado.
  return JSON.stringify({
    ok: true,
    avisado: true,
    repetido: id === undefined,
    instrucao: 'O responsável foi avisado. Continue atendendo e diga ao cliente que vai confirmar.',
  });
}
