/**
 * Testes da seleção de arquivos da ingestão.
 *
 * A regra do prefixo `_` nasceu de um erro real: o `_LEIA-ME.md` gerado pelo
 * scaffold foi ingerido como base de conhecimento, e o bot de uma barbearia
 * passou a "saber" responder sobre `npm run seed`. Dez dos dezessete chunks
 * eram o manual.
 */
import { describe, expect, it } from 'vitest';
import { ehArquivoDeApoio, selecionarArquivos } from '../src/scripts/ingest.js';
import { sugerirLimiar } from '../src/scripts/calibrar.js';

describe('selecionarArquivos', () => {
  it('aceita .txt e .md', () => {
    expect(selecionarArquivos(['faq.md', 'horarios.txt'])).toEqual(['faq.md', 'horarios.txt']);
  });

  it('ignora extensões que não sabemos ler', () => {
    // tenant.json e avaliacao.json moram na mesma pasta e são configuração,
    // não conteúdo: ingeri-los ensinaria o bot a falar sobre si mesmo.
    expect(selecionarArquivos(['tenant.json', 'avaliacao.json', 'tabela.pdf', 'faq.md'])).toEqual([
      'faq.md',
    ]);
  });

  it('IGNORA arquivo começando com _', () => {
    expect(selecionarArquivos(['_LEIA-ME.md', '_rascunho.txt', 'servicos.md'])).toEqual([
      'servicos.md',
    ]);
  });

  it('devolve em ordem alfabética, para a ingestão ser previsível', () => {
    expect(selecionarArquivos(['zebra.md', 'abacate.txt', 'meio.md'])).toEqual([
      'abacate.txt',
      'meio.md',
      'zebra.md',
    ]);
  });

  it('aceita extensão em maiúscula', () => {
    expect(selecionarArquivos(['FAQ.MD', 'NOTAS.TXT'])).toEqual(['FAQ.MD', 'NOTAS.TXT']);
  });

  it('devolve lista vazia quando não há nada ingerível', () => {
    expect(selecionarArquivos(['tenant.json', '_LEIA-ME.md'])).toEqual([]);
  });
});

describe('ehArquivoDeApoio', () => {
  it('reconhece o prefixo de apoio', () => {
    expect(ehArquivoDeApoio('_LEIA-ME.md')).toBe(true);
    expect(ehArquivoDeApoio('_notas-internas.txt')).toBe(true);
  });

  it('não confunde underscore no meio do nome', () => {
    expect(ehArquivoDeApoio('tabela_de_precos.md')).toBe(false);
    expect(ehArquivoDeApoio('faq.md')).toBe(false);
  });
});

describe('sugerirLimiar', () => {
  function medida(id: string, score: number, deveResponder: boolean) {
    return { id, pergunta: id, deveResponder, score };
  }

  it('quando os grupos NÃO se sobrepõem, sugere o meio do vale', () => {
    const r = sugerirLimiar([
      medida('boa-1', 0.6, true),
      medida('boa-2', 0.7, true),
      medida('ruim-1', 0.3, false),
      medida('ruim-2', 0.4, false),
    ]);

    expect(r.separaBem).toBe(true);
    expect(r.sugestao).toBeCloseTo(0.5, 3);
  });

  it('quando se sobrepõem, fica ABAIXO da pergunta legítima mais fraca', () => {
    // Barrar um cliente de verdade é pior que deixar passar uma pergunta que o
    // LLM vai recusar de qualquer forma.
    const r = sugerirLimiar([
      medida('boa', 0.42, true),
      medida('ruim', 0.59, false),
    ]);

    expect(r.separaBem).toBe(false);
    expect(r.sugestao).toBeLessThan(0.42);
    expect(r.sugestao).toBeCloseTo(0.4, 3);
  });

  it('nunca sugere limiar negativo', () => {
    expect(sugerirLimiar([medida('boa', 0.01, true), medida('ruim', 0.5, false)]).sugestao)
      .toBeGreaterThanOrEqual(0);
  });

  it('lida com um grupo vazio sem quebrar', () => {
    expect(() => sugerirLimiar([medida('boa', 0.5, true)])).not.toThrow();
    expect(() => sugerirLimiar([])).not.toThrow();
  });
});
