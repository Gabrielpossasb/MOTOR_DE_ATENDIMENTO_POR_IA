/**
 * Testes da leitura, validação e gravação do `avaliacao.json`.
 *
 * Esta validação é a que protege o arquivo que o `npm run avaliar` lê: a página
 * de testes escreve nele. Um save inválido não quebraria só a página — tiraria
 * do ar a suíte que mede a qualidade do bot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  caminhoDaAvaliacao,
  lerAvaliacao,
  salvarAvaliacao,
  validarPerguntas,
} from '../src/core/avaliacao/arquivo.js';

/** Slug de descarte: a pasta é criada e apagada por teste. */
const SLUG = 'zz-tenant-de-teste';
const PASTA = config.caminhos.documentosTenant(SLUG);

const VALIDA = [{ id: 'preco', pergunta: 'quanto custa?', esperaHandoff: false }];

beforeEach(() => {
  fs.mkdirSync(PASTA, { recursive: true });
});

afterEach(() => {
  fs.rmSync(PASTA, { recursive: true, force: true });
});

describe('validarPerguntas', () => {
  it('aceita uma suíte mínima', () => {
    const { perguntas, erros, avisos } = validarPerguntas(VALIDA);

    expect(erros).toEqual([]);
    expect(avisos).toEqual([]);
    expect(perguntas).toEqual([{ id: 'preco', pergunta: 'quanto custa?', esperaHandoff: false }]);
  });

  it('aceita todos os campos de uma vez', () => {
    const { erros, perguntas } = validarPerguntas([
      {
        id: 'completa',
        pergunta: 'quanto custa a limpeza?',
        deveConter: ['180'],
        naoPodeConter: ['grátis'],
        esperaHandoff: false,
        fonteEsperada: 'servicos.md',
        comentario: 'por que existe',
      },
    ]);

    expect(erros).toEqual([]);
    expect(perguntas[0]?.deveConter).toEqual(['180']);
    expect(perguntas[0]?.fonteEsperada).toBe('servicos.md');
  });

  it('NOMEIA o campo desconhecido em vez de ignorá-lo', () => {
    // O caso que a regra existe para pegar: "deveConterr" com dois r não
    // afrouxaria o teste de um jeito visível — deixaria a pergunta passando
    // sem verificar nada, o que é pior que não ter teste.
    const { erros } = validarPerguntas([
      { id: 'a', pergunta: 'p?', deveConterr: ['180'] },
    ]);

    expect(erros.some((e) => e.includes('deveConterr'))).toBe(true);
  });

  it('recusa id repetido', () => {
    // O histórico agrupa por id: dois iguais viram uma pergunta só no
    // relatório, e a trajetória das duas fica sem sentido.
    const { erros } = validarPerguntas([
      { id: 'mesmo', pergunta: 'primeira?' },
      { id: 'mesmo', pergunta: 'segunda?' },
    ]);

    expect(erros.some((e) => e.includes('repetido'))).toBe(true);
  });

  it('recusa id com pipe, que quebraria a tabela do relatório', () => {
    const { erros } = validarPerguntas([{ id: 'a|b', pergunta: 'p?' }]);
    expect(erros).toHaveLength(1);
  });

  it('exige id e pergunta', () => {
    expect(validarPerguntas([{ pergunta: 'sem id?' }]).erros).toHaveLength(1);
    expect(validarPerguntas([{ id: 'sem-pergunta' }]).erros).toHaveLength(1);
    expect(validarPerguntas([{ id: '   ', pergunta: 'p?' }]).erros).toHaveLength(1);
  });

  it('recusa lista vazia, para um clique não apagar a suíte', () => {
    expect(validarPerguntas([]).erros).toHaveLength(1);
  });

  it('recusa o que não é lista', () => {
    expect(validarPerguntas(undefined).erros).toHaveLength(1);
    expect(validarPerguntas({ id: 'a' }).erros).toHaveLength(1);
    expect(validarPerguntas('perguntas').erros).toHaveLength(1);
  });

  it('recusa item que não é objeto', () => {
    expect(validarPerguntas(['uma pergunta solta']).erros).toHaveLength(1);
  });

  it('recusa esperaHandoff que não é booleano', () => {
    const { erros } = validarPerguntas([{ id: 'a', pergunta: 'p?', esperaHandoff: 'sim' }]);
    expect(erros.some((e) => e.includes('esperaHandoff'))).toBe(true);
  });

  it('recusa deveConter que não é lista de textos', () => {
    expect(validarPerguntas([{ id: 'a', pergunta: 'p?', deveConter: '180' }]).erros).toHaveLength(1);
    expect(validarPerguntas([{ id: 'a', pergunta: 'p?', deveConter: [180] }]).erros).toHaveLength(1);
  });

  it('descarta linha em branco da caixa de texto, que não é regra', () => {
    const { erros, perguntas } = validarPerguntas([
      { id: 'a', pergunta: 'p?', deveConter: ['180', '   ', ''] },
    ]);

    expect(erros).toEqual([]);
    expect(perguntas[0]?.deveConter).toEqual(['180']);
  });

  it('avisa que deveConter não vai ser checado em pergunta que espera handoff', () => {
    // `verificar()` só cobra conteúdo de resposta que deveria existir. Sem o
    // aviso, quem escreveu a regra acha que está testando algo e não está.
    const { erros, avisos } = validarPerguntas([
      { id: 'cnpj', pergunta: 'qual o CNPJ?', esperaHandoff: true, deveConter: ['12'] },
    ]);

    expect(erros).toEqual([]);
    expect(avisos.some((a) => a.includes('deveConter'))).toBe(true);
  });

  it('avisa o mesmo sobre fonteEsperada', () => {
    const { avisos } = validarPerguntas([
      { id: 'cnpj', pergunta: 'qual o CNPJ?', esperaHandoff: true, fonteEsperada: 'faq.md' },
    ]);

    expect(avisos.some((a) => a.includes('fonteEsperada'))).toBe(true);
  });

  it('apara espaços e omite os campos vazios', () => {
    const { perguntas } = validarPerguntas([
      { id: '  preco  ', pergunta: '  quanto custa?  ', fonteEsperada: '   ', comentario: '' },
    ]);

    expect(perguntas[0]?.id).toBe('preco');
    expect(perguntas[0]?.pergunta).toBe('quanto custa?');
    expect(perguntas[0]).not.toHaveProperty('fonteEsperada');
    expect(perguntas[0]).not.toHaveProperty('comentario');
  });

  it('acumula os erros de todas as perguntas, não só da primeira', () => {
    const { erros } = validarPerguntas([{ id: '', pergunta: 'a?' }, { id: 'b' }]);
    expect(erros.length).toBeGreaterThanOrEqual(2);
  });
});

