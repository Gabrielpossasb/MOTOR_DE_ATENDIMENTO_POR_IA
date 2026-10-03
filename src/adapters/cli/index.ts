/**
 * Adaptador de terminal.
 *
 * Esta é a BORDA: é o único arquivo deste fluxo que sabe o que é um terminal.
 * Ele traduz "linha digitada" para uma chamada ao núcleo e formata a resposta
 * para a tela. O adaptador de WhatsApp, no futuro, fará a mesma coisa com
 * webhooks — sem que nenhuma linha do núcleo mude.
 *
 * Uso: npm run cli -- clinica-sorriso
 */
import readline from 'node:readline';
import { config } from '../../config.js';
import { Motor } from '../../core/engine.js';
import { EmbedderOpenAI } from '../../core/rag/embedder.js';
import { LlmOpenAI } from '../../core/llm/client.js';
import { carregarTenant } from '../../core/tenant/tenant-service.js';
import { contarChunks } from '../../storage/repositories/chunks.js';
import { abrirBanco } from '../../storage/db.js';
import type { RespostaDoBot } from '../../core/types.js';

/** Identificador do "contato" quando a conversa vem do terminal. */
const CONTATO_CLI = 'cli-local';

const cores = {
  cinza: (t: string) => `\x1b[90m${t}\x1b[0m`,
  verde: (t: string) => `\x1b[32m${t}\x1b[0m`,
  amarelo: (t: string) => `\x1b[33m${t}\x1b[0m`,
  negrito: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

async function principal(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run cli -- clinica-sorriso');
    process.exit(1);
  }

  const db = abrirBanco();
  const tenant = carregarTenant(db, slug);
  const total = contarChunks(db, tenant.id);

  if (total === 0) {
    console.error(`O tenant "${slug}" não tem nenhum chunk indexado. Rode: npm run ingest -- ${slug}`);
    db.close();
    process.exit(1);
  }

  const motor = new Motor({
    db,
    embedder: new EmbedderOpenAI(),
    llm: new LlmOpenAI(),
  });

  console.log(cores.negrito(`\n${tenant.nome}`));
  console.log(cores.cinza(`${total} chunks indexados · modelo ${config.llm.modelo}`));
  console.log(cores.cinza('Digite sua pergunta. Ctrl+C ou "sair" para encerrar.\n'));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('você: ');

  // Com entrada redirecionada a interface fecha ao fim do arquivo, e aí
  // prompt() lança "readline was closed". Só escrevemos o prompt enquanto ela
  // estiver aberta.
  let fechada = false;
  rl.once('close', () => {
    fechada = true;
  });

  const perguntar = (): void => {
    if (!fechada) rl.prompt();
  };

  perguntar();

  // `for await` em vez de rl.on('line'): com o laço de eventos, uma entrada
  // redirecionada (echo ... | npm run cli) chega ao fim do arquivo antes das
  // respostas voltarem, e o processo morre no meio. O laço assíncrono só lê a
  // próxima linha depois que a anterior terminou de ser respondida — o que
  // também deixa o CLI utilizável em script, coisa que a Etapa 4 vai precisar.
  for await (const linha of rl) {
    const pergunta = linha.trim();

    if (pergunta.length === 0) {
      perguntar();
      continue;
    }
    if (['sair', 'exit', 'quit'].includes(pergunta.toLowerCase())) {
      break;
    }

    try {
      imprimirResposta(await motor.responder(slug, CONTATO_CLI, pergunta, { canal: 'cli' }));
    } catch (erro: unknown) {
      console.error(cores.amarelo(`\nerro: ${erro instanceof Error ? erro.message : String(erro)}\n`));
    }

    perguntar();
  }

  rl.close();
  console.log(cores.cinza('\nAté logo.'));
  db.close();
}

function imprimirResposta(resposta: RespostaDoBot): void {
  console.log('');

  // Conversa já entregue a um humano: o bot não manda nada. No WhatsApp isso
  // seria silêncio de verdade; aqui avisamos para você enxergar o estado.
  if (resposta.aguardandoHumano) {
    console.log(cores.amarelo('     [o bot está calado: esta conversa já foi passada para um humano]'));
    console.log(cores.cinza('     (reabrir seria uma ação do atendente, fora do escopo desta fase)'));
    console.log('');
    return;
  }

  // Uma linha por MENSAGEM, com o rótulo repetido: é o que mais se parece com
  // o que o cliente vai ver no WhatsApp, onde cada uma chega separada. O
  // terminal é só outra forma da mesma lista que o núcleo devolveu.
  for (const mensagem of resposta.mensagens) {
    console.log(`${cores.verde('bot:')} ${mensagem}`);
  }

  if (resposta.precisaDeHumano) {
    console.log(cores.amarelo(`     [handoff: ${resposta.motivoDoHandoff}]`));
  }

  for (const fonte of resposta.fontes) {
    const secao = fonte.secao ? ` §${fonte.secao}` : '';
    console.log(cores.cinza(`     fonte: ${fonte.arquivo}${secao} (${fonte.score.toFixed(3)})`));
  }

  const { uso, melhorScore } = resposta;
  console.log(
    cores.cinza(
      `     ${uso.latenciaMs}ms · ${uso.tokensEntrada}→${uso.tokensSaida} tokens · ` +
        `US$ ${uso.custoEstimadoUsd.toFixed(6)} · melhor score ${melhorScore.toFixed(3)}`,
    ),
  );
  console.log('');
}

principal().catch((erro: unknown) => {
  console.error('Falha ao iniciar o CLI:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
