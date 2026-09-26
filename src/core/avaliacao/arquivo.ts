/**
 * Leitura, validação e gravação do `avaliacao.json` de um tenant.
 *
 * A validação é o coração deste arquivo, e existe porque a página de testes
 * ESCREVE aqui. Um save inválido não quebraria só a página: quebraria o
 * `npm run avaliar`, que é o sistema de registro da qualidade do projeto.
 *
 * Duas regras merecem explicação, porque as duas nasceram de armadilha real:
 *
 *  - **Campo desconhecido é erro, não é ignorado.** Escrever `deveConterr` em
 *    vez de `deveConter` não deixaria o teste mais frouxo de um jeito visível:
 *    deixaria a pergunta passando sem verificar nada. Um teste que passa à toa
 *    é pior que teste nenhum, porque dá confiança falsa.
 *  - **Id não pode ter `|`.** O id entra em tabela markdown nos relatórios
 *    (`| \`horario-sabado\` | 5/5 |`). Um pipe no meio quebraria a tabela do
 *    `ESTABILIDADE.md` em silêncio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import type { PerguntaDeAvaliacao } from './regras.js';

export interface ArquivoDeAvaliacao {
  descricao?: string;
  perguntas: PerguntaDeAvaliacao[];
}

export interface ResultadoDaValidacao {
  /** As perguntas já normalizadas. Só use se `erros` estiver vazio. */
  perguntas: PerguntaDeAvaliacao[];
  /** Impedem salvar e impedem rodar. */
  erros: string[];
  /** Não impedem nada, mas apontam regra que não vai ser checada. */
  avisos: string[];
}

/** Os únicos campos que uma pergunta pode ter. Ver o comentário do topo. */
const CAMPOS_VALIDOS = [
  'id',
  'pergunta',
  'deveConter',
  'naoPodeConter',
  'esperaHandoff',
  'fonteEsperada',
  'comentario',
] as const;

const TAMANHO_MAXIMO_DO_ID = 60;
const TAMANHO_MAXIMO_DA_PERGUNTA = 500;

export function caminhoDaAvaliacao(slug: string): string {
  return path.join(config.caminhos.documentosTenant(slug), 'avaliacao.json');
}

/**
 * Lê o `avaliacao.json` do tenant.
 *
 * Arquivo ausente devolve lista vazia — um tenant novo simplesmente ainda não
 * tem perguntas, e a página deve poder criar a primeira. JSON inválido, ao
 * contrário, lança: é um erro que você precisa ver, não esconder.
 */
