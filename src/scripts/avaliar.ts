/**
 * Suíte de avaliação: roda as perguntas de `avaliacao.json` contra a API real,
 * verifica cada resposta e grava os logs.
 *
 * Uso:
 *   npm run avaliar -- clinica-sorriso
 *   npm run avaliar -- clinica-sorriso --repeticoes 5
 *
 * Com `--repeticoes`, a mesma suíte roda N vezes e gera também um relatório de
 * estabilidade. Acurácia sozinha engana: 95% acertando sempre as mesmas
 * perguntas é uma coisa, 95% sorteando quais é outra bem pior — em produção o
 * cliente faz a pergunta uma vez só.
 *
 * Roda com `semPersistir`, então não cria conversas nem dispara handoffs de
 * verdade: avaliar não pode encher a fila da equipe de atendimento.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco } from '../storage/db.js';
import { carregarTenant, configEfetiva } from '../core/tenant/tenant-service.js';
import { EmbedderOpenAI } from '../core/rag/embedder.js';
import { LlmOpenAI } from '../core/llm/client.js';
import { Motor } from '../core/engine.js';
import type { PerguntaDeAvaliacao } from '../core/avaliacao/regras.js';
import { caminhoDaAvaliacao, lerAvaliacao } from '../core/avaliacao/arquivo.js';
import { rodarPergunta, type DependenciasDaSuite } from '../core/avaliacao/suite.js';
import {
  garantirPastas,
  gravarHistorico,
  montarRelatorio,
  novoIdDeExecucao,
  resultadoAnterior,
  resumir,
  salvarRelatorio,
  type RegistroDeAvaliacao,
} from '../core/avaliacao/log.js';
import {
  montarRelatorioDeEstabilidade,
  resumirEstabilidade,
} from '../core/avaliacao/estabilidade.js';

/** Quantas vezes repetir a suíte, lido de `--repeticoes N`. */
function lerRepeticoes(): number {
  const posicao = process.argv.indexOf('--repeticoes');
  if (posicao === -1) return 1;

  const valor = Number(process.argv[posicao + 1]);
  if (!Number.isInteger(valor) || valor < 1) {
    console.error('--repeticoes espera um número inteiro maior que zero.');
    process.exit(1);
  }
  return valor;
}

async function principal(): Promise<void> {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('--')) {
    console.error('Informe o slug do tenant. Exemplo: npm run avaliar -- clinica-sorriso');
    process.exit(1);
  }

  // `lerAvaliacao` valida o arquivo: campo escrito errado é erro aqui, e não
  // uma regra que silenciosamente deixa de ser checada.
  const { existe, perguntas } = lerAvaliacao(slug);
  if (!existe) {
    console.error(`Arquivo de avaliação não encontrado: ${caminhoDaAvaliacao(slug)}`);
    process.exit(1);
  }

  const repeticoes = lerRepeticoes();
  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);
    const ajustes = configEfetiva(tenant);
    const motor = new Motor({ db, embedder: new EmbedderOpenAI(), llm: new LlmOpenAI() });

    garantirPastas(config.caminhos.raiz);

    console.log(`Avaliando ${perguntas.length} perguntas de ${tenant.nome}`);
    console.log(`Modelo ${config.llm.modelo} · limiar ${ajustes.limiarDeConfianca}`);
    if (repeticoes > 1) console.log(`Repetições: ${repeticoes}`);
    console.log('');

    const todosOsRegistros: RegistroDeAvaliacao[] = [];
    let ultimoRelatorio = '';

    for (let rodada = 1; rodada <= repeticoes; rodada++) {
      // Cada rodada é uma execução própria no histórico, então `relatorio`
      // consegue mostrar a trajetória pergunta a pergunta.
      const execucao = novoIdDeExecucao() + (repeticoes > 1 ? `-r${rodada}` : '');

      if (repeticoes > 1) console.log(`--- rodada ${rodada}/${repeticoes}`);

      const registros = await rodarUmaVez({
        motor,
        db,
        slug,
        tenantId: tenant.id,
        perguntas,
        execucao,
        limiar: ajustes.limiarDeConfianca,
        maximoDeLinhas: ajustes.maximoDeLinhas,
        promptDoTenant: tenant.promptDoSistema,
        detalhar: repeticoes === 1,
      });

      const anterior = resultadoAnterior(config.caminhos.raiz, slug, execucao);
      const resumo = resumir(registros, {
        execucao,
        tenant: slug,
        modelo: config.llm.modelo,
        limiar: ajustes.limiarDeConfianca,
      });

      gravarHistorico(config.caminhos.raiz, registros);
      ultimoRelatorio = montarRelatorio(resumo, registros, anterior);
      salvarRelatorio(config.caminhos.raiz, execucao, ultimoRelatorio);

      todosOsRegistros.push(...registros);

      if (repeticoes > 1) {
        const falhas = registros.filter((r) => !r.passou).map((r) => r.id);
        console.log(
          `    ${(resumo.acuracia * 100).toFixed(1)}% (${resumo.passaram}/${resumo.total})` +
            (falhas.length > 0 ? ` · falhou: ${falhas.join(', ')}` : ''),
        );
      }
    }

    if (repeticoes > 1) {
      relatarEstabilidade(todosOsRegistros, slug, repeticoes);
    } else {
      relatarExecucaoUnica(todosOsRegistros, slug);
    }
  } finally {
    db.close();
  }
}

