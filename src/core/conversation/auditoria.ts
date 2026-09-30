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
  | 'handoff';

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
  },
  {
    id: 'convenio',
    rotulo: 'o convênio',
    pedido: /conv[êe]nio|carteirinha|plano odontol[óo]gico/i,
    fornecido:
      /n[ãa]o tenho conv|sem conv|particular|tenho conv|meu conv|amil|unimed|bradesco|sulam|odontoprev|metlife|porto seguro/i,
  },
  {
    id: 'data',
    rotulo: 'a data',
    pedido: /data exata|qual (o )?dia|que dia|confirma a data|para qual data|qual data/i,
    fornecido:
      /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|sabado|domingo|amanh[ãa]|hoje|depois de amanh|\d{1,2}\/\d{1,2}|dia \d{1,2}/i,
  },
  {
    id: 'horario',
    rotulo: 'o horário',
    pedido: /qual (o )?hor[áa]rio|que hor[áa]rio|hor[áa]rio (que |voc[êe] )?prefer|qual hora/i,
    fornecido: /\d{1,2}\s*[:h]\s*\d{0,2}|[àa]s \d{1,2}|de manh[ãa]|[àa] tarde|meio[- ]dia/i,
  },
];

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

/** O bot está PEDINDO, e não comentando. Sem isto, "já posso agendar com seu
 *  nome e telefone" contaria como pedido de nome e de telefone. */
const PEDIDO =
  /\?|me (manda|mande|envia|envie|confirma|confirme|informa|informe|diz|diga|passa|passe)|preciso d|pode (me )?(mandar|enviar|informar|confirmar|dizer|passar)|falta(m)? |qual|quais|informe|confirme/i;

/** Resposta que afirma um dado: preço, quantidade, hora, parcela. */
const AFIRMA_DADO = /r\$\s*\d|\d{1,2}\s*:\s*\d{2}|\d+\s*x\b|\d{2,}/i;

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
 * Audita uma conversa inteira.
 *
 * @param limiar o limiar de confiança do tenant, para saber o que é contexto
 *        fraco. Entra por parâmetro porque é ajustável por cliente.
 */
export function auditarConversa(
  conversa: ConversaParaAuditar,
  mensagens: MensagemGravada[],
  limiar: number,
): RelatorioDeConversa {
  const problemas: ProblemaDaConversa[] = [];
  const respostas = mensagens.filter((m) => m.papel === 'assistant');

  /** Dados que a conversa já tem, e em que ponto passou a ter. */
  const jaFornecido = new Set<string>();
  /** Dados que o bot já pediu antes. */
  const jaPedido = new Set<string>();

  let turno = 0;

  for (const mensagem of mensagens) {
    if (mensagem.papel === 'user') {
      for (const dado of DADOS) {
        if (clienteForneceu(dado, mensagem.conteudo, jaPedido.has(dado.id))) {
          jaFornecido.add(dado.id);
        }
      }
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

      if (jaFornecido.has(id)) {
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

      jaPedido.add(id);
    }

    // O bot também informa dado: quando ele mesmo diz a data, a conversa passa
    // a saber. Foi assim no caso medido — ele ofereceu "sexta (02/10)" e depois
    // pediu "a data exata" três vezes.
    for (const dado of DADOS) {
      if (dado.fornecido && dado.id !== 'nome' && dado.fornecido.test(mensagem.conteudo)) {
        jaFornecido.add(dado.id);
      }
    }

    const score = melhorScore(mensagem);
    const social = classificarTurnoSocial(anterior(mensagens, mensagem)) !== undefined;

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
): RelatorioDeConversa {
  return auditarConversa(conversa, mensagensApos(db, conversa.id, 0), limiar);
}
