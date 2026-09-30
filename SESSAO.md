# Estado da sessão — retomar daqui

Arquivo de handoff entre sessões. O `PROGRESSO.md` conta o que o projeto **é**;
este conta o que está **em andamento agora**.

**Última sessão:** 2026-09-29
**Estado:** suíte **verde** — 355 testes offline, typecheck limpo, e a suíte paga
em **100% de acurácia e 100% de estabilidade** (5 rodadas, 28 perguntas).
**Branch:** `conversa-natural`, à frente de `main`.
**Próximo:** a coleta de dados repetida na conversa (ver a seção da conversa real
abaixo) e depois trocar os documentos da clínica fictícia pelos de um cliente real.

**No banco há uma consulta de verdade** (`2026-10-02 09:00`, Gabriel, conversa 22),
feita pela página durante a sessão. Não é resíduo de teste — não apague sem
perguntar.

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

## A regressão paga foi feita: 100%/100%

Detalhe em `PROGRESSO.md`, "A regressão paga, finalmente rodada". Em resumo: caiu
para 93,6% na primeira medição, duas perguntas falhando; uma era regressão de
verdade (o bot dava o preço do clareamento de consultório para quem perguntou do
a laser) e a outra era o teste do `pizza`, que ainda cobrava o limiar-porteiro. As
duas resolvidas, segunda medição 28/28 nas 5 rodadas. **`semPersistir` confirmado:
140 chamadas e zero linha escrita na agenda.**

---

## O que a conversa real na página expôs (2026-09-29, 21:46)

Vale mais que a suíte, como sempre nesta fase. O agendamento **funcionou** de
ponta a ponta (`2026-10-02 09:00`, conversa 22, ainda no banco), mas levou 8
turnos para coletar o que caberia em 2. Nada disto está corrigido:

1. **O bot esquece a data que ele mesmo acabou de oferecer.** Listou os horários
   de sexta 02/10, o cliente disse `"as 9"`, e ele respondeu *"preciso da data
   exata"*. A data estava na mensagem anterior dele.
2. **Pede duas vezes o que já tem.** Recebeu o telefone e pediu a data de novo;
   recebeu o nome e pediu *"me confirma seu nome completo"* depois. O `"ja te
   mandei"` do cliente é o sintoma. A regra 7 existe para isso e não bastou.
3. **`"como"` virou conversa solta.** O classificador social está inocente —
   conferido, `"como"` vai para a busca. Foi o modelo: pela regra 2, tratou um
   follow-up curto como "algo que não consegui entender" e respondeu *"Oi! Como
   posso te ajudar?"*, perdendo o fio. Mesma família do bug de resposta parcial: a
   regra 2 é generosa demais com mensagem curta que TEM sentido no histórico.
4. **`"como funciona"` respondeu formas de pagamento** quando o assunto era
   remarcação. Deriva de contexto.
5. **Ofereceu 12:00.** Não é bug: o `tenant.json` da clínica tem uma janela só,
   08:00–18:00, sem almoço. Mas se algum documento mencionar horário de almoço, os
   dois se contradizem — é exatamente o risco descrito no README, em "O bloco
   `agenda` do `tenant.json`".

Os itens 1, 2 e 3 são a mesma raiz: **o modelo tem o histórico, mas não está sendo
obrigado a usá-lo antes de pedir de novo.** É a próxima frente óbvia de prompt, e
dá para medir na página.

### Agora isso é detectado sozinho

`npm run conversas -- <slug>` mede o aproveitamento de cada conversa, e o mesmo
relatório abre no `/painel` clicando numa linha. Detalhe em `PROGRESSO.md`,
"Auditoria de conversa". A conversa 22 dá **64%**, com os cinco achados acima.

É o número que diz se a próxima mexida no prompt resolveu: hoje 64%, e o alvo é
não ter `pedido_repetido` nenhum. **Medir antes e depois na mesma conversa não
custa nada** — a auditoria não chama a API.

---

## Pendências, em ordem

1. **A coleta de dados repetida (itens 1 a 3 acima).** É o que mais incomoda quem
   conversa, e é de graça testar na página.
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
