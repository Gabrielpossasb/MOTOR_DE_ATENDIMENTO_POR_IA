/**
 * LLM falso para os testes: não chama rede, não gasta crédito e registra o que
 * recebeu, para podermos afirmar o que foi (ou não foi) enviado ao modelo.
 */
import type { LlmClient, RespostaDoLlm } from '../../src/core/llm/client.js';
import type { TurnoDaConversa } from '../../src/core/types.js';
import { config } from '../../src/config.js';

export interface ChamadaRegistrada {
  promptDoSistema: string;
  mensagemDoUsuario: string;
  historico: TurnoDaConversa[];
}

export class LlmFake implements LlmClient {
  readonly modelo = 'fake';

  /** Todas as chamadas feitas, em ordem. Vazio significa que o LLM não foi usado. */
  readonly chamadas: ChamadaRegistrada[] = [];

  constructor(private readonly respostaFixa = 'Abrimos de segunda a sexta, das 8h às 18h.') {}

  async responder(
    promptDoSistema: string,
    mensagemDoUsuario: string,
    historico: TurnoDaConversa[] = [],
  ): Promise<RespostaDoLlm> {
    this.chamadas.push({ promptDoSistema, mensagemDoUsuario, historico });
    return { texto: this.respostaFixa, tokensEntrada: 120, tokensSaida: 18 };
  }
}

/**
 * Responde normalmente, mas desiste quando a mensagem contém um gatilho.
 *
 * Existe porque o handoff deixou de depender do limiar. Antes, bastava mandar
 * uma pergunta fora do assunto que o score baixo a barrava antes do modelo;
 * hoje toda mensagem chega ao modelo, e quem decide escalar é ele. Os testes
 * que precisam de um handoff controlam isso aqui, em vez de contar com a
 * mecânica da busca — que é outro assunto e tem os seus próprios testes.
 */
export class LlmQueDesiste extends LlmFake {
  constructor(private readonly gatilho = 'pizza') {
    super();
  }

  override async responder(
    promptDoSistema: string,
    mensagemDoUsuario: string,
    historico: TurnoDaConversa[] = [],
  ): Promise<RespostaDoLlm> {
    if (mensagemDoUsuario.toLowerCase().includes(this.gatilho)) {
      this.chamadas.push({ promptDoSistema, mensagemDoUsuario, historico });
      return { texto: config.resposta.fraseDeHandoff, tokensEntrada: 10, tokensSaida: 5 };
    }

    return super.responder(promptDoSistema, mensagemDoUsuario, historico);
  }
}
