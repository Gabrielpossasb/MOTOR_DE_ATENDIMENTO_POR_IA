/**
 * Ingestão: lê os .txt e .md do tenant, divide em chunks, gera os embeddings
 * e grava tudo no banco.
 *
 * Uso: npm run ingest -- clinica-sorriso
 *      npm run ingest -- clinica-sorriso --forcar   (reprocessa tudo)
 *
 * Arquivo cujo conteúdo não mudou é pulado: embedding custa dinheiro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco } from '../storage/db.js';
import { carregarTenant } from '../core/tenant/tenant-service.js';
import { buscarDocumento, hashDoConteudo, salvarDocumento } from '../storage/repositories/documents.js';
import { contarChunks, inserirChunks } from '../storage/repositories/chunks.js';
import { dividirEmChunks } from '../core/rag/chunker.js';
import { custoDeEmbedding, EmbedderOpenAI } from '../core/rag/embedder.js';

const EXTENSOES_ACEITAS = ['.txt', '.md'];

async function principal(): Promise<void> {
  const slug = process.argv[2];
  const forcar = process.argv.includes('--forcar');

  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run ingest -- clinica-sorriso');
    process.exit(1);
  }

  const pasta = config.caminhos.documentosTenant(slug);
  if (!fs.existsSync(pasta)) {
    console.error(`Pasta de documentos não encontrada: ${pasta}`);
    process.exit(1);
  }

  const db = abrirBanco();
  try {
    const tenant = carregarTenant(db, slug);
    const embedder = new EmbedderOpenAI();

    const arquivos = fs
      .readdirSync(pasta)
      .filter((nome) => EXTENSOES_ACEITAS.includes(path.extname(nome).toLowerCase()))
      .sort();

    if (arquivos.length === 0) {
      console.log(`Nenhum .txt ou .md em ${pasta}.`);
      return;
    }

    console.log(`Tenant: ${tenant.nome}`);
    console.log(`Arquivos encontrados: ${arquivos.length}\n`);

    let totalDeChunks = 0;
    let totalDeTokens = 0;
    let pulados = 0;

    for (const arquivo of arquivos) {
      const conteudo = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
      const existente = buscarDocumento(db, tenant.id, arquivo);

      if (!forcar && existente && existente.hash === hashDoConteudo(conteudo)) {
        console.log(`  ${arquivo}: sem alterações, pulando.`);
        pulados++;
        continue;
      }

      const chunks = dividirEmChunks(conteudo);
      if (chunks.length === 0) {
        console.log(`  ${arquivo}: vazio, ignorado.`);
        continue;
      }

      const { vetores, tokens } = await embedder.gerar(chunks.map((c) => c.texto));
      if (vetores.length !== chunks.length) {
        throw new Error(
          `O embedder devolveu ${vetores.length} vetores para ${chunks.length} chunks em ${arquivo}.`,
        );
      }

      // Regravar o documento apaga os chunks antigos por CASCADE.
      const documentId = salvarDocumento(db, tenant.id, arquivo, conteudo);

      inserirChunks(
        db,
        chunks.map((c, i) => ({
          documentId,
          tenantId: tenant.id,
          indice: c.indice,
          texto: c.texto,
          embedding: vetores[i] as number[],
          metadados: {
            ...(c.secao !== undefined ? { secao: c.secao } : {}),
            modeloDeEmbedding: embedder.modelo,
          },
        })),
      );

      totalDeChunks += chunks.length;
      totalDeTokens += tokens;
      console.log(`  ${arquivo}: ${chunks.length} chunks, ${tokens} tokens.`);
    }

    console.log('');
    console.log(`Chunks gravados agora: ${totalDeChunks}`);
    if (pulados > 0) console.log(`Arquivos pulados (sem alteração): ${pulados}`);
    console.log(`Total de chunks do tenant: ${contarChunks(db, tenant.id)}`);
    console.log(`Tokens de embedding: ${totalDeTokens} (custo estimado: US$ ${custoDeEmbedding(totalDeTokens).toFixed(6)})`);
    console.log(`\nPróximo passo: npm run cli -- ${slug}`);
  } finally {
    db.close();
  }
}

principal().catch((erro: unknown) => {
  console.error('Falha na ingestão:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
