/**
 * Auditoria de uma conversa: o que o bot fez de errado, turno por turno.
 *
 * Existe porque a suíte de avaliação mede PERGUNTA ISOLADA, e os defeitos que
 * mais incomodam quem conversa só aparecem ao longo de uma conversa: pedir duas
 * vezes o mesmo dado, afirmar preço com contexto vazio, perder o fio. Nenhum
 * deles é detectável numa pergunta só.
 *
 * É um LINT, não um juiz. Cada achado carrega o trecho da resposta para uma
 * pessoa julgar, porque a detecção é por padrão de texto e padrão de texto erra.
 * Um falso positivo aqui custa uma linha para ler e descartar; o contrário —
 * esconder um defeito — custa cliente.
 *
 * O `aproveitamento` é CONTAGEM, não nota: turnos sem problema grave sobre
 * turnos do bot. Nota composta com pesos escolhidos a dedo pareceria precisa e
 * não seria — a mesma razão pela qual o custo reportado soma todas as chamadas.
 */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import { mensagensApos, type MensagemGravada } from '../../storage/repositories/messages.js';
import { normalizar } from '../texto.js';
import { classificarTurnoSocial } from './turno-social.js';

export type TipoDeProblema =
  /** Pediu um dado que a conversa JÁ tinha. É o defeito que o cliente sente. */
  | 'pedido_repetido'
  /** Pediu o mesmo dado de novo, mas o cliente ainda não tinha respondido. */
  | 'pedido_insistente'
  /** Afirmou número, preço ou horário sem nenhum trecho acima do limiar. */
  | 'afirmou_com_contexto_fraco'
  /** Respondeu sem citar fonte nenhuma, e a mensagem não era social. */
  | 'sem_fonte'
  /** Desistiu e chamou a equipe. */
  | 'handoff'
  /** Repetiu um fato numérico que já tinha dito, sem o cliente ter puxado o assunto. */
  | 'repetiu_informacao'
  /** Pediu endereço ou pagamento antes de existir pedido na conversa. */
  | 'pediu_dado_cedo_demais'
  /** O cliente pediu o total e a resposta não traz valor nenhum. */
  | 'nao_somou';

export interface ProblemaDaConversa {
  tipo: TipoDeProblema;
  /** Grave entra na conta do aproveitamento; aviso só aparece na lista. */
  grave: boolean;
  /** Ordinal da resposta do bot (1 = primeira), para casar com o transcrito. */
  turno: number;
  mensagemId: number;
  detalhe: string;
  /** O que o bot respondeu, para quem lê julgar o achado. */
  trecho: string;
}

export interface RelatorioDeConversa {
  conversaId: number;
  contatoId: string;
  canal: string;
  status: string;
  /** Respostas do bot. É o denominador do aproveitamento. */
  turnos: number;
  mensagens: number;
  custoUsd: number;
  custoMedioPorRespostaUsd: number;
  latenciaMediaMs: number;
  latenciaPiorMs: number;
  /** Média do melhor score por resposta, ignorando as que não citaram fonte. */
  scoreMedio: number | null;
  problemas: ProblemaDaConversa[];
  turnosComProblemaGrave: number;
  /** 0 a 1. Turnos sem problema grave sobre turnos do bot. */
  aproveitamento: number;
  comecouEm: string;
  terminouEm: string;
}

/**
 * Um dado que o bot precisa coletar para agendar.
 *
 * `pedido` reconhece o bot PEDINDO; `fornecido`, o cliente DANDO. Os dois são
 * padrões de texto e por isso erram — ver o comentário do topo.
 */
