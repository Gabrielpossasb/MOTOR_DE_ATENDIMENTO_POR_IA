/**
 * Cliente do modelo de linguagem.
 *
 * O núcleo depende da interface `LlmClient`. Trocar OpenAI por Anthropic, ou
 * por um modelo local, é acrescentar uma implementação aqui. Os testes usam um
 * cliente falso e não gastam crédito.
 *
 * A interface fala o vocabulário do projeto — `Ferramenta`, `ChamadaDeFerramenta`
 * — e não o de nenhum provedor. Quem traduz para `tools`/`tool_calls` é a
 * implementação da OpenAI, e só ela.
 */
import OpenAI from 'openai';
import { config } from '../../config.js';
import type { TurnoDaConversa } from '../types.js';

/** Uma função que o modelo pode pedir para executar. */
export interface Ferramenta {
  nome: string;
  descricao: string;
  /** JSON Schema dos argumentos. */
  parametros: Record<string, unknown>;
}

/** O modelo pediu para executar uma ferramenta. */
export interface ChamadaDeFerramenta {
  /** Id que o provedor deu à chamada; precisa voltar junto com o resultado. */
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
}

/** Uma ferramenta já executada, com o que ela devolveu. */
export interface TurnoDeFerramenta {
  chamada: ChamadaDeFerramenta;
  /** Resultado serializado em JSON. */
  resultado: string;
}

export interface OpcoesDoLlm {
  /** O que o modelo pode chamar nesta mensagem. */
  ferramentas?: Ferramenta[];
  /** O que já rodou nesta mesma mensagem, para o modelo continuar de onde parou. */
  turnosDeFerramenta?: TurnoDeFerramenta[];
}

export interface RespostaDoLlm {
  texto: string;
  tokensEntrada: number;
  tokensSaida: number;
  /** Quando presente, o modelo quer executar isto antes de responder. */
  ferramentas?: ChamadaDeFerramenta[];
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
    opcoes?: OpcoesDoLlm,
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
    opcoes: OpcoesDoLlm = {},
  ): Promise<RespostaDoLlm> {
    const mensagens: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: promptDoSistema },
      ...historico.map((t) => ({ role: t.papel, content: t.conteudo })),
      { role: 'user', content: mensagemDoUsuario },
    ];

    // Refaz o vai-e-vem das ferramentas já executadas. A API exige a mensagem
    // do assistente com os `tool_calls` antes de cada resultado, e o
    // `tool_call_id` casando — sem isso ela recusa a requisição inteira.
    for (const turno of opcoes.turnosDeFerramenta ?? []) {
      mensagens.push({
        role: 'assistant',
        tool_calls: [
          {
            id: turno.chamada.id,
            type: 'function',
            function: {
              name: turno.chamada.nome,
              arguments: JSON.stringify(turno.chamada.argumentos),
            },
          },
        ],
      });
      mensagens.push({
        role: 'tool',
        tool_call_id: turno.chamada.id,
        content: turno.resultado,
      });
    }

    const resposta = await this.cliente.chat.completions.create({
      model: this.modelo,
      // `max_completion_tokens` e não `max_tokens`: a linha gpt-5.x recusa o
      // parâmetro antigo, e a gpt-4.x aceita o novo. Usando o novo em tudo,
      // trocar de modelo pelo .env não quebra nada.
      max_completion_tokens: config.llm.maxTokensDeResposta,
      temperature: config.llm.temperatura,
      messages: mensagens,
      ...(opcoes.ferramentas && opcoes.ferramentas.length > 0
        ? {
            tools: opcoes.ferramentas.map((f) => ({
              type: 'function' as const,
              function: { name: f.nome, description: f.descricao, parameters: f.parametros },
            })),
          }
        : {}),
    });

    const escolha = resposta.choices[0]?.message;
    const chamadas = (escolha?.tool_calls ?? []).flatMap(paraChamada);

    return {
      texto: escolha?.content?.trim() ?? '',
      tokensEntrada: resposta.usage?.prompt_tokens ?? 0,
      tokensSaida: resposta.usage?.completion_tokens ?? 0,
      ...(chamadas.length > 0 ? { ferramentas: chamadas } : {}),
    };
  }
}

/**
 * Traduz uma chamada da OpenAI para o vocabulário do núcleo.
 *
 * Argumento vem como string de JSON, e o modelo às vezes produz JSON quebrado.
 * Nesse caso a chamada é DESCARTADA em vez de derrubar a resposta inteira: o
 * motor segue sem ela, e o modelo tem a volta seguinte para tentar de novo.
 */
function paraChamada(bruta: OpenAI.Chat.ChatCompletionMessageToolCall): ChamadaDeFerramenta[] {
  if (bruta.type !== 'function') return [];

  try {
    const argumentos = JSON.parse(bruta.function.arguments || '{}') as Record<string, unknown>;
    return [{ id: bruta.id, nome: bruta.function.name, argumentos }];
  } catch {
    return [];
  }
}

/** Custo em dólares de uma resposta, a partir dos tokens consumidos. */
export function custoDaResposta(tokensEntrada: number, tokensSaida: number): number {
  const entrada = (tokensEntrada / 1_000_000) * config.llm.precoEntradaPorMilhaoDeTokens;
  const saida = (tokensSaida / 1_000_000) * config.llm.precoSaidaPorMilhaoDeTokens;
  return entrada + saida;
}
