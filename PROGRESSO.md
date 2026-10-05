# Progresso do projeto

Arquivo vivo: atualizado ao fim de cada etapa. Serve para você acompanhar e
para uma sessão nova retomar o trabalho sem precisar reconstruir o contexto.

**Última atualização:** 2026-09-29, com a agenda completa (as três fases).
**Estado:** as 4 etapas da fase local concluídas, mais a conversa que não trava e
a agenda inteira — a recepção opera pela página, o bot marca/remarca/cancela, e o
lembrete do dia sai pelo `outbox`. A fase está pronta para receber os documentos
de um cliente real e ser calibrada com perguntas de verdade.

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
| `npm run novo-tenant -- <slug> "<Nome>"` | cria a pasta de um cliente novo com modelos | zero |
| `npm test` | 405 testes unitários, offline | zero |
| `npm run typecheck` | checagem de tipos | zero |
| `npm run calibrar -- <slug>` | mede scores de busca para ajustar o limiar | ~US$ 0,000005 |
| `npm run avaliar -- <slug>` | 28 perguntas contra a API real, gera logs | ~US$ 0,01 |
| `npm run avaliar -- <slug> --repeticoes 5` | roda 5x e mede estabilidade | ~US$ 0,05 |
| `npm run relatorio` | histórico de todas as avaliações | zero |
| `npm run relatorio -- <id>` | trajetória de uma pergunta | zero |
| `npm run relatorio -- --instaveis` | perguntas que oscilam | zero |
| `npm run lembretes -- <slug>` | enfileira os lembretes das consultas de hoje e lista a fila | zero |
| `npm run conversas -- <slug>` | lista as conversas com o aproveitamento de cada uma | zero |
| `npm run conversas -- <slug> --id N` | transcrito com os achados; `--md` exporta | zero |
| `npm run lembretes -- <slug> --enviar` | marca a fila do dia como enviada | zero |
| `npm run web -- <slug>` | conversa em `/`, agenda em `/agenda`, testes em `/testes`, painel em `/painel` | por mensagem |

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

**`npm test`** — 405 testes unitários, offline, grátis, ~5s. Rode a cada
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

## Calibração: o limiar deixou de ser porteiro (revisto em 2026-09-29)

`npm run calibrar` mediu 24 perguntas e mostrou que os dois grupos **se sobrepõem**:

| grupo | faixa de score |
|---|---|
| perguntas que a base responde | 0,426 – 0,733 |
| perguntas sem resposta na base | 0,331 – **0,593** |

`"qual o CNPJ da clínica?"` tira 0,593 porque *fala* da clínica — só que a
resposta não existe nos documentos. **Nenhum número separa os dois grupos.**

Esse raciocínio continua valendo, e foi ele que acabou derrubando o papel de
porteiro. Enquanto o limiar decidia quem chegava ao modelo, ele errava para o
lado mais caro: `"bom diaa"` tirou **0,288**, foi barrado, virou handoff — e
como handoff cala o bot, a conversa inteira morreu. Um número que não separa os
dois grupos também não separa "cumprimento" de "pergunta sem resposta".

**Hoje o limiar não barra ninguém.** Ele faz duas coisas menores:

1. decide se o contexto vai ao modelo como firme ou marcado como fraco;
2. alimenta o `melhorScore`, que é o dado de calibração no painel.

Quem julga se dá para responder é o modelo, que tem uma regra para conversar
(mensagem que não é pergunta) e outra para escalar (pergunta que o contexto não
responde). E quando **nada** passa do limiar, os dois melhores trechos vão junto
assim mesmo, avisados como fracos — porque o limiar estava matando o contexto de
fome: `"tem onde parar o carro?"` tira 0,329 e o trecho descartado dizia
*"temos estacionamento próprio e gratuito, com seis vagas"*. Com o trecho na
mão, o bot responde certo; sem ele, chamava um atendente.

**O que isso custou, medido:** pergunta fora do assunto passou de US$ 0 para
~US$ 0,0004, porque agora chega ao modelo. O desfecho não muda — o modelo recusa
igual, e o handoff acontece do mesmo jeito. Comprar 0,04 centavo para não matar
conversa é troca boa.

Rode `calibrar` de novo sempre que trocar o modelo de embeddings ou mexer
bastante nos documentos. O número continua importando; só não manda mais em
quem é atendido.

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

## Como colocar um cliente real (resumo)

```bash
npm run novo-tenant -- barbearia-do-ze "Barbearia do Zé"
```

Cria a pasta com `tenant.json`, `avaliacao.json` e um `LEIA-ME.md` explicando o
que escrever em cada lugar. Não sobrescreve pasta existente.

Depois: documentos `.txt`/`.md` na pasta → ajustar `promptDoSistema` → escrever
as perguntas reais em `avaliacao.json` → `seed` → `ingest` → `calibrar` →
`avaliar --repeticoes 5`.

**O conjunto de perguntas precisa de três famílias**, e a do meio é a que mais
importa: perguntas que *falam do negócio* mas cuja resposta não está nos
documentos. É onde o bot inventa se estiver mal calibrado — na clínica de
exemplo é o caso `cnpj`, que pontua 0,593 na busca e mesmo assim deve ser
recusado.

---

## `.env` versus `.env.example`

`.env.example` **não é lido por nenhuma linha de código** — aparece só dentro do
texto de duas mensagens de erro. Quem lê é `dotenv.config()`, e ele lê só o
`.env`. O `.example` existe para documentar *quais* variáveis o projeto precisa,
podendo ser versionado sem levar a chave junto.

| Variável | Efeito | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | embeddings e chat | obrigatória |
| `LLM_MODEL` | sobrescreve o modelo de chat | `gpt-5.4-mini` |
| `WEB_PORT` | porta do adaptador web | `3000` |

Trocar `LLM_MODEL` sem atualizar os preços em `config.ts` faz o custo reportado
em cada mensagem virar ficção.

---

## Dois erros achados ao cadastrar o primeiro cliente (2026-09-24)

Criar uma barbearia de teste com o scaffold expôs duas falhas que nenhum teste
unitário pegaria, porque as duas só aparecem com uma pasta de tenant de verdade.

**1. O manual virou base de conhecimento.** O `LEIA-ME.md` gerado pelo scaffold
estava na mesma pasta que o `ingest` varre em busca de `.md`. Resultado: 10 dos
17 chunks da barbearia eram o manual, e o bot passou a "saber" responder sobre
`npm run seed` como se fosse serviço da empresa.

Conserto: **arquivo começando com `_` não é ingerido**, e o scaffold agora gera
`_LEIA-ME.md`. Vale como convenção geral para rascunhos e notas internas.

**2. O `calibrar.ts` tinha as perguntas da clínica escritas no código.** Rodá-lo
na barbearia media "quanto custa o implante?" contra documentos de barbearia —
inútil.

Conserto: as perguntas vêm do `avaliacao.json` do próprio tenant, e o campo
`esperaHandoff` já diz a qual grupo cada uma pertence. O script também passou a
**sugerir** um limiar em vez de só mostrar números.

Ambos os scripts ganharam guarda de entrada (`if process.argv[1] endsWith ...`)
para poderem ser importados por um teste sem disparar uma ingestão de verdade.

### A barbearia ficou no projeto
`data/tenants/barbearia-do-ze/` é um segundo tenant real, com 7 chunks, limiar
próprio (0,424, calibrado) e 8 perguntas cobrindo as três famílias. Serve de
exemplo e prova que o isolamento multi-tenant funciona com dado de verdade.
Pode ser apagada sem afetar nada.

---

## Bateria de testes na web (2026-09-25)

A suíte de avaliação só existia como comando: `npm run avaliar` rodava tudo, e
para mexer numa pergunta era preciso abrir o `avaliacao.json` num editor. Agora
`/testes` mostra as perguntas, deixa editá-las e rodar **uma, um grupo ou todas**.

### Entregue
- Página `/testes` no adaptador web: cada pergunta é um cartão com a expectativa
  (deve responder / deve recusar), o veredito, a resposta completa, as regras que
  quebraram, as fontes com scores, o `best_score`, o custo e a latência
- Edição dos 7 campos do `avaliacao.json` na própria página, com "Salvar" que
  reescreve o arquivo — o mesmo que o `npm run avaliar` lê
