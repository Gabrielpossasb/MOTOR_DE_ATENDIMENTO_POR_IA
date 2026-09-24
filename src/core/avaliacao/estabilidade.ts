/**
 * Medição de estabilidade: a mesma pergunta, várias execuções.
 *
 * Acurácia sozinha engana. Uma suíte que dá 95% em duas rodadas pode estar
 * acertando as mesmas 95% sempre (bom) ou sorteando quais 95% (ruim, e muito
 * pior em produção, onde o cliente faz a pergunta uma vez só).
 *
 * Uma pergunta que oscila é a informação mais acionável do log: não é bug nem
 * acerto, é a fronteira em que o modelo hesita. É nela que mexer no prompt, no
 * limiar ou nos documentos rende de verdade.
 */
import type { RegistroDeAvaliacao } from './log.js';

export interface EstabilidadeDaPergunta {
  id: string;
  pergunta: string;
  execucoes: number;
  passou: number;
  /** Fração de execuções em que passou, de 0 a 1. */
  taxa: number;
  /** true quando o resultado foi sempre o mesmo — sempre passar ou sempre falhar. */
  estavel: boolean;
  /** Quantos textos de resposta diferentes o modelo produziu. */
  respostasDistintas: number;
  /** Amplitude do best_score entre execuções: mede a variação da BUSCA, não do LLM. */
  variacaoDeScore: number;
}

export interface ResumoDeEstabilidade {
  perguntas: number;
  execucoes: number;
  semprePassaram: number;
  sempreFalharam: number;
  oscilaram: number;
  /** Fração de perguntas com resultado sempre igual. */
  taxaDeEstabilidade: number;
  /** Média das acurácias de cada execução. */
  acuraciaMedia: number;
  custoTotalUsd: number;
}

/**
 * Agrupa os registros por pergunta e mede a consistência de cada uma.
 *
 * As mais instáveis vêm primeiro: é a ordem em que se quer lê-las.
 */
export function medirEstabilidade(registros: RegistroDeAvaliacao[]): EstabilidadeDaPergunta[] {
  const porId = new Map<string, RegistroDeAvaliacao[]>();
  for (const r of registros) {
    porId.set(r.id, [...(porId.get(r.id) ?? []), r]);
  }

  const medidas: EstabilidadeDaPergunta[] = [];

  for (const [id, lista] of porId) {
    const passou = lista.filter((r) => r.passou).length;
    const scores = lista.map((r) => r.melhorScore);

    medidas.push({
      id,
      pergunta: lista[0]?.pergunta ?? '',
      execucoes: lista.length,
      passou,
      taxa: lista.length === 0 ? 0 : passou / lista.length,
      estavel: passou === 0 || passou === lista.length,
      respostasDistintas: new Set(lista.map((r) => r.resposta.trim())).size,
      variacaoDeScore: scores.length === 0 ? 0 : Math.max(...scores) - Math.min(...scores),
    });
  }

  // Instáveis primeiro; entre as estáveis, as que falham antes das que passam.
  return medidas.sort((a, b) => {
    if (a.estavel !== b.estavel) return a.estavel ? 1 : -1;
    return a.taxa - b.taxa;
  });
}

export function resumirEstabilidade(registros: RegistroDeAvaliacao[]): ResumoDeEstabilidade {
  const medidas = medirEstabilidade(registros);
  const execucoes = new Set(registros.map((r) => r.execucao));

  const semprePassaram = medidas.filter((m) => m.estavel && m.taxa === 1).length;
  const sempreFalharam = medidas.filter((m) => m.estavel && m.taxa === 0).length;
  const oscilaram = medidas.filter((m) => !m.estavel).length;

  const acuraciasPorExecucao = [...execucoes].map((e) => {
    const daExecucao = registros.filter((r) => r.execucao === e);
    return daExecucao.filter((r) => r.passou).length / daExecucao.length;
  });

  return {
    perguntas: medidas.length,
    execucoes: execucoes.size,
    semprePassaram,
    sempreFalharam,
    oscilaram,
    taxaDeEstabilidade: medidas.length === 0 ? 0 : (semprePassaram + sempreFalharam) / medidas.length,
    acuraciaMedia:
      acuraciasPorExecucao.length === 0
        ? 0
        : acuraciasPorExecucao.reduce((s, a) => s + a, 0) / acuraciasPorExecucao.length,
    custoTotalUsd: registros.reduce((s, r) => s + r.custoUsd, 0),
  };
}

