# Progresso do projeto

Arquivo vivo: atualizado ao fim de cada etapa. Serve para você acompanhar e
para uma sessão nova retomar o trabalho sem precisar reconstruir o contexto.

**Última atualização:** 2026-09-25, com a bateria de testes na web.
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
| `npm run novo-tenant -- <slug> "<Nome>"` | cria a pasta de um cliente novo com modelos | zero |
| `npm test` | 308 testes unitários, offline | zero |
| `npm run typecheck` | checagem de tipos | zero |
| `npm run calibrar -- <slug>` | mede scores de busca para ajustar o limiar | ~US$ 0,000005 |
| `npm run avaliar -- <slug>` | 24 perguntas contra a API real, gera logs | ~US$ 0,01 |
| `npm run avaliar -- <slug> --repeticoes 5` | roda 5x e mede estabilidade | ~US$ 0,05 |
| `npm run relatorio` | histórico de todas as avaliações | zero |
| `npm run relatorio -- <id>` | trajetória de uma pergunta | zero |
| `npm run relatorio -- --instaveis` | perguntas que oscilam | zero |
| `npm run web -- <slug>` | conversa em `/`, bateria de testes em `/testes` e painel em `/painel` | por mensagem |

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

**`npm test`** — 308 testes unitários, offline, grátis, ~3s. Rode a cada
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

### O que NÃO foi resolvido
`"ta entao marca dia 16 mesmo"` continua virando handoff. O chunk certo é
enviado (0,376, "Como agendar"), o modelo vê e recusa assim mesmo — porque é um
pedido para **agendar**, e o bot ainda não sabe agendar. Isso é a fase do bot na
agenda, não um bug desta.

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
