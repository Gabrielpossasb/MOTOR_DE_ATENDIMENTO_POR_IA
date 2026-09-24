/**
 * LLM falso para os testes: não chama rede, não gasta crédito e registra o que
 * recebeu, para podermos afirmar o que foi (ou não foi) enviado ao modelo.
 */
import type { LlmClient, RespostaDoLlm } from '../../src/core/llm/client.js';
import type { TurnoDaConversa } from '../../src/core/types.js';

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