export function lerAvaliacao(slug: string): ArquivoDeAvaliacao & { existe: boolean } {
  const arquivo = caminhoDaAvaliacao(slug);
  if (!fs.existsSync(arquivo)) return { existe: false, perguntas: [] };

  let bruto: unknown;
  try {
    bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (erro) {
    throw new Error(
      `O avaliacao.json de "${slug}" não é JSON válido: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  const objeto = (bruto ?? {}) as Record<string, unknown>;
  const { perguntas, erros } = validarPerguntas(objeto.perguntas);
  if (erros.length > 0) {
    throw new Error(`O avaliacao.json de "${slug}" tem problemas:\n- ${erros.join('\n- ')}`);
  }

  return {
    existe: true,
    ...(typeof objeto.descricao === 'string' ? { descricao: objeto.descricao } : {}),
    perguntas,
  };
}

/** Valida e normaliza a lista de perguntas vinda de fora (arquivo ou HTTP). */
export function validarPerguntas(bruto: unknown): ResultadoDaValidacao {
  const erros: string[] = [];
  const avisos: string[] = [];

  if (!Array.isArray(bruto)) {
    return { perguntas: [], erros: ['"perguntas" precisa ser uma lista.'], avisos };
  }

  // Salvar zero perguntas apagaria a suíte inteira, e quase sempre isso é um
  // acidente e não uma intenção. Para começar de novo, apague o arquivo.
  if (bruto.length === 0) {
    return { perguntas: [], erros: ['A lista de perguntas está vazia.'], avisos };
  }

  const perguntas: PerguntaDeAvaliacao[] = [];
  const idsVistos = new Set<string>();

  bruto.forEach((item, indice) => {
    const onde = `pergunta ${indice + 1}`;

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      erros.push(`${onde}: deveria ser um objeto.`);
      return;
    }

    const bruta = item as Record<string, unknown>;

    for (const campo of Object.keys(bruta)) {
      if (!(CAMPOS_VALIDOS as readonly string[]).includes(campo)) {
        erros.push(
          `${onde}: campo desconhecido "${campo}". Os válidos são: ${CAMPOS_VALIDOS.join(', ')}.`,
        );
      }
    }

    const id = typeof bruta.id === 'string' ? bruta.id.trim() : '';
    if (id.length === 0) {
      erros.push(`${onde}: "id" é obrigatório.`);
    } else if (id.length > TAMANHO_MAXIMO_DO_ID) {
      erros.push(`${onde}: "id" passa de ${TAMANHO_MAXIMO_DO_ID} caracteres.`);
    } else if (/[|\n\r`]/.test(id)) {
      erros.push(`${onde}: "id" não pode conter | nem acento grave nem quebra de linha.`);
    } else if (idsVistos.has(id)) {
      // O histórico agrupa por id: dois iguais viram uma pergunta só nos
      // relatórios, e a trajetória de ambas fica sem sentido.
      erros.push(`${onde}: o id "${id}" está repetido.`);
    } else {
      idsVistos.add(id);
    }

    const pergunta = typeof bruta.pergunta === 'string' ? bruta.pergunta.trim() : '';
    if (pergunta.length === 0) {
      erros.push(`${onde} ("${id}"): "pergunta" é obrigatória.`);
    } else if (pergunta.length > TAMANHO_MAXIMO_DA_PERGUNTA) {
      erros.push(`${onde} ("${id}"): a pergunta passa de ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`);
    }

    const deveConter = listaDeTextos(bruta.deveConter, `${onde} ("${id}"): "deveConter"`, erros);
    const naoPodeConter = listaDeTextos(
      bruta.naoPodeConter,
      `${onde} ("${id}"): "naoPodeConter"`,
      erros,
    );

    if (bruta.esperaHandoff !== undefined && typeof bruta.esperaHandoff !== 'boolean') {
      erros.push(`${onde} ("${id}"): "esperaHandoff" precisa ser true ou false.`);
    }

    for (const campo of ['fonteEsperada', 'comentario'] as const) {
      if (bruta[campo] !== undefined && typeof bruta[campo] !== 'string') {
        erros.push(`${onde} ("${id}"): "${campo}" precisa ser texto.`);
      }
    }

    // `verificar()` só cobra conteúdo de resposta que deveria existir. Numa
    // pergunta que espera handoff, estas regras nunca rodam — quem escreveu
    // acha que está testando algo e não está.
    if (bruta.esperaHandoff === true) {
      if (deveConter.length > 0) {
        avisos.push(`"${id}": espera handoff, então "deveConter" não vai ser checado.`);
      }
      if (typeof bruta.fonteEsperada === 'string' && bruta.fonteEsperada.length > 0) {
        avisos.push(`"${id}": espera handoff, então "fonteEsperada" não vai ser checado.`);
      }
    }

    const fonteEsperada = typeof bruta.fonteEsperada === 'string' ? bruta.fonteEsperada.trim() : '';
    const comentario = typeof bruta.comentario === 'string' ? bruta.comentario.trim() : '';

    perguntas.push({
      id,
      pergunta,
      ...(deveConter.length > 0 ? { deveConter } : {}),
      ...(naoPodeConter.length > 0 ? { naoPodeConter } : {}),
      ...(typeof bruta.esperaHandoff === 'boolean' ? { esperaHandoff: bruta.esperaHandoff } : {}),
      ...(fonteEsperada.length > 0 ? { fonteEsperada } : {}),
      ...(comentario.length > 0 ? { comentario } : {}),
    });
  });

  return { perguntas, erros, avisos };
}

/** Lê um campo que deve ser lista de textos, descartando entradas vazias. */
function listaDeTextos(valor: unknown, onde: string, erros: string[]): string[] {
  if (valor === undefined) return [];

  if (!Array.isArray(valor)) {
    erros.push(`${onde} precisa ser uma lista de textos.`);
    return [];
  }

  const textos: string[] = [];
  for (const item of valor) {
    if (typeof item !== 'string') {
      erros.push(`${onde} tem um item que não é texto.`);
      continue;
    }
    // Linha em branco na caixa de texto da página não é uma regra.
    if (item.trim().length > 0) textos.push(item.trim());
  }

  return textos;
}

/**
 * Grava o arquivo do tenant.
 *
 * Escreve num temporário e renomeia: se o processo morrer no meio, o
 * `avaliacao.json` continua sendo o antigo e válido, em vez de virar meio
 * arquivo que nem o `npm run avaliar` nem a página conseguem ler.
 */
export function salvarAvaliacao(slug: string, dados: ArquivoDeAvaliacao): string {
  const destino = caminhoDaAvaliacao(slug);
  const pasta = path.dirname(destino);

  if (!fs.existsSync(pasta)) {
    throw new Error(`A pasta do tenant "${slug}" não existe: ${pasta}`);
  }

  const conteudo = `${JSON.stringify(
    {
      ...(dados.descricao ? { descricao: dados.descricao } : {}),
      perguntas: dados.perguntas,
    },
    null,
    2,
  )}\n`;

  const temporario = `${destino}.tmp`;
  fs.writeFileSync(temporario, conteudo, 'utf8');
  fs.renameSync(temporario, destino);

  return destino;
}
