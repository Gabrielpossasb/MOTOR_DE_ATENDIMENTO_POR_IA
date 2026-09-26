/**
 * Regras que decidem se uma resposta está certa.
 *
 * Fica no core (e não no script) porque é lógica testável: a suíte de
 * avaliação custa dinheiro para rodar, então as regras que a julgam precisam
 * ter os seus próprios testes offline.
 */
import type { RespostaDoBot } from '../types.js';
import { normalizar } from '../texto.js';

// Reexportado porque as regras daqui comparam texto livre do mesmo jeito que o
// motor compara; uma segunda implementação divergiria em silêncio.
export { normalizar };

export interface PerguntaDeAvaliacao {
  id: string;
  pergunta: string;
  /** Todos estes trechos precisam aparecer na resposta. */
  deveConter?: string[];
  /** Nenhum destes pode aparecer. */
  naoPodeConter?: string[];
  /** Se a resposta deve ou não acionar o pedido de ajuda humana. */
  esperaHandoff?: boolean;
  /** Arquivo de onde a resposta deveria vir. */
  fonteEsperada?: string;
  /** Anotação para quem lê o log; não afeta o resultado. */
  comentario?: string;
}

export interface FalhaDeRegra {
  regra: string;
  detalhe: string;
}

export interface ResultadoDaVerificacao {
  passou: boolean;
  falhas: FalhaDeRegra[];
}

/**
 * Verifica uma resposta contra as regras da pergunta e contra a regra global
 * de não inventar números.
 *
 * @param contextoRecuperado texto dos chunks que embasaram a resposta
 */
export function verificar(
  esperado: PerguntaDeAvaliacao,
  resposta: RespostaDoBot,
  contextoRecuperado: string,
): ResultadoDaVerificacao {
  const falhas: FalhaDeRegra[] = [];
  const texto = normalizar(resposta.texto);

  if (esperado.esperaHandoff === true && !resposta.precisaDeHumano) {
    falhas.push({
      regra: 'esperaHandoff',
      detalhe: 'deveria pedir ajuda humana, mas respondeu como se soubesse',
    });
  }

  if (esperado.esperaHandoff === false && resposta.precisaDeHumano) {
    falhas.push({
      regra: 'esperaHandoff',
      detalhe: 'desistiu de uma pergunta que a base responde',
    });
  }

  // Só faz sentido cobrar conteúdo de uma resposta que deveria existir.
  if (esperado.esperaHandoff !== true) {
    for (const trecho of esperado.deveConter ?? []) {
      if (!texto.includes(normalizar(trecho))) {
        falhas.push({ regra: 'deveConter', detalhe: `faltou "${trecho}"` });
      }
    }

    if (esperado.fonteEsperada && !resposta.fontes.some((f) => f.arquivo === esperado.fonteEsperada)) {
      const citadas = resposta.fontes.map((f) => f.arquivo).join(', ') || 'nenhuma';
      falhas.push({
        regra: 'fonteEsperada',
        detalhe: `esperava ${esperado.fonteEsperada}, citou: ${citadas}`,
      });
    }
  }

  for (const trecho of esperado.naoPodeConter ?? []) {
    if (texto.includes(normalizar(trecho))) {
      falhas.push({ regra: 'naoPodeConter', detalhe: `apareceu "${trecho}"` });
    }
  }

  falhas.push(...verificarNumerosInventados(resposta.texto, contextoRecuperado));
  falhas.push(...verificarFormato(resposta.texto));

  return { passou: falhas.length === 0, falhas };
}

/**
 * Regra global: todo valor em reais, horário ou prazo citado na resposta
 * precisa existir no contexto recuperado.
 *
 * É a checagem direta de "NUNCA invente preço, prazo, horário ou
 * disponibilidade" — a regra cuja violação custa dinheiro e confiança. Um
 * modelo que acerta o texto mas troca R$ 180 por R$ 190 passaria em qualquer
 * verificação de palavra-chave e reprova aqui.
 */
export function verificarNumerosInventados(texto: string, contexto: string): FalhaDeRegra[] {
  const falhas: FalhaDeRegra[] = [];
  const contextoNormalizado = normalizar(contexto);

  for (const valor of extrairValores(texto)) {
    if (!contextoNormalizado.includes(normalizar(valor))) {
      falhas.push({
        regra: 'numeroInventado',
        detalhe: `"${valor}" não aparece nos chunks recuperados`,
      });
    }
  }

  return falhas;
}

/**
 * Extrai da resposta os números que precisam ter origem documental:
 * valores em reais, horários e prazos em dias/meses.
 *
 * Números soltos ("3 dentistas") ficam de fora de propósito: a taxa de falso
 * positivo acabaria com a utilidade do relatório.
 */
function extrairValores(texto: string): string[] {
  const padroes = [
    /R\$\s?[\d.,]+/gi, // R$ 180,00
    /\b\d{1,2}h(?:\d{2})?\b/gi, // 8h, 18h30
    /\b\d+\s?(?:dias?|semanas?|meses|m[êe]s)\b/gi, // 3 dias, 2 meses
    /\b\d+\s?%/g, // 50% — desconto inventado é tão caro quanto preço inventado
  ];

  const encontrados = new Set<string>();
  for (const padrao of padroes) {
    for (const achado of texto.match(padrao) ?? []) {
      encontrados.add(achado.trim());
    }
  }

  return [...encontrados];
}

/** Regras de forma que valem para toda resposta. */
export function verificarFormato(texto: string): FalhaDeRegra[] {
  const falhas: FalhaDeRegra[] = [];

  const linhas = texto.split('\n').filter((l) => l.trim().length > 0);
  if (linhas.length > 3) {
    falhas.push({ regra: 'maximoDeLinhas', detalhe: `${linhas.length} linhas, máximo 3` });
  }

  return falhas;
}
