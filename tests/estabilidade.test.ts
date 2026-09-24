/**
 * Testes da medição de estabilidade.
 *
 * Esta é a métrica que decide se a suíte paga é confiável, então ela própria
 * precisa ser. Offline.
 */
import { describe, expect, it } from 'vitest';
import {
  medirEstabilidade,
  montarRelatorioDeEstabilidade,
  resumirEstabilidade,
} from '../src/core/avaliacao/estabilidade.js';
import type { RegistroDeAvaliacao } from '../src/core/avaliacao/log.js';

function registro(parcial: Partial<RegistroDeAvaliacao> = {}): RegistroDeAvaliacao {
  return {
    execucao: 'exec-1',
    tenant: 'clinica',
    id: 'pergunta-a',
    pergunta: 'qual o horário?',
    passou: true,
    falhas: [],
    resposta: 'Das 8h às 18h.',
    esperavaHandoff: false,
    houveHandoff: false,
    melhorScore: 0.57,
    fontes: [],
    tokensEntrada: 100,
    tokensSaida: 20,
    custoUsd: 0.0004,
    latenciaMs: 1200,
    modelo: 'fake',
    limiar: 0.4,
    ...parcial,
  };
}

describe('medirEstabilidade', () => {
  it('marca como estável a pergunta que passou em todas as execuções', () => {
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', passou: true }),
      registro({ execucao: 'e2', passou: true }),
      registro({ execucao: 'e3', passou: true }),
    ]);

    expect(medida?.estavel).toBe(true);
    expect(medida?.taxa).toBe(1);
    expect(medida?.passou).toBe(3);
    expect(medida?.execucoes).toBe(3);
  });

  it('marca como estável a pergunta que falhou em todas', () => {
    // Falhar sempre é ruim, mas é previsível — e previsível se conserta.
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', passou: false }),
      registro({ execucao: 'e2', passou: false }),
    ]);

    expect(medida?.estavel).toBe(true);
    expect(medida?.taxa).toBe(0);
  });

  it('marca como INSTÁVEL a pergunta que oscila', () => {
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', passou: true }),
      registro({ execucao: 'e2', passou: false }),
      registro({ execucao: 'e3', passou: true }),
    ]);

    expect(medida?.estavel).toBe(false);
    expect(medida?.taxa).toBeCloseTo(2 / 3, 10);
  });

  it('conta quantos textos de resposta diferentes o modelo produziu', () => {
    // Uma pergunta pode passar sempre e mesmo assim variar muito o texto —
    // informação que a acurácia esconde por completo.
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', resposta: 'Das 8h às 18h.' }),
      registro({ execucao: 'e2', resposta: 'Funcionamos das 8h às 18h.' }),
      registro({ execucao: 'e3', resposta: 'Das 8h às 18h.' }),
    ]);

    expect(medida?.respostasDistintas).toBe(2);
    expect(medida?.estavel).toBe(true);
  });

  it('ignora espaço em volta ao comparar respostas', () => {
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', resposta: 'Das 8h às 18h.' }),
      registro({ execucao: 'e2', resposta: '  Das 8h às 18h.  ' }),
    ]);

    expect(medida?.respostasDistintas).toBe(1);
  });

  it('mede a variação do best_score entre execuções', () => {
    const [medida] = medirEstabilidade([
      registro({ execucao: 'e1', melhorScore: 0.5 }),
      registro({ execucao: 'e2', melhorScore: 0.5 }),
    ]);

    // Mesmo embedding e mesmos chunks: o score não pode variar.
    expect(medida?.variacaoDeScore).toBe(0);

    const [outra] = medirEstabilidade([
      registro({ execucao: 'e1', melhorScore: 0.5 }),
      registro({ execucao: 'e2', melhorScore: 0.7 }),
    ]);
    expect(outra?.variacaoDeScore).toBeCloseTo(0.2, 10);
  });

  it('põe as instáveis primeiro, que é a ordem em que se quer ler', () => {
    const medidas = medirEstabilidade([
      registro({ id: 'sempre-ok', execucao: 'e1', passou: true }),
      registro({ id: 'sempre-ok', execucao: 'e2', passou: true }),
      registro({ id: 'oscila', execucao: 'e1', passou: true }),
      registro({ id: 'oscila', execucao: 'e2', passou: false }),
      registro({ id: 'sempre-falha', execucao: 'e1', passou: false }),
      registro({ id: 'sempre-falha', execucao: 'e2', passou: false }),
    ]);

    expect(medidas[0]?.id).toBe('oscila');
    // Entre as estáveis, as que falham vêm antes das que passam.
    expect(medidas[1]?.id).toBe('sempre-falha');
    expect(medidas[2]?.id).toBe('sempre-ok');
  });

  it('lida com lista vazia sem quebrar', () => {
    expect(medirEstabilidade([])).toEqual([]);
  });
});

