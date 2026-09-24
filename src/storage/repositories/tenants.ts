/** Leitura e escrita de tenants. */
import type { Db } from '../db.js';
import type { ConfigDoTenant, Tenant } from '../../core/types.js';

interface LinhaTenant {
  id: number;
  slug: string;
  name: string;
  config: string;
  system_prompt: string;
}

function paraTenant(linha: LinhaTenant): Tenant {
  return {
    id: linha.id,
    slug: linha.slug,
    nome: linha.name,
    config: JSON.parse(linha.config) as ConfigDoTenant,
    promptDoSistema: linha.system_prompt,
  };
}

export function buscarTenantPorSlug(db: Db, slug: string): Tenant | undefined {
  const linha = db
    .prepare('SELECT id, slug, name, config, system_prompt FROM tenants WHERE slug = ?')
    .get(slug) as LinhaTenant | undefined;
  return linha ? paraTenant(linha) : undefined;
}

export function listarTenants(db: Db): Tenant[] {
  const linhas = db
    .prepare('SELECT id, slug, name, config, system_prompt FROM tenants ORDER BY slug')
    .all() as LinhaTenant[];
  return linhas.map(paraTenant);
}

export interface DadosDoTenant {
  slug: string;
  nome: string;
  config: ConfigDoTenant;
  promptDoSistema: string;
}

/** Cria o tenant ou atualiza o existente com o mesmo slug. */
export function salvarTenant(db: Db, dados: DadosDoTenant): Tenant {
  db.prepare(
    `INSERT INTO tenants (slug, name, config, system_prompt)
     VALUES (@slug, @nome, @config, @prompt)
     ON CONFLICT(slug) DO UPDATE SET
       name          = excluded.name,
       config        = excluded.config,
       system_prompt = excluded.system_prompt`,
  ).run({
    slug: dados.slug,
    nome: dados.nome,
    config: JSON.stringify(dados.config),
    prompt: dados.promptDoSistema,
  });

  const tenant = buscarTenantPorSlug(db, dados.slug);
  if (!tenant) throw new Error(`Falha ao salvar o tenant ${dados.slug}.`);
  return tenant;
}
