/**
 * Janela de contexto da conversa e encerramento.
 *
 * Mandar a conversa inteira ao modelo é caro e piora a qualidade: quanto mais
 * texto antigo, menos peso as regras do prompt e os chunks recuperados têm.
 * Por isso só as últimas N mensagens vão junto.
 */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import { mensagensApos, ultimasMensagens } from '../../storage/repositories/messages.js';
import {
  conversaAtiva,
  lerResumo,
  mudarStatus,
  salvarResumo,
} from '../../storage/repositories/conversations.js';
import type { LlmClient } from '../llm/client.js';
import { custoDaResposta } from '../llm/client.js';
import { montarEntradaDoResumo, montarPromptDeResumo } from '../llm/prompts.js';
import { BOT_ESTA_PEDINDO } from './auditoria.js';
import { classificarTurnoSocial } from './turno-social.js';
import type { TurnoDaConversa } from '../types.js';

/**
 * Monta a janela de contexto a ser enviada ao modelo.
 *
 * Mensagens de handoff ficam de fora: repetir "vou chamar alguém da equipe" no
 * histórico ensina o modelo a repetir a frase, que é o oposto do que queremos.
 */
export function janelaDeContexto(db: Db, conversaId: number, limite?: number): TurnoDaConversa[] {
  const maximo = limite ?? config.conversa.mensagensNaJanela;

  return ultimasMensagens(db, conversaId, maximo)
    .filter((m) => m.papel === 'user' || m.papel === 'assistant')
    .filter((m) => !ehFraseDeHandoff(m.conteudo))
    .map((m) => ({
      papel: m.papel as 'user' | 'assistant',
      conteudo: m.conteudo,
    }));
}

function ehFraseDeHandoff(texto: string): boolean {
  return texto.trim() === config.resposta.fraseDeHandoff;
}

/**
 * A última coisa que o cliente perguntou de verdade nesta conversa.
 *
 * Serve para desambiguar uma pergunta que se apoia na anterior ("e o canal?").
 * Saudação não conta: combinar "oi" com a pergunta nova não ajuda a busca em
 * nada, só adiciona ruído ao vetor.
 */
export function ultimaPerguntaDoCliente(db: Db, conversaId: number): string | undefined {
  const recentes = ultimasMensagens(db, conversaId, config.conversa.mensagensNaJanela);

  for (let i = recentes.length - 1; i >= 0; i--) {
    const mensagem = recentes[i];
    if (!mensagem || mensagem.papel !== 'user') continue;

    const texto = mensagem.conteudo.trim();
    if (texto.length === 0) continue;
    if (classificarTurnoSocial(texto) !== undefined) continue;

    return texto;
  }

  return undefined;
}

/**
 * A última coisa que o bot disse deixou um pedido aberto?
 *
 * Existe para um beco sem saída medido na conversa 33: o bot pediu quatro
 * informações, o cliente respondeu `"ok"` e a resposta foi *"Perfeito, fico no
 * aguardo 😊"*. O `"ok"` está na lista de confirmações sociais, então o turno
 * foi para o prompt social — que não recebe documento nenhum e por regra não
 * pode falar do negócio. Resultado: ar morto no meio de um atendimento.
 *
 * Um `"ok"` depois de um pedido do bot não é cumprimento: é o cliente
 * reconhecendo algo pendente, e quem tem de responder é o caminho normal, com
 * histórico e documentos na mão.
 *
 * NÃO basta procurar `?`. Medido no replay: *"Me fala quais sabores e quantos
 * kg de cada um você quer 😊"* é um pedido aberto e não tem interrogação
 * nenhuma — e o `"ok"` seguinte escapou por isso. O padrão é o mesmo que a
 * auditoria usa para dizer que o bot está pedindo algo.
 */
export function botPediuAlgo(db: Db, conversaId: number): boolean {
  const recentes = ultimasMensagens(db, conversaId, config.conversa.mensagensNaJanela);

  for (let i = recentes.length - 1; i >= 0; i--) {
    const mensagem = recentes[i];
    if (!mensagem || mensagem.papel !== 'assistant') continue;
    return BOT_ESTA_PEDINDO.test(mensagem.conteudo);
  }

  return false;
}

/** O que vai ao modelo: a memória compactada mais as mensagens ainda íntegras. */
export interface ContextoDaConversa {
  resumo?: string;
  historico: TurnoDaConversa[];
}

