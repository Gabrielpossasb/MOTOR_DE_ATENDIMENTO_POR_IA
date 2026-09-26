# Estado da sessão — retomar daqui

Arquivo de handoff entre sessões. O `PROGRESSO.md` conta o que o projeto **é**;
este conta o que está **em andamento agora**.

**Última sessão:** 2026-09-26
**Estado:** suíte **verde** — 267 passando, typecheck limpo.
**Próximo:** implementar o sistema de agendamento (plano aprovado, ver abaixo).

---

## Em andamento: sistema de agendamento

Plano aprovado em 2026-09-26, em
`~/.claude/plans/pode-commitar-e-em-curried-matsumoto.md`.

Decisão de produto: **o bot passa a agendar**. Isso reverte o item "o bot tentar
vender, agendar ou processar pagamento" que estava em "Fora de escopo" — e a
regra 7 do prompt, que proíbe explicitamente. Os dois precisam ser reescritos
junto com a implementação.

Motivo: conversando na página, `"quero marcar pra proxima sexta, tem vaga?"`
recebeu *"Não tenho essa informação aqui"*. A clínica não quer passar telefone,
quer que o bot marque.

Decisões já tomadas com o usuário:
- Agenda **estruturada**, um recurso por vez (uma cadeira/um profissional)
- Lembrete por **outbox + comando** (`npm run lembretes`), porque nesta fase não
  existe WhatsApp
- O bot **confirma antes** de cancelar ou alterar
- Página `/agenda` no painel, além do bot

### Fases (nesta ordem)
1. **Agenda no núcleo e no painel, sem bot.** Migration `003`, disponibilidade,
   operações com resultado tipado, página `/agenda`. Entrega sozinha.
2. **O bot operando.** Tool calling em `LlmClient` — é a maior adição e a de
   maior risco, por isso vem depois do núcleo estar provado.
3. **Lembretes.** Tabela `outbox`, comando, idempotência por índice único.

O detalhe completo (schema, assinaturas, armadilhas) está no arquivo do plano.

### Armadilhas já identificadas, anotadas para não esquecer
- **Dupla marcação** tem de ser barrada por índice único parcial, não por
  checagem em código: entre o SELECT e o INSERT existe corrida.
- **`semPersistir` precisa valer para as ferramentas.** `npm run avaliar` e a
  página `/testes` rodam com essa flag; sem tratá-la, avaliar criaria
  agendamentos de verdade no banco.
- **`contatoId` e `tenantId` são injetados pelo servidor**, nunca lidos dos
  argumentos que o modelo produziu — senão um cliente alcança a agenda de outro.
- **Confirmação no contrato da ferramenta** (`confirmado: boolean`), não só no
  prompt. Prompt pode ser desobedecido; assinatura de função, não.
- **Cancelar apaga o lembrete pendente** na mesma transação.
- As **ferramentas entram no input de toda mensagem** (~400 tokens, ~US$ 0,0003
  contra os ~US$ 0,00046 de hoje). Começar sempre ligadas e **medir** antes de
  otimizar.

---

## Bug conhecido e NÃO corrigido: mensagem parcialmente respondível

Pode ser resolvido junto com a Fase 2, porque mexe nos mesmos prompts.

`"quero marcar pra proxima sexta, tem vaga?"` tirou **0,418**, passou do limiar,
chegou ao LLM — e virou handoff com *"Não tenho essa informação aqui"*. Só que o
`faq.md` TEM a seção "Como agendar".

Medido, e o resultado é contraintuitivo:

| consulta | score | desfecho |
|---|---|---|
| `como faço para agendar?` | 0,672 | responde certo |
| `quero marcar uma consulta` | 0,435 | responde certo |
| `quero marcar pra sexta` | **0,402** | responde certo |
| `quero marcar pra proxima sexta, tem vaga?` | **0,418** | **HANDOFF** |

A que falha tem score MAIOR que uma que funciona. Não é recuperação: é o
`"tem vaga?"`. A mensagem tem duas partes — *como agendar* (está nos documentos)
e *se há vaga* (não está). A regra 2 do prompt é tudo-ou-nada, então o modelo
descarta a mensagem inteira, inclusive a metade que sabia responder.

Mensagem de cliente real quase sempre mistura o que o documento cobre com o que
ele não cobre.

**Correção proposta:** responder a parte coberta e escalar só o resto. Dois
efeitos colaterais a tratar junto: (1) `engine.ts` zera as fontes quando há
handoff, e numa resposta parcial elas precisam ser citadas; (2) a frase de
handoff é uma só para todos os motivos — "não tenho essa informação" está errado
quando o motivo é "isso quem faz é uma pessoa".

---

## Outras pendências

1. **Medir a memória compactada com API real.** Só tem teste offline. Roteiro:
   8+ turnos, e no último perguntar sobre algo do começo. Conferir que o bot
   lembra o assunto **e** re-consulta o preço nos documentos.
2. **`npm run avaliar -- clinica-sorriso --repeticoes 5`** (~US$ 0,06) e comparar
   com os 100%/100% da Etapa 4. Nenhuma das frentes desta sessão foi medida
   contra a suíte inteira.

## Aberto, mas não é bug

- Mensagem vaga (`"preciso de ajuda"`, `"?"`) cai em handoff. Não medido.
- Meta-pergunta (`"você é um robô?"`) cai em handoff. Decisão de produto.
- O banco local tem 3 conversas legítimas em handoff (`pizza`, `botox`).

## O padrão dos bugs desta sessão

Nenhum foi "o modelo não entendeu". Em dois o modelo nunca teve a chance (foi
barrado antes pelo limiar); no terceiro entendeu e foi obrigado a descartar por
uma regra tudo-ou-nada. **Melhorar entendimento aqui é classificar e rotear.**

E os três apareceram **conversando na página**, não pela suíte. A página
`/testes` é onde cada um vira caso permanente, e a lista de `unanswered` do
painel é a fila de mensagens que o bot não soube tratar.
