/**
 * Execução de uma pergunta de avaliação: pergunta ao motor e julga a resposta.
 *
 * Mora no core, e não dentro do `avaliar.ts`, porque agora tem DOIS chamadores:
 * o `npm run avaliar` (que roda a suíte inteira e grava os logs) e a página de
 * testes do adaptador web (que roda um subconjunto, interativamente). Se cada
 * um tivesse a sua cópia, a página poderia dizer "passou" onde a suíte diz
 * "falhou" — e aí nenhum dos dois serviria para calibrar nada.
 *
 * Roda sempre com `semPersistir`: avaliar não pode criar conversas nem encher a
 * fila da equipe de handoffs que nenhum cliente pediu.
 */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import type { Motor } from '../engine.js';
import { verificar, type PerguntaDeAvaliacao } from './regras.js';
import type { RegistroDeAvaliacao } from './log.js';

export interface DependenciasDaSuite {
  motor: Motor;
  db: Db;
  slug: string;
  tenantId: number;
  /** Limiar em vigor. Vai no registro para o log dizer contra o que foi medido. */
  limiar: number;
  /** Teto de linhas do tenant. Ausente = o default global. */
  maximoDeLinhas?: number;
  /** Id da execução, gravado em cada registro. */
  execucao: string;
}

/** Roda uma pergunta e devolve o registro já julgado. */
export async function rodarPergunta(
  deps: DependenciasDaSuite,
  esperado: PerguntaDeAvaliacao,
): Promise<RegistroDeAvaliacao> {
  const resposta = await deps.motor.responder(
    deps.slug,
    `avaliacao-${esperado.id}`,
    esperado.pergunta,
    { canal: 'avaliacao', semPersistir: true },
  );

  // A checagem de número inventado compara contra o texto REAL dos chunks, não
  // contra o nome do arquivo — senão qualquer preço passaria.
  const contexto = textoDosChunksCitados(deps.db, deps.tenantId, resposta.fontes);
  const verificacao = verificar(esperado, resposta, contexto, deps.maximoDeLinhas);

  return {
    execucao: deps.execucao,
    tenant: deps.slug,
    id: esperado.id,
    pergunta: esperado.pergunta,
    ...(esperado.comentario ? { comentario: esperado.comentario } : {}),
    passou: verificacao.passou,
    falhas: verificacao.falhas,
    resposta: resposta.texto,
    esperavaHandoff: esperado.esperaHandoff === true,
    houveHandoff: resposta.precisaDeHumano,
    melhorScore: resposta.melhorScore,
    fontes: resposta.fontes,
    tokensEntrada: resposta.uso.tokensEntrada,
    tokensSaida: resposta.uso.tokensSaida,
    custoUsd: resposta.uso.custoEstimadoUsd,
    latenciaMs: resposta.uso.latenciaMs,
    modelo: config.llm.modelo,
    limiar: deps.limiar,
  };
}

/**
 * Roda a lista em ordem, avisando a cada pergunta concluída.
 *
 * Sequencial de propósito: em paralelo as latências medidas viram ficção (uma
 * pergunta esperaria a outra no rate limit) e os números deixariam de ser
 * comparáveis com os do `npm run avaliar`, que também roda em fila.
 */
export async function rodarPerguntas(
  deps: DependenciasDaSuite,
  perguntas: PerguntaDeAvaliacao[],
  aoConcluir?: (registro: RegistroDeAvaliacao) => void,
): Promise<RegistroDeAvaliacao[]> {
  const registros: RegistroDeAvaliacao[] = [];

  for (const esperado of perguntas) {
    const registro = await rodarPergunta(deps, esperado);
    registros.push(registro);
    aoConcluir?.(registro);
  }

  return registros;
}

/**
 * Recupera o texto integral dos chunks dos arquivos que embasaram a resposta.
 */
export function textoDosChunksCitados(
  db: Db,
  tenantId: number,
  fontes: { arquivo: string }[],
): string {
  if (fontes.length === 0) return '';

  const arquivos = [...new Set(fontes.map((f) => f.arquivo))];
  const marcadores = arquivos.map(() => '?').join(', ');

  const linhas = db
    .prepare(
      `SELECT c.text
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.tenant_id = ? AND d.filename IN (${marcadores})`,
    )
    .all(tenantId, ...arquivos) as { text: string }[];

  return linhas.map((l) => l.text).join('\n');
}