/** Tokens e custo gastos numa compactação. Zero quando não houve. */
export interface CustoDaCompactacao {
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}

export const SEM_CUSTO: CustoDaCompactacao = { tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 };

/**
 * Compacta as mensagens que estão saindo da janela, se já houver o bastante.
 *
 * Roda ANTES de responder, então o próprio turno atual já enxerga a memória.
 * O preço disso é uma chamada a mais ao modelo no turno em que compacta — a
 * cada 2 turnos, com os valores padrão. Sai mais barato que o cliente repetir
 * o que já contou e desistir do atendimento.
 *
 * A memória é cumulativa: o resumo anterior entra junto com as mensagens
 * novas, senão a segunda compactação esqueceria o começo da conversa.
 */
export async function compactarSeNecessario(
  db: Db,
  llm: LlmClient,
  conversaId: number,
): Promise<CustoDaCompactacao> {
  if (!config.conversa.resumo.ativo) return SEM_CUSTO;

  const resumoAtual = lerResumo(db, conversaId);
  const pendentes = mensagensApos(db, conversaId, resumoAtual?.ateMensagemId ?? 0);

  // Ainda cabe na janela: não há nada saindo, então não há o que compactar.
  if (pendentes.length <= config.conversa.mensagensNaJanela) return SEM_CUSTO;

  const preservadas = config.conversa.resumo.mensagensPreservadas;
  const paraCompactar = pendentes.slice(0, pendentes.length - preservadas);
  if (paraCompactar.length === 0) return SEM_CUSTO;

  const ultima = paraCompactar[paraCompactar.length - 1];
  if (!ultima) return SEM_CUSTO;

  const resposta = await llm.responder(
    montarPromptDeResumo(),
    montarEntradaDoResumo(
      resumoAtual?.texto,
      paraCompactar.map((m) => ({ papel: m.papel, conteudo: m.conteudo })),
    ),
  );

  const texto = resposta.texto.trim();

  // Resumo vazio apagaria a memória em vez de estendê-la. Melhor manter o
  // anterior e tentar de novo no próximo turno.
  if (texto.length === 0) return SEM_CUSTO;

  salvarResumo(db, conversaId, { texto, ateMensagemId: ultima.id });

  return {
    tokensEntrada: resposta.tokensEntrada,
    tokensSaida: resposta.tokensSaida,
    custoUsd: custoDaResposta(resposta.tokensEntrada, resposta.tokensSaida),
  };
}

/**
 * Monta o contexto da conversa: memória compactada + mensagens íntegras.
 *
 * As íntegras são só as posteriores à marca d'água do resumo — mandar junto o
 * que já está resumido pagaria duas vezes pelo mesmo conteúdo.
 */
export function montarContextoDaConversa(db: Db, conversaId: number): ContextoDaConversa {
  const resumo = config.conversa.resumo.ativo ? lerResumo(db, conversaId) : undefined;

  if (!resumo) return { historico: janelaDeContexto(db, conversaId) };

  const historico = mensagensApos(db, conversaId, resumo.ateMensagemId)
    .slice(-config.conversa.mensagensNaJanela)
    .filter((m) => m.papel === 'user' || m.papel === 'assistant')
    .filter((m) => !ehFraseDeHandoff(m.conteudo))
    .map((m) => ({ papel: m.papel as 'user' | 'assistant', conteudo: m.conteudo }));

  return { resumo: resumo.texto, historico };
}

/**
 * Encerra a conversa em andamento do contato, para a próxima mensagem começar
 * do zero — sem histórico e sem herdar o status.
 *
 * Fecha em vez de apagar: o histórico é o que alimenta o painel e a lista de
 * buracos da base. Apagar para poder testar de novo jogaria fora justamente o
 * dado que o teste produziu.
 *
 * Também é a saída de uma conversa presa em `handoff`. Depois de um handoff o
 * bot fica mudo de propósito, para não atropelar o atendente; sem uma forma de
 * encerrar, o único jeito de voltar a conversar era trocar de contato.
 *
 * @returns o id da conversa encerrada, ou `undefined` se não havia nenhuma.
 */
export function encerrarConversa(
  db: Db,
  tenantId: number,
  contatoId: string,
): number | undefined {
  const conversa = conversaAtiva(db, tenantId, contatoId);
  if (!conversa) return undefined;

  mudarStatus(db, conversa.id, 'closed');
  return conversa.id;
}
