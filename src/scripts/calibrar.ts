/**
 * Mede o melhor score de busca de cada pergunta, SEM chamar o LLM.
 *
 * Serve para escolher o `limiarDeConfianca` com dado em vez de chute: compara
 * a faixa de score das perguntas que a base responde com a das que ela não
 * responde, e mostra se existe um número que separa as duas.
 *
 * As perguntas vêm do `avaliacao.json` do próprio tenant — o campo
 * `esperaHandoff` já diz a qual grupo cada uma pertence. Deixá-las escritas no
 * código faria este script medir as perguntas de um cliente contra os
 * documentos de outro, que foi exatamente o que aconteceu antes desta versão.
 *
 * Uso: npm run calibrar -- barbearia-do-ze
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco } from '../storage/db.js';
import { carregarTenant, configEfetiva } from '../core/tenant/tenant-service.js';
import { EmbedderOpenAI } from '../core/rag/embedder.js';
import { BuscaPorCossenoEmMemoria } from '../core/rag/retriever.js';
import type { PerguntaDeAvaliacao } from '../core/avaliacao/regras.js';

interface ArquivoDeAvaliacao {
  perguntas: PerguntaDeAvaliacao[];
}

interface Medida {
  id: string;
  pergunta: string;
  deveResponder: boolean;
  score: number;
}

/**
 * Sugere um limiar a partir das medidas.
 *
 * A regra é conservadora de propósito: fica logo abaixo da pergunta legítima
 * mais fraca, porque barrar um cliente de verdade é pior que deixar passar uma
 * pergunta que o LLM vai recusar de qualquer forma. O limiar é porteiro, não
 * juiz.
 */
export function sugerirLimiar(medidas: Medida[]): {
  sugestao: number;
  separaBem: boolean;
  menorQueResponde: number;
  maiorQueRecusa: number;
} {
  const responder = medidas.filter((m) => m.deveResponder).map((m) => m.score);
  const recusar = medidas.filter((m) => !m.deveResponder).map((m) => m.score);

  const menorQueResponde = responder.length > 0 ? Math.min(...responder) : 0;
  const maiorQueRecusa = recusar.length > 0 ? Math.max(...recusar) : 0;
  const separaBem = menorQueResponde > maiorQueRecusa;

  // Uma folga de 0,02 abaixo da pergunta legítima mais fraca: o suficiente
  // para absorver variação de redação sem deixar o limiar frouxo demais.
  const sugestao = separaBem
    ? Number(((menorQueResponde + maiorQueRecusa) / 2).toFixed(3))
    : Number(Math.max(0, menorQueResponde - 0.02).toFixed(3));

  return { sugestao, separaBem, menorQueResponde, maiorQueRecusa };
}

async function principal(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run calibrar -- barbearia-do-ze');
    process.exit(1);
  }

  const arquivo = path.join(config.caminhos.documentosTenant(slug), 'avaliacao.json');
  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo de avaliação não encontrado: ${arquivo}`);
    console.error('É dele que saem as perguntas da calibração.');
    process.exit(1);
  }

  const { perguntas } = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ArquivoDeAvaliacao;
  if (perguntas.length === 0) {
    console.error('O avaliacao.json não tem nenhuma pergunta.');
    process.exit(1);
  }

  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);
    const ajustes = configEfetiva(tenant);
    const embedder = new EmbedderOpenAI();
    const busca = new BuscaPorCossenoEmMemoria(db);

    const { vetores, tokens } = await embedder.gerar(perguntas.map((p) => p.pergunta));

    const medidas: Medida[] = perguntas.map((p, i) => ({
      id: p.id,
      pergunta: p.pergunta,
      deveResponder: p.esperaHandoff !== true,
      score: busca.buscar(tenant.id, vetores[i] as number[], 1)[0]?.score ?? 0,
    }));

    console.log(`Tenant: ${tenant.nome}\n`);

    imprimirGrupo(
      'DEVE RESPONDER (queremos score alto)',
      medidas.filter((m) => m.deveResponder).sort((a, b) => a.score - b.score),
    );

    imprimirGrupo(
      'DEVE RECUSAR (queremos score baixo)',
      medidas.filter((m) => !m.deveResponder).sort((a, b) => b.score - a.score),
    );

    const analise = sugerirLimiar(medidas);

    console.log('=== RESUMO ===');
    console.log(`  Limiar atual:                   ${ajustes.limiarDeConfianca.toFixed(3)}`);
    console.log(`  Menor score do grupo RESPONDER: ${analise.menorQueResponde.toFixed(3)}`);
    console.log(`  Maior score do grupo RECUSAR:   ${analise.maiorQueRecusa.toFixed(3)}`);
    console.log('');

    if (analise.separaBem) {
      console.log(`  Os grupos NÃO se sobrepõem — um limiar separa os dois sem erro.`);
    } else {
      console.log('  Os grupos se SOBREPÕEM: nenhum limiar separa os dois sem erro.');
      console.log('  Isso é normal. O limiar é porteiro, não juiz: ele barra o que é');
      console.log('  claramente fora do assunto, e quem julga o resto é o LLM.');
    }

    console.log(`\n  Limiar sugerido: ${analise.sugestao.toFixed(3)}`);
    if (Math.abs(analise.sugestao - ajustes.limiarDeConfianca) > 0.001) {
      console.log(`  Para aplicar, edite "limiarDeConfianca" em ${path.relative(config.caminhos.raiz, path.join(config.caminhos.documentosTenant(slug), 'tenant.json'))}`);
      console.log(`  e rode: npm run seed -- ${slug}`);
    } else {
      console.log('  O limiar em vigor já é esse.');
    }

    console.log(`\n  Tokens de embedding gastos: ${tokens}`);
  } finally {
    db.close();
  }
}

function imprimirGrupo(titulo: string, medidas: Medida[]): void {
  console.log(`=== ${titulo} ===`);
  if (medidas.length === 0) {
    console.log('  (nenhuma pergunta deste tipo no avaliacao.json)');
  }
  for (const m of medidas) {
    console.log(`  ${m.score.toFixed(3)}  ${m.pergunta}`);
  }
  console.log('');
}

if (process.argv[1]?.endsWith('calibrar.ts')) {
  principal().catch((erro: unknown) => {
    console.error('Falha na calibração:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
}