describe('gravar e ler o arquivo', () => {
  it('sobrevive à ida e volta preservando descrição e perguntas', () => {
    salvarAvaliacao(SLUG, { descricao: 'suíte de teste', perguntas: VALIDA });
    const lido = lerAvaliacao(SLUG);

    expect(lido.existe).toBe(true);
    expect(lido.descricao).toBe('suíte de teste');
    expect(lido.perguntas).toEqual(VALIDA);
  });

  it('grava JSON indentado e com quebra de linha final', () => {
    // O arquivo é versionado e lido por humanos; JSON numa linha só geraria
    // diff ilegível a cada mudança de uma pergunta.
    salvarAvaliacao(SLUG, { perguntas: VALIDA });
    const conteudo = fs.readFileSync(caminhoDaAvaliacao(SLUG), 'utf8');

    expect(conteudo).toContain('\n  "perguntas"');
    expect(conteudo.endsWith('\n')).toBe(true);
  });

  it('não deixa arquivo temporário para trás', () => {
    // A gravação é "escreve no .tmp e renomeia" para o arquivo nunca ficar
    // meio escrito. O .tmp não pode sobrar na pasta do cliente.
    salvarAvaliacao(SLUG, { perguntas: VALIDA });

    expect(fs.readdirSync(PASTA)).toEqual(['avaliacao.json']);
  });

  it('trata tenant sem arquivo como lista vazia, e não como erro', () => {
    const lido = lerAvaliacao(SLUG);

    expect(lido.existe).toBe(false);
    expect(lido.perguntas).toEqual([]);
  });

  it('lança quando a pasta do tenant não existe', () => {
    expect(() => salvarAvaliacao('tenant-que-nao-existe', { perguntas: VALIDA })).toThrow(
      /não existe/,
    );
  });

  it('lança em JSON inválido em vez de fingir suíte vazia', () => {
    fs.writeFileSync(caminhoDaAvaliacao(SLUG), '{ "perguntas": [', 'utf8');

    expect(() => lerAvaliacao(SLUG)).toThrow(/não é JSON válido/);
  });

  it('lança quando o arquivo no disco tem campo desconhecido', () => {
    // Vale para o `npm run avaliar` também: uma edição à mão que escreve o
    // campo errado para de rodar em vez de passar sem checar nada.
    fs.writeFileSync(
      caminhoDaAvaliacao(SLUG),
      JSON.stringify({ perguntas: [{ id: 'a', pergunta: 'p?', fonte: 'faq.md' }] }),
      'utf8',
    );

    expect(() => lerAvaliacao(SLUG)).toThrow(/fonte/);
  });
});

describe('os arquivos de avaliação que estão no projeto', () => {
  // Guarda de regressão: pega uma edição à mão que quebraria a suíte, sem
  // precisar gastar uma rodada de API para descobrir.
  const pastaDeTenants = path.dirname(config.caminhos.documentosTenant('x'));

  const slugs = fs.existsSync(pastaDeTenants)
    ? fs
        .readdirSync(pastaDeTenants, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== SLUG)
        .map((e) => e.name)
        .filter((slug) => fs.existsSync(caminhoDaAvaliacao(slug)))
    : [];

  it.each(slugs)('%s tem avaliacao.json válido', (slug) => {
    const lido = lerAvaliacao(slug);

    expect(lido.perguntas.length).toBeGreaterThan(0);
  });

  it('achou pelo menos um tenant para conferir', () => {
    // Se a pasta de tenants sumir, o `it.each` acima roda zero casos e o
    // arquivo passaria verde sem ter verificado nada.
    expect(slugs.length).toBeGreaterThan(0);
  });
});
