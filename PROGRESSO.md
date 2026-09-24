# Progresso do projeto

Arquivo vivo: atualizado ao fim de cada etapa. Serve para você acompanhar e
para uma sessão nova retomar o trabalho sem precisar reconstruir o contexto.

**Última atualização:** 2026-09-23, ao fim da Etapa 2.
**Estado:** Etapas 1 e 2 concluídas. Próxima: Etapa 3 (adaptador web + painel).

---

## O que é este projeto

Motor de um bot de atendimento que vai rodar no WhatsApp, mas nesta fase roda
100% local — sem WhatsApp e sem nuvem — para calibrar qualidade antes de gastar
com infraestrutura.

**Princípio que governa tudo:** o canal é um adaptador na borda. `src/core/` não
sabe se está falando com terminal, web ou WhatsApp. Quando a Cloud API entrar,
acrescenta-se um adaptador e nenhuma linha do núcleo muda. Tudo é multi-tenant
desde o primeiro commit.

---

## Como rodar (resumo)

```bash
npm install
cp .env.example .env            # e preencha OPENAI_API_KEY

npm run seed   -- clinica-sorriso
npm run ingest -- clinica-sorriso
npm run cli    -- clinica-sorriso
```

Comandos de qualidade:

| Comando | O que faz | Custo |
|---|---|---|
| `npm test` | 103 testes unitários, offline | zero |
| `npm run typecheck` | checagem de tipos | zero |
| `npm run calibrar -- <slug>` | mede scores de busca para ajustar o limiar | ~US$ 0,000005 |
| `npm run avaliar -- <slug>` | 24 perguntas contra a API real, gera logs | ~US$ 0,01 |
| `npm run relatorio` | histórico de todas as avaliações | zero |
| `npm run relatorio -- <id>` | trajetória de uma pergunta | zero |
| `npm run relatorio -- --instaveis` | perguntas que oscilam | zero |

---

## Decisões técnicas tomadas (e por quê)

| Decisão | Motivo |
|---|---|
| `better-sqlite3` **v13** | A v11 não tem binário para Node 24 e tentou compilar; a máquina não tem Visual Studio Build Tools. A v13 traz prebuild `win32-x64` — nada a compilar. |
| **OpenAI para tudo** | Você já tinha crédito lá. Uma chave só. `Embedder` e `LlmClient` são interfaces, então trocar de provedor depois é acrescentar uma classe. |
| `text-embedding-3-small` | 1536 dimensões, US$ 0,02 por milhão de tokens. |
| `gpt-5.4-mini` | US$ 0,75 / US$ 4,50 por MTok. Custa ~2x o `gpt-4.1-mini`, mas responde em ~1,2s contra ~2,8s. No WhatsApp o cliente sente a latência; US$ 4 a mais por mês, não. |
| `max_completion_tokens` (não `max_tokens`) | A linha `gpt-5.x` recusa o parâmetro antigo; a `gpt-4.x` aceita o novo. Usando o novo em tudo, trocar de modelo pelo `.env` não quebra. |
| Cosseno em memória | O corpus de um cliente cabe folgado na RAM. Fica atrás da interface `BuscaVetorial`, então `sqlite-vec` entra depois sem refatoração. |
| Limiar de confiança **0,40** | Ver seção "Calibração" abaixo. |
| `tsx` sem build | Menos peça móvel; `tsc --noEmit` só para checar tipos. |

---

## Etapa 1 — CONCLUÍDA

Esqueleto, SQLite, ingestão, busca e CLI.

### Entregue
- Estrutura `src/core` (agnóstico de canal) / `src/adapters` / `src/storage`
- Schema SQLite completo com as 8 tabelas, migrations versionadas
- `scripts/seed-tenant.ts` — cria tenant a partir de `tenant.json`
- `scripts/ingest.ts` — `.txt`/`.md` → chunks → embeddings → banco, **idempotente**
  (arquivo sem alteração é pulado; embedding custa dinheiro)
- `scripts/calibrar.ts` — mede a distribuição de scores da busca
- Busca por cosseno com isolamento por tenant
- Adaptador CLI respondendo e citando a fonte
- Tenant de exemplo: clínica odontológica (20 chunks, 3 documentos)

