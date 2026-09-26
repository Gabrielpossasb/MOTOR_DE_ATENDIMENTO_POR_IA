-- Agenda: compromissos marcados e a fila de mensagens a enviar.
--
-- Até aqui o bot só lia documentos. A clínica decidiu que ele precisa marcar,
-- alterar e cancelar consultas — o que reverte o "o bot não agenda" que estava
-- em Fora de Escopo e na regra 7 do prompt.

CREATE TABLE appointments (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Quem marcou, na identidade do canal. É por aqui que o bot só enxerga os
  -- compromissos de quem está falando com ele.
  contact_id      TEXT NOT NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  -- 'YYYY-MM-DD HH:MM', hora local da clínica. Texto e não timestamp: o SQLite
  -- não tem tipo de data, e comparação lexicográfica neste formato é igual à
  -- comparação cronológica.
  starts_at       TEXT NOT NULL,
  duration_min    INTEGER NOT NULL,
  service         TEXT,
  -- Os dados que o faq.md já diz serem necessários para agendar.
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT,
  insurance       TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','cancelled','completed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_appointments_tenant_inicio ON appointments(tenant_id, starts_at);
CREATE INDEX idx_appointments_contato ON appointments(tenant_id, contact_id);

-- Dupla marcação vira IMPOSSÍVEL, e não apenas improvável.
--
-- Checar em código antes de inserir tem corrida entre o SELECT e o INSERT:
-- duas mensagens simultâneas pedindo o mesmo horário passariam as duas na
-- checagem. O índice parcial resolve no banco. Parcial porque um horário
-- cancelado precisa poder ser remarcado — só 'scheduled' ocupa a vaga.
CREATE UNIQUE INDEX idx_appointments_vaga
  ON appointments(tenant_id, starts_at)
  WHERE status = 'scheduled';

-- Mensagens que o bot precisa ENVIAR, em vez de responder.
--
-- Nesta fase não existe WhatsApp, então nada sai daqui sozinho: o comando
-- `npm run lembretes` gera e lista. Quando o adaptador de canal chegar, ele
-- drena esta tabela e o núcleo não muda — é o mesmo princípio do resto do
-- projeto, o canal é adaptador de borda.
CREATE TABLE outbox (
  id             INTEGER PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id     TEXT NOT NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  body           TEXT NOT NULL,
  scheduled_for  TEXT NOT NULL,
  -- NULL = ainda não enviada.
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_outbox_pendentes ON outbox(tenant_id, sent_at);

-- Idempotência, na mesma disciplina do ingest: rodar o comando duas vezes no
-- mesmo dia não pode gerar dois lembretes para a mesma consulta.
CREATE UNIQUE INDEX idx_outbox_unico ON outbox(appointment_id, kind);
