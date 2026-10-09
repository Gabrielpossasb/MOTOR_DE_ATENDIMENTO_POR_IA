/**
 * Montagem dos prompts.
 *
 * As regras abaixo não são estética: no WhatsApp cada mensagem enviada custa
 * dinheiro, e um preço inventado custa a confiança do cliente. Por isso elas
 * aparecem como instruções duras, e não como sugestões.
 */
import { config } from '../../config.js';
import type { CategoriaSocial, ResultadoDeBusca } from '../types.js';

/** O que muda de cliente para cliente nas regras gerais. */
export interface AjustesDoPrompt {
  /** O bot pode montar pedido e informar total. Ver `ConfigDoTenant.vende`. */
  vende: boolean;
  maximoDeLinhas: number;
}

/** Regras fixas, válidas para todo tenant. */
export function regrasDoBot(ajustes: AjustesDoPrompt): string {
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
    // A regra 5 já foi "no máximo N linhas, seja direto", e isso virou um
    // problema quando cada linha passou a ser enviada como uma MENSAGEM
    // separada: o modelo lia "economize linhas" e empacotava duas ou três
    // ideias numa frase só. Quem conversou com o bot reclamou exatamente disso
    // — "se não, a mensagem fica muito grande e artificial". A quebra de linha
    // deixou de ser custo e passou a ser o recurso.
    `5. CADA LINHA que você escrever é enviada como uma mensagem separada no WhatsApp. Então ` +
      `separe ideias diferentes em linhas diferentes, como quem conversa: o valor numa linha, ` +
      `a pergunta na outra. Máximo de ${ajustes.maximoDeLinhas} linhas, e cada uma curta.`,
    '6. Não repita a mesma ideia em duas linhas. Cada linha é uma mensagem nova chegando no ' +
      'celular da pessoa.',
    '7. Se faltam vários dados para atender a pessoa, pergunte todos de uma vez, numa frase só ' +
      '— e só os que ainda faltam.',
    // A regra 8 já foi "não tente vender nem processar pagamento" para todo
    // mundo. Escrita assim quando vender estava fora de escopo, ela passou a
    // contradizer o prompt da revendedora de polpa, que manda juntar o pedido e
    // informar o total — as duas no mesmo prompt, e esta dentro do bloco de
    // REGRAS OBRIGATÓRIAS. Vender virou recurso por decisão de produto, igual a
    // agendar. Não processar PAGAMENTO continua valendo para os dois casos.
    ajustes.vende
      ? '8. Você PODE montar o pedido e informar o total. NÃO processe pagamento: a forma de ' +
        'pagamento é só anotada, e quem recebe o dinheiro é a pessoa na entrega.'
      : '8. Não tente vender nem processar pagamento.',
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
    // V1 já foi "avise SEMPRE que pedirem desconto, quem fecha é a pessoa". Foi
    // escrita quando nenhum desconto era cadastrado, e passou a atropelar o
    // caso em que o bot PODE aplicar: medido cinco vezes seguidas, o cliente
    // mencionava o cartão impresso, o prompt dizia em letras maiúsculas para
    // chamar `aplicar_desconto`, e o bot respondia "vou confirmar com a
    // responsável" — obedecendo esta regra, que vinha depois e numerada.
    'V1. Avise quando o cliente pedir desconto que NÃO esteja cadastrado — é o caso do pedido ' +
      'grande, combinado caso a caso. Mas se `aplicar_desconto` aceita o desconto, então ele é ' +
      'cadastrado e o caso é APLICAR, não avisar: aí você não chama esta ferramenta.',
    'V2. Avise quando houver horário de entrega ou de atendimento a confirmar.',
    'V3. Avise quando perguntarem de um lugar, prazo ou condição que NÃO está nos documentos, ' +
      'em vez de afirmar por conta própria. Na dúvida, avise.',
    'V4. Depois de avisar, DIGA AO CLIENTE que você vai confirmar e CONTINUE o atendimento. ' +
      'Nunca pare de responder por causa de um aviso.',
    'V5. Um aviso por assunto. Se já avisou sobre isso nesta conversa, não avise de novo.',
  ].join('\n');
}

/**
 * Instruções do pedido, acrescentadas quando o bot tem as ferramentas de venda.
 *
 * A regra P1 é a razão de existir desta seção. Medido na conversa 34: com o
 * prompt consertado o bot passou a montar o pedido de cabeça e passou a errar —
 * listou três itens e informou o total de dois (R$ 60,00 onde a soma era
 * R$ 110,00). Ele sabe multiplicar; não sabe manter uma lista. Então a lista
 * sai da cabeça dele e vai para a ferramenta.
 */
