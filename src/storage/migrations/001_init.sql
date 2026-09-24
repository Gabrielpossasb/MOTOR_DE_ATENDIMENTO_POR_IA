-- Schema inicial do motor de atendimento.
-- Multi-tenant desde o começo: tudo pendura em tenants.
-- Colunas em inglês (padrão SQL); comentários em português.

-- Cada cliente do serviço. `config` guarda ajustes que sobrescrevem os defaults
-- de config.ts (top_k, limiar de confiança, tom de voz).
CREATE TABLE tenants (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  config        TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documento bruto ingerido (.txt ou .md). `content_hash` torna a reingestão
-- idempotente: se o arquivo não mudou, não gastamos API de embeddings de novo.
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, filename)
);

-- Pedaço indexável de um documento, com seu vetor.
-- tenant_id é desnormalizado de propósito: a busca filtra direto por tenant,
-- sem join, e o isolamento entre clientes fica explícito numa coluna só.
CREATE TABLE chunks (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text        TEXT NOT NULL,
  embedding   BLOB NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_chunks_tenant ON chunks(tenant_id);
CREATE INDEX idx_chunks_document ON chunks(document_id);

-- Uma conversa com um contato. `channel` é só informativo: o núcleo não lê,
-- justamente para não ficar sabendo qual canal está do outro lado.
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  channel    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handoff','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_conv_tenant_contact ON conversations(tenant_id, contact_id);

-- Cada mensagem trocada, com o custo que ela deu. `sources` guarda em JSON os
-- ids e scores dos chunks que embasaram a resposta.
CREATE TABLE messages (
  id                 INTEGER PRIMARY KEY,
  conversation_id    INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role               TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content            TEXT NOT NULL,
  tokens_in          INTEGER,
  tokens_out         INTEGER,
  estimated_cost_usd REAL,
  latency_ms         INTEGER,
  sources            TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_conv ON messages(conversation_id);

-- Perguntas que o bot não soube responder. `best_score` guarda a melhor
-- similaridade encontrada — é o dado para calibrar o limiar de confiança.
CREATE TABLE unanswered (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  best_score      REAL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_unanswered_tenant ON unanswered(tenant_id);

-- Passagem para um humano.
CREATE TABLE handoffs (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_handoffs_conv ON handoffs(conversation_id);