describe('resumirEstabilidade', () => {
  it('separa sempre-passou, sempre-falhou e oscilou', () => {
    const resumo = resumirEstabilidade([
      registro({ id: 'a', execucao: 'e1', passou: true }),
      registro({ id: 'a', execucao: 'e2', passou: true }),
      registro({ id: 'b', execucao: 'e1', passou: false }),
      registro({ id: 'b', execucao: 'e2', passou: false }),
      registro({ id: 'c', execucao: 'e1', passou: true }),
      registro({ id: 'c', execucao: 'e2', passou: false }),
    ]);

    expect(resumo.perguntas).toBe(3);
    expect(resumo.execucoes).toBe(2);
    expect(resumo.semprePassaram).toBe(1);
    expect(resumo.sempreFalharam).toBe(1);
    expect(resumo.oscilaram).toBe(1);
    expect(resumo.taxaDeEstabilidade).toBeCloseTo(2 / 3, 10);
  });

  it('a acurácia média é a média das execuções, não do total de registros', () => {
    // Execução 1 acertou 2/2, execução 2 acertou 0/2. Média: 50%.
    const resumo = resumirEstabilidade([
      registro({ id: 'a', execucao: 'e1', passou: true }),
      registro({ id: 'b', execucao: 'e1', passou: true }),
      registro({ id: 'a', execucao: 'e2', passou: false }),
      registro({ id: 'b', execucao: 'e2', passou: false }),
    ]);

    expect(resumo.acuraciaMedia).toBe(0.5);
  });

  it('soma o custo de todas as rodadas', () => {
    const resumo = resumirEstabilidade([
      registro({ execucao: 'e1', custoUsd: 0.001 }),
      registro({ execucao: 'e2', custoUsd: 0.002 }),
    ]);

    expect(resumo.custoTotalUsd).toBeCloseTo(0.003, 10);
  });
});

describe('montarRelatorioDeEstabilidade', () => {
  it('destaca as perguntas que oscilaram', () => {
    const texto = montarRelatorioDeEstabilidade(
      [
        registro({ id: 'desconto', execucao: 'e1', passou: true }),
        registro({ id: 'desconto', execucao: 'e2', passou: false }),
      ],
      'clinica',
    );

    expect(texto).toContain('## Perguntas que oscilaram');
    expect(texto).toContain('`desconto`');
    expect(texto).toContain('1/2');
  });

  it('diz claramente quando nada oscilou', () => {
    const texto = montarRelatorioDeEstabilidade(
      [
        registro({ execucao: 'e1', passou: true }),
        registro({ execucao: 'e2', passou: true }),
      ],
      'clinica',
    );

    expect(texto).toContain('Nenhuma. Toda pergunta deu o mesmo resultado');
  });

  it('avisa que veredito estável não quer dizer texto idêntico', () => {
    // A distinção que mais confunde quem lê o relatório.
    const texto = montarRelatorioDeEstabilidade([registro()], 'clinica');
    expect(texto).toContain('respostas distintas');
  });
});
