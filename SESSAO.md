# Estado da sessão — retomar daqui

Arquivo de handoff entre sessões. O `PROGRESSO.md` conta o que o projeto **é**;
este conta o que está **em andamento agora**.

**Última sessão:** 2026-09-29
**Estado:** suíte **verde** — 336 testes, typecheck limpo, árvore limpa.
**Branch:** `conversa-natural` (4 commits à frente de `main`).
**Próximo:** Fase C — lembretes.

---

## Próximo passo: Fase C, lembretes

Plano aprovado em `~/.claude/plans/pode-commitar-e-em-curried-matsumoto.md`.
É a menor das três fases. A infraestrutura já existe:

- Tabela `outbox` já criada na migration `003`, com índice único
  `(appointment_id, kind)` — é ele que garante a idempotência, na mesma
  disciplina do `ingest`: rodar duas vezes no mesmo dia não duplica.
- Cancelar um agendamento **já apaga** o lembrete pendente, na mesma transação
  (feito na Fase 1, com teste).

Falta:
1. `src/core/agenda/lembretes.ts` — gerar, para cada consulta do dia sem
   lembrete, uma linha no outbox com o texto da mensagem.
2. `npm run lembretes -- <slug>` — gera e lista; `--enviar` marca `sent_at`,
   simulando o canal.
3. Painel: seção de lembretes pendentes.
4. Testes: idempotência, só do dia, não gera para cancelado, `--enviar` marca.

Nesta fase não existe WhatsApp: o outbox é o ponto de encaixe do adaptador
real, e o núcleo não vai mudar quando ele chegar.

**Verificar de verdade:** criar agendamento para hoje, rodar o comando,
conferir o texto; rodar de novo e conferir que **não** duplica; cancelar e
conferir que o lembrete pendente sumiu.

---

## O que saiu nesta sessão (4 commits, tudo em `conversa-natural`)

| commit | o que |
|---|---|
| `24999e8` | Bateria de testes `/testes`, turno social, nova conversa, memória compactada |
| `89c1db8` | Agenda no núcleo e página `/agenda` (fase 1) |
| `f3283b5` | A conversa não trava: saudação com typo e volta do handoff por botão |
| `2dd5b87` | O bot opera a agenda: marca, remarca e cancela (fase 2) |

O detalhe de cada um, com o porquê das decisões, está no `PROGRESSO.md`.

### Mudanças de comportamento que valem lembrar
- **O limiar não barra mais ninguém.** Só escolhe se o contexto vai firme ou
  marcado como fraco, e alimenta o `melhorScore`. Quem julga é o modelo.
- **Handoff não é mais porta sem maçaneta.** Toda resposta muda oferece a ação
  `voltar_ao_bot`; o botão devolve a conversa para `open` e o handoff
  **continua pendente** para a equipe revisar.
- **Taxa de resolução** conta conversas que tiveram ALGUM handoff, e não o
  status atual — senão a volta do bot faria a conversa contar como resolvida.
- **`handoffs.resolved_at`** (migration `004`) separa "humano precisa olhar" de
  "bot está mudo".
- **O bot agenda.** Isso reverteu um item de Fora de Escopo, por decisão de
  produto.

---

## Pendências, em ordem

1. **Fase C** (acima).
2. **Custo das ferramentas.** Pergunta simples foi de US$ 0,00046 para
   US$ 0,00107, porque as definições entram em toda mensagem (~700 tokens).
   Ficou ligado em todas de propósito — filtro por palavra-chave erraria nos
   pedidos tortos, que causaram os três bugs desta fase. Reavaliar com uso
   real; a chave é `config.agenda.ferramentasSempre`.
3. **A avaliação não cobre agenda.** Sem conversa o motor não oferece
   ferramenta, então pergunta de agendamento no `avaliacao.json` mediria o bot
   sem as ferramentas. Testar fluxo de agenda é conversar na página.
4. **Memória compactada não foi medida com API real.** Só teste offline.
   Roteiro: 8+ turnos e, no último, perguntar sobre algo do começo. Conferir
   que o bot lembra o assunto **e** re-consulta o preço nos documentos.
5. **`npm run avaliar -- clinica-sorriso --repeticoes 5`** (~US$ 0,06) contra os
   100%/100% da Etapa 4. Nenhuma frente desta sessão foi medida contra a suíte
   inteira, e muita coisa mudou no prompt.
6. **Mesclar em `main`** quando quiser: `git checkout main && git merge conversa-natural`
   (fast-forward).

---

## Bug conhecido e NÃO corrigido: resposta parcial

`"quero marcar pra proxima sexta, tem vaga?"` tirou 0,418 e virou handoff com
*"Não tenho essa informação aqui"*, mesmo com o `faq.md` tendo "Como agendar".
A mensagem tem duas partes — uma que o documento responde e outra que não — e a
regra do prompt era tudo-ou-nada, descartando a mensagem inteira.

Parte disso melhorou nesta sessão (a regra 2 virou duas, e contexto fraco agora
é enviado), mas o caso de mistura continua. Dois efeitos a tratar junto:
`engine.ts` zera as fontes quando há handoff, e a frase de handoff é uma só
para todos os motivos — "não tenho essa informação" está errado quando o motivo
é "isso quem faz é uma pessoa".

## Aberto, mas não é bug

- Mensagem vaga (`"preciso de ajuda"`, `"?"`) cai em handoff. Não medido.
- Meta-pergunta (`"você é um robô?"`) cai em handoff. Decisão de produto.
- Agenda com vários profissionais em paralelo ficou fora: hoje é um recurso só.

## O padrão dos bugs desta fase

Nenhum foi "o modelo não entendeu". Em todos, ou o modelo nunca teve a chance
(barrado pelo limiar), ou foi obrigado a descartar (regra tudo-ou-nada). E os
três apareceram **conversando na página**, não pela suíte. A página `/testes` é
onde cada um vira caso permanente.