export function regrasDoPedido(): string {
  return [
    'PEDIDO:',
    'Você monta o pedido com as ferramentas. O pedido fica guardado e NÃO depende da sua ' +
      'memória nem do que ainda está visível no histórico.',
    '',
    'P1. NUNCA some de cabeça e nunca repita um total de memória. Todo valor que você disser ' +
      'ao cliente vem do que a ferramenta devolveu AGORA.',
    'P2. Assim que o cliente escolher um produto E a quantidade, chame `adicionar_ao_pedido`. ' +
      'Se ele disse o produto sem a quantidade, PERGUNTE quantos quilos — não suponha 1.',
    'P3. Se a ferramenta recusar o produto, não ofereça um parecido no lugar. Diga que não ' +
      'temos aquele e, se ela mandar as opções, pergunte qual delas o cliente quer.',
    'P4. Qualquer dado de entrega que o cliente mencionar — nome, endereço, horário, forma de ' +
      'pagamento — vai para `anotar_dados_da_entrega` na hora, mesmo que você não tenha ' +
      'perguntado.',
    // P4b nasceu da conversa 37: doze achados de `pedido_insistente`, com o bot
    // pedindo nome, endereço e pagamento em sete turnos seguidos enquanto o
    // cliente ainda montava o pedido. O dono do negócio resumiu: "a primeira
    // mensagem até tudo bem, pois aí o cliente já fica ciente do que terá que
    // informar, mas ficar pedindo toda hora fica chato e repetitivo".
    'P4b. Os dados de entrega se pedem DUAS vezes no máximo: uma no começo, para o cliente já ' +
      'saber o que vai precisar, e outra quando ele sinalizar que terminou de escolher. Entre ' +
      'essas duas, NUNCA repita o pedido — pergunte se ele quer mais alguma coisa. O campo ' +
      '`falta_quando_fechar` é para você SABER o que falta, não para pedir agora.',
    // P4c nasceu da conversa 38: o cliente mandou "Pedro", o bot respondeu
    // "Perfeito, já anotei o nome" e NÃO chamou a ferramenta. Nada foi gravado,
    // e dois turnos depois ele pediu o nome de novo a quem tinha acabado de dar.
    'P4c. NUNCA diga "anotei", "registrei" ou "guardei" sem ter chamado a ferramenta nesta ' +
      'mesma resposta. Dizer que anotou sem anotar é enganar o cliente: ele vai embora achando ' +
      'que o pedido está de pé. Chame a ferramenta PRIMEIRO, e só depois confirme.',
    'P5. Para fechar, chame `fechar_pedido` com confirmado=false, leia o pedido inteiro de ' +
      'volta ao cliente e só chame com confirmado=true depois do sim dele.',
    // P6 nasceu de um laço medido na conversa 35. O cliente disse "pode ser
    // amanhã de manhã", o bot NÃO anotou, e depois respondeu "pra fechar só
    // falta me dizer o horário" — duas vezes. O prompt do tenant diz "NUNCA
    // confirme o horário da entrega", e o modelo leu isso como "não registre o
    // horário". São coisas diferentes, e agora está escrito que são.
    'P6. ANOTAR o horário que o cliente pediu é OBRIGATÓRIO: mande em ' +
      '`anotar_dados_da_entrega`, campo horario_desejado, assim que ele disser. Sem isso o ' +
      'pedido não fecha e a conversa entra em laço.',
    'P7. CONFIRMAR o horário é proibido, e é outra coisa. A ferramenta guarda o horário que o ' +
      'cliente PEDIU; quem diz que ele está disponível é a responsável. Anotar não é prometer.',
  ].join('\n');
}

/**
 * O estado do pedido, lido do banco, em TODA mensagem.
 *
 * Nasceu do defeito mais teimoso desta frente. Medido na conversa 41: o cliente
 * disse `"pix"`, o bot respondeu *"falta só o horário"* sem chamar ferramenta
 * nenhuma — deduziu o que faltava da SUA MENSAGEM ANTERIOR, que já estava
 * velha. Dois turnos depois a ferramenta informou a verdade (o pix nunca tinha
 * sido gravado) e, para o cliente, o bot pareceu esquecer o que ele acabara de
 * dizer.
 *
 * A lição desta sessão, repetida três vezes, é que **dado concreto no prompt
 * ganha de regra abstrata**. Então o pedido deixa de depender de o modelo
 * lembrar ou de chamar `ver_pedido`: ele chega pronto, a cada mensagem, vindo
 * da tabela.
 *
 * O bloco é propositalmente de leitura, nunca de escrita: se o cliente acabou
 * de dizer algo que não está aqui, a discrepância fica visível na cara do
 * modelo e o caminho para gravar é a ferramenta.
 */
