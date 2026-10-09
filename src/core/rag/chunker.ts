/**
 * Divisão de documentos em chunks.
 *
 * Estratégia, do mais forte para o mais fraco:
 *   1. Nunca atravessar um título de seção — cada chunk pertence a uma seção só.
 *      Título é "# markdown" ou, em .txt, uma linha curta e sem pontuação final
 *      isolada por linhas em branco.
 *   2. Dentro da seção, agrupar parágrafos inteiros até chegar perto do alvo.
 *   3. Parágrafo maior que o alvo sozinho é quebrado em frases.
 *   4. Frase absurdamente longa é cortada no espaço mais próximo, nunca no meio
 *      de uma palavra.
 *
 * O overlap (últimos N caracteres do chunk anterior) evita que uma informação
 * que cai exatamente na borda entre dois chunks fique sem contexto em nenhum
 * dos dois.
 */
import { config } from '../../config.js';

export interface ChunkCru {
  texto: string;
  indice: number;
  /** Título da seção de onde veio, quando o documento tem títulos markdown. */
  secao?: string;
}

export interface OpcoesDeChunking {
  tamanhoAlvo?: number;
  sobreposicao?: number;
  tamanhoMinimo?: number;
}

interface Secao {
  titulo?: string;
  corpo: string;
}

/** Quebra o documento em chunks prontos para virar embedding. */
export function dividirEmChunks(texto: string, opcoes: OpcoesDeChunking = {}): ChunkCru[] {
  const tamanhoAlvo = opcoes.tamanhoAlvo ?? config.chunking.tamanhoAlvo;
  const sobreposicao = opcoes.sobreposicao ?? config.chunking.sobreposicao;
  const tamanhoMinimo = opcoes.tamanhoMinimo ?? config.chunking.tamanhoMinimo;

  if (sobreposicao >= tamanhoAlvo) {
    throw new Error('A sobreposição precisa ser menor que o tamanho alvo do chunk.');
  }

  const normalizado = semComentarios(texto.replace(/\r\n/g, '\n')).trim();
  if (normalizado.length === 0) return [];

  const chunks: ChunkCru[] = [];

  for (const secao of separarSecoes(normalizado)) {
    const pedacos = agruparParagrafos(secao.corpo, tamanhoAlvo, tamanhoMinimo);

    for (const pedaco of pedacos) {
      // O overlap vem do chunk anterior apenas se ele for da mesma seção.
      const anterior = chunks.at(-1);
      const mesmaSecao = anterior !== undefined && anterior.secao === secao.titulo;
      const prefixo = mesmaSecao && sobreposicao > 0 ? caudaDe(anterior.texto, sobreposicao) : '';

      const corpo = prefixo.length > 0 ? `${prefixo} ${pedaco}` : pedaco;
      // O título entra no texto do chunk: "Horários" sozinho no metadado não
      // ajuda a busca, mas dentro do texto vira sinal para o embedding.
      const textoFinal = secao.titulo ? `${secao.titulo}\n${corpo}` : corpo;

      chunks.push({
        texto: textoFinal,
        indice: chunks.length,
        ...(secao.titulo !== undefined ? { secao: secao.titulo } : {}),
      });
    }
  }

  return chunks;
}

/**
 * Tira os comentários de markdown (`<!-- ... -->`) antes de qualquer coisa.
 *
 * Comentário é anotação para quem EDITA o documento: ele não aparece no
 * markdown renderizado, então nem a pessoa que lê o arquivo o vê. Deixá-lo
 * virar chunk é transformar recado interno em conhecimento do negócio — e isso
 * já quase aconteceu: um marcador `<!-- MUDA DE ESTADO: troque o parágrafo
 * acima e rode npm run ingest -->` foi indexado junto das formas de pagamento,
 * e o bot poderia muito bem responder sobre `npm run ingest` a um cliente
 * perguntando se aceita cartão.
 *
 * É o mesmo motivo do prefixo `_` nos nomes de arquivo, um nível abaixo: ali o
 * arquivo inteiro fica fora, aqui um trecho dele.
 *
 * Com isso o comentário passa a ser o jeito OFICIAL de anotar documento de
 * cliente — nota de manutenção que o bot nunca lê.
 */
function semComentarios(texto: string): string {
  // `[\s\S]` em vez de `.` porque comentário de markdown ocupa várias linhas, e
  // não-guloso para dois comentários seguidos não virarem um só, engolindo o
  // conteúdo entre eles.
  return texto.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Separa o documento por títulos (markdown ou texto puro).
 * Texto antes do primeiro título vira uma seção sem título.
 */
function separarSecoes(texto: string): Secao[] {
  const linhas = texto.split('\n');
  const secoes: Secao[] = [];

  let tituloAtual: string | undefined;
  let corpoAtual: string[] = [];

  const fechar = () => {
    const corpo = corpoAtual.join('\n').trim();
    if (corpo.length > 0) {
      secoes.push(tituloAtual !== undefined ? { titulo: tituloAtual, corpo } : { corpo });
    }
    corpoAtual = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] as string;
    const titulo = tituloDaLinha(linha, linhas[i - 1], linhas[i + 1]);

    if (titulo !== undefined) {
      fechar();
      tituloAtual = titulo;
    } else {
      corpoAtual.push(linha);
    }
  }
  fechar();

  return secoes;
}

