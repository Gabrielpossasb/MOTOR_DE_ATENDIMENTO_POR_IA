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
import { abrirBanco, type Db } from '../storage/db.js';
import { carregarTenant, configEfetiva } from '../core/tenant/tenant-service.js';
import { EmbedderOpenAI } from '../core/rag/embedder.js';
import { LlmOpenAI } from '../core/llm/client.js';
import { Motor } from '../core/engine.js';
import { verificar, type PerguntaDeAvaliacao } from '../core/avaliacao/regras.js';
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

interface ArquivoDeAvaliacao {
  descricao?: string;
  perguntas: PerguntaDeAvaliacao[];
}

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

  const arquivo = path.join(config.caminhos.documentosTenant(slug), 'avaliacao.json');
  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo de avaliação não encontrado: ${arquivo}`);
    process.exit(1);
  }

  const { perguntas } = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ArquivoDeAvaliacao;
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

interface ParametrosDaRodada {
  motor: Motor;
  db: Db;
  slug: string;
  tenantId: number;
  perguntas: PerguntaDeAvaliacao[];
  execucao: string;
  limiar: number;
  detalhar: boolean;
}

async function rodarUmaVez(p: ParametrosDaRodada): Promise<RegistroDeAvaliacao[]> {
  const registros: RegistroDeAvaliacao[] = [];

  for (const esperado of p.perguntas) {
    const resposta = await p.motor.responder(p.slug, `avaliacao-${esperado.id}`, esperado.pergunta, {
      canal: 'avaliacao',
      semPersistir: true,
    });

    // A checagem de número inventado compara contra o texto REAL dos chunks.
    const contextoCompleto = textoDosChunksCitados(p.db, p.tenantId, resposta.fontes);
    const verificacao = verificar(esperado, resposta, contextoCompleto);

    registros.push({
      execucao: p.execucao,
      tenant: p.slug,
      id: esperado.id,
      pergunta: esperado.pergunta,
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
      limiar: p.limiar,
    });

    if (p.detalhar) {
      const marca = verificacao.passou ? 'ok    ' : 'FALHOU';
      const motivo = verificacao.passou
        ? ''
        : ` — ${verificacao.falhas.map((f) => f.detalhe).join('; ')}`;
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

/**
 * Recupera o texto integral dos chunks que embasaram a resposta.
 *
 * A checagem de número inventado compara contra o texto REAL dos chunks, não
 * contra o nome do arquivo — senão qualquer preço passaria.
 */
function textoDosChunksCitados(
  db: Db,
  tenantId: number,
  fontes: { arquivo: string; secao?: string }[],
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

principal().catch((erro: unknown) => {
  console.error('Falha na avaliação:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
