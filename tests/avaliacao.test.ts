/**
 * Testes das regras de avaliação e do log.
 *
 * Estas regras decidem se a suíte paga passou ou falhou. Se elas erram, todo
 * o log vira ruído e a calibração vai na direção errada — por isso têm teste
 * próprio, offline.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  verificar,
  verificarFormato,
  verificarNumerosInventados,
  type PerguntaDeAvaliacao,
} from '../src/core/avaliacao/regras.js';
import {
  garantirPastas,
  gravarHistorico,
  lerHistorico,
  montarRelatorio,
  novoIdDeExecucao,
  resultadoAnterior,
  resumir,
  type RegistroDeAvaliacao,
} from '../src/core/avaliacao/log.js';
import type { RespostaDoBot } from '../src/core/types.js';

function resposta(parcial: Partial<RespostaDoBot> = {}): RespostaDoBot {
  const texto = parcial.texto ?? 'Aos sábados, o atendimento é das 8h às 12h.';

  return {
    texto,
    // As regras de avaliação julgam o TEXTO do turno, não as mensagens
    // separadas: é a mesma coisa que vai para o log e para o banco.
    mensagens: texto.split('\n').filter((l) => l.trim().length > 0),
    fontes: [{ arquivo: 'horarios.txt', secao: 'Horário de atendimento', score: 0.57 }],
    precisaDeHumano: false,
    melhorScore: 0.57,
    uso: { tokensEntrada: 100, tokensSaida: 20, custoEstimadoUsd: 0.0004, latenciaMs: 1200 },
    aguardandoHumano: false,
    ...parcial,
  };
}

const CONTEXTO = 'Horário de atendimento. De segunda a sexta das 8h às 18h. Aos sábados das 8h às 12h.';

describe('verificar', () => {
  it('aprova resposta que cumpre todas as regras', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'horario-sabado',
      pergunta: 'qual o horário de sábado?',
      deveConter: ['8h', '12h'],
      esperaHandoff: false,
      fonteEsperada: 'horarios.txt',
    };

    expect(verificar(esperado, resposta(), CONTEXTO).passou).toBe(true);
  });

  it('reprova quando falta um trecho obrigatório', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'x',
      pergunta: 'p',
      deveConter: ['domingo'],
      esperaHandoff: false,
    };

    const r = verificar(esperado, resposta(), CONTEXTO);
    expect(r.passou).toBe(false);
    expect(r.falhas[0]?.regra).toBe('deveConter');
  });

  it('compara ignorando acento e maiúscula', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'x',
      pergunta: 'p',
      deveConter: ['SÁBADOS'],
      esperaHandoff: false,
    };

    expect(verificar(esperado, resposta(), CONTEXTO).passou).toBe(true);
  });

  it('reprova quando o bot desiste de uma pergunta que a base responde', () => {
    const esperado: PerguntaDeAvaliacao = { id: 'x', pergunta: 'p', esperaHandoff: false };
    const r = verificar(esperado, resposta({ precisaDeHumano: true }), CONTEXTO);

    expect(r.passou).toBe(false);
    expect(r.falhas.some((f) => f.regra === 'esperaHandoff')).toBe(true);
  });

  it('reprova quando o bot responde algo que deveria recusar', () => {
    // É a falha mais cara: inventar resposta para o que não está na base.
    const esperado: PerguntaDeAvaliacao = { id: 'cnpj', pergunta: 'qual o CNPJ?', esperaHandoff: true };
    const r = verificar(esperado, resposta({ texto: 'O CNPJ é 12.345.678/0001-90.' }), CONTEXTO);

    expect(r.passou).toBe(false);
    expect(r.falhas.some((f) => f.regra === 'esperaHandoff')).toBe(true);
  });

  it('não cobra conteúdo nem fonte de uma resposta que deveria ser handoff', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'pizza',
      pergunta: 'vocês vendem pizza?',
      esperaHandoff: true,
      fonteEsperada: 'cardapio.md',
    };

    const handoff = resposta({
      texto: 'Não tenho essa informação aqui.',
      precisaDeHumano: true,
      fontes: [],
    });

    expect(verificar(esperado, handoff, '').passou).toBe(true);
  });

  it('reprova quando cita a fonte errada', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'x',
      pergunta: 'p',
      esperaHandoff: false,
      fonteEsperada: 'servicos.md',
    };

    const r = verificar(esperado, resposta(), CONTEXTO);
    expect(r.falhas.some((f) => f.regra === 'fonteEsperada')).toBe(true);
  });

  it('reprova quando aparece um trecho proibido', () => {
    const esperado: PerguntaDeAvaliacao = {
      id: 'x',
      pergunta: 'p',
      naoPodeConter: ['sábados'],
      esperaHandoff: false,
    };

    const r = verificar(esperado, resposta(), CONTEXTO);
    expect(r.falhas.some((f) => f.regra === 'naoPodeConter')).toBe(true);
  });
});

describe('verificarNumerosInventados', () => {
  it('NAO acusa quando so o ponto final difere', () => {
    // Bug real, achado medindo a Polpa Santa Helena: o documento escreve
    // "R$ 35,00 o quilo" e o bot respondeu "sai por R$ 35,00." — com ponto. O
    // padrao de extracao e guloso e engolia o ponto, entao o valor nao casava e
    // a regra acusava invencao de um preco que estava no documento.
    //
    // Falso positivo numa regra de seguranca e pior que regra nenhuma: ensina a
    // ignorar o aviso justo quando ele estiver certo.
    expect(
      verificarNumerosInventados('Sai por R$ 35,00.', 'Estes sabores custam R$ 35,00 o quilo'),
    ).toEqual([]);
  });

  it('continua acusando o valor que de fato nao existe', () => {
    const falhas = verificarNumerosInventados('Sai por R$ 39,00.', 'custam R$ 35,00 o quilo');

    expect(falhas).toHaveLength(1);
    expect(falhas[0]?.detalhe).toContain('R$ 39,00');
  });

  it('aceita valor em reais que está no contexto', () => {
    expect(verificarNumerosInventados('A limpeza custa R$ 180,00.', 'Limpeza: R$ 180,00.')).toEqual([]);
  });

  it('PEGA um preço trocado, que passaria em qualquer teste de palavra-chave', () => {
    // O caso que motiva esta regra: texto certo, número errado.
    const falhas = verificarNumerosInventados('A limpeza custa R$ 190,00.', 'Limpeza: R$ 180,00.');

    expect(falhas).toHaveLength(1);
    expect(falhas[0]?.regra).toBe('numeroInventado');
    expect(falhas[0]?.detalhe).toContain('190');
  });

  it('pega horário inventado', () => {
    const falhas = verificarNumerosInventados('Abrimos às 7h.', 'Funcionamos das 8h às 18h.');
    expect(falhas.some((f) => f.detalhe.includes('7h'))).toBe(true);
  });

  it('aceita horário que está no contexto', () => {
    expect(verificarNumerosInventados('Das 8h às 18h.', 'Funcionamos das 8h às 18h.')).toEqual([]);
  });

  it('pega prazo inventado', () => {
    const falhas = verificarNumerosInventados('Fica pronto em 15 dias.', 'O implante custa R$ 3.200,00.');
    expect(falhas.some((f) => f.detalhe.includes('15 dias'))).toBe(true);
  });

  it('pega desconto em porcentagem inventado', () => {
    // Descoberto na primeira avaliação real: a pergunta sobre desconto expôs
    // que porcentagem não era verificada, então "damos 10%" passaria.
    const falhas = verificarNumerosInventados(
      'Damos 10% de desconto à vista.',
      'Os valores são válidos para pagamento à vista.',
    );
    expect(falhas.some((f) => f.detalhe.includes('10%'))).toBe(true);
  });

  it('aceita porcentagem que está no contexto', () => {
    expect(
      verificarNumerosInventados('A multa é de 50% da consulta.', 'Faltas podem gerar cobrança de 50% do valor.'),
    ).toEqual([]);
  });

  it('não reclama de número que não é preço, horário nem prazo', () => {
    // "3 dentistas" não precisa de origem documental para o teste passar;
    // cobrar isso encheria o relatório de falso positivo e ninguém o leria.
    expect(verificarNumerosInventados('A clínica tem 3 dentistas.', 'Equipe da clínica.')).toEqual([]);
  });

  it('ignora diferença de acento e caixa ao comparar', () => {
    expect(verificarNumerosInventados('Custa R$ 180,00', 'custa r$ 180,00')).toEqual([]);
  });
});

describe('verificarFormato', () => {
  it('aceita resposta de até 3 linhas', () => {
    expect(verificarFormato('uma\nduas\ntrês')).toEqual([]);
  });

  it('reprova resposta com mais de 3 linhas', () => {
    const falhas = verificarFormato('1\n2\n3\n4');
    expect(falhas[0]?.regra).toBe('maximoDeLinhas');
  });

  it('não conta linha em branco', () => {
    expect(verificarFormato('uma\n\n\nduas')).toEqual([]);
  });
});

describe('log de avaliação', () => {
  let raiz: string;

  function registro(parcial: Partial<RegistroDeAvaliacao> = {}): RegistroDeAvaliacao {
    return {
      execucao: '2026-09-23-18-00',
      tenant: 'clinica',
      id: 'horario-sabado',
      pergunta: 'qual o horário de sábado?',
      passou: true,
      falhas: [],
      resposta: 'Das 8h às 12h.',
      esperavaHandoff: false,
      houveHandoff: false,
      melhorScore: 0.57,
      fontes: [{ arquivo: 'horarios.txt', score: 0.57 }],
      tokensEntrada: 100,
      tokensSaida: 20,
      custoUsd: 0.0004,
      latenciaMs: 1200,
      modelo: 'fake',
      limiar: 0.4,
      ...parcial,
    };
  }

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-log-'));
    garantirPastas(raiz);
  });

  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it('o id de execução serve como nome de arquivo e ordena cronologicamente', () => {
    const a = novoIdDeExecucao(new Date('2026-09-23T18:00:00Z'));
    const b = novoIdDeExecucao(new Date('2026-09-24T09:00:00Z'));

    expect(a).toBe('2026-09-23-18-00');
    expect(a < b).toBe(true);
    expect(a).not.toMatch(/[:/\\]/);
  });

  it('acumula execuções em vez de sobrescrever', () => {
    // Sem isso não existe histórico, e sem histórico não existe calibração.
    gravarHistorico(raiz, [registro({ execucao: 'exec-1' })]);
    gravarHistorico(raiz, [registro({ execucao: 'exec-2' })]);

    const historico = lerHistorico(raiz);
    expect(historico).toHaveLength(2);
    expect(historico.map((r) => r.execucao)).toEqual(['exec-1', 'exec-2']);
  });

  it('devolve histórico vazio quando ainda não há arquivo', () => {
    expect(lerHistorico(raiz)).toEqual([]);
  });

  it('ignora linha corrompida em vez de derrubar o relatório', () => {
    gravarHistorico(raiz, [registro()]);
    fs.appendFileSync(path.join(raiz, 'logs', 'historico.jsonl'), '{quebrado\n', 'utf8');

    expect(lerHistorico(raiz)).toHaveLength(1);
  });

  it('compara com a execução anterior, não com todas as anteriores', () => {
    gravarHistorico(raiz, [registro({ execucao: 'exec-1', id: 'a', passou: false })]);
    gravarHistorico(raiz, [registro({ execucao: 'exec-2', id: 'a', passou: true })]);

    const anterior = resultadoAnterior(raiz, 'clinica', 'exec-3');
    expect(anterior.get('a')).toBe(true);
  });

  it('não mistura o histórico de tenants diferentes', () => {
    gravarHistorico(raiz, [registro({ execucao: 'exec-1', tenant: 'clinica', id: 'a', passou: true })]);
    gravarHistorico(raiz, [registro({ execucao: 'exec-1', tenant: 'loja', id: 'a', passou: false })]);

    expect(resultadoAnterior(raiz, 'clinica', 'exec-2').get('a')).toBe(true);
    expect(resultadoAnterior(raiz, 'loja', 'exec-2').get('a')).toBe(false);
  });

  it('calcula acurácia, custo e latência média', () => {
    const resumo = resumir(
      [registro({ passou: true, custoUsd: 0.001, latenciaMs: 1000 }), registro({ id: 'b', passou: false, custoUsd: 0.003, latenciaMs: 2000 })],
      { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 },
    );

    expect(resumo.acuracia).toBe(0.5);
    expect(resumo.custoTotalUsd).toBeCloseTo(0.004, 6);
    expect(resumo.latenciaMediaMs).toBe(1500);
  });

  it('o relatório destaca regressão: passava antes, falhou agora', () => {
    const atual = [registro({ id: 'horario', passou: false, falhas: [{ regra: 'deveConter', detalhe: 'faltou "12h"' }] })];
    const anterior = new Map([['horario', true]]);

    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      anterior,
    );

    expect(texto).toContain('## Regressões');
    expect(texto).toContain('**horario**');
    expect(texto).toContain('faltou "12h"');
  });

  it('o relatório não acusa regressão no que já falhava antes', () => {
    const atual = [registro({ id: 'cnpj', passou: false })];
    const anterior = new Map([['cnpj', false]]);

    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      anterior,
    );

    expect(texto).toContain('Nenhuma. Nada que passava antes falhou agora.');
  });

  it('o relatório traz resposta, fontes e best_score de cada pergunta', () => {
    const atual = [registro()];
    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      new Map(),
    );

    expect(texto).toContain('Das 8h às 12h.');
    expect(texto).toContain('horarios.txt');
    expect(texto).toContain('best_score 0.570');
  });

  it('mostra o comentário da pergunta no relatório', () => {
    // A anotação diz POR QUE a pergunta está na suíte. Sem ela no relatório,
    // seis meses depois ninguém lembra se um handoff esperado era intencional.
    const atual = [registro({ comentario: 'Fala da clínica mas a base não responde.' })];
    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      new Map(),
    );

    expect(texto).toContain('Fala da clínica mas a base não responde.');
  });

  it('não deixa linha vazia quando a pergunta não tem comentário', () => {
    const atual = [registro()];
    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      new Map(),
    );

    expect(texto).not.toContain('> undefined');
    // Nenhuma linha de citação vazia sobrando onde não havia comentário.
    expect(texto.split('\n').some((l) => l.trim() === '>')).toBe(false);
  });

  it('avisa quando é a primeira execução, em vez de fingir comparação', () => {
    const atual = [registro()];
    const texto = montarRelatorio(
      resumir(atual, { execucao: 'e', tenant: 'clinica', modelo: 'fake', limiar: 0.4 }),
      atual,
      new Map(),
    );

    expect(texto).toContain('Primeira execução');
  });
});
