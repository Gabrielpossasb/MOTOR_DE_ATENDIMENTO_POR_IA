/**
 * Log das execuções de avaliação.
 *
 * Duas saídas, de propósito:
 *   - `historico.jsonl` é append-only e legível por máquina. É o que permite
 *     comparar execuções e ver a trajetória de uma pergunta ao longo do tempo.
 *   - os `.md` são para ler. Sem eles o log vira um arquivo que ninguém abre,
 *     e um log que ninguém abre não calibra nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FalhaDeRegra } from './regras.js';

/** Uma pergunta avaliada numa execução. */
export interface RegistroDeAvaliacao {
  execucao: string;
  tenant: string;
  id: string;
  pergunta: string;
  /** Anotação escrita no avaliacao.json: por que esta pergunta está na suíte. */
  comentario?: string;
  passou: boolean;
  falhas: FalhaDeRegra[];
  resposta: string;
  esperavaHandoff: boolean;
  houveHandoff: boolean;
  melhorScore: number;
  fontes: { arquivo: string; secao?: string; score: number }[];
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  latenciaMs: number;
  modelo: string;
  limiar: number;
}

export interface ResumoDaExecucao {
  execucao: string;
  tenant: string;
  modelo: string;
  limiar: number;
  total: number;
  passaram: number;
  acuracia: number;
  custoTotalUsd: number;
  custoMedioUsd: number;
  latenciaMediaMs: number;
}

const PASTA_LOGS = 'logs';
const ARQUIVO_HISTORICO = path.join(PASTA_LOGS, 'historico.jsonl');
const PASTA_EXECUCOES = path.join(PASTA_LOGS, 'avaliacoes');

/** Identificador da execução: serve de nome de arquivo e de chave de ordenação. */
export function novoIdDeExecucao(agora = new Date()): string {
  return agora.toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

export function garantirPastas(raiz: string): void {
  fs.mkdirSync(path.join(raiz, PASTA_EXECUCOES), { recursive: true });
}

/** Acrescenta os registros ao histórico, sem reescrever o que já existe. */
export function gravarHistorico(raiz: string, registros: RegistroDeAvaliacao[]): void {
  const linhas = registros.map((r) => JSON.stringify(r)).join('\n');
  fs.appendFileSync(path.join(raiz, ARQUIVO_HISTORICO), `${linhas}\n`, 'utf8');
}

/** Lê todo o histórico. Linha corrompida é ignorada em vez de derrubar o relatório. */
export function lerHistorico(raiz: string): RegistroDeAvaliacao[] {
  const arquivo = path.join(raiz, ARQUIVO_HISTORICO);
  if (!fs.existsSync(arquivo)) return [];

  const registros: RegistroDeAvaliacao[] = [];
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    if (linha.trim().length === 0) continue;
    try {
      registros.push(JSON.parse(linha) as RegistroDeAvaliacao);
    } catch {
      // Linha inválida (escrita interrompida, por exemplo): segue o baile.
    }
  }
  return registros;
}

/** Resultado da execução anterior, por id de pergunta — base da comparação. */
export function resultadoAnterior(
  raiz: string,
  tenant: string,
  execucaoAtual: string,
): Map<string, boolean> {
  const anteriores = lerHistorico(raiz).filter(
    (r) => r.tenant === tenant && r.execucao !== execucaoAtual,
  );

  if (anteriores.length === 0) return new Map();

  const ultimaExecucao = anteriores
    .map((r) => r.execucao)
    .sort()
    .at(-1);

  return new Map(
    anteriores.filter((r) => r.execucao === ultimaExecucao).map((r) => [r.id, r.passou]),
  );
}

export function resumir(registros: RegistroDeAvaliacao[], resumoBase: Omit<ResumoDaExecucao, 'total' | 'passaram' | 'acuracia' | 'custoTotalUsd' | 'custoMedioUsd' | 'latenciaMediaMs'>): ResumoDaExecucao {
  const total = registros.length;
  const passaram = registros.filter((r) => r.passou).length;
  const custoTotal = registros.reduce((s, r) => s + r.custoUsd, 0);
  const latenciaTotal = registros.reduce((s, r) => s + r.latenciaMs, 0);

  return {
    ...resumoBase,
    total,
    passaram,
    acuracia: total === 0 ? 0 : passaram / total,
    custoTotalUsd: custoTotal,
    custoMedioUsd: total === 0 ? 0 : custoTotal / total,
    latenciaMediaMs: total === 0 ? 0 : Math.round(latenciaTotal / total),
  };
}