- Seleção por grupo: todas, nenhuma, deve responder, deve recusar e
  **as que falharam** (a que mais se usa: rodar de novo só o que quebrou)
- Custo estimado no botão **antes** de rodar, custo medido depois
- Botão "Parar", que interrompe entre uma pergunta e a seguinte
- 35 testes novos (26 do arquivo/validação, 9 das rotas)

### Decisões
- **A execução de uma pergunta virou `core/avaliacao/suite.ts`.** Era código de
  dentro do `avaliar.ts`. Com dois chamadores, uma cópia em cada lado deixaria a
  página dizer "passou" onde a suíte diz "falhou" — e aí nenhum dos dois
  serviria para calibrar. O `avaliar.ts` encolheu e agora só cuida do terminal.
- **Rodar pela página NÃO grava em `logs/`.** Uma rodada parcial de 3 perguntas
  registrada como execução faria o `relatorio` comparar 3 contra as 24 da suíte,
  e a seção de regressões — a mais importante dos logs — acusaria 21 falhas que
  nunca aconteceram. Quem registra histórico é o `npm run avaliar`.
- **Uma requisição HTTP por pergunta**, mesmo a rota aceitando lista. É o que faz
  o resultado aparecer conforme sai e o "Parar" funcionar de verdade.
- **Roda sequencial**, como o script. Em paralelo as latências medidas viram
  ficção e deixam de ser comparáveis com as do `npm run avaliar`.
- **Campo desconhecido é erro, não é ignorado.** Escrever `deveConterr` com dois
  r não afrouxaria a regra de um jeito visível: deixaria a pergunta passando sem
  verificar nada. Um teste que passa à toa é pior que teste nenhum. Vale também
  para o `npm run avaliar`, que agora lê o arquivo pelo mesmo validador.
- **Gravação atômica** (escreve `.tmp` e renomeia): se o processo morrer no meio,
  o `avaliacao.json` continua o antigo e válido em vez de virar meio arquivo.
- **Id não pode conter `|`.** O id entra em tabela markdown nos relatórios; um
  pipe no meio quebraria a tabela do `ESTABILIDADE.md` em silêncio.

### Conferido rodando de verdade
As 24 perguntas da clínica carregam na página, os grupos batem (9 "deve recusar"
+ 15 "deve responder"), e uma execução real de `horario-sabado` passou por
US$ 0,000464 em 4,5s, com `best_score` 0,572 e as 4 fontes citadas com score.

---

## Turno social: o bot chamava um humano para responder "boa tarde" (2026-09-25)

Achado conversando na página `/`: um **"boa tarde"** tirou **0,370** na busca,
abaixo do limiar de 0,40, e o bot respondeu *"Não tenho essa informação aqui.
Vou chamar alguém da equipe"*, registrou handoff e marcou a conversa.

### Por que era pior do que parecia
Três estragos, e o segundo é o grave:

1. Um atendente é acionado para retribuir um cumprimento. No WhatsApp, a fila da
   equipe encheria de "oi".
2. **A conversa morre ali.** Como `bloquearBotAposHandoff` cala o bot depois de
   um handoff, a pergunta de verdade — que viria na mensagem seguinte — nunca
   seria respondida. Quem cumprimenta antes de perguntar não é atendido.
3. `unanswered` enche de saudação, e é justamente a lista que diz qual documento
   falta escrever.

### Mexer no limiar não resolveria
Com o limiar mais baixo, "boa tarde" iria ao LLM com contexto irrelevante — e a
regra 2 do prompt manda responder **exatamente** a frase de handoff quando o
contexto não responde. Mesmo resultado, agora pagando por ele. O problema nunca
foi o número: era o motor ter só **dois modos** (responder pelos documentos ou
chamar um humano) quando uma saudação não é nenhum dos dois.

### Entregue: um terceiro modo
- `src/core/conversation/turno-social.ts` classifica saudação, agradecimento,
  despedida e confirmação. **Determinístico**: custo zero, latência zero,
  testável offline. Sai antes da busca, então não gasta nem embedding.
- Prompt próprio (`montarPromptSocial`), sem CONTEXTO e com a regra dura
  invertida: não pode sair **nenhum** dado do negócio, porque qualquer um seria
  inventado. Quem escreve a resposta é o LLM, então ela varia — não é frase
  enlatada.
- O histórico vai junto: é o que faz "boa noite" no fim de um atendimento ser
  lido como despedida, e não como novo cumprimento.
- 4 perguntas sociais no `avaliacao.json` da clínica, para calibrar em `/testes`.
- 57 testes novos (49 do classificador, 8 do motor).

### A regra que segura o classificador
Só é turno social a mensagem em que **não sobra nada** depois de tirar as
expressões sociais e o ruído. Por isso `"oi, quanto custa a limpeza?"` continua
sendo pergunta e segue o caminho normal.

