import { describe, expect, it } from 'vitest';
import { dividirEmChunks } from '../src/core/rag/chunker.js';

describe('dividirEmChunks', () => {
  it('devolve lista vazia para texto vazio ou só espaços', () => {
    expect(dividirEmChunks('')).toEqual([]);
    expect(dividirEmChunks('   \n\n  \n ')).toEqual([]);
  });

  it('mantém um texto curto num chunk só', () => {
    const chunks = dividirEmChunks('A clínica abre às 8h.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.texto).toBe('A clínica abre às 8h.');
    expect(chunks[0]?.indice).toBe(0);
  });

  it('numera os chunks em sequência a partir de zero', () => {
    const texto = Array.from({ length: 12 }, (_, i) => `Parágrafo número ${i} com um texto de tamanho razoável aqui.`).join('\n\n');
    const chunks = dividirEmChunks(texto, { tamanhoAlvo: 120, sobreposicao: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.indice)).toEqual(chunks.map((_, i) => i));
  });

  it('nunca junta conteúdo de seções diferentes no mesmo chunk', () => {
    const texto = [
      '# Horários',
      'Segunda a sexta das 8h às 18h.',
      '',
      '# Convênios',
      'Atendemos Amil Dental e Odontoprev.',
    ].join('\n');

    const chunks = dividirEmChunks(texto);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.secao).toBe('Horários');
    expect(chunks[1]?.secao).toBe('Convênios');
    expect(chunks[0]?.texto).not.toContain('Odontoprev');
    expect(chunks[1]?.texto).not.toContain('18h');
  });

  it('repete o título da seção dentro do texto do chunk', () => {
    // O título é sinal forte para a busca: "Horários" precisa estar no vetor.
    const chunks = dividirEmChunks('## Horário de atendimento\nAbrimos às 8h.');
    expect(chunks[0]?.texto.startsWith('Horário de atendimento')).toBe(true);
  });

  it('reconhece títulos de # até ######', () => {
    const texto = ['# Um', 'a', '', '###### Seis', 'b'].join('\n');
    const secoes = dividirEmChunks(texto).map((c) => c.secao);
    expect(secoes).toEqual(['Um', 'Seis']);
  });

  it('trata texto antes do primeiro título como seção sem título', () => {
    const chunks = dividirEmChunks('Introdução solta.\n\n# Seção\nCorpo.');
    expect(chunks[0]?.secao).toBeUndefined();
    expect(chunks[1]?.secao).toBe('Seção');
  });

  it('reconhece título em texto puro: linha curta e isolada, sem ponto final', () => {
    // Um .txt sem markdown não pode virar uma seção única gigante.
    const texto = [
      'Horário de atendimento',
      '',
      'Funcionamos de segunda a sexta, das 8h às 18h.',
      '',
      'Contato',
      '',
      'Telefone: (67) 3321-4400.',
    ].join('\n');

    const chunks = dividirEmChunks(texto);

    expect(chunks.map((c) => c.secao)).toEqual(['Horário de atendimento', 'Contato']);
    expect(chunks[0]?.texto).not.toContain('Telefone');
  });

  it('não confunde frase curta com título', () => {
    // Termina em ponto: é corpo, não título.
    const chunks = dividirEmChunks('Abrimos às 8h.\n\nFechamos às 18h.');
    expect(chunks.every((c) => c.secao === undefined)).toBe(true);
  });

  it('não trata item de lista nem linha longa como título', () => {
    const texto = [
      '- Amil Dental',
      '',
      'Esta linha é longa demais para ser considerada um título de seção em texto puro',
      '',
      'Convênios',
      '',
      'Atendemos Amil e Odontoprev.',
    ].join('\n');

    const secoes = dividirEmChunks(texto).map((c) => c.secao);
    expect(secoes).toEqual([undefined, 'Convênios']);
  });

  it('descarta título que não tem corpo nenhum embaixo', () => {
    const chunks = dividirEmChunks('Seção vazia\n\n# Outra\n\nCom corpo.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.secao).toBe('Outra');
  });

  it('respeita o tamanho alvo, com folga para o overlap e o título', () => {
    const paragrafo = 'Esta é uma frase de tamanho médio usada para encher o documento de teste. ';
    const texto = paragrafo.repeat(40);

    const alvo = 300;
    const sobreposicao = 50;
    const chunks = dividirEmChunks(texto, { tamanhoAlvo: alvo, sobreposicao });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      // Alvo + overlap + uma frase de borda é o teto realista.
      expect(chunk.texto.length).toBeLessThanOrEqual(alvo + sobreposicao + 100);
    }
  });

  it('sobrepõe o final do chunk anterior no começo do seguinte', () => {
    const texto = Array.from({ length: 10 }, (_, i) => `Bloco ${i}: informação importante que precisa de contexto.`).join('\n\n');
    const chunks = dividirEmChunks(texto, { tamanhoAlvo: 110, sobreposicao: 40 });

    expect(chunks.length).toBeGreaterThan(2);

    const primeiro = chunks[0]?.texto as string;
    const segundo = chunks[1]?.texto as string;
    const cauda = primeiro.slice(-20);

    expect(segundo).toContain(cauda);
  });

  it('não sobrepõe quando a sobreposição é zero', () => {
    const texto = Array.from({ length: 6 }, (_, i) => `Bloco ${i} com conteúdo suficiente para separar.`).join('\n\n');
    const chunks = dividirEmChunks(texto, { tamanhoAlvo: 100, sobreposicao: 0 });

    expect(chunks[1]?.texto.startsWith('Bloco')).toBe(true);
  });

  it('quebra em frases um parágrafo maior que o alvo', () => {
    const frase = 'Cada frase deste parágrafo termina com ponto final. ';
    const chunks = dividirEmChunks(frase.repeat(20), { tamanhoAlvo: 150, sobreposicao: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    // Nenhum chunk pode começar no meio de uma palavra.
    for (const chunk of chunks) {
      expect(chunk.texto.startsWith('Cada')).toBe(true);
    }
  });

  it('corta no espaço quando uma única frase estoura o alvo', () => {
    const fraseGigante = 'palavra '.repeat(200).trim();
    const chunks = dividirEmChunks(fraseGigante, { tamanhoAlvo: 100, sobreposicao: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Se tivesse cortado no meio, apareceria "palavr" ou "alavra".
      const palavras = chunk.texto.split(/\s+/).filter((p) => p.length > 0);
      expect(palavras.every((p) => p === 'palavra')).toBe(true);
    }
  });

  it('não deixa uma sobra minúscula como chunk isolado', () => {
    const texto = `${'a '.repeat(150).trim()}\n\nfim.`;
    const chunks = dividirEmChunks(texto, { tamanhoAlvo: 200, sobreposicao: 0, tamanhoMinimo: 50 });

    expect(chunks.at(-1)?.texto.length).toBeGreaterThanOrEqual(50);
    expect(chunks.at(-1)?.texto).toContain('fim.');
  });

  it('recusa sobreposição maior ou igual ao tamanho alvo', () => {
    expect(() => dividirEmChunks('texto', { tamanhoAlvo: 100, sobreposicao: 100 })).toThrow(
      /menor que o tamanho alvo/,
    );
  });

  it('normaliza quebras de linha do Windows', () => {
    const chunks = dividirEmChunks('# Título\r\nCorpo da seção.\r\n');
    expect(chunks[0]?.secao).toBe('Título');
    expect(chunks[0]?.texto).not.toContain('\r');
  });
});