interface ParametrosDaRodada extends DependenciasDaSuite {
  perguntas: PerguntaDeAvaliacao[];
  detalhar: boolean;
}

/**
 * Roda a suíte uma vez.
 *
 * A execução e o julgamento de cada pergunta vivem em `core/avaliacao/suite.ts`,
 * compartilhados com a página de testes do adaptador web. Aqui fica só o que é
 * do script: imprimir o andamento no terminal.
 */
async function rodarUmaVez(p: ParametrosDaRodada): Promise<RegistroDeAvaliacao[]> {
  const registros: RegistroDeAvaliacao[] = [];

  for (const esperado of p.perguntas) {
    const registro = await rodarPergunta(p, esperado);
    registros.push(registro);

    if (p.detalhar) {
      const marca = registro.passou ? 'ok    ' : 'FALHOU';
      const motivo = registro.passou
        ? ''
        : ` — ${registro.falhas.map((f) => f.detalhe).join('; ')}`;
      console.log(`  ${marca} ${esperado.id}${motivo}`);
    }
  }

  return registros;
}

function relatarExecucaoUnica(registros: RegistroDeAvaliacao[], slug: string): void {
  const passaram = registros.filter((r) => r.passou).length;
  const custo = registros.reduce((s, r) => s + r.custoUsd, 0);
  const latencia = Math.round(registros.reduce((s, r) => s + r.latenciaMs, 0) / registros.length);

  console.log('');
  console.log(`Acurácia: ${((passaram / registros.length) * 100).toFixed(1)}% (${passaram}/${registros.length})`);
  console.log(`Custo total: US$ ${custo.toFixed(6)}`);
  console.log(`Latência média: ${latencia} ms`);

  const anterior = resultadoAnterior(config.caminhos.raiz, slug, registros[0]?.execucao ?? '');
  const regressoes = registros.filter((r) => !r.passou && anterior.get(r.id) === true);

  if (regressoes.length > 0) {
    console.log(`\nREGRESSÕES (${regressoes.length}): ${regressoes.map((r) => r.id).join(', ')}`);
  }

  console.log('\nRelatório: logs/ULTIMO.md');
  console.log('Para medir estabilidade: npm run avaliar -- <slug> --repeticoes 5');
}

function relatarEstabilidade(
  registros: RegistroDeAvaliacao[],
  slug: string,
  repeticoes: number,
): void {
  const resumo = resumirEstabilidade(registros);
  const relatorio = montarRelatorioDeEstabilidade(registros, `${slug} · ${config.llm.modelo}`);

  const destino = path.join(config.caminhos.raiz, 'logs', 'ESTABILIDADE.md');
  fs.writeFileSync(destino, relatorio, 'utf8');

  console.log('');
  console.log(`Acurácia média:  ${(resumo.acuraciaMedia * 100).toFixed(1)}%`);
  console.log(
    `Estabilidade:    ${(resumo.taxaDeEstabilidade * 100).toFixed(1)}% ` +
      `(${resumo.semprePassaram + resumo.sempreFalharam}/${resumo.perguntas} deram sempre o mesmo resultado)`,
  );
  console.log(`Sempre passaram: ${resumo.semprePassaram}`);
  console.log(`Sempre falharam: ${resumo.sempreFalharam}`);
  console.log(`OSCILARAM:       ${resumo.oscilaram}`);
  console.log(`Custo das ${repeticoes} rodadas: US$ ${resumo.custoTotalUsd.toFixed(6)}`);
  console.log('\nRelatório de estabilidade: logs/ESTABILIDADE.md');
}

principal().catch((erro: unknown) => {
  console.error('Falha na avaliação:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
