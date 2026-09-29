/**
 * Classificação de turno social: saudação, agradecimento, despedida, confirmação.
 *
 * POR QUE ISTO EXISTE. O motor tinha dois modos: responder a partir dos
 * documentos, ou chamar um humano. Uma saudação não é nenhum dos dois. Rodando
 * de verdade, um "boa tarde" tirou 0.370 na busca — abaixo do limiar de 0.40 —
 * e o bot respondeu "Não tenho essa informação aqui. Vou chamar alguém da
 * equipe", registrou handoff e marcou a conversa como `handoff`. Como o bot se
 * cala depois de um handoff, a conversa morreu ali: a pergunta de verdade, que
 * viria na mensagem seguinte, nunca seria respondida.
 *
 * Mexer no limiar não conserta isso. Com o limiar mais baixo, "boa tarde" iria
 * ao LLM com contexto irrelevante e a regra 2 do prompt manda responder
 * exatamente a frase de handoff — mesmo resultado, agora pagando por ele.
 *
 * A classificação é DETERMINÍSTICA de propósito: custo zero, latência zero e
 * testável offline. Quem varia a redação da resposta é o LLM, depois.
 *
 * Regra central: só é turno social a mensagem em que **não sobra nada** depois
 * de tirar as expressões sociais e o ruído. Assim "oi, quanto custa a limpeza?"
 * continua sendo uma pergunta e segue o caminho normal de busca.
 */
import { config } from '../../config.js';
import { normalizar } from '../texto.js';
import type { CategoriaSocial } from '../types.js';

interface Expressao {
  categoria: CategoriaSocial;
  frase: string;
}

/**
 * Colapsa letras repetidas: "bom diaa" vira "bom dia", "oii" vira "oi".
 *
 * Nasceu de um caso real: `"bom diaa"` não casava com `\bbom dia\b`, porque a
 * fronteira depois de "dia" não existe quando vem outra letra. O bot chamou um
 * atendente para responder a um cumprimento, e a conversa morreu ali.
 * Esticar a última letra é como se escreve no WhatsApp — "oii", "tardee",
 * "obrigadoo" — e comparação exata não sobrevive a isso.
 *
 * Colapsa dos DOIS lados, mensagem e lista de expressões, para as duas formas
 * se encontrarem. Não importa que "pessoal" vire "pesoal": importa que vire a
 * mesma coisa nos dois lados.
 */
export function colapsarRepetidas(texto: string): string {
  return texto.replace(/([a-z0-9])\1+/g, '$1');
}

/**
 * Todas as expressões, já colapsadas e das mais longas para as mais curtas.
 *
 * A ordem importa na hora de remover: "tudo bem" precisa sair antes de
 * qualquer coisa que case com "bem", senão sobra a metade da frase e o turno
 * deixa de parecer social.
 */
const EXPRESSOES: Expressao[] = Object.entries(config.social.expressoes)
  .flatMap(([categoria, frases]) =>
    frases.map((frase) => ({
      categoria: categoria as CategoriaSocial,
      frase: colapsarRepetidas(frase),
    })),
  )
  .sort((a, b) => b.frase.length - a.frase.length);

const RUIDO = [...config.social.ruido]
  .map(colapsarRepetidas)
  .sort((a, b) => b.length - a.length);

/**
 * Diz se a mensagem é puramente social e de qual tipo.
 *
 * Devolve `undefined` quando sobra qualquer conteúdo — aí é pergunta, e quem
 * responde é o caminho normal com busca.
 */
export function classificarTurnoSocial(texto: string): CategoriaSocial | undefined {
  const normalizado = colapsarRepetidas(normalizar(texto));
  if (normalizado.length === 0) return undefined;

  const achados = localizarExpressoes(normalizado);
  if (achados.length === 0) return undefined;

  let restante = normalizado;
  for (const { frase } of EXPRESSOES) restante = restante.replace(padraoDe(frase), ' ');
  for (const ruido of RUIDO) restante = restante.replace(padraoDe(ruido), ' ');

  // Sobrou letra ou número: tem pergunta no meio. Pontuação e emoji não contam,
  // então "oi!!! 😊" continua sendo só uma saudação.
  if (/[a-z0-9]/.test(restante)) return undefined;

  // A última expressão da frase é a que manda: em "obrigado, tchau" o que
  // importa é a despedida, não o agradecimento.
  return achados[achados.length - 1]?.categoria;
}

/** Onde cada expressão social aparece na mensagem, em ordem de posição. */
function localizarExpressoes(normalizado: string): { categoria: CategoriaSocial; inicio: number }[] {
  const achados: { categoria: CategoriaSocial; inicio: number }[] = [];

  for (const { categoria, frase } of EXPRESSOES) {
    for (const achado of normalizado.matchAll(padraoDe(frase))) {
      if (achado.index !== undefined) achados.push({ categoria, inicio: achado.index });
    }
  }

  return achados.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Expressão inteira e isolada.
 *
 * O `\b` é o que impede "oi" de casar dentro de "oito" e "ola" dentro de
 * "bolacha" — sem ele, "oito reais" viraria uma saudação.
 */
function padraoDe(frase: string): RegExp {
  return new RegExp(`\\b${frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
}
