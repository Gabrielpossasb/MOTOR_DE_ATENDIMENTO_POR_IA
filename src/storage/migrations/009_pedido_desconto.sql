-- Desconto CADASTRADO no pedido.
--
-- Decisao do dono: "o bot pode confirmar e dar o desconto, mas somente se
-- estiver cadastrado como desconto -- entao sao apenas descontos que estiverem
-- cadastrados".
--
-- Isso e a mesma forma que o resto deste projeto usa para impedir invencao: o
-- bot nao consegue criar um desconto porque so existem os que estao no
-- `produtos.json`, e a ferramenta recusa qualquer chave fora da lista. Prompt
-- pode ser desobedecido; enum de chaves cadastradas, nao.
--
-- E e a mesma distincao que os alertas ja faziam, agora com mecanismo:
--
--   desconto CADASTRADO (valor fixo e condicao escrita)  -> o bot aplica
--   desconto a combinar (acima de 10 kg, caso a caso)    -> o bot avisa o dono
--
-- UMA chave, e nao uma tabela de ligacao, porque hoje nao existe caso de dois
-- descontos no mesmo pedido. Quando existir, isto vira `order_discounts` e a
-- coluna sai -- de proposito nao foi generalizado antes de precisar.
ALTER TABLE orders ADD COLUMN discount_key TEXT;

-- O valor em centavos, COPIADO no momento em que o desconto e aplicado.
--
-- Mesma razao de `unit_price_cents` e de `delivery_fee_cents`: o pedido e
-- registro historico. Se o dono mudar o desconto do cartao de R$ 10,00 para
-- R$ 15,00, um pedido fechado no mes passado nao pode passar a mostrar outro
-- total no painel.
ALTER TABLE orders ADD COLUMN discount_cents INTEGER;