/** Monta o relatório legível de uma execução. */
export function montarRelatorio(
  resumo: ResumoDaExecucao,
  registros: RegistroDeAvaliacao[],
  anterior: Map<string, boolean>,
): string {
  const linhas: string[] = [];

  const regressoes = registros.filter((r) => !r.passou && anterior.get(r.id) === true);
  const correcoes = registros.filter((r) => r.passou && anterior.get(r.id) === false);

  linhas.push(`# Avaliação ${resumo.execucao} — ${resumo.tenant}`);
  linhas.push('');
  linhas.push(`Modelo \`${resumo.modelo}\` · limiar ${resumo.limiar}`);
  linhas.push('');
  linhas.push('| | |');
  linhas.push('|---|---|');
  linhas.push(`| Acurácia | **${(resumo.acuracia * 100).toFixed(1)}%** (${resumo.passaram}/${resumo.total}) |`);
  linhas.push(`| Custo total | US$ ${resumo.custoTotalUsd.toFixed(6)} |`);
  linhas.push(`| Custo médio por pergunta | US$ ${resumo.custoMedioUsd.toFixed(6)} |`);
  linhas.push(`| Latência média | ${resumo.latenciaMediaMs} ms |`);
  linhas.push('');

  // A seção mais importante do relatório: separa "eu piorei" de "o modelo variou".
  if (anterior.size === 0) {
    linhas.push('> Primeira execução para este tenant: não há com o que comparar.');
    linhas.push('');
  } else {
    linhas.push('## Regressões');
    linhas.push('');
    if (regressoes.length === 0) {
      linhas.push('Nenhuma. Nada que passava antes falhou agora.');
    } else {
      for (const r of regressoes) {
        linhas.push(`- **${r.id}** — ${r.falhas.map((f) => f.detalhe).join('; ')}`);
      }
    }
    linhas.push('');

    if (correcoes.length > 0) {
      linhas.push('## Corrigidas nesta execução');
      linhas.push('');
      for (const r of correcoes) linhas.push(`- ${r.id}`);
      linhas.push('');
    }
  }

  const falharam = registros.filter((r) => !r.passou);
  linhas.push(`## Falhas (${falharam.length})`);
  linhas.push('');
  if (falharam.length === 0) {
    linhas.push('Nenhuma.');
    linhas.push('');
  } else {
    for (const r of falharam) linhas.push(...detalharPergunta(r));
  }

  linhas.push(`## Passaram (${registros.length - falharam.length})`);
  linhas.push('');
  for (const r of registros.filter((x) => x.passou)) linhas.push(...detalharPergunta(r));

  return linhas.join('\n');
}

function detalharPergunta(r: RegistroDeAvaliacao): string[] {
  const linhas: string[] = [];
  const marca = r.passou ? 'OK' : 'FALHOU';

  linhas.push(`### ${marca} · \`${r.id}\``);
  linhas.push('');
  linhas.push(`**Pergunta:** ${r.pergunta}`);
  linhas.push('');
  linhas.push(`**Resposta:** ${r.resposta.length > 0 ? r.resposta : '_(vazia)_'}`);
  linhas.push('');

  // A anotação diz POR QUE a pergunta está na suíte. Sem ela no relatório, seis
  // meses depois ninguém lembra se um handoff esperado era intencional.
  if (r.comentario) {
    linhas.push(`> ${r.comentario}`);
    linhas.push('');
  }

  if (!r.passou) {
    linhas.push('**Por que falhou:**');
    for (const f of r.falhas) linhas.push(`- \`${f.regra}\`: ${f.detalhe}`);
    linhas.push('');
  }

  const fontes =
    r.fontes.length > 0
      ? r.fontes.map((f) => `${f.arquivo}${f.secao ? ` §${f.secao}` : ''} (${f.score.toFixed(3)})`).join(', ')
      : 'nenhuma';

  linhas.push(
    `<sub>handoff: esperado ${r.esperavaHandoff ? 'sim' : 'não'}, obtido ${r.houveHandoff ? 'sim' : 'não'} · ` +
      `best_score ${r.melhorScore.toFixed(3)} · ${r.latenciaMs}ms · ` +
      `${r.tokensEntrada}→${r.tokensSaida} tokens · US$ ${r.custoUsd.toFixed(6)}</sub>`,
  );
  linhas.push('');
  linhas.push(`<sub>fontes: ${fontes}</sub>`);
  linhas.push('');

  return linhas;
}

export function salvarRelatorio(raiz: string, execucao: string, conteudo: string): string[] {
  const doHistorico = path.join(raiz, PASTA_EXECUCOES, `${execucao}.md`);
  const ultimo = path.join(raiz, PASTA_LOGS, 'ULTIMO.md');

  fs.writeFileSync(doHistorico, conteudo, 'utf8');
  fs.writeFileSync(ultimo, conteudo, 'utf8');

  return [doHistorico, ultimo];
}
