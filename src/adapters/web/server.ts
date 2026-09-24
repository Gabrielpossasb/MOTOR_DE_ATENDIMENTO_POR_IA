/**
 * Inicialização do adaptador web.
 *
 * Só monta as dependências reais (OpenAI, banco) e sobe o servidor. Todo o
 * roteamento mora em `rotas.ts`, que é testável.
 *
 * Uso: npm run web -- clinica-sorriso
 */
import { config } from '../../config.js';
import { abrirBanco } from '../../storage/db.js';
import { Motor } from '../../core/engine.js';
import { EmbedderOpenAI } from '../../core/rag/embedder.js';
import { LlmOpenAI } from '../../core/llm/client.js';
import { carregarTenant } from '../../core/tenant/tenant-service.js';
import { contarChunks } from '../../storage/repositories/chunks.js';
import { criarServidor } from './rotas.js';

function principal(): void {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run web -- clinica-sorriso');
    process.exit(1);
  }

  const db = abrirBanco();
  const tenant = carregarTenant(db, slug);

  if (contarChunks(db, tenant.id) === 0) {
    console.error(`O tenant "${slug}" não tem chunks indexados. Rode: npm run ingest -- ${slug}`);
    db.close();
    process.exit(1);
  }

  const motor = new Motor({ db, embedder: new EmbedderOpenAI(), llm: new LlmOpenAI() });
  const servidor = criarServidor({ motor, db, slug });

  servidor.listen(config.web.porta, () => {
    console.log(`\n${tenant.nome}`);
    console.log(`\n  Conversa: http://localhost:${config.web.porta}/`);
    console.log(`  Painel:   http://localhost:${config.web.porta}/painel`);
    console.log('\nCtrl+C para encerrar.\n');
  });

  const encerrar = () => {
    servidor.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

principal();