export function pedidoAtualParaOPrompt(
  resumoDoPedido: string,
  falta: string[],
  /** Aviso de desconto a que o cliente já tem direito. Ver `descontoAplicavel`. */
  descontoDisponivel?: string,
): string {
  return [
    'PEDIDO ATUAL (lido do banco agora, nesta mensagem):',
    resumoDoPedido,
    falta.length === 0
      ? 'Está tudo que o pedido precisa para fechar.'
      : `Ainda NÃO está gravado: ${falta.join(', ')}.`,
    '',
    'Este bloco é a verdade sobre o pedido — mais confiável que a sua memória e que qualquer ' +
      'coisa que você escreveu antes. NUNCA deduza o que falta a partir da sua mensagem ' +
      'anterior.',
    'Se o cliente disse nesta mensagem algo que NÃO aparece como gravado aqui, é porque ainda ' +
      'não está: chame a ferramenta para gravar ANTES de responder.',
    ...(descontoDisponivel ? ['', descontoDisponivel] : []),
  ].join('\n');
}

export function montarPromptDoSistema(
  promptDoTenant: string,
  ajustes: AjustesDoPrompt,
  resumo?: string,
  agenda?: string,
  aviso?: string,
  pedido?: string,
  pedidoAtual?: string,
): string {
  const partes = [promptDoTenant.trim(), regrasDoBot(ajustes)];

  if (agenda) partes.push(agenda);
  if (pedido) partes.push(pedido);
  if (aviso) partes.push(aviso);

  // O estado do pedido vai por ÚLTIMO, depois de todas as regras fixas. É a
  // única parte que muda a cada mensagem, e ficar antes das regras custou caro:
  // o aviso de "aplique o desconto cadastrado" vinha antes do bloco de avisar o
  // responsável, e o modelo seguia o bloco de baixo.
  if (pedidoAtual) partes.push(pedidoAtual);

  if (resumo && resumo.trim().length > 0) {
    partes.push(
      [
        'RESUMO DA CONVERSA ATÉ AQUI (as mensagens antigas já saíram do histórico):',
        resumo.trim(),
        '',
        'Use o resumo para não fazer o cliente repetir o que já contou. Ele NÃO é ' +
          'fonte de informação sobre o negócio: preço, prazo e horário de TABELA continuam ' +
          'vindo apenas do CONTEXTO.',
        // Sem esta frase a exceção da regra 4 do resumo não serve para nada: o
        // pedido chegaria com os números e o modelo os descartaria aqui.
        'O PEDIDO do cliente é exceção: itens, quantidades, total e dados de entrega que ' +
          'estiverem no resumo são o pedido dele, já combinado. Use-os direto e NUNCA peça ' +
          'para ele mandar os itens de novo.',
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
    // A exceção da regra 4 conserta um defeito medido, não é afrouxamento. Na
    // conversa 33 da Polpa Santa Helena o cliente perguntou "qual o valor de
    // tudo?" e o bot respondeu "vou confirmar o total com a responsável, me
    // manda de novo os itens" — e avisou a dona do negócio. Ele não estava
    // sendo preguiçoso: o resumo gravado dizia "Assunto de valores dos itens já
    // foi respondido", exatamente como a regra 3 manda, e os preços tinham
    // sumido com as mensagens antigas. A regra 3 está certa para uma clínica;
    // um pedido em montagem é a única coisa que PRECISA carregar número ao
    // longo da conversa.
    '4. EXCEÇÃO à regra 3 — o PEDIDO EM ANDAMENTO: itens, quantidades, o total já ' +
      'informado e os dados de fechamento (nome, endereço, horário desejado, forma de ' +
      'pagamento) ficam no resumo COM os números. Isso é dado do atendimento, não consulta ' +
      'ao catálogo. Um pedido que perde o preço obriga o cliente a montar tudo de novo.',
    '5. Não invente nada e não conclua nada. Se não ficou claro, deixe de fora.',
    `6. No máximo ${config.conversa.resumo.maximoDeLinhas} linhas, em tópicos curtos.`,
    '7. Português do Brasil. Escreva só o resumo, sem introdução.',
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
  // A forma é pedida, e não só a intenção, porque "cumprimente de volta" deixou
  // solto demais: o bot respondeu "Boa noite! Me fala o que você precisa por
  // aqui", que o dono do negócio achou largado. Primeira mensagem é primeira
  // impressão, e aqui ela tem padrão.
  //
  // Isto só alcança saudação PURA — `classificarTurnoSocial` devolve
  // `undefined` quando sobra qualquer conteúdo, e "boa tarde, vocês abrem no
  // sábado?" tem de receber o horário. Esse caso está na suíte paga, em
  // `social-com-pergunta-junto`.
  saudacao:
    'Cumprimente de volta no mesmo período do dia que a pessoa usou, pergunte como ela está ' +
    'e ofereça ajuda — nesta forma: "Bom dia! Tudo bem? Em que posso ajudar?". As palavras ' +
    'podem variar; a estrutura das três partes, não.',
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
    // Esta regra já foi "não repita uma frase que você já tenha usado". Assim
    // ela brigava com a forma pedida na regra 1 e empurrava o modelo a inventar
    // uma abertura nova a cada vez — que é como a saudação ficou largada.
    '4. Varie as palavras em relação ao que você já disse nesta conversa. A forma pedida na ' +
      'regra 1 pode repetir.',
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
