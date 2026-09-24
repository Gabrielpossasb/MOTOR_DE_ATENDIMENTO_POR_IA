/**
 * Cria ou atualiza um tenant a partir de data/tenants/<slug>/tenant.json.
 *
 * Uso: npm run seed -- clinica-sorriso
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco } from '../storage/db.js';
import { salvarTenant } from '../storage/repositories/tenants.js';
import type { ConfigDoTenant } from '../core/types.js';

interface ArquivoDeTenant {
  slug: string;
  nome: string;
  promptDoSistema: string;
  config?: ConfigDoTenant;
}

function principal(): void {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run seed -- clinica-sorriso');
    process.exit(1);
  }

  const pasta = config.caminhos.documentosTenant(slug);
  const arquivo = path.join(pasta, 'tenant.json');

  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo não encontrado: ${arquivo}`);
    process.exit(1);
  }

  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ArquivoDeTenant;
  if (dados.slug !== slug) {
    console.error(`O slug dentro de tenant.json ("${dados.slug}") não bate com a pasta ("${slug}").`);
    process.exit(1);
  }

  const db = abrirBanco();
  try {
    const tenant = salvarTenant(db, {
      slug: dados.slug,
      nome: dados.nome,
      config: dados.config ?? {},
      promptDoSistema: dados.promptDoSistema,
    });
    console.log(`Tenant salvo: ${tenant.nome} (slug: ${tenant.slug}, id: ${tenant.id})`);
    console.log(`Próximo passo: npm run ingest -- ${slug}`);
  } finally {
    db.close();
  }
}

principal();