### Resultados medidos
- Ingestão de 20 chunks: **US$ 0,000023**
- Resposta típica: ~1,2s, ~US$ 0,00046 (R$ 0,0025)
- Pergunta fora do domínio: **US$ 0,00**, 306ms (barrada antes do LLM)

### O que a execução real revelou
1. **O `.txt` não chunkava direito.** Sem títulos markdown, "Contato" e
   "Atendimento de urgência" caíam no mesmo chunk. O chunker aprendeu a
   reconhecer título de texto puro (linha curta, sem pontuação final, isolada
   por linhas em branco). Foi de 2 para 4 chunks no arquivo, bem separados.
2. **Bug silencioso de handoff.** A checagem usava `includes()` com a frase
   exata; o modelo escreveu `"não tenho essa informação"` com "n" minúsculo e
   escapou. A conversa seria marcada como resolvida e **ninguém seria chamado**.
   Corrigido com comparação normalizada (minúsculas, sem acento). Teste que
   reproduz o caso real está em `tests/engine.test.ts`.

---

## Etapa 2 — CONCLUÍDA

Estado de conversa, handoff persistido, contabilidade e política de testes.

### Entregue
- **Conversa com estado**: uma conversa por (tenant, contato), reaproveitada
  entre mensagens. Conversa `closed` faz a próxima começar do zero.
- **Janela de contexto**: as últimas 8 mensagens vão ao modelo (config), não a
  conversa inteira. A frase de handoff é removida do histórico — deixá-la lá
  ensina o modelo a repeti-la.
- **Handoff persistido**: grava `handoffs` + `unanswered` + muda status da
  conversa, tudo numa transação. Uma conversa marcada como `handoff` sem a linha
  em `handoffs` seria uma conversa travada que nenhum painel mostra.
- **Bot cala a boca após handoff**: continuar respondendo atropelaria o
  atendente no meio do atendimento.
- **Contabilidade**: tokens, custo e latência em cada mensagem. O custo do
  embedding agora entra também no caminho de handoff.
- **`semPersistir`**: modo usado pela avaliação, que roda dezenas de perguntas
  sem sujar o histórico real nem disparar handoffs falsos para a equipe.

### Política de testes (o que você pediu)

**Dois tipos, separados de propósito.** Juntos os dois pioram: o determinístico
fica lento e caro, o não-determinístico some no ruído.

**`npm test`** — 103 testes unitários, offline, grátis, ~2s. Rode a cada
salvamento. Embedder e LLM são sempre dublês; **nenhum teste unitário toca a
rede**. Um teste só entra se falha por *um* motivo nomeável, se o nome descreve
comportamento (não implementação), e — quando nasce de bug real — traz comentário
dizendo qual era o caso.

**`npm run avaliar`** — 24 perguntas contra a API real, ~US$ 0,01, não-determinística.
Critério: regras explícitas por pergunta em `data/tenants/<slug>/avaliacao.json`
(`deveConter`, `naoPodeConter`, `esperaHandoff`, `fonteEsperada`).

Além disso, **toda** resposta passa por uma checagem automática global: qualquer
valor em reais, horário, prazo ou porcentagem citado precisa existir nos chunks
recuperados. É a verificação direta de "nunca invente preço, prazo, horário ou
disponibilidade". Um modelo que acerta o texto mas troca R$ 180 por R$ 190 passa
em qualquer teste de palavra-chave e **reprova aqui**.

### Os logs (como calibrar)

```
logs/
  ULTIMO.md              ← abra este primeiro
  historico.jsonl        ← append-only, uma linha por (execução, pergunta)
  avaliacoes/<data>.md   ← cada execução preservada
```

Cada relatório traz por pergunta: passou/falhou, **qual regra quebrou**, a
**resposta completa**, as **fontes com scores** e o **best_score**. E uma seção
de **regressões** — o que passava antes e falhou agora. É a seção mais
importante: separa "eu piorei" de "o modelo variou".

### Resultados medidos

