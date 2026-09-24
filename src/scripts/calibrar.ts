/**
 * Mede o melhor score de busca de uma lista de perguntas, SEM chamar o LLM.
 *
 * Serve para escolher o `limiarDeConfianca` com dado em vez de chute: rode com
 * perguntas que o bot deve responder e perguntas que ele deve recusar, e
 * procure o vale entre os dois grupos.
 *
 * Uso: npx tsx src/scripts/calibrar.ts clinica-sorriso
 */
import { abrirBanco } from '../storage/db.js';
import { carregarTenant, configEfetiva } from '../core/tenant/tenant-service.js';
import { EmbedderOpenAI } from '../core/rag/embedder.js';
import { BuscaPorCossenoEmMemoria } from '../core/rag/retriever.js';

/** Perguntas que a base responde. */
const DEVE_RESPONDER = [
  'qual o horário de sábado?',
  'vocês abrem domingo?',
  'quanto custa a limpeza?',
  'quanto custa um implante?',
  'vocês aceitam Amil Dental?',
  'posso parcelar no cartão?',
  'onde fica a clínica?',
  'tem estacionamento?',
  'o que levar na primeira consulta?',
  'atendem criança de 5 anos?',
  'como faço para agendar?',
  'quanto tempo dura o tratamento de canal?',
  'e se eu faltar na consulta?',
  'tem atendimento de urgência?',
];

/** Perguntas fora da base: o bot deve recusar. */
const DEVE_RECUSAR = [
  'vocês vendem pizza?',
  'qual a previsão do tempo amanhã?',
  'vocês fazem cirurgia plástica no nariz?',
  'quanto custa uma consulta com cardiologista?',
  'vocês têm vaga de emprego para recepcionista?',
  'qual o CNPJ da clínica?',
  'vocês atendem pelo SUS?',
  'posso pagar em criptomoeda?',
  'quem é o dono da clínica?',
  'vocês fazem entrega em domicílio?',
];

async function principal(): Promise<void> {
  const slug = process.argv[2] ?? 'clinica-sorriso';
  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);
    const ajustes = configEfetiva(tenant);
    const embedder = new EmbedderOpenAI();
    const busca = new BuscaPorCossenoEmMemoria(db);

    const todas = [...DEVE_RESPONDER, ...DEVE_RECUSAR];
    const { vetores, tokens } = await embedder.gerar(todas);

    const scores = todas.map((pergunta, i) => ({
      pergunta,
      deveResponder: i < DEVE_RESPONDER.length,
      score: busca.buscar(tenant.id, vetores[i] as number[], 1)[0]?.score ?? 0,
    }));

    const responder = scores.filter((s) => s.deveResponder).map((s) => s.score);
    const recusar = scores.filter((s) => !s.deveResponder).map((s) => s.score);

    console.log('=== DEVE RESPONDER (queremos score alto) ===');
    for (const s of scores.filter((x) => x.deveResponder).sort((a, b) => a.score - b.score)) {
      console.log(`  ${s.score.toFixed(3)}  ${s.pergunta}`);
    }

    console.log('\n=== DEVE RECUSAR (queremos score baixo) ===');
    for (const s of scores.filter((x) => !x.deveResponder).sort((a, b) => b.score - a.score)) {
      console.log(`  ${s.score.toFixed(3)}  ${s.pergunta}`);
    }

    const menorQueResponde = Math.min(...responder);
    const maiorQueRecusa = Math.max(...recusar);

    console.log('\n=== RESUMO ===');
    console.log(`  Limiar atual:                 ${ajustes.limiarDeConfianca.toFixed(3)}`);
    console.log(`  Menor score do grupo RESPONDER: ${menorQueResponde.toFixed(3)}`);
    console.log(`  Maior score do grupo RECUSAR:   ${maiorQueRecusa.toFixed(3)}`);

    if (menorQueResponde > maiorQueRecusa) {
      const sugestao = (menorQueResponde + maiorQueRecusa) / 2;
      console.log(`  Os grupos NÃO se sobrepõem. Limiar sugerido: ${sugestao.toFixed(3)}`);
    } else {
      console.log('  Os grupos se SOBREPÕEM: nenhum limiar separa os dois sem erro.');
      console.log('  Perguntas no meio da faixa vão exigir julgamento do LLM.');
    }

    console.log(`\n  Tokens de embedding gastos: ${tokens}`);
  } finally {
    db.close();
  }
}

principal().catch((erro: unknown) => {
  console.error('Falha na calibração:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
