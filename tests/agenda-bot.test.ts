/**
 * Testes do bot operando a agenda.
 *
 * O dublê segue um roteiro de chamadas de ferramenta, então todo o
 * comportamento — inclusive o que protege a agenda de um modelo que alucina —
 * se prova offline e de graça.
 *
 * O relógio é injetado nas ferramentas pelo mesmo motivo do resto da agenda:
 * um teste preso ao relógio real passa hoje e falha amanhã.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { AGENDA_PADRAO } from '../src/core/agenda/disponibilidade.js';
import {
  executarFerramenta,
  FERRAMENTAS_DA_AGENDA,
  hojeParaOPrompt,
  type ContextoDasFerramentas,
} from '../src/core/agenda/ferramentas.js';
import { criarAgendamento, buscarPorId } from '../src/core/agenda/agenda-service.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { Motor } from '../src/core/engine.js';
import { config } from '../src/config.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmComFerramentas } from './helpers/fake-llm.js';

// 2026-10-05 é segunda; AGORA é a sexta anterior, 09:00.
const SEGUNDA = '2026-10-05';
const AGORA = new Date(2026, 9, 2, 9, 0, 0);

let db: Db;
let tenantId: number;

function contexto(extra: Partial<ContextoDasFerramentas> = {}): ContextoDasFerramentas {
  return {
    db,
    tenantId,
    contatoId: 'contato-maria',
    agenda: AGENDA_PADRAO,
    semPersistir: false,
    agora: AGORA,
    ...extra,
  };
}

/** Executa e já devolve o JSON parseado. */
function rodar(
  nome: string,
  argumentos: Record<string, unknown>,
  ctx = contexto(),
): Record<string, unknown> {
  return JSON.parse(executarFerramenta(ctx, nome, argumentos)) as Record<string, unknown>;
}

function marcarPara(contatoId: string, inicio: string): number {
  const r = criarAgendamento(
    db,
    tenantId,
    AGENDA_PADRAO,
    { contatoId, inicio, nome: 'Paciente' },
    AGORA,
  );
  if (!r.ok) throw new Error(`não marcou: ${r.detalhe}`);
  return r.agendamento.id;
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  tenantId = salvarTenant(db, { slug: 'c', nome: 'C', config: {}, promptDoSistema: 'p' }).id;
});

