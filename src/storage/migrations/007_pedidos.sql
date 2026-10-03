-- Pedido como ESTADO, e nao como texto que o modelo relembra a cada turno.
--
-- A conversa 34 mostrou por que isto precisa existir. Com o prompt consertado,
-- o bot passou a montar o pedido -- e passou a ERRAR:
--
--   turno 4  "ate agora sao 2 kg de pao de queijo, R$ 50,00"
--   turno 5  "ate agora sao 1 kg de acerola com laranja, R$ 25,00"   <- sumiu
--   turno 9  lista tres itens e informa R$ 60,00; a soma e R$ 110,00
--
-- O carrinho SUBSTITUIA em vez de somar, e o cliente ouviu um preco errado. A
-- aritmetica dele esta certa em toda conta isolada que conferimos; o que ele
-- nao consegue e manter uma lista ao longo da conversa. Isso nao se conserta
-- com regra de prompt: carrinho e estado, e estado mora em tabela.
--
-- Mesma forma da agenda, que ja provou o desenho: tabela, ferramentas, e o que
-- importa no CONTRATO em vez do prompt.

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- A conversa em que o pedido foi montado. O carrinho e por conversa, nao por
  -- contato: duas vendas do mesmo cliente em dias diferentes sao dois pedidos.
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','confirmado','cancelado')),
  -- Os quatro dados de fechamento. Todos NULL enquanto o cliente nao informa, e
  -- `fechar_pedido` recusa enquanto faltar algum.
  customer_name   TEXT,
  address         TEXT,
  -- O horario que o CLIENTE pediu, nunca um horario confirmado. O nome da
  -- coluna e que garante isso: quem entrega e a responsavel, e so ela confirma.
  -- Com uma coluna chamada `delivery_time` alguem acabaria gravando promessa.
  preferred_time  TEXT,
  payment_method  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at    TEXT
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id, status);
CREATE INDEX idx_orders_contato ON orders(tenant_id, contact_id);

-- UM rascunho por conversa, garantido pelo banco.
--
-- Mesma disciplina do indice de vaga da agenda: checar em codigo antes de
-- inserir tem corrida entre o SELECT e o INSERT, e duas mensagens do mesmo
-- cliente chegando juntas criariam dois carrinhos -- cada um com metade do
-- pedido. Parcial porque, depois de confirmado, a mesma conversa pode comecar
-- outro pedido.
CREATE UNIQUE INDEX idx_orders_um_rascunho
  ON orders(conversation_id)
  WHERE status = 'rascunho';

CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- A chave do produto no produtos.json do tenant.
  product_key      TEXT NOT NULL,
  -- O nome como o cliente vai ler. Copiado junto do preco, pela mesma razao.
  label            TEXT NOT NULL,
  quantity         REAL NOT NULL CHECK (quantity > 0),
  unit             TEXT NOT NULL,
  -- Preco em CENTAVOS, e COPIADO do catalogo no momento em que o item entra.
  --
  -- Centavos porque somar R$ 25,00 em float acumula erro, e um total errado por
  -- um centavo destroi mais confianca que um total ausente. Copiado porque o
  -- pedido e registro historico: mexer no produtos.json nao pode reescrever o
  -- preco de um pedido ja feito.
  unit_price_cents INTEGER NOT NULL,
  -- Peso de UMA unidade, para a taxa de entrega -- que e por peso. NULL quando
  -- o produto nao e vendido por peso (o balde de acai e de 2 litros), e nesse
  -- caso a taxa fica indefinida em vez de ser chutada.
  weight_kg        REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_order_items_pedido ON order_items(order_id);

-- Um item por produto no mesmo pedido. "quero mais 1 kg de acai" soma na linha
-- que ja existe, em vez de criar uma segunda -- senao o recapitulativo mostra o
-- mesmo produto duas vezes e o cliente desconfia da conta inteira.
CREATE UNIQUE INDEX idx_order_items_unico ON order_items(order_id, product_key);
