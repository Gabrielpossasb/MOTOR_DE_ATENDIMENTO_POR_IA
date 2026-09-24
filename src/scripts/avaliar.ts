/**
 * Suíte de avaliação: roda as perguntas de `avaliacao.json` contra a API real,
 * verifica cada resposta e grava os logs.
 *
 * Uso: npm run avaliar -- clinica-sorriso
 *
 * Roda com `semPersistir`, então não cria conversas nem dispara handoffs de
 * verdade — avaliar não pode encher a fila da equipe de atendimento.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco } from '../storage/db.js';
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

interface ArquivoDeAvaliacao {
  descricao?: string;
  perguntas: PerguntaDeAvaliacao[];
}

async function principal(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run avaliar -- clinica-sorriso');
    process.exit(1);
  }

  const arquivo = path.join(config.caminhos.documentosTenant(slug), 'avaliacao.json');
  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo de avaliação não encontrado: ${arquivo}`);
    process.exit(1);
  }

  const { perguntas } = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ArquivoDeAvaliacao;
  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);
    const ajustes = configEfetiva(tenant);
    const motor = new Motor({ db, embedder: new EmbedderOpenAI(), llm: new LlmOpenAI() });

    const execucao = novoIdDeExecucao();
    garantirPastas(config.caminhos.raiz);

    console.log(`Avaliando ${perguntas.length} perguntas de ${tenant.nome}`);
    console.log(`Modelo ${config.llm.modelo} · limiar ${ajustes.limiarDeConfianca}\n`);

    const registros: RegistroDeAvaliacao[] = [];

    for (const esperado of perguntas) {
      const resposta = await motor.responder(slug, `avaliacao-${esperado.id}`, esperado.pergunta, {
        canal: 'avaliacao',
        semPersistir: true,
      });

      // O texto dos chunks citados é a base da checagem de número inventado.
      const contexto = resposta.fontes.map((f) => `${f.arquivo} ${f.secao ?? ''}`).join(' ');
      const contextoCompleto = textoDosChunksCitados(db, tenant.id, resposta.fontes) || contexto;

      const verificacao = verificar(esperado, resposta, contextoCompleto);

      registros.push({
        execucao,
        tenant: slug,
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
        limiar: ajustes.limiarDeConfianca,
      });

      const marca = verificacao.passou ? 'ok    ' : 'FALHOU';
      const motivo = verificacao.passou ? '' : ` — ${verificacao.falhas.map((f) => f.detalhe).join('; ')}`;
      console.log(`  ${marca} ${esperado.id}${motivo}`);
    }

    const anterior = resultadoAnterior(config.caminhos.raiz, slug, execucao);
    const resumo = resumir(registros, {
      execucao,
      tenant: slug,
      modelo: config.llm.modelo,
      limiar: ajustes.limiarDeConfianca,
    });

    gravarHistorico(config.caminhos.raiz, registros);
    const [doHistorico] = salvarRelatorio(
      config.caminhos.raiz,
      execucao,
      montarRelatorio(resumo, registros, anterior),
    );

    console.log('');
    console.log(`Acurácia: ${(resumo.acuracia * 100).toFixed(1)}% (${resumo.passaram}/${resumo.total})`);
    console.log(`Custo total: US$ ${resumo.custoTotalUsd.toFixed(6)}`);
    console.log(`Latência média: ${resumo.latenciaMediaMs} ms`);

    const regressoes = registros.filter((r) => !r.passou && anterior.get(r.id) === true);
    if (regressoes.length > 0) {
      console.log(`\nREGRESSÕES (${regressoes.length}): ${regressoes.map((r) => r.id).join(', ')}`);
    } else if (anterior.size > 0) {
      console.log('\nNenhuma regressão.');
    }

    console.log(`\nRelatório: logs/ULTIMO.md`);
    console.log(`Preservado em: ${path.relative(config.caminhos.raiz, doHistorico as string)}`);
  } finally {
    db.close();
  }
}

/**
 * Recupera o texto integral dos chunks que embasaram a resposta.
 *
 * A checagem de número inventado compara contra o texto REAL dos chunks, não
 * contra o nome do arquivo — senão qualquer preço passaria.
 */
function textoDosChunksCitados(
  db: ReturnType<typeof abrirBanco>,
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
