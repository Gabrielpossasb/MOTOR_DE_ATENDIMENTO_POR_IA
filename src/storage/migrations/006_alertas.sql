-- Avisos para o dono do negocio, SEM calar o bot.
--
-- Ate aqui so existia o handoff, e ele significa duas coisas ao mesmo tempo:
-- "o bot nao soube" e "o bot para de responder". Isso serve para a clinica,
-- onde o atendente assume. Nao serve para o que a Polpa Santa Helena pediu:
--
--   - o cliente pede desconto -> o dono precisa saber, e a venda continua
--   - o horario da entrega -> quem entrega e o dono, entao so ele confirma
--   - perguntaram de um lugar que nao esta documentado -> sinalizar a duvida
--
-- Nos tres casos o bot TEM de continuar conversando: se calasse depois de
-- dizer "vou confirmar o horario", o cliente que ainda nao deu o endereco
-- ficaria sem como terminar o pedido, e a venda morreria ali.
--
-- Por isso tabela separada, e nao uma coluna em handoffs: sao conceitos
-- diferentes. Handoff conta contra a taxa de resolucao; alerta nao, porque
-- confirmar horario acontece em TODA venda, e uma metrica que marca todas as
-- vendas como nao resolvidas nao mede nada.
CREATE TABLE alerts (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  -- desconto | confirmar_entrega | fora_de_cobertura | outro
  kind            TEXT NOT NULL,
  -- O que o bot entendeu do caso, para o dono saber do que se trata sem abrir.
  detail          TEXT NOT NULL,
  -- A mensagem do cliente que disparou. E o que permite julgar falso positivo.
  trigger_message TEXT,
  -- 'ferramenta' (o modelo pediu) ou 'palavra-chave' (a rede deterministica).
  source          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- NULL = ninguem tratou ainda.
  resolved_at     TEXT
);

CREATE INDEX idx_alerts_pendentes ON alerts(tenant_id, resolved_at);

-- Um aviso pendente por tipo, por conversa. Mesma disciplina do outbox: o
-- cliente que escreve "desconto" tres vezes gera UM aviso, nao tres. Parcial
-- porque, depois de resolvido, o mesmo assunto pode voltar numa venda nova.
CREATE UNIQUE INDEX idx_alerts_unico
  ON alerts(conversation_id, kind)
  WHERE resolved_at IS NULL;
