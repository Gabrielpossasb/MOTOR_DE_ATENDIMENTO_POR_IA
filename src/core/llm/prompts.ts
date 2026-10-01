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
    '1. Ao responder sobre o negócio, use APENAS o CONTEXTO fornecido abaixo. Ele é sua ' +
      'única fonte de verdade.',
    // As regras 2 e 3 já foram uma só ("se o contexto não responde, escale"), e essa
    // mistura matava conversa: um "bom diaa" com contexto vazio caía nela e acionava a
    // equipe para retribuir um cumprimento. Não saber a resposta de uma pergunta e a
    // mensagem não ser uma pergunta são situações diferentes.
    '2. Se a mensagem NÃO for uma pergunta sobre o negócio — um cumprimento, uma conversa ' +
      'solta, um agradecimento, ou algo que você não conseguiu entender — responda em uma ' +
      'linha, com simpatia, e pergunte o que a pessoa precisa. NÃO chame ninguém da ' +
      'equipe: não existe informação faltando, só não foi feita uma pergunta ainda.',
    '3. Se FOR uma pergunta sobre o negócio e o CONTEXTO não a responder, responda ' +
      `exatamente: "${config.resposta.fraseDeHandoff}"`,
    // A segunda frase nasceu de uma regressão medida em 5 rodadas: "o clareamento
    // A LASER sai por quanto?" recebeu o preço do clareamento de consultório
    // (R$ 1.100,00) em 4 das 5, com score 0.653 — contexto firme, cheio de
    // clareamento, só não do que foi perguntado. O modelo não inventou número: ele
    // achou que a pergunta estava respondida porque o ASSUNTO estava. Passou 13 de
    // 17 execuções antes de a regra 2 virar duas, e o "NÃO chame ninguém" da nova
    // regra 2 pesou para o lado de ser útil.
    '4. NUNCA invente preço, prazo, horário ou disponibilidade. Se o número não está ' +
      'literalmente no contexto, você não o tem. E item PARECIDO não é resposta: se a ' +
      'pessoa perguntou por um procedimento, produto, plano ou condição que NÃO aparece ' +
      'no CONTEXTO, o preço ou prazo do item vizinho não serve — vale a regra 3, mesmo ' +
      'que o assunto geral esteja no contexto.',
    `5. No máximo ${config.resposta.maximoDeLinhas} linhas. Seja direto.`,
    '6. Envie uma única mensagem. Nunca escreva várias mensagens seguidas.',
    '7. Se faltam vários dados para atender a pessoa, pergunte todos de uma vez, numa frase só.',
    '8. Não tente vender nem processar pagamento.',
    '9. Escreva em português do Brasil, em tom de conversa de WhatsApp.',
  ].join('\n');
}

/**
 * Prompt de sistema completo: identidade do tenant + regras (+ memória).
 *
 * O resumo entra aqui, e não como um turno falso no histórico, porque ele não
 * é uma coisa que alguém disse: é contexto sobre a conversa. Fingir que o
 * cliente ou o bot escreveu aquilo ensinaria o modelo a escrever resumos.
 */
/**
 * Instruções de agenda, acrescentadas quando o bot tem as ferramentas.
 *
 * A regra 8 dizia "não tente agendar". Mudou por decisão de produto: a clínica
 * não quer passar telefone, quer que o bot marque.
 */
export function regrasDaAgenda(hoje: string): string {
  return [
    'AGENDA:',
    hoje,
    'Você CONSEGUE marcar, remarcar e cancelar consultas, usando as ferramentas.',
    '',
    'A1. NUNCA diga que um horário está livre sem ter chamado ' +
      '`consultar_horarios_livres`. Disponibilidade inventada vira paciente na porta ' +
      'de uma agenda cheia.',
    'A2. Para marcar você precisa de TRÊS coisas: o horário escolhido, o NOME COMPLETO e o ' +
      'TELEFONE com DDD. Convênio só se a pessoa tiver. Peça o que faltar de uma vez só, e ' +
      'confira no histórico o que ela já disse antes de perguntar de novo.',
    'A3. Antes de marcar, alterar ou cancelar, chame a ferramenta com `confirmado: false`, ' +
      'repita para o cliente o que vai acontecer e só chame com `confirmado: true` ' +
      'depois do sim dele.',
    'A4. Use `meus_agendamentos` para achar o id. Nunca peça o id ao cliente e nunca ' +
      'invente um.',
    'A5. Se a ferramenta recusar, explique o motivo em português simples e ofereça ' +
      'outra saída — outro horário, outro dia.',
  ].join('\n');
}

