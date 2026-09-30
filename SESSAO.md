# Estado da sessão — retomar daqui

Arquivo de handoff entre sessões. O `PROGRESSO.md` conta o que o projeto **é**;
este conta o que está **em andamento agora**.

**Última sessão:** 2026-09-29
**Estado:** suíte **verde** — 355 testes, typecheck limpo.
**Branch:** `conversa-natural`, à frente de `main`.
**Próximo:** a regressão paga (`npm run avaliar --repeticoes 5`) e depois trocar
os documentos da clínica fictícia pelos de um cliente real.

---

## A agenda está completa: as três fases saíram

| fase | o que | onde ler |
|---|---|---|
| 1 | agenda no núcleo e página `/agenda` para a recepção | `PROGRESSO.md`, "A agenda no núcleo" |
| 2 | o bot marca, remarca e cancela por tool calling | `PROGRESSO.md`, "O bot opera a agenda" |
| 3 | lembrete no dia da consulta, pelo `outbox` | `PROGRESSO.md`, "O lembrete do dia da consulta" |

O plano que guiou tudo está em
`~/.claude/plans/pode-commitar-e-em-curried-matsumoto.md`, e não sobrou item dele.

### O que a fase 3 acrescentou

- `src/core/agenda/lembretes.ts` — gerar, listar, drenar e marcar como enviado.
- `npm run lembretes -- <slug>` (`--data`, `--enviar`) — o dublê do canal.
- Seção e cartão de lembretes na fila no `/painel`.
- `config.agenda.lembrete` — `tipo` (o `kind` do outbox) e `horaDeEnvio` (07:30).

### Dois achados da fase 3 que valem lembrar

1. **Remarcar deixava o lembrete velho.** `alterarAgendamento` mudava o horário e
   não tocava no outbox; o corpo do lembrete tem o horário escrito dentro, e o
   índice único impediria gerar um segundo. Remarcar de 09:00 para 15:00 mandaria
   o cliente para as 09:00. Corrigido: apaga o pendente na mesma transação, como o
   cancelamento já fazia.
2. **`sent_at` é UTC, `scheduled_for` é hora local.** Apareceu na verificação
   real: `sent_at` gravado como `2026-09-30 00:22` quando aqui eram 21:22. Não é
   bug hoje porque nada compara os dois, mas um `WHERE scheduled_for <=
   datetime('now')` no futuro adaptador adiantaria o lembrete em 4h. Por isso
   `lembretesAEnviar(db, tenantId, agora)` já existe no núcleo, com o relógio
   injetado — para o adaptador não precisar inventar a consulta.

---

## Pendências, em ordem

1. **Regressão paga, que nunca foi feita depois de tudo isso.**
   `npm run avaliar -- clinica-sorriso --repeticoes 5` (~US$ 0,06) contra os
   100%/100% da Etapa 4. O prompt mudou muito: regra 2 virou duas, entraram as
   regras de agenda e a data de hoje. **Conferir também que a avaliação não criou
   agendamento nenhum** — é o teste de fogo do `semPersistir`.
2. **Custo das ferramentas.** Pergunta simples foi de US$ 0,00046 para
   US$ 0,00107, porque as definições entram em toda mensagem (~700 tokens). Ficou
   ligado em todas de propósito — filtro por palavra-chave erraria nos pedidos
   tortos, que causaram os três bugs desta fase. Reavaliar com uso real; a chave é
   `config.agenda.ferramentasSempre`.
3. **A avaliação não cobre agenda.** Sem conversa o motor não oferece ferramenta,
   então pergunta de agendamento no `avaliacao.json` mediria o bot sem as
   ferramentas. Testar fluxo de agenda é conversar na página.
4. **Memória compactada não foi medida com API real.** Só teste offline. Roteiro:
   8+ turnos e, no último, perguntar sobre algo do começo. Conferir que o bot
   lembra o assunto **e** re-consulta o preço nos documentos.
5. **Perguntas novas no `avaliacao.json`**, previstas no plano e não escritas:
   saudação com alongamento, mensagem curta ambígua, e uma mensagem ambígua que
   **não** deve virar agendamento.
6. **Mesclar em `main`** quando quiser:
   `git checkout main && git merge conversa-natural` (fast-forward).

---

## Bug conhecido e NÃO corrigido: resposta parcial

`"quero marcar pra proxima sexta, tem vaga?"` tirou 0,418 e virou handoff com
*"Não tenho essa informação aqui"*, mesmo com o `faq.md` tendo "Como agendar". A
mensagem tem duas partes — uma que o documento responde e outra que não — e a
regra do prompt era tudo-ou-nada, descartando a mensagem inteira.

Parte disso melhorou (a regra 2 virou duas, contexto fraco agora é enviado, e
agora existe a ferramenta que responde "tem vaga?"), mas o caso de mistura
continua. Dois efeitos a tratar junto: `engine.ts` zera as fontes quando há
handoff, e a frase de handoff é uma só para todos os motivos — "não tenho essa
informação" está errado quando o motivo é "isso quem faz é uma pessoa".

## Aberto, mas não é bug

- Mensagem vaga (`"preciso de ajuda"`, `"?"`) cai em handoff. Não medido.
- Meta-pergunta (`"você é um robô?"`) cai em handoff. Decisão de produto.
- Agenda com vários profissionais em paralelo ficou fora: hoje é um recurso só.
- O lembrete é um só, no dia. Lembrete de véspera não foi pedido.

## O padrão dos bugs desta fase

Nenhum foi "o modelo não entendeu". Em todos, ou o modelo nunca teve a chance
(barrado pelo limiar), ou foi obrigado a descartar (regra tudo-ou-nada). E os
três apareceram **conversando na página**, não pela suíte. O de remarcar, o
quarto, apareceu **rodando o comando de verdade** contra o banco real — não pela
suíte também. A página `/testes` é onde cada um vira caso permanente.
