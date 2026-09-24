/**
 * Cliente do modelo de linguagem.
 *
 * O núcleo depende da interface `LlmClient`. Trocar OpenAI por Anthropic, ou
 * por um modelo local, é acrescentar uma implementação aqui. Os testes usam um
 * cliente falso e não gastam crédito.
 */
import OpenAI from 'openai';
import { config } from '../../config.js';
import type { TurnoDaConversa } from '../types.js';

export interface RespostaDoLlm {
  texto: string;
  tokensEntrada: number;
  tokensSaida: number;
}

export interface LlmClient {
  readonly modelo: string;
  /**
   * @param historico turnos anteriores, do mais antigo para o mais recente.
   *        A pergunta atual NÃO vem aqui — ela vai em `mensagemDoUsuario`,
   *        junto com o contexto recuperado.
   */
  responder(
    promptDoSistema: string,
    mensagemDoUsuario: string,
    historico?: TurnoDaConversa[],
  ): Promise<RespostaDoLlm>;
}

export class LlmOpenAI implements LlmClient {
  readonly modelo: string;
  private readonly cliente: OpenAI;

  constructor(apiKey: string = config.openai.apiKey, modelo: string = config.llm.modelo) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada. Copie .env.example para .env e preencha a chave.');
    }
    this.cliente = new OpenAI({ apiKey });
    this.modelo = modelo;
  }

  async responder(
    promptDoSistema: string,
    mensagemDoUsuario: string,
    historico: TurnoDaConversa[] = [],
  ): Promise<RespostaDoLlm> {
    const resposta = await this.cliente.chat.completions.create({
      model: this.modelo,
      // `max_completion_tokens` e não `max_tokens`: a linha gpt-5.x recusa o
      // parâmetro antigo, e a gpt-4.x aceita o novo. Usando o novo em tudo,
      // trocar de modelo pelo .env não quebra nada.
      max_completion_tokens: config.llm.maxTokensDeResposta,
      temperature: config.llm.temperatura,
      messages: [
        { role: 'system', content: promptDoSistema },
        ...historico.map((t) => ({ role: t.papel, content: t.conteudo })),
        { role: 'user', content: mensagemDoUsuario },
      ],
    });

    return {
      texto: resposta.choices[0]?.message?.content?.trim() ?? '',
      tokensEntrada: resposta.usage?.prompt_tokens ?? 0,
      tokensSaida: resposta.usage?.completion_tokens ?? 0,
    };
  }
}

/** Custo em dólares de uma resposta, a partir dos tokens consumidos. */
export function custoDaResposta(tokensEntrada: number, tokensSaida: number): number {
  const entrada = (tokensEntrada / 1_000_000) * config.llm.precoEntradaPorMilhaoDeTokens;
  const saida = (tokensSaida / 1_000_000) * config.llm.precoSaidaPorMilhaoDeTokens;
  return entrada + saida;
}
