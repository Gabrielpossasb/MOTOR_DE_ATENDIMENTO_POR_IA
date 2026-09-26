-- Memória compactada da conversa.
--
-- A janela de contexto manda só as últimas N mensagens ao modelo. Numa conversa
-- longa isso faz o começo cair fora, e o cliente precisa repetir o que já
-- contou. O resumo é o que fica no lugar das mensagens que saíram da janela.
--
-- `summary_until_message_id` é a marca d'água: tudo até esta mensagem já está
-- dentro do resumo. O que veio depois vai íntegro para o modelo. Sem a marca,
-- não haveria como saber o que já foi compactado e o resumo ou repetiria
-- conteúdo ou perderia mensagens.

ALTER TABLE conversations ADD COLUMN summary TEXT;
ALTER TABLE conversations ADD COLUMN summary_until_message_id INTEGER;