describe('as ferramentas oferecidas', () => {
  it('expõe as cinco operações que o bot precisa', () => {
    expect(FERRAMENTAS_DA_AGENDA.map((f) => f.nome)).toEqual([
      'consultar_horarios_livres',
      'meus_agendamentos',
      'criar_agendamento',
      'alterar_agendamento',
      'cancelar_agendamento',
    ]);
  });

  it('NENHUMA aceita contato ou tenant como parâmetro', () => {
    // Se o modelo pudesse escolher de quem é a agenda, bastaria alucinar um id
    // para alcançar a consulta de outra pessoa. Os dois vêm do servidor.
    //
    // Confere os nomes dos PARÂMETROS, e não o JSON inteiro: "telefone de
    // contato" na descrição é texto para o modelo ler, não porta de entrada.
    const parametros = FERRAMENTAS_DA_AGENDA.flatMap((f) =>
      Object.keys((f.parametros as { properties?: object }).properties ?? {}),
    );

    expect(parametros).not.toContain('contatoId');
    expect(parametros).not.toContain('contact_id');
    expect(parametros).not.toContain('tenantId');
    expect(parametros).not.toContain('tenant_id');
  });

  it('todas recusam parâmetro fora do esquema', () => {
    // `additionalProperties: false` faz o provedor rejeitar o que o modelo
    // inventar, em vez de a gente ter de filtrar depois.
    for (const f of FERRAMENTAS_DA_AGENDA) {
      expect((f.parametros as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it('diz ao modelo que dia é hoje', () => {
    // Sem isto ele não transforma "próxima sexta" em data: chuta, e marca
    // consulta no dia errado com toda a confiança.
    expect(hojeParaOPrompt(AGORA)).toBe('Hoje é 2026-10-02 (sexta-feira).');
  });
});

describe('consultar e listar', () => {
  it('devolve os horários livres do dia', () => {
    const r = rodar('consultar_horarios_livres', { data: SEGUNDA });

    expect(r.horarios).toContain('09:00');
    expect(r.aviso).toBeUndefined();
  });

  it('avisa quando o dia não tem vaga, em vez de devolver lista vazia e pronto', () => {
    // Lista vazia sem explicação faz o modelo inventar um motivo.
    const r = rodar('consultar_horarios_livres', { data: '2026-10-11' });

    expect(r.horarios).toEqual([]);
    expect(r.aviso).toContain('Nenhum horário livre');
  });

  it('lista só os agendamentos de quem está falando', () => {
    marcarPara('contato-maria', `${SEGUNDA} 09:00`);
    marcarPara('contato-joao', `${SEGUNDA} 10:00`);

    const r = rodar('meus_agendamentos', {}) as { agendamentos: { inicio: string }[] };

    expect(r.agendamentos).toHaveLength(1);
    expect(r.agendamentos[0]?.inicio).toBe(`${SEGUNDA} 09:00`);
  });
});

describe('marcar', () => {
  it('marca e devolve o agendamento', () => {
    const r = rodar('criar_agendamento', {
      inicio: `${SEGUNDA} 09:00`,
      nome: 'Maria Silva',
      servico: 'limpeza',
    }) as { ok: boolean; agendamento: { id: number; nome: string } };

    expect(r.ok).toBe(true);
    expect(buscarPorId(db, r.agendamento.id)?.nome).toBe('Maria Silva');
  });

  it('IGNORA o contato que o modelo escrever e usa o do servidor', () => {
    rodar('criar_agendamento', {
      inicio: `${SEGUNDA} 09:00`,
      nome: 'Maria',
      contatoId: 'contato-de-outra-pessoa',
      contact_id: 'contato-de-outra-pessoa',
    });

    const daMaria = rodar('meus_agendamentos', {}) as { agendamentos: unknown[] };
    expect(daMaria.agendamentos).toHaveLength(1);
  });

  it('explica a recusa em vez de lançar', () => {
    marcarPara('contato-joao', `${SEGUNDA} 09:00`);

    const r = rodar('criar_agendamento', { inicio: `${SEGUNDA} 09:00`, nome: 'Maria' });

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('conflito');
    expect(typeof r.detalhe).toBe('string');
  });

  it('devolve erro legível quando o horário não existe na grade', () => {
    const r = rodar('criar_agendamento', { inicio: `${SEGUNDA} 03:00`, nome: 'Maria' });
    expect(r.motivo).toBe('fora_do_horario');
  });
});

describe('confirmação antes de alterar ou cancelar', () => {
  it('cancelar com confirmado=false NÃO cancela: só devolve o que cancelaria', () => {
    // A confirmação está no contrato da ferramenta, e não só no prompt.
    // Prompt pode ser desobedecido; assinatura de função, não.
    const id = marcarPara('contato-maria', `${SEGUNDA} 09:00`);

    const r = rodar('cancelar_agendamento', { id, confirmado: false });

    expect(r.confirmacao_pendente).toBe(true);
    expect(buscarPorId(db, id)?.status).toBe('scheduled');
  });

  it('cancelar com confirmado=true cancela', () => {
    const id = marcarPara('contato-maria', `${SEGUNDA} 09:00`);

    const r = rodar('cancelar_agendamento', { id, confirmado: true });

    expect(r.ok).toBe(true);
    expect(buscarPorId(db, id)?.status).toBe('cancelled');
  });

  it('alterar com confirmado=false NÃO altera', () => {
    const id = marcarPara('contato-maria', `${SEGUNDA} 09:00`);

    const r = rodar('alterar_agendamento', {
      id,
      novo_inicio: `${SEGUNDA} 14:00`,
      confirmado: false,
    });

    expect(r.confirmacao_pendente).toBe(true);
    expect(buscarPorId(db, id)?.inicio).toBe(`${SEGUNDA} 09:00`);
  });

  it('confirmado ausente vale como não confirmado', () => {
    // Um modelo que esquece o campo não pode apagar consulta de ninguém.
    const id = marcarPara('contato-maria', `${SEGUNDA} 09:00`);

    rodar('cancelar_agendamento', { id });

    expect(buscarPorId(db, id)?.status).toBe('scheduled');
  });
});

describe('isolamento entre contatos', () => {
  it('não cancela o agendamento de outra pessoa nem com o id certo', () => {
    const doJoao = marcarPara('contato-joao', `${SEGUNDA} 09:00`);

    const r = rodar('cancelar_agendamento', { id: doJoao, confirmado: true });

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('nao_encontrado');
    expect(buscarPorId(db, doJoao)?.status).toBe('scheduled');
  });

  it('não altera o agendamento de outra pessoa', () => {
    const doJoao = marcarPara('contato-joao', `${SEGUNDA} 09:00`);

    const r = rodar('alterar_agendamento', {
      id: doJoao,
      novo_inicio: `${SEGUNDA} 14:00`,
      confirmado: true,
    });

    expect(r.ok).toBe(false);
    expect(buscarPorId(db, doJoao)?.inicio).toBe(`${SEGUNDA} 09:00`);
  });
});

describe('modo de avaliação (semPersistir)', () => {
  // npm run avaliar e a página /testes rodam com esta flag. Sem tratá-la,
  // avaliar criaria agendamentos de verdade na agenda do cliente.
  const seco = () => contexto({ semPersistir: true });

  it('não grava agendamento nenhum', () => {
    const r = rodar('criar_agendamento', { inicio: `${SEGUNDA} 09:00`, nome: 'Maria' }, seco());

    expect(r.simulado).toBe(true);
    const total = db.prepare('SELECT COUNT(*) AS t FROM appointments').get() as { t: number };
    expect(total.t).toBe(0);
  });

  it('não cancela de verdade', () => {
    const id = marcarPara('contato-maria', `${SEGUNDA} 09:00`);

    rodar('cancelar_agendamento', { id, confirmado: true }, seco());

    expect(buscarPorId(db, id)?.status).toBe('scheduled');
  });

  it('mas consultar continua funcionando: avaliar precisa medir a busca', () => {
    const r = rodar('consultar_horarios_livres', { data: SEGUNDA }, seco());
    expect(r.horarios).toContain('09:00');
  });
});

describe('o laço de ferramentas no motor', () => {
  const DOCUMENTO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';

  function semearComChunk(): void {
    const documentId = salvarDocumento(db, tenantId, 'faq.md', DOCUMENTO);
    inserirChunks(db, [
      {
        documentId,
        tenantId,
        indice: 0,
        texto: DOCUMENTO,
        embedding: vetorDeTexto(DOCUMENTO),
        metadados: { secao: 'Horários' },
      },
    ]);
  }

  const chamada = (nome: string, argumentos: Record<string, unknown>, id = 'c1') => ({
    id,
    nome,
    argumentos,
  });

  it('executa a ferramenta pedida e devolve o resultado ao modelo', async () => {
    semearComChunk();
    const llm = new LlmComFerramentas(
      [chamada('consultar_horarios_livres', { data: SEGUNDA }), undefined],
      'Tenho 09:00 livre na segunda.',
    );
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const r = await motor.responder('c', 'contato-1', 'que horas tem livre?', { canal: 'web' });

    expect(r.texto).toBe('Tenho 09:00 livre na segunda.');
    expect(llm.resultadosRecebidos[0]).toContain('horarios');
  });

  it('PARA no teto de voltas, mesmo se o modelo pedir ferramenta para sempre', async () => {
    // Sem teto, um modelo confuso repete a chamada e queima crédito em
    // silêncio, com o cliente esperando uma resposta que não vem.
    semearComChunk();
    const semFim = Array.from({ length: 20 }, (_, i) =>
      chamada('meus_agendamentos', {}, `c${i}`),
    );
    const llm = new LlmComFerramentas(semFim);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    // Mensagem que NÃO é turno social: saudação nem chega ao laço, porque é
    // respondida sem busca e sem ferramenta.
    await motor.responder('c', 'contato-1', 'quero ver minha consulta marcada', {
      canal: 'web',
    });

    // Uma chamada inicial mais o teto de voltas.
    expect(llm.chamadas.length).toBe(config.agenda.maximoDeVoltas + 1);
  });

  it('soma os tokens de TODAS as voltas', async () => {
    // Custo reportado que conta só a última chamada é ficção.
    semearComChunk();
    const llm = new LlmComFerramentas([chamada('meus_agendamentos', {}), undefined]);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    const r = await motor.responder('c', 'contato-1', 'tenho consulta marcada?', { canal: 'web' });

    // Duas chamadas de 50 tokens de entrada cada.
    expect(r.uso.tokensEntrada).toBe(100);
  });

  it('manda a data de hoje no prompt, junto com as regras de agenda', async () => {
    semearComChunk();
    const llm = new LlmComFerramentas([undefined]);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder('c', 'contato-1', 'oi, quanto custa?', { canal: 'web' });

    expect(llm.chamadas[0]?.promptDoSistema).toContain('Hoje é');
    expect(llm.chamadas[0]?.promptDoSistema).toContain('AGENDA:');
  });

  it('NÃO oferece ferramenta na avaliação, que roda sem conversa', async () => {
    // Sem conversa não há contato de verdade a quem pendurar um agendamento.
    semearComChunk();
    const llm = new LlmComFerramentas([undefined]);
    const motor = new Motor({ db, embedder: new EmbedderFake(), llm });

    await motor.responder('c', 'contato-1', 'quero marcar', { semPersistir: true });

    expect(llm.chamadas[0]?.promptDoSistema).not.toContain('AGENDA:');
  });
});

describe('robustez', () => {
  it('ferramenta desconhecida vira erro legível, não exceção', () => {
    const r = rodar('apagar_a_agenda_toda', {});
    expect(String(r.erro)).toContain('desconhecida');
  });

  it('argumento faltando não derruba a resposta', () => {
    const r = rodar('criar_agendamento', {});
    expect(r.ok).toBe(false);
  });

  it('id que não é número não acha nada', () => {
    const r = rodar('cancelar_agendamento', { id: 'o primeiro', confirmado: true });
    expect(r.motivo).toBe('nao_encontrado');
  });
});
