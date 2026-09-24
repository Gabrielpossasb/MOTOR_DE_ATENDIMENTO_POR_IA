# Progresso do projeto

Arquivo vivo: atualizado ao fim de cada etapa. Serve para você acompanhar e
para uma sessão nova retomar o trabalho sem precisar reconstruir o contexto.

**Última atualização:** 2026-09-24, ao fim da Etapa 4.
**Estado:** todas as 4 etapas da fase local concluídas. A fase está pronta para
receber os documentos de um cliente real e ser calibrada com perguntas de verdade.

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
| `npm test` | 142 testes unitários, offline | zero |
| `npm run typecheck` | checagem de tipos | zero |
| `npm run calibrar -- <slug>` | mede scores de busca para ajustar o limiar | ~US$ 0,000005 |
| `npm run avaliar -- <slug>` | 24 perguntas contra a API real, gera logs | ~US$ 0,01 |
| `npm run avaliar -- <slug> --repeticoes 5` | roda 5x e mede estabilidade | ~US$ 0,05 |
| `npm run relatorio` | histórico de todas as avaliações | zero |
| `npm run relatorio -- <id>` | trajetória de uma pergunta | zero |
| `npm run relatorio -- --instaveis` | perguntas que oscilam | zero |
| `npm run web -- <slug>` | conversa em http://localhost:3000/ e painel em /painel | por mensagem |

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

**`npm test`** — 142 testes unitários, offline, grátis, ~2,7s. Rode a cada
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

## Etapa 3 — CONCLUÍDA

Adaptador web e painel.

### Entregue
- **Servidor HTTP** com `node:http` puro, sem framework — duas rotas de API e
  uma pasta de páginas não justificam dependência (`npm run web -- <slug>`)
- **Página de conversa** com cara de WhatsApp: balões, "digitando…", fontes e
  custo embaixo de cada resposta, aviso visual quando há handoff
- **Painel** com taxa de resolução, conversas por status, custo acumulado e
  médio, mensagens, latência média, lista de `unanswered` com score e tabela de
  conversas. Atualiza sozinho a cada 4s, para deixar aberto ao lado da conversa.
- 15 testes do adaptador, subindo o servidor de verdade em porta efêmera com
  dublês de embedder e LLM — HTTP real, mas offline e grátis

### Decisões
- **`rotas.ts` separado de `server.ts`.** O roteamento precisava ser testável;
  `server.ts` ficou só com a montagem das dependências reais e o `listen`.
- **A agregação do painel mora no core** (`src/core/painel/painel-service.ts`),
  não no adaptador. O que conta como "resolvido" é decisão de negócio, não
  formatação — e assim tem teste offline.
- **Taxa de resolução conta por CONVERSA, não por mensagem.** Uma conversa com
  cinco acertos e um handoff no fim não foi resolvida pelo bot: alguém da equipe
  teve de entrar. Contar por mensagem esconderia exatamente o que interessa.
- **Cada aba do navegador é um contato diferente** (`sessionStorage`), o que
  permite testar várias conversas simultâneas no mesmo tenant.

### Segurança verificada
A rota de arquivos estáticos resolve o caminho e **recusa qualquer coisa fora da
pasta de páginas**, inclusive com travessia codificada (`%2e%2e%2f`). Sem essa
barreira, `../../../.env` entregaria a chave da OpenAI a quem pedisse. Há teste
para isso, conferindo que a resposta não contém `OPENAI_API_KEY`.