O risco aqui é assimétrico: deixar passar uma saudação devolve o bug antigo, mas
tratar uma **pergunta** como saudação é pior — o cliente pede preço e leva um
"oi, tudo bem?". Por isso metade dos testes é sobre o que NÃO pode ser
confundido: `"oito reais?"` não contém "oi", `"bolacha"` não contém "olá",
`"até que horas vocês abrem?"` não é despedida (só as formas compostas — "até
logo", "até mais" — entraram na lista; "até" sozinho ficou de fora).

A promessa de escalar continua sendo detectada mesmo no caminho social: se o
modelo desobedecer e prometer chamar alguém, alguém é chamado. Já aconteceu duas
vezes neste projeto de essa promessa passar batida.

### Medido contra a API real

| Mensagem | Antes | Depois |
|---|---|---|
| `boa tarde` | handoff, equipe acionada | *"Boa tarde! Como posso te ajudar hoje?"* |
| `obrigado!` | handoff | *"Eu que agradeço! Fico à disposição sempre que precisar"* |
| `tchau, até mais` | handoff | *"Tchau! Até mais, e quando quiser, é só chamar"* |
| `boa tarde, vocês abrem no sábado?` | handoff | *"Sim, abrimos aos sábados das 8h às 12h."* (score 0,516) |

A conversa inteira do print refeita: `boa tarde` → `quanto custa a limpeza?` →
`obrigado!` responde as três, a conversa fica `open` o tempo todo e **nenhuma
entrada nova** aparece em `unanswered`. Custo das 4 perguntas: US$ 0,001055.

### "Nova conversa": reiniciar rápido para ir testando

Botão no cabeçalho da página de conversa (atalho **Ctrl+Shift+N**), para tentar
uma conversa natural atrás da outra sem abrir aba nova.

O mecanismo já existia: `closed` faz a próxima mensagem criar uma conversa do
zero, sem histórico e sem herdar o status. O botão só marca a conversa atual
como encerrada — mesmo contato, conversa nova.

Dois detalhes que valem registrar:

- **Fecha, não apaga.** O histórico é o que alimenta o painel e a lista de
  buracos da base. Testar de novo não pode jogar fora o que o teste anterior
  produziu.
- **É a saída de uma conversa presa em handoff.** Depois de um handoff o bot
  fica mudo de propósito, para não atropelar o atendente. Até agora o único
  jeito de voltar a conversar era trocar de contato. Tem teste para isso.

A decisão de encerrar mora no core (`encerrarConversa`), não no adaptador; a
rota só traduz HTTP. De quebra, a busca pela conversa ativa, que estava embutida
no `obterOuCriarConversa`, virou `conversaAtiva` e é usada pelos dois.

### Limpeza dos handoffs falsos (feita)
O banco local tinha 4 conversas travadas em `handoff`. Usando o próprio
classificador novo para decidir o que era falso, só **uma** era — a do "boa
tarde". As outras três eram legítimas (`pizza`, `botox`) e ficaram como estavam.
A conversa foi encerrada e o "boa tarde" saiu da lista de `unanswered`, onde era
ruído puro.

### Fica em aberto
- Mensagem vaga que não é social nem pergunta (`"preciso de ajuda"`, `"?"`)
  ainda cai em handoff. Provavelmente certo, mas não foi medido.
- Meta-perguntas (`"você é um robô?"`) também caem em handoff. A resposta certa
  é decisão de produto de cada cliente, então ficou de fora.
- Tirar a saudação da consulta antes de buscar (`"oi, quanto custa?"` →
  `"quanto custa?"`) melhoraria o embedding. Não foi feito: o ganho é
  especulativo e não dá para conferir sem gastar.

---

## Memória da conversa e busca com contexto (2026-09-26)

Duas frentes que resolvem o mesmo problema: o cliente não pode ter de repetir o
que já contou.

### Memória compactada
Quando a conversa passa de 8 mensagens, as antigas viram resumo em vez de
sumirem da janela. A memória é cumulativa — o resumo anterior entra na
compactação seguinte, senão a segunda esqueceria o começo.

- Migration `002`: colunas `summary` e `summary_until_message_id` (marca
  d'água) em `conversations`
- `compactarSeNecessario` e `montarContextoDaConversa` no core
- Com janela 8 e 4 preservadas, compacta a cada 3 turnos. Os tokens e o custo
  dessa chamada entram no `uso` da resposta: custo reportado que ignora uma
  chamada paga é ficção.

**A regra que não pode cair:** o resumo NÃO copia preço, prazo ou horário que o
BOT informou — registra que o assunto foi respondido, sem o número. Senão a
memória vira fonte de verdade paralela: o bot responde de cabeça em vez de
consultar os documentos, e a checagem de número inventado não pega, porque ela
compara contra os chunks e não contra o resumo. Um preço corrigido no documento
continuaria sendo repetido errado a conversa inteira. Número que o CLIENTE deu
fica, porque é dado do atendimento.

### A busca não via a conversa
O LLM recebia o histórico; a busca, não. Uma pergunta que se apoia na anterior
morria antes de chegar ao modelo — e como handoff cala o bot, a conversa
inteira morria junto. Medido numa conversa real de 8 turnos: travou no turno 3
e os turnos 4 a 8 vieram vazios.

| consulta | score |
|---|---|
| `e o canal?` | **0,369** (barrado) |
| `quanto custa um implante? e o canal?` | **0,672** |

Conserto: quando o score fica abaixo do limiar e há conversa, refaz a busca com
a pergunta anterior do cliente junto. Só roda quando a primeira falhou, e custa
um embedding — não uma chamada ao modelo.

### O que isso custou, medido
A segunda tentativa enfraquece o filtro grátis de fora-de-assunto dentro de uma
conversa:

| `vocês vendem pizza?` | score | desfecho | custo |
|---|---|---|---|
| sozinho | 0,373 | handoff | US$ 0 |
| depois de uma pergunta boa | 0,443 | handoff igual | US$ 0,000395 |

O desfecho não muda — o modelo recusa. Só o custo. Trocar 0,04 centavo por
conversa que morre é troca boa, então ficou sem filtro de intenção: um filtro
por palavra-chave teria falso negativo justamente nas elípticas sem conectivo
("tem desconto?"), que é o bug que se quer evitar.

Isso quebrou um teste do painel que contava com o limiar barrar a pergunta ruim.
O teste é do painel, não da recuperação — passou a controlar o handoff com um
dublê próprio, e agora vale com ou sem a segunda tentativa.

---

## A conversa não trava mais (2026-09-29)

`"bom diaa"` recebeu *"Não tenho essa informação aqui. Vou chamar alguém da
equipe"*, score 0,288 — e a conversa morreu ali: o `"opa"` seguinte já levou
*"Esta conversa já foi passada para um atendente"*.

Duas causas, e **em nenhuma o modelo errou**: a mensagem nunca chegou nele.

### 1. Alongamento derrubava o classificador social
Ele montava `\bbom dia\b`; em `"bom diaa"` a fronteira depois de "dia" não
existe, porque vem outra letra. `oii`, `tardee`, `obrigadoo` — o jeito como se
escreve no WhatsApp — passavam batido.

Conserto: colapsar letras repetidas antes de comparar, **dos dois lados**,
mensagem e lista. Não importa que "pessoal" vire "pesoal": importa que vire a
mesma coisa nos dois lados. Os testes de falso positivo continuam valendo —
`"oito reais?"`, `"bolacha"`, `"até que horas"` seguem não sendo saudação.

### 2. Handoff era porta sem maçaneta
Depois dele o bot calava para sempre. O cliente não tinha como voltar.

Conserto: **ações sugeridas**, um tipo novo que o núcleo devolve sem saber que
viram botão. No WhatsApp serão botões de resposta; na página, botões; no
terminal, um comando. Foi escolha do usuário fazer por botão e não por
adivinhação — ação explícita não erra intenção.

A ação acompanha a resposta que gerou o handoff **e toda resposta muda
seguinte**, então o cliente nunca fica sem saída. Texto livre com o bot mudo
continua sem resposta, de propósito: o botão está sempre à vista.

`Motor.executarAcao()` é entrada separada de `responder()`, porque tocar num
botão não é mandar uma mensagem — se viesse como texto, o motor teria de
adivinhar a intenção pelo rótulo, que é o que o botão evita.

### 3. Separar "humano precisa olhar" de "bot está mudo"
As duas coisas eram a mesma: `status = 'handoff'`. Com o botão, a conversa volta
para `open` e o handoff **continua pendente** — o colaborador ainda precisa ver
por que foi chamado. Migration `004` traz `handoffs.resolved_at`.

Isso obrigou a corrigir a taxa de resolução: ela contava `status = 'handoff'`, e
depois da volta o status é `open`, então uma conversa que precisou de gente
passaria a contar como resolvida. Agora conta **conversas que tiveram algum
handoff**, olhando a tabela. O painel ganhou a fila de handoffs pendentes, com
"bot voltou" marcado e botão de revisado.

### Medido contra a API real

| mensagem | antes | depois |
|---|---|---|
| `bom diaa` | handoff, conversa morta | *"Bom diaaa! 😊 Como posso te ajudar hoje?"* |
| `opa` (bot mudo) | "o bot não responde mais", sem saída | mesma mensagem, **com o botão** |
| botão | não existia | destrava, e o handoff segue pendente |
| `tem onde parar o carro?` (0,329) | handoff | *"Sim, temos estacionamento próprio e gratuito, com seis vagas."* |

### O que NÃO foi resolvido aqui (e foi resolvido depois)
`"ta entao marca dia 16 mesmo"` continuou virando handoff. O chunk certo era
enviado (0,376, "Como agendar") e o modelo recusava assim mesmo — porque é
pedido para **agendar**, e naquele momento o bot não sabia agendar.

**Resolvido na seção "O bot opera a agenda", logo abaixo:** com as ferramentas,
ele marca de verdade em vez de escalar.

---

## O bot opera a agenda (2026-09-29)

Fase 2 de 3 da agenda. A clínica não quer passar telefone: quer que o bot marque.

Isto **reverte** o "o bot tentar vender, agendar ou processar pagamento" que
estava em Fora de Escopo, e a regra 8 do prompt, que proibia. Decisão de
produto, não descuido.

### Tool calling, agnóstico de provedor
`LlmClient.responder()` devolvia só texto. Agora aceita `ferramentas` e
`turnosDeFerramenta`, e devolve `ferramentas` quando o modelo quer executar
algo. A interface fala `Ferramenta`/`ChamadaDeFerramenta`; quem traduz para
`tools`/`tool_calls` é só a implementação da OpenAI.

JSON de argumento quebrado **descarta a chamada** em vez de derrubar a resposta:
o modelo tem a volta seguinte para tentar de novo.

### O laço tem teto
Três voltas. Sem teto, um modelo confuso repete a chamada e queima crédito em
silêncio, com o cliente esperando uma resposta que não vem. Os tokens de todas
as voltas são somados — custo que conta só a última chamada é ficção.

### Segurança que não depende do prompt
1. **`tenantId` e `contatoId` vêm do servidor**, nunca dos argumentos. Nenhuma
   ferramenta tem parâmetro de contato — há teste conferindo isso nos
   `properties` de todas elas. Um modelo que alucina um id não alcança a agenda
   de ninguém.
2. **Cancelar e alterar exigem `confirmado: true`.** Com `false`, devolve o que
   aconteceria e não escreve. Campo ausente vale como não confirmado. Está na
   assinatura da função, não no prompt: prompt pode ser desobedecido.
3. **`semPersistir` opera em modo seco.** `npm run avaliar` e `/testes` rodam
   com essa flag; sem isso, avaliar criaria agendamentos de verdade. Duas
   camadas: o executor tem o modo seco testado, e o motor nem oferece
   ferramenta quando não há conversa.

### A data de hoje vai no prompt
Sem ela o modelo não transforma "próxima segunda" em data — chuta, e marca no
dia errado com toda a confiança.

### Medido contra a API real

Conversa completa, sem nenhuma intervenção:

> — bom dia! queria marcar uma consulta
> — *"Bom dia! Hoje não tenho horário livre. Me diga outro dia que eu verifico."*
> — pode ser na proxima segunda de manha
> — *"Na próxima segunda (05/10) de manhã tenho 08:00, 09:00, 10:00 e 11:00.
>    Me manda seu nome completo e o horário que prefere."*
> — as 9 ta bom. meu nome e Maria Silva Santos, telefone 67 99912-3344
> — *"Perfeito, Maria Silva Santos! Sua consulta ficou marcada para 05/10 às 09:00."*

Conferido no banco: `2026-10-05 09:00 | Maria Silva Santos | tel:67 99912-3344`.
Depois, `"na verdade preciso cancelar"` → o bot **pediu confirmação e não
cancelou**; só com o `"isso, pode cancelar"` o status virou `cancelled`.

### O custo subiu, e é preciso saber quanto

| | antes | depois |
|---|---|---|
| pergunta simples | US$ 0,00046 | **US$ 0,00107** |
| tokens de entrada | ~500 | ~1.200 |
| conversa de agendamento | não existia | ~US$ 0,0027 por mensagem |

As definições das ferramentas mais as regras de agenda somam ~700 tokens em
**toda** mensagem, inclusive nas que não têm nada com agenda — e a maioria não
tem. Um agendamento custa mais ainda, porque cada volta de ferramenta é uma
chamada inteira.

Ficou ligado em todas (`config.agenda.ferramentasSempre`). Um filtro por
palavra-chave economizaria isso, mas erraria justamente nos pedidos tortos — e
pedido torto derrubando o bot já foi a causa dos três bugs desta fase. Em
números absolutos: mil mensagens por mês saem de US$ 0,46 para US$ 1,07.

### Lacuna conhecida
A suíte de avaliação **não cobre agenda**: como o motor não oferece ferramenta
sem conversa, uma pergunta de agendamento no `avaliacao.json` mediria o bot sem
as ferramentas. Testar fluxo de agenda é, por ora, conversar na página.

---

## O lembrete do dia da consulta (2026-09-29)

Fase 3 de 3 da agenda, e a menor: a infraestrutura já existia desde a
migration `003`. O comando `npm run lembretes -- <slug>` enfileira o lembrete de
cada consulta do dia e lista a fila; `--enviar` marca como enviado.

### Nada aqui envia nada

O núcleo só escreve na tabela `outbox`. Nesta fase quem drena é o comando, que é
o **dublê do canal** — e é isso que faz o WhatsApp entrar depois sem mexer no
núcleo: o adaptador da Cloud API vai drenar a mesma tabela.

### Idempotência é do banco, não do código

Rodar o comando cinco vezes no mesmo dia gera um lembrete, e quem garante é o
índice único `(appointment_id, kind)`. O `INSERT` usa
`ON CONFLICT (appointment_id, kind) DO NOTHING` — conflito **alvejado**, e não um
`INSERT OR IGNORE`: o IGNORE engoliria também um `NOT NULL` violado, e a falha
apareceria como "nenhum lembrete gerado hoje", sem dizer por quê.

Conferido rodando de verdade: primeira passada `gerados: 1`, segunda
`gerados: 0 / já existiam: 1`.

### Três casos em que o lembrete NÃO sai

1. **Consulta cancelada.** Já estava resolvido na fase 1 — cancelar apaga o
   lembrete pendente na mesma transação. Lembrete de consulta cancelada é pior
   que lembrete nenhum: o cliente aparece na clínica.
2. **Consulta que já começou.** Rodar o comando às 10:30 não manda lembrete da
   consulta das 09:00 — ou a pessoa já está lá, ou já faltou, e a mensagem só
   confunde.
3. **Consulta de outro dia.** O comando é por dia, e `--data` escolhe qual.

### O bug que esta fase revelou: remarcar deixava o lembrete velho

`alterarAgendamento` mudava o horário e **não** tocava no outbox. O corpo do
lembrete tem o horário escrito dentro dele, e o índice único impediria gerar um
segundo — então remarcar de 09:00 para 15:00 mandaria o cliente para as 09:00 no
dia da consulta. Passou a apagar o lembrete pendente na mesma transação, como o
cancelamento já fazia, e a geração seguinte o refaz com o horário novo.

Conferido rodando de verdade: remarcado para 15:00, a fila voltou a ter uma linha
e o texto dizia 15:00.

### A armadilha de fuso que ficou documentada em código

`starts_at` e `scheduled_for` são hora de **parede local**; `sent_at` e
`created_at` saem em **UTC**, porque vêm do `datetime('now')` do SQLite. Na
verificação real isso apareceu à vista: consulta remarcada para 15:00 do dia 30 e
`sent_at` gravado como `2026-09-30 00:22` — 21:22 aqui.

Não é bug hoje, porque nada compara os dois. Mas um `WHERE scheduled_for <=
datetime('now')` escrito de boa-fé pelo futuro adaptador mandaria o lembrete
quatro horas adiantado em Campo Grande. Por isso a consulta de drenagem já existe
no núcleo, `lembretesAEnviar(db, tenantId, agora)`, com o relógio injetado e o
motivo escrito em cima — para ninguém precisar inventá-la depois.

### O painel mostra a fila

Porque nesta fase nada sai sozinho: se a fila tem linha de um dia que já passou,
o comando não rodou. Sem isso, o lembrete não sair passaria em silêncio.

---

## A regressão paga, finalmente rodada (2026-09-29)

`npm run avaliar -- clinica-sorriso --repeticoes 5`, contra os 100%/100% da
Etapa 4. Nada tinha sido medido contra a suíte inteira desde que o prompt mudou.

**Primeira rodada: 93,6% de acurácia, 96,4% de estabilidade.** Duas perguntas
falhando, e só uma era culpa do bot.

### O `semPersistir` passou o teste de fogo
140 chamadas à API com as ferramentas de agenda oferecidas em todas, e **zero
linha** escrita em `appointments` e `outbox`. Conferido antes e depois. Era a
dúvida mais séria da lista: sem isso, avaliar criaria consulta de verdade.

### Regressão real: o bot empurrava o preço do vizinho
`"o clareamento a laser sai por quanto?"` — a clínica não faz a laser. Em **4 das
5 rodadas** o bot respondeu *"O clareamento em consultório, em três sessões,
custa R$ 1.100,00."*

Ele não inventou número nenhum: score 0,653, contexto firme e cheio de
clareamento. Ele concluiu que a pergunta estava respondida porque o **assunto**
estava. Essa pergunta passava em 13 de 17 execuções históricas, e o que a virou
foi a divisão da regra 2 desta mesma sessão: o `"NÃO chame ninguém da equipe"` da
nova regra 2 vem **antes** da regra que manda escalar, e pesou para o lado de ser
útil.

Corrigido na regra 4, onde o caso pertence — *item parecido não é resposta* —, sem
renumerar as outras. Voltou a 5/5, conferido rodando só essa pergunta 5 vezes por
US$ 0,005 em vez de pagar a suíte inteira para descobrir.

### O outro caso era o teste, não o bot
`"vocês vendem pizza?"` esperava handoff, e o comentário da pergunta dizia por
quê: *"deve ser barrado pelo limiar, sem chamar o LLM"*. Esse mecanismo saiu por
decisão de produto. Chamar um colaborador para dizer que uma clínica
odontológica não vende pizza é o desperdício que a Fase A atacou, e o bot
responde *"Não vendemos pizza. Posso te ajudar com algo da clínica?"*.

A expectativa mudou, não o código — e a pergunta continua cobrando algo real:
negar **sem inventar preço e sem acionar ninguém** (`esperaHandoff: false` mais
`naoPodeConter`). O `comentario` registra a troca, para ninguém achar depois que
o teste foi afrouxado só para passar.

Sobrou uma assimetria não resolvida: `"qual a previsão do tempo amanhã?"`
continua virando handoff, e passando. O bot sabe negar o que não vende e não sabe
negar o que não é.

**Segunda rodada, depois das duas mudanças: 100% de acurácia e 100% de
estabilidade, 28/28 em todas as 5 rodadas.** Custo das duas medições somadas:
US$ 0,146.

---

## Auditoria de conversa: o que a suíte não vê (2026-09-29)

A suíte paga mede **pergunta isolada**, e os defeitos que mais incomodam quem
conversa só existem ao longo de uma conversa. Ela deu 100% no mesmo dia em que a
conversa real da página pedia o nome e a data várias vezes.

`npm run conversas -- <slug>` lista as conversas com o aproveitamento de cada
uma; `--id N` mostra o transcrito com os achados no turno em que aconteceram, e
`--md` exporta. O mesmo relatório abre no `/painel`, clicando numa conversa —
aproveitando a rota `/api/conversa`, que existia e nenhuma página usava.

### É um lint, e está escrito que é

A detecção é por padrão de texto, então erra. Cada achado carrega a fala que o
gerou, para uma pessoa julgar. Um falso positivo custa uma linha para descartar;
esconder defeito custa cliente.

O **aproveitamento** é contagem, não nota: turnos sem problema grave sobre
turnos do bot. Nota composta com pesos escolhidos a dedo pareceria precisa e não
seria — a mesma razão pela qual o custo reportado soma todas as chamadas.

### As regras

| achado | quando | peso |
|---|---|---|
| `pedido_repetido` | pediu um dado que a conversa JÁ tinha | grave |
| `pedido_insistente` | pediu de novo, mas o cliente não tinha respondido | aviso |
| `afirmou_com_contexto_fraco` | afirmou número com todo score abaixo do limiar | grave |
| `sem_fonte` | respondeu sem citar fonte, e a mensagem não era social | grave |
| `handoff` | desistiu | grave |

"A conversa já tinha" inclui o que o **bot** disse: no caso medido ele ofereceu
"próxima sexta (02/10)" e depois pediu "a data exata" três vezes.

### Metade do código existe contra o falso positivo

E cada trava saiu de um caso real, não de imaginação:

- **Frase de reconhecimento não é pedido.** "Recebi seu telefone, obrigado. Me
  confirma a data" pede a DATA. Sem separar, viraria "pediu o telefone de novo".
- **O emoji separa frase.** Achado rodando contra o banco: o bot escreveu "Já
  recebi, sim 😊 Me confirma seu nome completo", sem ponto no meio. Como frase
  única, o "recebi" fazia tudo passar por reconhecimento e o defeito escapava —
  o aproveitamento da conversa 22 subia de 64% para 71% escondendo um erro.
- **Comentar não é pedir.** "já posso agendar com seu nome e telefone" não pede
  nada.
- **Frase curta não é nome.** "ta certo", "ja te mandei" e "nao tenho convenio"
  têm a forma de nome: só letras, duas palavras.
- **Hora não é telefone.** "as 9" tem dígito; telefone exige oito.
- **A resposta do botão de retomada não é resposta a pergunta.** Achado contra o
  banco real: sem a exceção, toda volta de handoff levava um `sem_fonte`
  inventado.

### O que ele achou na conversa real

Aproveitamento **64%**, 5 problemas graves: pediu a data três vezes tendo-a dito,
pediu o nome depois de recebê-lo, e afirmou formas de pagamento (R$ 100,00, 6x)
com o melhor score em 0,281. Os três primeiros são a mesma raiz — o modelo tem o
histórico e nada o obriga a consultá-lo antes de pedir de novo.

### Privacidade não é detalhe

`logs/conversas/` entrou no `.gitignore`. O resto de `logs/` é versionado de
propósito porque avaliação é pergunta sintética; transcrito de conversa tem nome
e telefone, e com cliente real virar commit é problema de LGPD. A rota
`/api/conversa` também passou a filtrar por tenant e devolver 404 — sem isso,
trocar o número na URL lia o atendimento de outra clínica.

---

## Marcar também precisa de contrato (2026-09-30)

Uma conversa real marcou uma consulta **sem telefone e sem confirmar**. O bot não
desobedeceu nada: `criar_agendamento` pedia `['inicio', 'nome']` e não tinha
`confirmado`, e a regra A2 dizia "telefone e convênio, se a pessoa tiver". Ele fez
exatamente o combinado. **O combinado é que estava errado.**

A clínica ficou com uma consulta marcada e nenhum jeito de avisar a pessoa se
precisasse desmarcar.

### O que mudou

`criar_agendamento` agora exige `telefone` e `confirmado`, como alterar e
cancelar já exigiam. Confirmado ausente vale como `false`: o silêncio erra para
o lado seguro.

**`required` no schema não basta.** Campo obrigatório de texto aceita "não
informado" — treze caracteres e nenhum telefone dentro —, e o modelo preencheria
para poder chamar. Quem barra é uma checagem que conta DÍGITO: de 10 a 15, o que
aceita "+55 (67) 99935-9933" e recusa "a combinar".

A regra A2 do prompt foi junto, mas ela é a parte fraca: prompt pede, assinatura
obriga.

### A avaliação paga NÃO precisou ser refeita

As regras de agenda só entram no prompt quando há ferramenta, e `npm run avaliar`
roda sem conversa — logo sem ferramenta. Há teste afirmando isso. O prompt que a
suíte mede não mudou.

---

## A auditoria também erra, e a conversa real mostrou onde (2026-09-30)

Dois falsos positivos apareceram na primeira conversa depois que a auditoria
ficou pronta. Ambos foram corrigidos com teste.

### `"boa boa"` virou o nome do cliente

Duas palavras, só letras: forma de nome. Foi contado como o nome na primeira
mensagem da conversa, e os dois pedidos seguintes viraram "pediu o nome, que a
conversa já tinha" — acusação inventada.

**Nome não tem formato que o separe de uma frase curta qualquer. O que separa é
vir DEPOIS de alguém perguntar.** Agora só conta como nome o que chega depois de
o bot pedir. Telefone, data e hora continuam valendo a qualquer momento, porque
têm formato próprio e o cliente pode dizer "quero dia 8 às 9" sem ninguém pedir.

### O score da busca não se aplica a resposta de ferramenta

"Na próxima quinta (08/10) tenho horários às 08:00..." saiu da agenda, com
autoridade total, e o melhor chunk recuperado marcava 0.391. O relatório acusou
`afirmou_com_contexto_fraco` três vezes, e nas três o dado estava certo.

A auditoria não tinha como saber de onde veio a resposta. Migration `005`:
`messages.used_tool`. O motor já sabia — `conversarComFerramentas` conta as
voltas — e só não estava contando a ninguém.

**Mensagem gravada antes da migration continua sem a informação**, e por isso a
conversa 23 ainda mostra os três achados. Não dá para saber retroativamente, e
inventar o valor seria pior que o falso positivo.

---

## Mensagens seguidas viram um turno só (2026-09-30)

Ninguém escreve um parágrafo no WhatsApp. Escreve "quero marcar", depois "pra
sexta", depois "as 9" — e o bot respondia três vezes a um pedido só. Foi o que
aconteceu nas conversas 22 e 23.

Agora o servidor espera 2,5s de silêncio antes de responder, e o contador
**reinicia a cada mensagem nova**.

### Por que NÃO foi pelo sinal de digitação

A pergunta certa veio antes do código: dá para esperar o cliente parar de
digitar? Pesquisado na documentação da Meta: **não**.

- O indicador de digitação da Cloud API é **mão única** — do negócio para o
  cliente. Some quando você responde ou em 25s.
- A lista de webhooks (`messages`, `statuses`, `account_update`, …) não tem
  evento de presença. `statuses` engana pelo nome: fala só das mensagens de
  SAÍDA (sent/delivered/read).
- Quem tem o sinal são as bibliotecas não-oficiais (Baileys e afins), via
  `presence.update` com `composing`. Elas violam os Termos e arriscam banir o
  número — inaceitável para o número de uma clínica.

Sobra o único sinal que existe: **mensagem chegando**. Está registrado aqui
porque é a pergunta que qualquer um vai refazer, e a resposta custou pesquisa.

### O que segura o recurso

`src/core/conversation/agrupador.ts`, no core e não no adaptador: como várias
mensagens viram um turno é decisão de negócio, e o adaptador de WhatsApp vai
usar este mesmo código. Lá ele não poderá segurar a requisição — webhook
precisa devolver 200 na hora —, então chamará `receber` sem await e mandará a
resposta depois.

Três detalhes que não são óbvios:

1. **A requisição absorvida responde na hora**, com `{ agrupada: true }`, em vez
   de esperar o turno fechar. Do outro lado há uma conexão HTTP aberta.
2. **Teto de espera** (`esperaMaximaMs`, 12s). Sem ele, quem digita sem parar
   empurraria o prazo para frente e nunca receberia resposta.
3. **A chave do lote inclui o tenant.** Dois clientes podem ter o mesmo id de
   contato, e sem isso conversariam na mesma caixa.

### O primeiro estado em memória do servidor

Até aqui o servidor era stateless: nenhum `setTimeout`, nenhum `Map` de módulo,
todo estado no SQLite. Este é o primeiro — e por isso o encerramento
(`SIGINT`/`SIGTERM` em `server.ts`) passou a chamar `agrupador.encerrar()`.
Timer pendente segura o processo vivo.

`encerrar()` resolve com `undefined`, não com o texto: o processo está caindo, e
mandar responder faria o motor escrever num banco que está fechando.

### A página precisou mudar antes de tudo

`chat.html` **desabilitava o input** enquanto esperava a resposta. Com isso o
cliente não conseguia mandar a segunda mensagem, e o agrupamento nunca teria o
que agrupar. Era o bloqueio real do recurso, e só apareceu ao mapear o caminho
da mensagem antes de codar.

Junto: um indicador "digitando…" para a conversa, não um por envio — três envios
empilhavam três na tela para uma resposta só.

### Medido com a API real

As mesmas três mensagens, agrupadas e separadas, contra a clínica de exemplo:

| | chamadas | custo |
|---|---|---|
| agrupado | 1 | US$ 0,002620 |
| separado | 3 | US$ 0,004985 |

**47% mais barato, e não os ~67% que eu previ.** A previsão errou porque supôs
custo uniforme por mensagem: a mensagem que aciona a ferramenta de agenda custa
~2,5x uma simples (2.900 tokens de entrada contra 1.360), então juntar três não
divide por três.

### O ganho de verdade não foi o custo, foi a resposta

Separado, na terceira mensagem:

> — as 9 da manha
> — *"Perfeito — para agendar às 9h, me envie seu nome completo e telefone."*

**As 09:00 daquela sexta estavam ocupadas** — o próprio bot tinha acabado de
listar os livres, sem as 09:00, na resposta anterior. Ele confirmou um horário
que não existe.

Agrupado, com o mesmo pedido:

> *"Pra sexta 02/10 às 09:00 não tenho horário livre. Tenho 08:00, 10:00, ... Se
> quiser, me diga qual horário prefere e seu nome completo com telefone."*

Recebendo o pedido inteiro de uma vez, o bot consultou a agenda com a data E a
hora e pegou o conflito. Fragmentado, ele perdeu o fio entre um turno e outro.
Era isto que a fragmentação custava, e o custo em dólar é o detalhe.

### A auditoria inverteu o veredito, e isso era bug dela

O relatório deu **0% para a conversa boa** e **100% para a ruim**.

O 0% veio de `pedido_repetido: pediu o horário, que a conversa já tinha`. A
conversa tinha mesmo — e o bot pediu de novo porque **recusou** aquele horário.
Pedir de novo o que foi recusado é o certo, não esquecimento. Corrigido: a
resposta que contém uma recusa não gera esse achado.

O 100% da conversa ruim é a outra metade, e **continua em aberto**: nenhuma
regra pega "confirmou um horário que não está livre". Pegaria exigindo que a
auditoria consultasse a agenda na data citada — é outro tipo de checagem, e está
anotado como pendência.

### Ordenação, uma limitação conhecida

O lote sai na ordem em que as mensagens **chegaram**. Isso apareceu como teste
oscilante: três requisições HTTP disparadas no mesmo instante chegam em ordem
arbitrária, e o turno saía embaralhado. Digitação humana não produz isso, e o
teste passou a espaçar como gente digita.

Mas **webhook do WhatsApp pode chegar fora de ordem**. Quando o adaptador
entrar, ele precisa ordenar pelo `timestamp` da mensagem antes de juntar — e
`"quero cancelar / não, deixa"` não é a mesma coisa que `"não, deixa / quero
cancelar"`.

### O que NÃO mudou

`Motor` não foi tocado. O CLI é sequencial (`for await` por linha) e não
participa. A suíte de avaliação chama `motor.responder()` direto, com
`semPersistir` — o agrupador não entra no caminho e **nenhum prompt mudou**,
então a medição paga continua valendo.

---

## Avisar o dono sem calar o bot (2026-10-01)

A Polpa Santa Helena pediu três coisas que o motor não sabia fazer, e as três
caem no mesmo buraco: **o bot precisa chamar uma pessoa e continuar
conversando.**

- Cliente pede desconto → a dona precisa saber, e a venda segue.
- Horário da entrega → quem entrega é ela, então só ela confirma.
- Perguntaram de um lugar que não está documentado → sinalizar a dúvida.

Até aqui só existia o handoff, e ele significa duas coisas grudadas: *o bot não
soube* e *o bot para de responder*. Se o bot calasse depois de dizer "vou
confirmar o horário", o cliente que ainda não deu o endereço ficaria sem como
terminar o pedido. A venda morreria exatamente no fim.

### Alerta é tarefa; handoff é desistência

Migration `006`, tabela `alerts`, separada de `handoffs` porque são conceitos
diferentes:

| | handoff | alerta |
|---|---|---|
| o bot | fica mudo | continua conversando |
| significa | não soube | alguém precisa decidir |
| taxa de resolução | conta contra | não conta |

A métrica é a parte que não é óbvia. Confirmar horário acontece em **toda**
venda de quem entrega pessoalmente; se contasse contra, a taxa da Santa Helena
ficaria em zero para sempre e deixaria de medir qualquer coisa. Handoff de
verdade continua contando.

Índice único parcial `(conversation_id, kind) WHERE resolved_at IS NULL`: quem
escreve "desconto" três vezes gera UM aviso. Parcial porque, depois de
resolvido, o assunto pode voltar numa venda nova.

### Duas redes, porque elas erram de formas opostas

**A ferramenta** `avisar_responsavel` o modelo chama quando percebe o caso —
pega o pedido torto que nenhuma lista prevê. **A palavra-chave** do
`tenant.json` dispara sozinha, antes de qualquer chamada paga, e nunca esquece.

A primeira conversa real provou que as duas são necessárias: `"faz um
descontinho se eu levar 12kg?"` **não** fez o modelo chamar a ferramenta. Quem
pegou foi a palavra-chave.

E a lista precisa de **radicais, não palavras inteiras**: `"descontinho"` não
contém `"desconto"`, contém `"descont"`. Configurar com a palavra completa
deixaria passar justamente o diminutivo, que é como se pede abatimento no
WhatsApp.

### A ferramenta de aviso vale para todo cliente

Diferente da agenda, que é opt-in. Chamar quem é dono do negócio não é recurso
de clínica — é o mínimo de um bot que atende em nome de outra pessoa. E é
barata: uma definição contra as cinco da agenda.

Isso obrigou a generalizar o laço de ferramentas do motor, que só conhecia a
agenda: agora ele recebe a lista a oferecer e um despachante.

### Medido na conversa real

> — vocês entregam em sidrolândia?
> — *"Em Sidrolândia eu vou confirmar com a responsável, tá?"*
> — e em terenos?
> — *"Em Terenos entregamos sim. Qual horário fica melhor pra você? Vou
> confirmar com a responsável."*
> — faz um descontinho se eu levar 12kg de açaí?
> — *"Vou confirmar com a responsável. A partir de 10 kg tem condição especial,
> mas o valor é combinado caso a caso."*

Os três avisos chegaram ao painel com a mensagem do cliente citada — é ela que
permite julgar falso positivo sem abrir a conversa.

**Custo subiu**: de ~US$ 0,001 para ~US$ 0,0035 por mensagem, porque a
ferramenta entra no prompt e cada aviso é uma volta a mais no laço. Para quem
estava perdendo venda por não saber de pedido de desconto, paga-se.

### A avaliação não mede isto

Ferramenta só é oferecida quando há conversa, e `npm run avaliar` roda sem uma.
O prompt que a suíte mede continua idêntico — nenhuma medição anterior foi
invalidada —, mas também quer dizer que o comportamento de aviso só se testa
conversando.
---

## O bot monta o pedido (2026-10-02)

Uma conversa real da Polpa Santa Helena — a 33 — tirou **100% de aproveitamento**
contendo o pior defeito desta fase. O dono do negócio reclamou de cinco coisas; a
auditoria não via nenhuma delas.

> **CLIENTE** qual o valor de tudo?
> **BOT** Vou confirmar o total certinho com a responsável, tá? / Se quiser, me
> manda de novo os itens e quantidades do pedido pra eu conferir tudo.

E ainda gerou um aviso (`kind: 'outro'`): **o bot escalou uma soma para a dona do
negócio.**

### A causa raiz não era preguiça: era a memória funcionando como especificada

`summary_until_message_id` era 191, então a janela íntegra tinha 4 mensagens e o
resto era este resumo gravado:

```
- Cliente quer encomendar para amanhã: 2 pacotes de pão de queijo, 1 kg de
  polpa de acerola e 1 kg de polpa de maracujá.
- Assunto de valores dos itens já foi respondido.    ← os preços, apagados
```

A regra 3 do `montarPromptDeResumo` manda exatamente isso: *"NÃO copie preço que
o BOT informou. Escreva que o assunto foi respondido, sem o número."* Ela está
**certa** para a clínica — preço no resumo vira fonte de verdade paralela e
desatualizada. Ela é **destrutiva** para um pedido em montagem, que é a única
coisa que precisa carregar número ao longo da conversa.

A exceção foi aberta nos **dois** lugares: no prompt do resumo e no cabeçalho que
o injeta. Só num deles, o pedido chegaria com os números e o modelo os
descartaria.

### A contradição que ninguém tinha notado

A regra 8 global dizia *"não tente vender nem processar pagamento"* — escrita
quando vender estava fora de escopo — enquanto o `promptDoSistema` da Polpa
mandava *"junte o pedido"* e *"some o pedido e informe o total"*. As duas no
mesmo prompt, e a regra 8 dentro do bloco `REGRAS OBRIGATÓRIAS`.

Vender virou recurso, igual a agendar. Hoje é opt-in por `config.vende`.

### A Camada 1 consertou sete defeitos e revelou o oitavo

Medido refazendo a conversa 33 palavra por palavra (conversa 34):

| | antes | depois |
|---|---|---|
| saudação | "Boa noite! Me fala o que você precisa por aqui" | "Boa noite! Tudo bem? Em que posso ajudar?" |
| 2ª mensagem | pediu nome, endereço, horário e pagamento | "quais sabores e quantos kg?" |
| pão de queijo | "vem com 10 pacotes de 100 g" (errado) | "2 pacotes = 2 kg, R$ 50,00" |
| embalagem | dita 2 turnos seguidos | dita uma vez |
| taxa | recitou a política | "no seu pedido fica sem taxa" |
| total | escalou para a dona | informou |

E então o defeito de verdade apareceu: **o carrinho substituía em vez de somar.**
Turno 4 *"até agora 2 kg de pão de queijo"*; turno 5 *"até agora 1 kg de
acerola"* — o pão de queijo sumiu. No fim listou três itens e informou
**R$ 60,00**, quando a soma era **R$ 110,00**.

A aritmética dele está certa em cada conta isolada que conferimos. O que ele não
consegue é manter uma lista. **Isso não se conserta com regra de prompt.**

### Parte 2: carrinho é estado, e estado mora em tabela

Mesma forma da agenda, que já tinha provado o desenho: tabela, ferramentas, e o
que importa no **contrato** em vez do prompt. `orders` + `order_items`, cinco
ferramentas, opt-in por `config.vende` mais um `produtos.json` na pasta do tenant.

A venda completa (conversa 36, 13 turnos) fechou de ponta a ponta: R$ 50 → R$ 75
→ **R$ 110,00**, nome, endereço, horário e Pix anotados, pedido confirmado no
banco.

Dois momentos valem destacar, porque são a não-invenção virando contrato:

> — **quero 1 kg de manga também**
> — *Não temos manga, viu. Se quiser, temos polpa de goiaba, maracujá, morango…*
>
> — **então 1 kg de açaí**
> — *Só confirma pra mim: você quer a polpa de açaí, R$ 35,00 o kg, ou o açaí
> pronto no balde de 2 litros, R$ 43,00?*

Açaí é o único termo do catálogo em que adivinhar **muda o preço**, e o próprio
documento avisa "não confundir". A ferramenta devolve as opções e o bot pergunta:
é a regra 4 do prompt ("item PARECIDO não é resposta") deixando de depender de
obediência.

O que o contrato garante e o prompt não garantia:

- pedido vazio não fecha, **mesmo** com os quatro dados preenchidos
- `confirmado: false` não grava, só devolve o que aconteceria
- o horário gravado se chama **`preferred_time`**, nunca `delivery_time` — quem
  confirma é a responsável, e o nome da coluna é que garante isso
- preço em **centavos** e **copiado** para o item; a taxa **congela** no
  fechamento (migration 008), pelo mesmo argumento: o pedido é registro histórico
- **um rascunho por conversa**, por índice único parcial, como a vaga da agenda

### Um laço que o prompt criou

O cliente disse *"pode ser amanhã de manhã"*, o bot **não anotou**, e respondeu
*"pra fechar só falta me dizer o horário"* — duas vezes. O `promptDoSistema`
dizia *"NUNCA confirme o horário da entrega"*, e o modelo leu isso como **"não
registre o horário"**.

Anotar o horário pedido e confirmar o horário são coisas diferentes. Agora está
escrito que são, nas duas pontas (P6 e P7 de `regrasDoPedido`).

### A auditoria precisou de conserto duas vezes

Primeiro para **ver** os defeitos: a lista `DADOS` era vocabulário de clínica e
não tinha `endereco` nem `pagamento`. Com eles, a conversa 32 expôs **cinco**
pedidos repetidos que eram invisíveis.

Depois para **não punir o conserto**: ela acusava o recapitulativo *"Até agora
são…"* como `repetiu_informacao`. Resposta que veio de ferramenta deixou de
contar — mesmo raciocínio que já valia para `afirmou_com_contexto_fraco`. O caso
real sobrevive, porque o *"10 pacotes de 100 g"* saiu dos documentos, com
`used_tool = 0`.

`repetiu_informacao` levou **quatro guardas**, todas nascidas de falso positivo
medido contra o banco real. A mais importante é a do recapitulativo: sem ela a
régua marcaria como defeito justamente o comportamento que esta frente existe
para criar.

### A régua ainda é cega para uma coisa

A conversa 34, com o total **errado**, tirou 100%. É a mesma cegueira já
registrada para "horário impossível": a auditoria lê texto e não cruza com dado.
Agora que existe `produtos.json`, dá para comparar o total que o bot escreveu
contra a soma do carrinho — e aí o preço errado deixa de passar.

### O custo

| | por mensagem |
|---|---|
| antes dos avisos | ~US$ 0,0010 |
| com avisos | ~US$ 0,0022 |
| com pedido | **~US$ 0,0057** |

Seis definições de ferramenta no prompt de toda mensagem. Em mil mensagens, de
US$ 1,00 para US$ 5,70. Para quem estava dizendo preço errado e perdendo venda
por não saber de pedido de desconto, parece pagar — mas é conta do dono.

### A clínica não regrediu, e isso foi medido

As mudanças de prompt desta frente são **globais** em três pontos: a regra 7, as
regras do resumo e o prompt social. A regressão paga foi refeita depois delas:
**100% de acurácia e 100% de estabilidade**, 28/28 nas 5 rodadas, zero
oscilação, por US$ 0,0739.

A saudação era o risco óbvio, e não era risco: as quatro perguntas sociais do
`avaliacao.json` da clínica usam só `naoPodeConter` — proíbem handoff e preço, e
não cobram redação. `social-com-pergunta-junto` ("boa tarde, vocês abrem no
sábado?") continua garantindo que saudação grudada em pergunta responde a
pergunta.

---

## Calibrado com conversas reais de WhatsApp (2026-10-04)

O dono mandou analisar 35 prints de conversas reais da Polpa com oito clientes —
varejo de primeira compra, varejo recorrente, orçamento por indicação, prospect
e dois clientes B2B. A instrução que governou o trabalho foi dele: **"quero que
ele atenda todas as pessoas, não algo específico para essas conversas, elas
estão sendo usadas como modo de calibrar melhor"**.

### O achado que vale mais que todo o resto: pacote não é quilo

Numa conversa real, o cliente pediu *"05 polpas de acerola, 05 de maracujá"*
querendo cinco pacotes de 100 g de cada. Quem pegou foi a dona: *"no caso nós
vendemos apenas o kg fechado, seria 5kg de cada?"*. O cliente respondeu *"não, 5
KG é muito"* e refez o pedido.

Somado como quilo, isso é **R$ 300,00 em vez de uns R$ 30,00** — e nem é
vendável, porque só sai quilo fechado. Posto na suíte paga, o bot cometia o erro:

> **quero 5 polpas de acerola e 5 de maracuja**
> *5 kg de acerola e 5 kg de maracujá, R$ 300,00 no total*

**Três redes, porque uma não bastou.** A ordem em que elas foram descobertas é o
ponto:

1. **Documento** (`catalogo.md`, seção "Pacote e quilo são coisas diferentes").
   Não segurou: o bot respondeu R$ 300,00 mesmo com a seção indexada.
2. **Contrato** — `adicionar_ao_pedido` recusa quando o cliente conta em pacotes
   um produto vendido por quilo. Cobre o caminho do pedido, e **não cobre** quem
   só pergunta o preço: ali o modelo responde sem ferramenta nenhuma.
3. **Rede determinística no prompt** — `avisoDeUnidade` roda sobre o texto do
   cliente, antes de qualquer chamada paga, e injeta o aviso. É a mesma forma da
   rede de palavra-chave dos alertas, que nasceu do mesmo problema: o modelo
   esquece de chamar a ferramenta.

A medição de estabilidade é que mostrou a necessidade da terceira. Com uma
rodada só, 33/35 e parecia resolvido. Em cinco rodadas:

```
Estabilidade:  91.4%     OSCILARAM: 3
```

`unidade-pacote-virou-quilo` passava em 4 de 5 execuções. **Regra de prompt é
probabilística**, e aqui o preço do 1-em-5 é dizer R$ 300,00 a um cliente. Com a
rede determinística: **estabilidade 100%, zero oscilação**.

### Regra condicional não mora em documento

O desconto de R$ 10,00 da primeira compra só vale para quem recebeu o cartão
impresso, e o bot nunca pode oferecer por conta própria. Documentado, vazou de um
jeito sutil:

> **é a primeira vez que eu compro com vocês**
> *O desconto de R$ 10,00 é só pra quem recebeu o cartão impresso. Você recebeu
> esse cartão?*

Ele não ofereceu — mas **ensinou quem não tem a dizer que tem**. A causa é a
busca: o trecho chegava com similaridade 0,672 em "primeira compra" e pedia para
ser usado.

A regra saiu dos documentos e foi para o `promptDoSistema`, onde está sempre
presente e vem junto da proibição. Princípio que ficou: **fato incondicional nos
documentos, regra condicional no prompt** — trecho condicional recuperado por
similaridade é trecho que vaza.

### Isso expôs um falso positivo na checagem de número inventado

Com o fato fora dos documentos, a resposta CERTA passou a falhar: a checagem
compara todo valor em reais contra os **chunks recuperados**, e "R$ 10,00" não
estava em nenhum. Ela acusou invenção de um número que o dono do negócio
escreveu.

O `promptDoSistema` do tenant passou a contar como texto autorizado. Número que
o cliente configurou não é invenção do modelo — e o comentário da própria regra
já dizia que falso positivo em regra de segurança ensina a ignorar o aviso.

### O que eu NÃO fiz do plano, e por quê

O plano pedia um bloco de vocabulário fechado tirado dos prints — "Maravilha",
"Opa maravilha", "Prontinho", "ook" — mais exemplos few-shot das conversas.

Isso foi recusado por duas razões. A primeira é a instrução do dono: oito
conversas são calibração, não alvo, e clonar o idioleto de uma pessoa não é o
mesmo que atender bem todo mundo. A segunda é medida: dois dias antes, o bot
abriu três mensagens seguidas com *"Perfeito, Pedro."* — **lista fechada de
aberturas piora repetição, não melhora**.

O que entrou no lugar foi o princípio por trás do estilo: uma ideia por mensagem
(já existia), sem markdown, emoji raro e só no fim, variar as aberturas, tratar o
cliente como ele se apresentou, e falar das regras no plural.

### O que era regra de segurança disfarçada de estilo

A parte mais valiosa da observação de estilo não era estilo: era que **o bot não
está em lugar nenhum fisicamente**. Nos prints, quem separa, leva, entrega e
recebe é a dona. Então viraram proibição explícita: *"estou a caminho"*, *"estou
aqui na frente"*, *"vou separar e levo"*, *"te aviso quando sair para entrega"*,
*"volto para receber"*. Mais: não pedir comprovante, não mandar chave Pix, não
tratar de nota fiscal.

Isso generaliza para qualquer cliente que tenha uma pessoa fazendo trabalho
físico, que é o caso de quase todo negócio pequeno.

### Fatos de negócio que faltavam

Cartão só por aproximação (sem maquininha de chip e senha), NF-e para CNPJ, Pix
com a chave e a conferência pela responsável, brinde "por enquanto não temos" com
alerta, e desconto abaixo de 10 kg que o atendimento não concede — avisa.

`TipoDeAlerta` ganhou `brinde`, e não `outro`, porque é pergunta recorrente de
resposta mutável: o dono quer contar quantos perguntam para decidir se volta a
dar. Em `outro` isso ficaria escondido.

### Números

| | antes | depois |
|---|---|---|
| perguntas na suíte | 26 | 35 |
| acurácia | 85,3% | **97,1%** |
| estabilidade (5 rodadas) | 91,4% | **100%** |
| oscilaram | 3 | **0** |

Duas expectativas velhas foram corrigidas, não o código: `desconto-atacado` e
`bairros` esperavam handoff de coisas que os documentos passaram a responder.

Sobra **uma** falha, e ela é antiga: `conserta-geladeira` ainda escala em vez de
negar. É a mesma família do `pizza` da clínica, mora na regra 3 global e mexer
nela obriga a remedir a clínica.

Clínica conferida depois de tudo: **100% (28/28)**, inalterada.

---

## Fora de escopo nesta fase

Confirmado com o usuário, não fazer:
- WhatsApp, Evolution API, Cloud API
- Supabase ou qualquer serviço em nuvem
- Autenticação, painel administrativo completo, área de login
- LangChain — o RAG é explícito de propósito
- O bot **processar pagamento** (anotar a forma escolhida é diferente: isso ele
  faz). **Agendar e vender SAÍRAM daqui**: os dois viraram recurso, cada um com a
  sua seção — "O bot opera a agenda" e "O bot monta o pedido".

---

## Pendências e avisos

- **Branch `conversa-natural`** tem todo o trabalho de 2026-09-25 a 09-29 e está
  à frente de `main`. Para integrar: `git checkout main && git merge conversa-natural`
  (fast-forward). Conferido: `.env` **não** está versionado, e `.gitattributes`
  normaliza as quebras de linha (LF no repositório).
- **O `CLAUDE.md` e a skill `encerrar-sessao` ficam um nível acima**, fora da raiz
  do git, então não são versionados com o projeto.
- **A chave da OpenAI foi colada uma vez no `.env.example`** (arquivo versionado).
  Foi movida para `.env` e o placeholder restaurado **antes** de existir git, e
  o commit inicial não contém a chave. Ainda assim, rotacionar a chave é o
  caminho seguro se quiser zerar o risco.
- Os arquivos em `logs/` **são versionados de propósito**: é o histórico que
  permite calibrar.