| Execução | Acurácia | Custo | Latência média |
|---|---|---|---|
| 2026-09-23-21-58 | 95,8% (23/24) | US$ 0,0101 | 1324 ms |
| 2026-09-23-21-59 | 100% (24/24) | US$ 0,0101 | 1234 ms |

### O que a avaliação revelou

**A única falha era do meu teste, não do bot.** Na pergunta "vocês dão desconto
para pagamento à vista?" eu esperava handoff. O bot respondeu *"Os valores de
tabela particular já são válidos para pagamento à vista"* — ancorado literalmente
em `servicos.md`. O bot reenquadrou a pergunta corretamente; minha expectativa é
que estava errada. Corrigida, com o motivo registrado no próprio
`avaliacao.json`.

Isso expôs um buraco real: o extrator de números não pegava **porcentagem**, então
um `"damos 10% de desconto"` inventado passaria. Corrigido, com teste.

---

## Calibração: o limiar é porteiro, não juiz

`npm run calibrar` mediu 24 perguntas e mostrou que os dois grupos **se sobrepõem**:

| grupo | faixa de score |
|---|---|
| perguntas que a base responde | 0,426 – 0,733 |
| perguntas sem resposta na base | 0,331 – **0,593** |

`"qual o CNPJ da clínica?"` tira 0,593 porque *fala* da clínica — só que a
resposta não existe nos documentos. **Nenhum número separa os dois grupos.**

Por isso o limiar (0,40) fica **abaixo da pergunta legítima mais fraca**: nunca
barra cliente de verdade, e ainda filtra de graça o que é claramente fora do
assunto. Quem julga o resto é o LLM.

Rode `calibrar` de novo sempre que trocar o modelo de embeddings ou mexer
bastante nos documentos.

---

## Etapa 3 — A FAZER

Adaptador web e painel.

- [ ] Página simples com cara de WhatsApp (`src/adapters/web/`)
- [ ] Servidor HTTP mínimo, sem framework pesado
- [ ] Painel com: lista de conversas, taxa de resolução, custo acumulado e
      lista de `unanswered`
- [ ] Testes do adaptador web

**Já pronto para isso:** `custoAcumulado()` e `listarPerguntasSemResposta()` em
`src/storage/repositories/`, e `listarConversas()`.

**Atenção ao fazer:** o adaptador web é borda. Ele chama `Motor.responder()` e
formata para HTTP — nenhuma lógica de negócio pode nascer ali.

---

## Etapa 4 — A FAZER

Suíte de avaliação formal.

- [ ] `scripts/evaluate.ts` conforme o pedido original (JSON de perguntas e
      respostas esperadas, acurácia, custo médio, latência média)
- [ ] Avaliar se o `avaliar.ts` da Etapa 2 já cobre, ou se falta algo
- [ ] Rodar N vezes a mesma suíte para medir **estabilidade**, não só acurácia

**Ponto em aberto que a Etapa 4 precisa resolver:** a mesma pergunta pode dar
respostas diferentes entre execuções (temperatura 0,2). Foi observado na
pergunta sobre SUS. Ainda não se sabe qual é a taxa de oscilação nem se ela é
aceitável. O comando `npm run relatorio -- --instaveis` existe para medir isso.

---

## Fora de escopo nesta fase

Confirmado com o usuário, não fazer:
- WhatsApp, Evolution API, Cloud API
- Supabase ou qualquer serviço em nuvem
- Autenticação, painel administrativo completo, área de login
- LangChain — o RAG é explícito de propósito
- O bot tentar vender, agendar ou processar pagamento

---

## Pendências e avisos

- **Ainda não há git neste projeto.** Foi oferecido `git init` + commit inicial;
  aguardando decisão. O `.gitignore` já existe e já ignora `.env` e `data/*.db`.
- **A chave da OpenAI foi colada uma vez no `.env.example`** (arquivo versionado).
  Foi movida para `.env` e o placeholder restaurado. Como não há git, ela nunca
  saiu da máquina — mas vale trocar a chave se quiser zerar o risco.
- Os arquivos em `logs/` **são versionados de propósito**: é o histórico que
  permite calibrar.