/** Comprimento máximo de uma linha para ela ainda poder ser título de .txt. */
const MAXIMO_DE_UM_TITULO = 60;

/**
 * Decide se a linha é um título e devolve seu texto.
 *
 * Markdown é inequívoco. Em .txt usamos uma heurística conservadora: linha
 * curta, sem pontuação de fim de frase, isolada por linhas em branco (ou no
 * começo do arquivo). É assim que as pessoas separam assuntos num bloco de
 * notas — e sem isso um .txt inteiro vira uma seção só.
 */
function tituloDaLinha(
  linha: string,
  anterior: string | undefined,
  seguinte: string | undefined,
): string | undefined {
  const markdown = /^#{1,6}\s+(.*\S)\s*$/.exec(linha);
  if (markdown) return markdown[1];

  const conteudo = linha.trim();
  if (conteudo.length === 0 || conteudo.length > MAXIMO_DE_UM_TITULO) return undefined;

  // Pontuação de fim de frase, dois pontos ou marcador de lista denotam corpo.
  if (/[.,;:!?]$/.test(conteudo)) return undefined;
  if (/^[-*•\d]/.test(conteudo)) return undefined;

  const precedidaDeBranco = anterior === undefined || anterior.trim().length === 0;
  const seguidaDeBranco = seguinte === undefined || seguinte.trim().length === 0;

  return precedidaDeBranco && seguidaDeBranco ? conteudo : undefined;
}

/**
 * Agrupa parágrafos em pedaços de tamanho próximo ao alvo.
 * Um pedaço só fecha quando somar mais um parágrafo estouraria o alvo.
 */
function agruparParagrafos(corpo: string, tamanhoAlvo: number, tamanhoMinimo: number): string[] {
  const paragrafos = corpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pedacos: string[] = [];
  let atual = '';

  const fechar = () => {
    if (atual.trim().length > 0) pedacos.push(atual.trim());
    atual = '';
  };

  for (const paragrafo of paragrafos) {
    // Parágrafo grande demais: quebra em frases e trata cada uma como unidade.
    const unidades = paragrafo.length > tamanhoAlvo ? quebrarEmFrases(paragrafo, tamanhoAlvo) : [paragrafo];

    for (const unidade of unidades) {
      if (atual.length === 0) {
        atual = unidade;
      } else if (atual.length + unidade.length + 1 <= tamanhoAlvo) {
        atual = `${atual}\n${unidade}`;
      } else {
        fechar();
        atual = unidade;
      }
    }
  }
  fechar();

  // Um resto pequeno sozinho no fim vira um chunk sem contexto nenhum;
  // é melhor grudá-lo no anterior mesmo passando um pouco do alvo.
  if (pedacos.length >= 2) {
    const ultimo = pedacos.at(-1) as string;
    if (ultimo.length < tamanhoMinimo) {
      pedacos.pop();
      pedacos[pedacos.length - 1] = `${pedacos.at(-1) as string}\n${ultimo}`;
    }
  }

  return pedacos;
}

/** Quebra um parágrafo longo em frases, juntando-as até o tamanho alvo. */
function quebrarEmFrases(paragrafo: string, tamanhoAlvo: number): string[] {
  const frases = paragrafo.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [paragrafo];

  const unidades: string[] = [];
  let atual = '';

  for (const bruta of frases) {
    const frase = bruta.trim();
    if (frase.length === 0) continue;

    if (frase.length > tamanhoAlvo) {
      // Frase única maior que o alvo: corta no espaço, nunca no meio da palavra.
      if (atual.length > 0) {
        unidades.push(atual);
        atual = '';
      }
      unidades.push(...cortarPorEspaco(frase, tamanhoAlvo));
      continue;
    }

    if (atual.length === 0) {
      atual = frase;
    } else if (atual.length + frase.length + 1 <= tamanhoAlvo) {
      atual = `${atual} ${frase}`;
    } else {
      unidades.push(atual);
      atual = frase;
    }
  }
  if (atual.length > 0) unidades.push(atual);

  return unidades;
}

/** Fatia um texto em partes de no máximo `tamanho`, cortando em espaços. */
function cortarPorEspaco(texto: string, tamanho: number): string[] {
  const partes: string[] = [];
  let resto = texto;

  while (resto.length > tamanho) {
    let corte = resto.lastIndexOf(' ', tamanho);
    // Sem espaço nenhum no trecho (URL gigante, por exemplo): corta no limite.
    if (corte <= 0) corte = tamanho;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto.length > 0) partes.push(resto);

  return partes;
}

/** Últimos `n` caracteres de um texto, começando numa fronteira de palavra. */
function caudaDe(texto: string, n: number): string {
  if (texto.length <= n) return texto;
  const cauda = texto.slice(-n);
  const espaco = cauda.indexOf(' ');
  return espaco === -1 ? cauda : cauda.slice(espaco + 1);
}
