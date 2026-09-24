/** Carrega o tenant e resolve sua configuração efetiva. */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import { buscarTenantPorSlug } from '../../storage/repositories/tenants.js';
import type { Tenant } from '../types.js';

export interface ConfigEfetiva {
  topK: number;
  limiarDeConfianca: number;
}

export function carregarTenant(db: Db, slug: string): Tenant {
  const tenant = buscarTenantPorSlug(db, slug);
  if (!tenant) {
    throw new Error(`Tenant "${slug}" não encontrado. Rode: npm run seed -- ${slug}`);
  }
  return tenant;
}

/** Funde os defaults globais com os ajustes do tenant. */
export function configEfetiva(tenant: Tenant): ConfigEfetiva {
  return {
    topK: tenant.config.topK ?? config.busca.topK,
    limiarDeConfianca: tenant.config.limiarDeConfianca ?? config.busca.limiarDeConfianca,
  };
}
