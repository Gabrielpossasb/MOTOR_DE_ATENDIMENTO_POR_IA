-- Separa "um humano precisa olhar isto" de "o bot esta mudo".
--
-- Ate aqui as duas coisas eram a mesma: conversations.status = 'handoff'.
-- Com o botao de trazer o bot de volta, a conversa volta para 'open' e o
-- handoff PRECISA continuar pendente -- o colaborador ainda tem de ver por que
-- foi chamado. Sem esta coluna, destravar a conversa apagaria o aviso.
--
-- NULL = ninguem revisou ainda.
ALTER TABLE handoffs ADD COLUMN resolved_at TEXT;