interface DadoDoAtendimento {
  id: string;
  rotulo: string;
  pedido: RegExp;
  /** Ausente quando não há forma honesta de reconhecer o dado no texto. */
  fornecido?: RegExp;
  /**
   * A resposta do BOT também passa a conversa a ter este dado.
   *
   * Vale para data e horário: o bot ofereceu "sexta (02/10)", então a conversa
   * sabe a data e pedi-la de novo é esquecimento. NÃO vale para endereço nem
   * pagamento, e o motivo é um falso positivo concreto: *"Entregamos em toda
   * Campo Grande, em qualquer bairro"* casa com `fornecido` do endereço, e
   * *"Aceitamos Pix, dinheiro e cartão"* casa com o do pagamento. Nos dois casos
   * o bot está informando a POLÍTICA, não recebendo a escolha do cliente — e
   * tratar como recebido faria o pedido legítimo seguinte virar defeito.
   */
  infereDaRespostaDoBot?: boolean;
}

const DADOS: DadoDoAtendimento[] = [
  {
    id: 'nome',
    rotulo: 'o nome',
    pedido: /nome completo|seu nome|qual (é |e )?o seu nome/i,
    // Nome não tem formato. O que dá para reconhecer é a FORMA da mensagem: só
    // letras, duas palavras ou mais, sem pergunta. Isso pega "maria silva" e
    // pegaria "tudo certo" também, e é por isso que existe a lista de aberturas
    // abaixo — e por isso o achado vem com o trecho para alguém conferir.
    fornecido: /^[a-zà-ÿ'´`^~-]{2,}(\s+[a-zà-ÿ'´`^~-]{2,})+$/i,
  },
  {
    id: 'telefone',
    rotulo: 'o telefone',
    pedido: /telefone|celular|whatsapp|n[úu]mero para contato/i,
    // Oito dígitos ou mais. Menos que isso é hora ("as 9"), preço ou dia do mês.
    fornecido: /(\d[\s().-]*){8,}/,
    infereDaRespostaDoBot: true,
  },
  {
    id: 'convenio',
    rotulo: 'o convênio',
    pedido: /conv[êe]nio|carteirinha|plano odontol[óo]gico/i,
    fornecido:
      /n[ãa]o tenho conv|sem conv|particular|tenho conv|meu conv|amil|unimed|bradesco|sulam|odontoprev|metlife|porto seguro/i,
    infereDaRespostaDoBot: true,
  },
  {
    id: 'data',
    rotulo: 'a data',
    pedido: /data exata|qual (o )?dia|que dia|confirma a data|para qual data|qual data/i,
    fornecido:
      /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|sabado|domingo|amanh[ãa]|hoje|depois de amanh|\d{1,2}\/\d{1,2}|dia \d{1,2}/i,
    infereDaRespostaDoBot: true,
  },
  {
    id: 'horario',
    rotulo: 'o horário',
    pedido: /qual (o )?hor[áa]rio|que hor[áa]rio|hor[áa]rio (que |voc[êe] )?prefer|qual hora/i,
    fornecido: /\d{1,2}\s*[:h]\s*\d{0,2}|[àa]s \d{1,2}|de manh[ãa]|[àa] tarde|meio[- ]dia/i,
    infereDaRespostaDoBot: true,
  },
  // Os dois abaixo nasceram da conversa 33 da Polpa Santa Helena, que tirou
  // 100% de aproveitamento enquanto pedia endereço e pagamento repetidas vezes.
  // A lista acima é vocabulário de clínica, e sem estes dois os dois campos que
  // uma entrega mais repete não tinham como ser vistos.
  {
    id: 'endereco',
    rotulo: 'o endereço',
    pedido: /endere[çc]o|\bcep\b|onde (voc[êe]|vc|a pessoa|ela|ele) (mora|fica|recebe)/i,
    // Endereço não tem formato. O que dá para reconhecer é o logradouro ou o
    // tipo de bairro — é o que todo endereço brasileiro escrito tem.
    fornecido:
      /\b(rua|av|avenida|travessa|alameda|pra[çc]a|rodovia|estrada|bairro|jardim|vila|conjunto|condom[íi]nio|quadra|apto|apartamento|bloco)\b/i,
  },
  {
    id: 'pagamento',
    rotulo: 'a forma de pagamento',
    pedido:
      /forma de pagamento|como (voc[êe] |vc |prefere )?(vai )?pagar|prefere pagar|pagamento (fica|ser[áa]|vai ser)/i,
    fornecido: /\b(pix|dinheiro|cart[ãa]o|cr[ée]dito|d[ée]bito|esp[ée]cie|especie)\b/i,
  },
];

/**
 * Dados que só se pedem com pedido já montado.
 *
 * O nome fica FORA de propósito: perguntar o nome no começo é educação, não
 * pressa. Quem assusta o cliente é endereço e forma de pagamento antes de ele
 * ter escolhido o que quer.
 */
const FECHAMENTO = new Set(['endereco', 'pagamento']);

/**
 * Aberturas que derrubam o reconhecimento de nome.
 *
 * "ta certo", "ja te mandei" e "nao tenho convenio" têm a forma de nome: só
 * letras, duas palavras. Sem esta lista, qualquer uma delas viraria "o cliente
 * informou o nome" e o relatório acusaria um defeito que não houve.
 */
const NAO_E_NOME =
  /^(ja|j[áa]|nao|n[ãa]o|sim|ta|t[áa]|tudo|por favor|obrigad|na|no|pra|para|quero|pode|posso|como|qual|quais|isso|beleza|blz|tem|ok|okay|entao|ent[ãa]o|mas|so|s[óo]|ainda|preciso|gostaria|queria|vou|voce|vc|me|te|e|de|do|da|em|com|sem)\b/i;

/** Frases em que o bot RECONHECE ter recebido algo. Não são pedidos. */
const RECONHECIMENTO = /\b(recebi|anotei|obrigad[oa]|perfeito|j[áa] (recebi|tenho|anotei))\b/i;

/**
 * O bot está PEDINDO algo, e não comentando.
 *
 * Sem isto, "já posso agendar com seu nome e telefone" contaria como pedido de
 * nome e de telefone.
 *
 * Exportado porque o motor precisa da MESMA noção para decidir se um "ok" do
 * cliente é turno social: `"Me fala quais sabores e quantos kg"` é um pedido
 * aberto mesmo sem ponto de interrogação, e duas cópias deste padrão
 * divergiriam em silêncio.
 */
export const BOT_ESTA_PEDINDO =
  /\?|me (manda|mande|envia|envie|confirma|confirme|informa|informe|diz|diga|fala|fale|conta|conte|passa|passe)|preciso d|pode (me )?(mandar|enviar|informar|confirmar|dizer|passar)|falta(m)? |qual|quais|quantos|quantas|informe|confirme/i;

const PEDIDO = BOT_ESTA_PEDINDO;

/**
 * A resposta RECUSA o que o cliente pediu.
 *
 * Quando o bot recusa um valor, pedir o dado de novo é o certo, não um
 * esquecimento. Medido: o cliente mandou "quero marcar / pra proxima sexta /
 * as 9 da manha" e o bot respondeu "às 09:00 não tenho horário livre. Tenho
 * 08:00, 10:00... me diga qual horário prefere" — resposta correta, e o
 * relatório acusou "pediu o horário, que a conversa já tinha".
 *
 * Suprime o achado na resposta inteira, e não só no dado recusado: atribuir a
 * recusa ao dado certo exigiria entender a frase, e um lint que erra para o
 * lado de não acusar é melhor que um que inventa defeito.
 */
const RECUSA =
  /n[ãa]o (tenho|temos|h[áa]|atendemos|trabalhamos|consigo)|indispon[íi]vel|j[áa] (est[áa] )?ocupad|sem (hor[áa]rio|vaga)|n[ãa]o (est[áa]|fica) (livre|dispon)/i;

/** Resposta que afirma um dado: preço, quantidade, hora, parcela. */
const AFIRMA_DADO = /r\$\s*\d|\d{1,2}\s*:\s*\d{2}|\d+\s*x\b|\d{2,}/i;

/**
 * O cliente está pedindo o total do pedido.
 *
 * O caso é a conversa 33, turno 9: `"qual o valor de tudo?"` levou *"Vou
 * confirmar o total certinho com a responsável"* — e um aviso para a dona do
 * negócio. O bot escalou uma SOMA. A conversa tirou 100% porque nenhuma regra
 * olhava para isso.
 */
const PEDE_TOTAL =
  /valor de tudo|quanto (fica|deu|da|d[áa]|sai|vai dar|ficou) (tudo|no total)|quanto (é|e) tudo|no total|valor total|total do pedido|fecha quanto|deu quanto/i;

/** A resposta traz algum valor em reais. */
const TEM_VALOR = /r\$\s*\d/i;

/**
 * Uma quantidade de produto apareceu na conversa.
 *
 * É o que separa "ainda estamos descobrindo o que a pessoa quer" de "já existe
 * pedido". Sem isso não há como dizer que endereço e pagamento foram pedidos
 * cedo demais.
 */
const TEM_QUANTIDADE =
  /\d+\s*(kg|quilos?|g\b|gramas?|pacotes?|unidades?|litros?|baldes?|caixas?|potes?|copos?)|\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|meio)\s+(kg|quilos?|pacotes?|baldes?|caixas?|potes?)\b/i;

/**
 * Palavras que não identificam assunto nenhum.
 *
 * Servem só ao `repetiu_informacao`: a comparação precisa saber se o cliente
 * puxou o assunto de volta, e para isso "de", "com" e "kg" não valem como
 * assunto. Unidades entram aqui de propósito — "kg" aparece em toda frase deste
 * negócio e casaria sempre.
 */
const SEM_ASSUNTO = new Set([
  'de', 'da', 'do', 'dos', 'das', 'em', 'com', 'para', 'pra', 'por', 'que', 'uma', 'uns',
  'umas', 'nos', 'nas', 'ao', 'aos', 'kg', 'gr', 'ml', 'reais', 'sim', 'nao', 'mais', 'ja',
  'vem', 'tem', 'fica', 'sai', 'custa', 'cada', 'seu', 'sua', 'voce', 'esta', 'sao', 'ser',
  'tudo', 'perfeito', 'certo', 'claro', 'total', 'pedido', 'entrega', 'quilo', 'quilos',
]);

/**
 * Tokens normalizados: sem acento, sem pontuação, números preservados.
 *
 * Número e letra encostados são separados, e isso não é detalhe: o cliente
 * escreve `"2kg de acai"` e o bot escreve `"2 kg de açaí"`. Sem separar, as
 * duas formas não casam e a auditoria achava que o bot estava repetindo um
 * dado por conta própria quando ele estava ecoando o cliente.
 */
function tokens(texto: string): string[] {
  return normalizar(texto)
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 0);
}

/** As palavras da frase que identificam de que ela fala. */
function assuntos(texto: string): string[] {
  return tokens(texto).filter((t) => t.length >= 3 && !/\d/.test(t) && !SEM_ASSUNTO.has(t));
}

/**
 * Os números do texto, sem zero à esquerda.
 *
 * `"as 8"` e `"08:00"` são o mesmo horário escrito de dois jeitos, e cliente e
 * bot escrevem cada um do seu. Sem igualar os dois, confirmar uma escolha
 * parece repetição.
 */
function numeros(texto: string): Set<string> {
  const achados = new Set<string>();

  for (const t of tokens(texto)) {
    if (/^\d+$/.test(t)) achados.add(String(Number(t)));
  }

  return achados;
}

/**
 * Janelas de 4 tokens que contêm algum número.
 *
 * Quatro, e só as com número, porque o alvo é **fato repetido**, não frase
 * parecida. O caso medido: *"Cada quilo vem com 10 pacotes de 100 g"* no turno
 * 4 e *"1 kg = 10 pacotes de 100 g"* no turno 5 não têm nenhuma frase em comum,
 * mas compartilham a janela `10 pacotes de 100`. Exigir o número é o que
 * impede a saudação e o "perfeito, anotei" de casarem entre si.
 */
function janelasComNumero(texto: string): string[] {
  const t = tokens(texto);
  const janelas: string[] = [];

  for (let i = 0; i + 4 <= t.length; i++) {
    const janela = t.slice(i, i + 4);
    if (janela.some((p) => /\d/.test(p))) janelas.push(janela.join(' '));
  }

  return janelas;
}

/**
 * Divide a resposta em frases para julgar cada uma por si.
 *
 * O emoji separa frase. Não é firula: medido na conversa real, o bot escreveu
 * "Já recebi, sim 😊 Me confirma seu nome completo" — sem ponto no meio. Tratando
 * como uma frase só, o "recebi" fazia a frase inteira passar por reconhecimento
 * e o pedido de nome escapava. No WhatsApp o emoji é a pontuação de quem escreve.
 */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+|\p{Extended_Pictographic}+/u)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/** Os dados que esta resposta do bot está pedindo. */
function dadosPedidosEm(resposta: string): Set<string> {
  const pedidos = new Set<string>();

  for (const frase of frases(resposta)) {
    // Frase de reconhecimento fica fora: "Recebi seu telefone, obrigado. Me
    // confirma a data" pede a DATA, não o telefone. Sem esta exclusão, o
    // relatório acusaria o bot de pedir de novo o que ele acabou de agradecer.
    if (RECONHECIMENTO.test(frase)) continue;
    if (!PEDIDO.test(frase)) continue;

    for (const dado of DADOS) {
      if (dado.pedido.test(frase)) pedidos.add(dado.id);
    }
  }

  return pedidos;
}

/**
 * O cliente forneceu este dado nesta mensagem?
 *
 * @param jaFoiPedido se o bot já pediu este dado antes. Só o NOME depende
 *        disso, e o motivo saiu de um falso positivo real: `"boa boa"` tem a
 *        forma de nome — duas palavras, só letras — e foi contado como o nome
 *        do cliente na primeira mensagem da conversa 23. Nome não tem formato
 *        que o distinga de uma frase curta qualquer; o que o distingue é vir
 *        DEPOIS de alguém perguntar. Telefone, data e hora têm formato próprio
 *        e continuam valendo a qualquer momento, porque o cliente pode dizer
 *        "quero dia 8 às 9" sem ninguém ter pedido.
 */
function clienteForneceu(
  dado: DadoDoAtendimento,
  mensagem: string,
  jaFoiPedido: boolean,
): boolean {
  if (!dado.fornecido) return false;

  const texto = mensagem.trim();
  if (dado.id === 'nome' && (!jaFoiPedido || NAO_E_NOME.test(texto))) return false;

  return dado.fornecido.test(texto);
}

/** O melhor score citado por uma resposta. `null` quando não citou fonte. */
function melhorScore(mensagem: MensagemGravada): number | null {
  if (mensagem.fontes.length === 0) return null;
  return Math.max(...mensagem.fontes.map((f) => f.score));
}

export interface ConversaParaAuditar {
  id: number;
  contatoId: string;
  canal: string;
  status: string;
}

/**
 * O que muda de cliente para cliente na auditoria.
 *
 * `vende` liga os achados que só fazem sentido em quem monta pedido. Numa
 * clínica não existe quantidade de produto, então `pediu_dado_cedo_demais`
 * acusaria toda pergunta de pagamento e `nao_somou` nunca teria o que medir.
 */
export interface OpcoesDeAuditoria {
  vende?: boolean;
}

/**
 * Audita uma conversa inteira.
 *
 * @param limiar o limiar de confiança do tenant, para saber o que é contexto
 *        fraco. Entra por parâmetro porque é ajustável por cliente.
 */
export function auditarConversa(
  conversa: ConversaParaAuditar,
  mensagens: MensagemGravada[],
  limiar: number,
  opcoes: OpcoesDeAuditoria = {},
): RelatorioDeConversa {
  const problemas: ProblemaDaConversa[] = [];
  const respostas = mensagens.filter((m) => m.papel === 'assistant');

  /** Dados que a conversa já tem, e em que ponto passou a ter. */
  const jaFornecido = new Set<string>();
  /** Dados que o bot já pediu antes. */
  const jaPedido = new Set<string>();
  /** Janelas numéricas que o bot já disse, para pegar fato repetido. */
  const jaDito = new Set<string>();
  /** Tudo que o CLIENTE escreveu, palavra por palavra. Ver `repetiu_informacao`. */
  const ditoPeloCliente = new Set<string>();
  /** O cliente já pediu alguma quantidade de produto? */
  let houveQuantidade = false;
  /** A última mensagem do cliente entregou algum dado do atendimento? */
  let clienteEntregouDado = false;

  let turno = 0;

  for (const mensagem of mensagens) {
    if (mensagem.papel === 'user') {
      clienteEntregouDado = false;

      for (const dado of DADOS) {
        if (clienteForneceu(dado, mensagem.conteudo, jaPedido.has(dado.id))) {
          jaFornecido.add(dado.id);
          clienteEntregouDado = true;
        }
      }

      if (TEM_QUANTIDADE.test(mensagem.conteudo)) houveQuantidade = true;
      for (const t of tokens(mensagem.conteudo)) ditoPeloCliente.add(t);
      continue;
    }

    if (mensagem.papel !== 'assistant') continue;
    turno += 1;

    const registrar = (p: Omit<ProblemaDaConversa, 'turno' | 'mensagemId' | 'trecho'>) => {
      problemas.push({
        ...p,
        turno,
        mensagemId: mensagem.id,
        trecho: mensagem.conteudo.replace(/\s*\n+\s*/g, ' / '),
      });
    };

    for (const id of dadosPedidosEm(mensagem.conteudo)) {
      const dado = DADOS.find((d) => d.id === id);
      if (!dado) continue;

      if (jaFornecido.has(id) && !RECUSA.test(mensagem.conteudo)) {
        registrar({
          tipo: 'pedido_repetido',
          grave: true,
          detalhe: `pediu ${dado.rotulo}, que a conversa já tinha`,
        });
      } else if (jaPedido.has(id)) {
        registrar({
          tipo: 'pedido_insistente',
          grave: false,
          detalhe: `pediu ${dado.rotulo} de novo; o cliente ainda não tinha respondido`,
        });
      }

      // Endereço e pagamento são dados de FECHAMENTO. Pedi-los antes de existir
      // pedido assusta quem só perguntou um preço — foi o turno 2 da conversa
      // 33, a segunda mensagem do atendimento: *"Me passa o nome de quem
      // recebe, endereço completo, horário que fica melhor amanhã e a forma de
      // pagamento"*, sem nenhum produto escolhido ainda.
      if (opcoes.vende === true && !houveQuantidade && FECHAMENTO.has(id)) {
        registrar({
          tipo: 'pediu_dado_cedo_demais',
          grave: true,
          detalhe: `pediu ${dado.rotulo} antes de o cliente ter escolhido nada`,
        });
      }

      jaPedido.add(id);
    }

    // O bot também informa dado: quando ele mesmo diz a data, a conversa passa
    // a saber. Foi assim no caso medido — ele ofereceu "sexta (02/10)" e depois
    // pediu "a data exata" três vezes.
    for (const dado of DADOS) {
      if (dado.infereDaRespostaDoBot && dado.fornecido?.test(mensagem.conteudo)) {
        jaFornecido.add(dado.id);
      }
    }

    const mensagemDoCliente = anterior(mensagens, mensagem);

    // O cliente pediu o total e não veio valor nenhum. É o turno 9 da conversa
    // 33, e é o defeito mais caro desta conversa: o bot tinha o pedido e mandou
    // o cliente mandar os itens de novo.
    if (
      opcoes.vende === true &&
      PEDE_TOTAL.test(mensagemDoCliente) &&
      !TEM_VALOR.test(mensagem.conteudo)
    ) {
      registrar({
        tipo: 'nao_somou',
        grave: true,
        detalhe: 'o cliente pediu o total e a resposta não trouxe valor nenhum',
      });
    }

    // Fato numérico repetido sem o cliente ter puxado o assunto.
    //
    // Duas guardas, e as duas saíram de falso positivo real. O alvo é o aviso
    // de prateleira que o bot arrasta de mensagem em mensagem — na conversa 33,
    // "10 pacotes de 100 g" nos turnos 4 e 5 seguidos.
    const assuntosDoCliente = assuntos(mensagemDoCliente);
    const numerosDoCliente = numeros(mensagemDoCliente);
    let acusouRepeticao = false;

    // 0. O cliente acabou de ENTREGAR um dado, então esta resposta é uma
    //    confirmação — e confirmação recapitula. Medido na conversa 32, turno
    //    14: *"Perfeito, entrega amanhã à tarde e pagamento no Pix 😊 Pedido: 2
    //    kg de açaí + 1 kg de cupuaçu. Total: R$ 95,00"* depois de o cliente
    //    dizer "amanha a tarde, pago no pix". Essa é a guarda mais importante
    //    das quatro: sem ela a auditoria puniria justamente o recapitulativo de
    //    pedido que o bot precisa passar a escrever.
    //    E quando o cliente PEDE o total, a resposta certa é um resumo — e
    //    resumo repete por definição. Medido no replay da conversa 33: "qual o
    //    valor de tudo?" levou o pedido inteiro de volta, que é exatamente o
    //    comportamento pedido, e foi acusado de repetição.
    //
    //    Resposta que veio de FERRAMENTA também não conta. É o mesmo raciocínio
    //    que já vale para `afirmou_com_contexto_fraco`: quando os números saem
    //    da ferramenta, eles são o ESTADO ATUAL do pedido, não um aviso de
    //    prateleira que o bot arrasta. Medido na conversa 36: os três achados
    //    graves eram o "Até agora são..." a cada item novo — o recapitulativo
    //    que esta frente existe para criar. O caso que importa sobrevive: o
    //    "10 pacotes de 100 g" da conversa 33 saiu dos documentos, com
    //    `used_tool = 0`.
    const ehConfirmacao =
      clienteEntregouDado || PEDE_TOTAL.test(mensagemDoCliente) || mensagem.usouFerramenta;

    for (const frase of frases(mensagem.conteudo)) {
      // Pedido repetido já tem detector próprio; aqui o alvo é INFORMAÇÃO.
      if (PEDIDO.test(frase)) continue;

      const janelas = janelasComNumero(frase);

      // 1. O cliente trouxe o assunto de volta: repetir é responder. Sem esta
      //    guarda, "Acerola: R$ 25,00 o quilo" logo depois de o cliente pedir
      //    acerola de novo viraria defeito.
      const respondeAoAssunto = assuntos(frase).some((p) => assuntosDoCliente.includes(p));

      // 2. O cliente escolheu um dos números: o bot está CONFIRMANDO. Medido na
      //    conversa 23 da clínica: o bot listou dez horários, o cliente disse
      //    "quero as 8" e ele respondeu "Tem 08:00 na próxima quinta (08/10)" —
      //    resposta certa, e sem esta guarda era acusada de repetição.
      //
      // 3. A janela é só o ECO do que o cliente escreveu: é recapitulação, não
      //    repetição. É o que faz "2 kg de açaí" devolvido ao cliente não ser
      //    defeito — ele mesmo pediu isso.
      const repetidas = janelas.filter(
        (j) =>
          jaDito.has(j) &&
          ![...numeros(j)].some((n) => numerosDoCliente.has(n)) &&
          !tokens(j).every((t) => ditoPeloCliente.has(t)),
      );

      if (!acusouRepeticao && !ehConfirmacao && !respondeAoAssunto && repetidas.length > 0) {
        registrar({
          tipo: 'repetiu_informacao',
          grave: true,
          detalhe: `repetiu "${repetidas[0]}", que já tinha dito, sem o cliente ter perguntado de novo`,
        });
        acusouRepeticao = true;
      }

      for (const janela of janelas) jaDito.add(janela);
    }

    const score = melhorScore(mensagem);
    const social = classificarTurnoSocial(mensagemDoCliente) !== undefined;

    // A confirmação do botão de retomada não é resposta a pergunta nenhuma: o
    // cliente TOCOU numa ação. Não citar fonte é o comportamento certo, e sem
    // esta saída o relatório acusaria `sem_fonte` em toda volta do handoff.
    const ehRetomada = mensagem.conteudo.trim() === config.resposta.fraseDeRetomada;

    if (mensagem.conteudo.toLowerCase().includes(config.resposta.marcadorDeHandoff)) {
      registrar({ tipo: 'handoff', grave: true, detalhe: 'desistiu e chamou a equipe' });
    } else if (ehRetomada) {
      // Nada a auditar: é confirmação de ação.
    } else if (score === null && !social) {
      registrar({
        tipo: 'sem_fonte',
        grave: true,
        detalhe: 'respondeu sem citar fonte, e a mensagem do cliente não era social',
      });
    } else if (
      score !== null &&
      score < limiar &&
      // Quem respondeu foi a agenda: o score da busca não se aplica. Medido na
      // conversa 23 — "tenho horários às 08:00..." saiu da ferramenta, com
      // autoridade total, e o melhor chunk marcava 0.391. O relatório acusou
      // três vezes, e nas três o dado estava certo.
      !mensagem.usouFerramenta &&
      AFIRMA_DADO.test(mensagem.conteudo)
    ) {
      registrar({
        tipo: 'afirmou_com_contexto_fraco',
        grave: true,
        detalhe: `afirmou um dado com o melhor score em ${score.toFixed(3)}, abaixo do limiar de ${limiar}`,
      });
    }
  }

  const turnosComProblemaGrave = new Set(
    problemas.filter((p) => p.grave).map((p) => p.turno),
  ).size;

  const custo = respostas.reduce((s, m) => s + (m.custoUsd ?? 0), 0);
  const latencias = respostas.map((m) => m.latenciaMs ?? 0);
  const scores = respostas.map(melhorScore).filter((s): s is number => s !== null);

  return {
    conversaId: conversa.id,
    contatoId: conversa.contatoId,
    canal: conversa.canal,
    status: conversa.status,
    turnos: respostas.length,
    mensagens: mensagens.length,
    custoUsd: custo,
    custoMedioPorRespostaUsd: respostas.length === 0 ? 0 : custo / respostas.length,
    latenciaMediaMs:
      latencias.length === 0 ? 0 : Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length),
    latenciaPiorMs: latencias.length === 0 ? 0 : Math.max(...latencias),
    scoreMedio: scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
    problemas,
    turnosComProblemaGrave,
    aproveitamento:
      respostas.length === 0 ? 1 : (respostas.length - turnosComProblemaGrave) / respostas.length,
    comecouEm: mensagens[0]?.criadaEm ?? '',
    terminouEm: mensagens[mensagens.length - 1]?.criadaEm ?? '',
  };
}

/** A mensagem do cliente que provocou esta resposta. */
function anterior(mensagens: MensagemGravada[], resposta: MensagemGravada): string {
  const posicao = mensagens.findIndex((m) => m.id === resposta.id);

  for (let i = posicao - 1; i >= 0; i--) {
    if (mensagens[i]?.papel === 'user') return mensagens[i]?.conteudo ?? '';
  }

  return '';
}

/** Carrega e audita, para quem tem o banco na mão. */
export function auditarConversaDoBanco(
  db: Db,
  conversa: ConversaParaAuditar,
  limiar: number,
  opcoes: OpcoesDeAuditoria = {},
): RelatorioDeConversa {
  return auditarConversa(conversa, mensagensApos(db, conversa.id, 0), limiar, opcoes);
}