/**
 * Instruções da ferramenta de avisar o responsável.
 *
 * Separadas das regras gerais porque só entram quando a ferramenta é oferecida
 * — e porque dizem o contrário do handoff: aqui o bot avisa e CONTINUA. Se ele
 * calasse depois de dizer "vou confirmar o horário", o cliente que ainda não
 * deu o endereço ficaria sem como terminar o pedido.
 */
export function regrasDeAviso(): string {
  return [
    'AVISAR O RESPONSÁVEL:',
    'Você pode deixar um aviso para a pessoa responsável pelo negócio com a ferramenta ' +
      '`avisar_responsavel`. Ela NÃO interrompe o atendimento.',
    '',
    'V1. Avise quando o cliente pedir desconto, abatimento ou preço de atacado — mesmo que ' +
      'você saiba a política. Quem fecha condição especial é a pessoa, não você.',
    'V2. Avise quando houver horário de entrega ou de atendimento a confirmar.',
    'V3. Avise quando perguntarem de um lugar, prazo ou condição que NÃO está nos documentos, ' +
      'em vez de afirmar por conta própria. Na dúvida, avise.',
    'V4. Depois de avisar, DIGA AO CLIENTE que você vai confirmar e CONTINUE o atendimento. ' +
      'Nunca pare de responder por causa de um aviso.',
    'V5. Um aviso por assunto. Se já avisou sobre isso nesta conversa, não avise de novo.',
  ].join('\n');
}

export function montarPromptDoSistema(
  promptDoTenant: string,
  resumo?: string,
  agenda?: string,
  aviso?: string,
): string {
  const partes = [promptDoTenant.trim(), regrasDoBot()];

  if (agenda) partes.push(agenda);
  if (aviso) partes.push(aviso);

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
export function montarMensagemComContexto(
  pergunta: string,
  resultados: ResultadoDeBusca[],
  incerto = false,
): string {
  // Desde que o limiar deixou de barrar, chega aqui mensagem sem nenhum trecho
  // relevante — um cumprimento, por exemplo. Uma seção CONTEXTO em branco faz o
  // modelo procurar o que não existe; dizer que não veio nada é mais honesto e
  // deixa claro que a regra 2 ou a 3 é que valem.
  if (resultados.length === 0) {
    return [
      'CONTEXTO:',
      '(nenhum trecho relevante encontrado para esta mensagem)',
      '',
      'MENSAGEM DO CLIENTE:',
      pergunta,
    ].join('\n');
  }

  const trechos = resultados
    .map((r, i) => {
      const secao = r.chunk.metadados.secao ? ` — ${r.chunk.metadados.secao}` : '';
      return `[${i + 1}] (${r.arquivo}${secao})\n${r.chunk.texto}`;
    })
    .join('\n\n');

  // Nada passou do limiar, mas a busca achou alguma coisa. Avisar que o
  // material é fraco é melhor que esconder: medido, "ta entao marca dia 16
  // mesmo" tira 0.376 e o trecho descartado por essa margem era justamente o
  // "Como agendar". Sem ele, o modelo responde que não sabe uma coisa que o
  // documento responde.
  const cabecalho = incerto
    ? 'CONTEXTO (nenhum trecho claramente relevante; use só se de fato responder):'
    : 'CONTEXTO:';

  return `${cabecalho}\n${trechos}\n\nMENSAGEM DO CLIENTE:\n${pergunta}`;
}
