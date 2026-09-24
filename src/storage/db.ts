/** Conexão com o SQLite e aplicação das migrations. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

export type Db = Database.Database;

/**
 * Abre o banco, liga os PRAGMAs que queremos em todo lugar e aplica as
 * migrations pendentes.
 *
 * @param caminho caminho do arquivo; use ':memory:' nos testes.
 */
export function abrirBanco(caminho: string = config.caminhos.banco): Db {
  if (caminho !== ':memory:') {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
  }

  const db = new Database(caminho);
  // WAL deixa leitura e escrita simultâneas confortáveis; foreign_keys não vem
  // ligado por padrão no SQLite e sem ele os ON DELETE CASCADE não funcionam.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  aplicarMigrations(db);
  return db;
}

/**
 * Aplica, em ordem, as migrations ainda não registradas em `schema_migrations`.
 * Cada arquivo roda dentro de uma transação junto com o próprio registro, então
 * ou a migration inteira entra, ou nada entra.
 */
export function aplicarMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const jaAplicadas = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((l) => (l as { version: number }).version),
  );

  const arquivos = fs
    .readdirSync(config.caminhos.migrations)
    .filter((nome) => nome.endsWith('.sql'))
    .sort();

  for (const arquivo of arquivos) {
    const versao = Number.parseInt(arquivo.slice(0, 3), 10);
    if (Number.isNaN(versao)) {
      throw new Error(`Migration com nome fora do padrão NNN_nome.sql: ${arquivo}`);
    }
    if (jaAplicadas.has(versao)) continue;

    const sql = fs.readFileSync(path.join(config.caminhos.migrations, arquivo), 'utf8');
    const aplicar = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(versao);
    });
    aplicar();
  }
}
