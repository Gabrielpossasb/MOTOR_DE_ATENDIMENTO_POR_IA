/**
 * Montagem dos prompts.
 *
 * As regras abaixo não são estética: no WhatsApp cada mensagem enviada custa
 * dinheiro, e um preço inventado custa a confiança do cliente. Por isso elas
 * aparecem como instruções duras, e não como sugestões.
 */
import { config } from '../../config.js';
import type { CategoriaSocial, ResultadoDeBusca } from '../types.js';

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

/**
 * Prompt de sistema completo: identidade do tenant + regras (+ memória).
 *
 * O resumo entra aqui, e não como um turno falso no histórico, porque ele não
 * é uma coisa que alguém disse: é contexto sobre a conversa. Fingir que o
 * cliente ou o bot escreveu aquilo ensinaria o modelo a escrever resumos.
 */
export function montarPromptDoSistema(promptDoTenant: string, resumo?: string): string {
  const partes = [promptDoTenant.trim(), regrasDoBot()];

  if (resumo && resumo.trim().length > 0) {
    partes.push(
      [
        'RESUMO DA CONVERSA ATÉ AQUI (as mensagens antigas já saíram do histórico):',
        resumo.trim(),
        '',
        'Use o resumo para não fazer o cliente repetir o que já contou. Ele NÃO é ' +
          'fonte de informação sobre o negócio: preço, prazo e horário continuam vindo ' +
          'apenas do CONTEXTO.',
      ].join('\n'),
    );
  }

  return partes.join('\n\n');
}

/**
 * Prompt que compacta as mensagens antigas numa memória curta.
 *
 * A regra 3 é a que não pode cair. Se o resumo guardar "a limpeza custa
 * R$ 180,00", esse número vira uma fonte de verdade paralela: o modelo passa a
 * responder de memória em vez de consultar os documentos, e a checagem de
 * número inventado — que compara contra os chunks recuperados — não tem como
 * saber que o valor veio do resumo. Um preço desatualizado no documento
 * continuaria sendo repetido pelo bot a conversa inteira.
 *
 * Por isso a distinção: número que o CLIENTE deu é dado do atendimento e fica;
 * número que o BOT informou é consulta, e se for perguntado de novo tem de ser
 * consultado de novo.
 */
export function montarPromptDeResumo(): string {
  return [
    'Você compacta o histórico de um atendimento em andamento, para servir de memória.',
    '',
    'O resumo SUBSTITUI as mensagens antigas: o que não estiver nele, o atendente esquece.',
    '',
    'REGRAS OBRIGATÓRIAS:',
    '1. Preserve o que o cliente quer, o que ele já informou (nome, procedimento, ' +
      'horário desejado, valores que ELE citou) e o que ficou pendente.',
    '2. Registre quais assuntos já foram respondidos, para o bot não repetir a resposta ' +
      'nem pedir a mesma informação duas vezes.',
    '3. NÃO copie preço, prazo, horário ou disponibilidade que o BOT informou. Escreva ' +
      'que o assunto foi respondido, sem o número. Esses dados vivem nos documentos e ' +
      'precisam ser consultados de novo, não lembrados.',
    '4. Não invente nada e não conclua nada. Se não ficou claro, deixe de fora.',
    `5. No máximo ${config.conversa.resumo.maximoDeLinhas} linhas, em tópicos curtos.`,
    '6. Português do Brasil. Escreva só o resumo, sem introdução.',
  ].join('\n');
}

/**
 * Monta o texto que vai ser resumido: o resumo anterior (se houver) mais as
 * mensagens que estão saindo da janela.
 *
 * O resumo anterior entra junto para a memória ser cumulativa. Resumir só as
 * mensagens novas faria a conversa esquecer o começo na segunda compactação —
 * o bug que este recurso existe para não ter.
 */
export function montarEntradaDoResumo(
  resumoAnterior: string | undefined,
  mensagens: { papel: string; conteudo: string }[],
): string {
  const partes: string[] = [];

  if (resumoAnterior && resumoAnterior.trim().length > 0) {
    partes.push(`RESUMO ATÉ AGORA:\n${resumoAnterior.trim()}`);
  }

  const transcricao = mensagens
    .map((m) => `${m.papel === 'user' ? 'Cliente' : 'Atendente'}: ${m.conteudo}`)
    .join('\n');

  partes.push(`MENSAGENS A INCORPORAR:\n${transcricao}`);

  return partes.join('\n\n');
}

/** O que fazer em cada tipo de turno social. */
const ORIENTACAO: Record<CategoriaSocial, string> = {
  saudacao: 'Cumprimente de volta e convide a pessoa a dizer o que precisa.',
  agradecimento: 'Responda ao agradecimento e se coloque à disposição.',
  despedida: 'Despeça-se com cordialidade e deixe claro que pode voltar quando quiser.',
  confirmacao: 'Confirme que entendeu e pergunte se pode ajudar em mais alguma coisa.',
};

/**
 * Prompt para um turno social — saudação, agradecimento, despedida, confirmação.
 *
 * É um prompt SEPARADO, e não o normal com contexto vazio, por um motivo
 * concreto: a regra 2 do prompt normal manda responder a frase de handoff
 * quando o contexto não tem a resposta. Um "boa tarde" com contexto vazio cai
 * exatamente nessa regra, e o bot chamaria um atendente para retribuir um
 * cumprimento.
 *
 * Aqui não há CONTEXTO nenhum, então a regra dura é o contrário: não pode sair
 * nenhum dado do negócio, porque qualquer um seria inventado.
 */
export function montarPromptSocial(promptDoTenant: string, categoria: CategoriaSocial): string {
  return [
    promptDoTenant.trim(),
    '',
    `A mensagem do cliente é apenas social (${categoria}). Não é uma pergunta sobre o negócio.`,
    '',
    'REGRAS OBRIGATÓRIAS:',
    `1. ${ORIENTACAO[categoria]}`,
    '2. UMA linha curta e calorosa, em português do Brasil, com tom de conversa de WhatsApp.',
    '3. NUNCA cite preço, horário, prazo, endereço, telefone ou qualquer outro dado do ' +
      'negócio. Nesta mensagem você NÃO recebeu documento nenhum: qualquer dado que ' +
      'escrever será invenção.',
    '4. Não repita uma frase que você já tenha usado antes nesta conversa.',
    '5. NÃO diga que vai chamar alguém da equipe. Um cumprimento não precisa de atendente.',
    '6. Não tente vender, agendar nem processar pagamento.',
  ].join('\n');
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
