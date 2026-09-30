/**
 * Junta mensagens seguidas do mesmo cliente num turno só.
 *
 * Ninguém escreve um parágrafo no WhatsApp: escreve "quero marcar", depois
 * "pra sexta", depois "as 9". Sem isto o bot responde três vezes a um pedido
 * só — foi o que aconteceu nas conversas 22 e 23.
 *
 * O ideal seria esperar o cliente PARAR DE DIGITAR, e isso não existe: no
 * WhatsApp oficial o indicador de digitação é mão única (do negócio para o
 * cliente) e nenhum webhook carrega presença. Quem tem esse sinal são as
 * bibliotecas não-oficiais, que arriscam o banimento do número. Sobra o único
 * sinal disponível — mensagem chegando — e um contador que REINICIA a cada
 * mensagem nova. Na prática dá quase no mesmo: quem está escrevendo a segunda
 * manda em poucos segundos.
 *
 * Fica no core, e não no adaptador, por dois motivos: como várias mensagens
 * viram um turno é decisão de negócio e precisa de teste offline, e o
 * adaptador de WhatsApp vai usar exatamente este código quando chegar. Lá ele
 * não vai poder segurar a requisição (webhook precisa responder 200 na hora),
 * então vai usar o mesmo `receber` sem await e mandar a resposta depois.
 */

export interface OpcoesDoAgrupador {
  /** Quanto esperar por mais mensagens. Reinicia a cada mensagem nova. */
  esperaMs: number;
  /**
   * Teto contado desde a PRIMEIRA mensagem do lote.
   *
   * Sem ele, quem digita sem parar nunca recebe resposta: cada mensagem nova
   * empurraria o prazo para frente indefinidamente.
   */
  esperaMaximaMs: number;
}

type Resolver = (texto: string | undefined) => void;

interface Lote {
  textos: string[];
  /** Instante da primeira mensagem, para o teto de espera. */
  abertoEm: number;
  /** Só o resolver da ÚLTIMA mensagem: as anteriores já foram respondidas. */
  resolver: Resolver;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * O texto que o modelo vai ver.
 *
 * Quebra de linha e não espaço: assim o modelo enxerga que foram mensagens
 * separadas, e no transcrito dá para ver onde uma terminou e a outra começou.
 */
export function juntarMensagens(textos: string[]): string {
  return textos
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join('\n');
}

export class AgrupadorDeMensagens {
  /** Um lote por conversa. A chave inclui o tenant — o servidor é multi-tenant. */
  private readonly lotes = new Map<string, Lote>();

  constructor(private readonly opcoes: OpcoesDoAgrupador) {}

  /** Chave de lote. Nunca só o contato: dois tenants podem ter o mesmo id. */
  static chave(tenantSlug: string, contatoId: string): string {
    return `${tenantSlug}|${contatoId}`;
  }

  /**
   * Registra uma mensagem e espera o turno fechar.
   *
   * @returns o texto juntado, se esta foi a última mensagem do turno;
   *          `undefined` se ela foi absorvida por uma mensagem posterior.
   */
  receber(chave: string, texto: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const agora = Date.now();
      let lote = this.lotes.get(chave);

      if (lote) {
        if (lote.timer) clearTimeout(lote.timer);
        // A mensagem anterior foi absorvida por esta. Responde JÁ, em vez de
        // deixar a requisição pendurada até o turno fechar — do outro lado há
        // uma conexão HTTP aberta esperando.
        lote.resolver(undefined);
        lote.textos.push(texto);
        lote.resolver = resolve;
      } else {
        lote = { textos: [texto], abertoEm: agora, resolver: resolve };
        this.lotes.set(chave, lote);
      }

      lote.timer = setTimeout(() => this.fechar(chave), this.quantoFalta(lote, agora));
    });
  }

  /** Quanto ainda dá para esperar, respeitando o teto do lote. */
  private quantoFalta(lote: Lote, agora: number): number {
    const restanteDoTeto = this.opcoes.esperaMaximaMs - (agora - lote.abertoEm);
    return Math.max(0, Math.min(this.opcoes.esperaMs, restanteDoTeto));
  }

  private fechar(chave: string): void {
    const lote = this.lotes.get(chave);
    if (!lote) return;

    this.lotes.delete(chave);
    if (lote.timer) clearTimeout(lote.timer);
    lote.resolver(juntarMensagens(lote.textos));
  }

  /**
   * Cancela tudo que está pendente. É o que o servidor chama ao encerrar.
   *
   * Resolve com `undefined`, e não com o texto: o processo está caindo, e
   * mandar responder agora faria o motor escrever num banco que está
   * fechando. Sem isto, um timer pendente segura o processo vivo.
   */
  encerrar(): void {
    for (const lote of this.lotes.values()) {
      if (lote.timer) clearTimeout(lote.timer);
      lote.resolver(undefined);
    }
    this.lotes.clear();
  }

  /** Quantos lotes estão abertos. Existe para o teste conferir que não vazou. */
  get pendentes(): number {
    return this.lotes.size;
  }
}
