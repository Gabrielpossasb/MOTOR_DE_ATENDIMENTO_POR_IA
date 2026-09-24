/**
 * Montagem dos prompts.
 *
 * As regras abaixo não são estética: no WhatsApp cada mensagem enviada custa
 * dinheiro, e um preço inventado custa a confiança do cliente. Por isso elas
 * aparecem como instruções duras, e não como sugestões.
 */
import { config } from '../../config.js';
import type { ResultadoDeBusca } from '../types.js';

/** Regras fixas, válidas para todo tenant. */
export function regrasDoBot(): string {
  return [
    'REGRAS OBRIGATÓRIAS:',
    '1. Responda APENAS com base no CONTEXTO fornecido abaixo. Ele é sua única fonte de verdade.',
    '2. Se o contexto não contém a resposta, responda exatamente: ' +
      `"${config.resposta.fraseDeHandoff}"`,
    '3. NUNCA invente preço, prazo, horário ou disponibilidade. Se o número não está ' +
      'literalmente no contexto, você não o tem.',
    `4. No máximo ${config.resposta.maximoDeLinhas} linhas. Seja direto.`,
    '5. Envie uma única mensagem. Nunca escreva várias mensagens seguidas.',
    '6. Se faltam vários dados para atender a pessoa, pergunte todos de uma vez, numa frase só.',
    '7. Não tente vender, agendar nem processar pagamento. Você só informa.',
    '8. Escreva em português do Brasil, em tom de conversa de WhatsApp.',
  ].join('\n');
}

/** Prompt de sistema completo: identidade do tenant + regras. */
export function montarPromptDoSistema(promptDoTenant: string): string {
  return `${promptDoTenant.trim()}\n\n${regrasDoBot()}`;
}

/**
 * Monta a mensagem do usuário com o contexto recuperado.
 * Cada trecho vem rotulado com o arquivo de origem para o modelo conseguir
 * distinguir as fontes — e para nós conferirmos de onde saiu a resposta.
 */
export function montarMensagemComContexto(pergunta: string, resultados: ResultadoDeBusca[]): string {
  const contexto = resultados
    .map((r, i) => {
      const secao = r.chunk.metadados.secao ? ` — ${r.chunk.metadados.secao}` : '';
      return `[${i + 1}] (${r.arquivo}${secao})\n${r.chunk.texto}`;
    })
    .join('\n\n');

  return `CONTEXTO:\n${contexto}\n\nPERGUNTA DO CLIENTE:\n${pergunta}`;
}