/** Relatório legível da estabilidade. */
export function montarRelatorioDeEstabilidade(
  registros: RegistroDeAvaliacao[],
  rotulo: string,
): string {
  const medidas = medirEstabilidade(registros);
  const resumo = resumirEstabilidade(registros);
  const linhas: string[] = [];

  linhas.push(`# Estabilidade — ${rotulo}`);
  linhas.push('');
  linhas.push(
    `${resumo.execucoes} execuções da mesma suíte de ${resumo.perguntas} perguntas.`,
  );
  linhas.push('');
  linhas.push('| | |');
  linhas.push('|---|---|');
  linhas.push(`| Acurácia média | **${(resumo.acuraciaMedia * 100).toFixed(1)}%** |`);
  linhas.push(
    `| Estabilidade | **${(resumo.taxaDeEstabilidade * 100).toFixed(1)}%** (${resumo.semprePassaram + resumo.sempreFalharam}/${resumo.perguntas} sempre iguais) |`,
  );
  linhas.push(`| Sempre passaram | ${resumo.semprePassaram} |`);
  linhas.push(`| Sempre falharam | ${resumo.sempreFalharam} |`);
  linhas.push(`| **Oscilaram** | **${resumo.oscilaram}** |`);
  linhas.push(`| Custo total | US$ ${resumo.custoTotalUsd.toFixed(6)} |`);
  linhas.push('');

  const instaveis = medidas.filter((m) => !m.estavel);

  linhas.push('## Perguntas que oscilaram');
  linhas.push('');
  if (instaveis.length === 0) {
    linhas.push('Nenhuma. Toda pergunta deu o mesmo resultado em todas as execuções.');
    linhas.push('');
    linhas.push(
      'Isso não quer dizer que o texto das respostas foi idêntico — só que o veredito foi. ' +
        'Veja a coluna "respostas distintas" abaixo.',
    );
  } else {
    linhas.push(
      'São a fronteira em que o modelo hesita. Mexer no prompt, no limiar ou nos ' +
        'documentos rende mais aqui do que em qualquer outro lugar.',
    );
    linhas.push('');
    linhas.push('| Pergunta | Passou | Respostas distintas | Variação do score |');
    linhas.push('|---|---|---|---|');
    for (const m of instaveis) {
      linhas.push(
        `| \`${m.id}\` | ${m.passou}/${m.execucoes} | ${m.respostasDistintas} | ${m.variacaoDeScore.toFixed(3)} |`,
      );
    }
  }
  linhas.push('');

  linhas.push('## Todas as perguntas');
  linhas.push('');
  linhas.push('| Pergunta | Passou | Respostas distintas | Variação do score |');
  linhas.push('|---|---|---|---|');
  for (const m of medidas) {
    const marca = m.estavel && m.taxa === 1 ? '' : m.estavel ? ' (sempre falha)' : ' **oscila**';
    linhas.push(
      `| \`${m.id}\`${marca} | ${m.passou}/${m.execucoes} | ${m.respostasDistintas} | ${m.variacaoDeScore.toFixed(3)} |`,
    );
  }
  linhas.push('');
  linhas.push(
    '<sub>A **variação do score** mede a busca, não o modelo: a mesma pergunta gera ' +
      'sempre o mesmo embedding, então variação acima de zero indica que os chunks mudaram ' +
      'entre as execuções — normalmente porque houve reingestão.</sub>',
  );

  return linhas.join('\n');
}