### Observações da execução real
- UTF-8 passa íntegro pelo servidor (testado com "vocês atendem crianças? é
  urgente"). Um `voc�s vendem pizza?` que aparece no painel veio de um teste meu
  com `curl` no Git Bash do Windows, que mangueou a codificação **antes** de
  enviar — não é falha do servidor.
- Encerrar o processo do servidor no Windows às vezes deixa a porta presa
  (`EADDRINUSE`). Se acontecer: `netstat -ano | grep :3000` e
  `taskkill //F //PID <pid>`.

---

## Etapa 4 — CONCLUÍDA

Medição de estabilidade e fechamento do laço de calibração.

### Sobre o pedido original
O pedido era um `scripts/evaluate.ts` que lê um JSON de perguntas, roda tudo e
reporta acurácia, custo médio e latência média. O `avaliar.ts` da Etapa 2 já
fazia exatamente isso — criar um segundo script com nome em inglês seria
duplicação. O que faltava de verdade era a pergunta em aberto: **qual a taxa de
oscilação do modelo?**

### Entregue
- `npm run avaliar -- <slug> --repeticoes N` roda a mesma suíte N vezes
- `src/core/avaliacao/estabilidade.ts` mede, por pergunta: quantas vezes passou,
  se o resultado foi sempre o mesmo, **quantos textos distintos** o modelo
  produziu e a variação do `best_score`
- `logs/ESTABILIDADE.md` com as instáveis destacadas primeiro
- 14 testes da medição

### Por que acurácia sozinha engana
95% acertando sempre as mesmas perguntas é uma coisa; 95% sorteando quais é
outra, bem pior — em produção o cliente faz a pergunta **uma vez só**.

A **variação do score** separa as duas causas possíveis: como a mesma pergunta
gera sempre o mesmo embedding, variação acima de zero significa que os chunks
mudaram (houve reingestão); variação zero com resultado oscilante é puro o LLM.

### O que a medição revelou

**Primeira medição (5 rodadas):** 97,5% de acurácia média, mas **uma pergunta
oscilando** — `desconto`, que passou 2/5 com 3 textos distintos e variação de
score **0.000**. Ou seja: busca perfeitamente determinística, hesitação do LLM.

Ao abrir a trajetória, apareceu um **bug silencioso mais grave que o da Etapa 1**:

> *"Os valores de tabela particular são válidos para pagamento à vista.
> **Não tenho informação sobre desconto à vista aqui. Vou chamar alguém da
> equipe para te ajudar.**"*

O bot prometeu chamar a equipe e foi marcado como **resolvido**. A detecção
procurava a frase configurada; o modelo parafraseou a primeira oração
("não tenho informação **sobre desconto à vista**") e escapou. Em produção:
nenhum handoff criado, ninguém chamado, cliente esperando.

**Dois consertos, de naturezas diferentes:**

1. **Código** — `config.resposta.marcadorDeHandoff` (`"vou chamar alguém da
   equipe"`). A promessa de escalar é a parte estável da frase; não importa
   como o modelo diga que não sabe, se prometeu chamar alguém, alguém precisa
   ser chamado.
2. **Produto** — a causa raiz era o documento. `servicos.md` dizia "válidos para
   pagamento à vista" e nunca mencionava desconto, então o modelo genuinamente
   não conseguia decidir se sabia. O conserto foi escrever a informação que
   faltava no `faq.md`. **É exatamente para isso que serve a lista de
   `unanswered`.**

**Segunda medição, depois dos dois consertos:**

| | Antes | Depois |
|---|---|---|
| Acurácia média | 97,5% | **100%** |
| Estabilidade | 95,8% | **100%** |
| Perguntas oscilando | 1 | **0** |

### Quanto o texto varia (mesmo com veredito estável)
19 das 24 perguntas dão resposta **byte a byte idêntica** nas 5 rodadas. Só 5
variam a redação; `parcelamento` é a mais solta, com 4 textos em 5 rodadas — e
passa nas 5. Com temperatura 0,2 o modelo é bem mais determinístico do que a
observação isolada da Etapa 2 sugeria.

### Custo
5 rodadas × 24 perguntas = 120 chamadas por **US$ 0,050**. Medir estabilidade
custa cinco vezes uma avaliação, e vale — foi o que achou o bug.

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

- **Git inicializado** em 2026-09-23, branch `main`, commit `55c9005` com as
  Etapas 1 e 2 (53 arquivos). Conferido: `.env` **não** está versionado.
  `.gitattributes` normaliza as quebras de linha (LF no repositório).
- **A chave da OpenAI foi colada uma vez no `.env.example`** (arquivo versionado).
  Foi movida para `.env` e o placeholder restaurado **antes** de existir git, e
  o commit inicial não contém a chave. Ainda assim, rotacionar a chave é o
  caminho seguro se quiser zerar o risco.
- Os arquivos em `logs/` **são versionados de propósito**: é o histórico que
  permite calibrar.
