# Motor de atendimento por IA — fase local

Núcleo de um bot de atendimento que responde **apenas** com base nos documentos
de cada cliente. Roda 100% local: SQLite em arquivo, sem Docker, sem nuvem.

O canal é um adaptador na borda. `src/core/` não sabe se está falando com o
terminal, com uma página web ou com o WhatsApp — quando a Cloud API entrar, é só
mais um adaptador em `src/adapters/`, e nenhuma linha do núcleo muda.
Tudo é multi-tenant desde o primeiro commit.

## Como rodar

```bash
npm install

cp .env.example .env          # e preencha OPENAI_API_KEY

npm run seed   -- clinica-sorriso   # cria o tenant a partir do tenant.json
npm run ingest -- clinica-sorriso   # documentos -> chunks -> embeddings -> banco
npm run cli    -- clinica-sorriso   # conversa no terminal
npm run web    -- clinica-sorriso   # conversa, bateria de testes e painel no navegador
```

O `npm run web` sobe quatro páginas: `/` (conversa), `/agenda` (a agenda da
recepção: marcar, remarcar e cancelar na mão), `/testes` (bateria de testes:
ver, editar e rodar as perguntas do `avaliacao.json` uma a uma, por grupo ou
todas) e `/painel` (números, handoffs a revisar e lembretes na fila).

Na conversa, **Nova conversa** (ou **Ctrl+Shift+N**) encerra a conversa atual e
começa outra do zero — para ir testando linguagem natural sem abrir aba nova, e
para destravar uma conversa que caiu em handoff e deixou o bot mudo. Encerra sem
apagar: o histórico continua alimentando o painel.

Outros comandos:

```bash
npm test                              # testes unitários (não usa rede nem crédito)
npm run typecheck                     # checagem de tipos
npm run ingest -- <slug> --forcar     # reprocessa tudo, mesmo sem mudanças
npm run calibrar -- <slug>            # mede os scores das perguntas do avaliacao.json e sugere o limiar
npm run avaliar -- <slug>             # suíte de qualidade contra a API real (~US$ 0,01)
npm run avaliar -- <slug> --repeticoes 5  # roda 5x e mede estabilidade (~US$ 0,05)
npm run relatorio                     # histórico de todas as avaliações
npm run relatorio -- <id-da-pergunta> # trajetória de uma pergunta
npm run relatorio -- --instaveis      # perguntas que oscilam entre passar e falhar
npm run conversas -- <slug>           # lista as conversas com o aproveitamento de cada uma
npm run conversas -- <slug> --id 22   # transcrito + relatório de uma conversa
npm run conversas -- <slug> --id 22 --md  # exporta para logs/conversas/
npm run lembretes -- <slug>           # enfileira os lembretes das consultas de hoje e lista a fila
npm run lembretes -- <slug> --data 2026-10-05   # de outro dia
npm run lembretes -- <slug> --enviar  # marca a fila do dia como enviada
```

`npm run conversas` também não gasta crédito: lê só o banco. Ele é o par do
`avaliar` — a suíte mede **pergunta isolada**, e há defeito que só aparece ao
longo de uma conversa: pedir duas vezes o mesmo dado, afirmar preço com contexto
vazio, perder o fio. O mesmo relatório aparece no `/painel`, clicando numa
conversa.

O **aproveitamento** é contagem, não nota: turnos sem problema grave sobre
turnos do bot, com cada achado citando a fala que o gerou. A detecção é por
padrão de texto e **pode errar** — por isso o trecho vem junto, para você
conferir antes de tratar como defeito.

O export de `--md` vai para `logs/conversas/`, que está no `.gitignore`. O resto
de `logs/` é versionado de propósito, mas aquilo é avaliação sintética; isto é
conversa de gente, com nome e telefone.

`npm run lembretes` não gasta crédito: não passa nem por modelo nem por
embedding. Rodar duas vezes no mesmo dia não duplica nada — quem garante é o
índice único `(appointment_id, kind)` do `outbox`, a mesma disciplina do
`ingest`. Nesta fase nada sai sozinho: o comando é o dublê do canal, e o dia em
que a Cloud API entrar ela drena a mesma tabela.

O CLI também aceita entrada redirecionada, o que serve para testar em lote:

```bash
printf 'qual o horário de sábado?\nvocês vendem pizza?\nsair\n' | npm run cli -- clinica-sorriso
```

## `.env` e `.env.example`

São arquivos com papéis opostos, e só um deles faz alguma coisa.

| | `.env` | `.env.example` |
|---|---|---|
| Contém | a chave **real** | um placeholder falso |
| Versionado no git | **não** (está no `.gitignore`) | **sim** |
| Lido pelo programa | **sim**, por `dotenv.config()` | **nunca** |

**`.env.example` não influencia nada em tempo de execução.** Ele é documentação:
existe para quem clona o projeto saber *quais* variáveis precisa definir, sem que
a sua chave vá junto no repositório. É por isso que ele fica versionado e o
`.env` não.

Se você o apagasse agora, o projeto continuaria funcionando igual — só ficaria
mais difícil para outra pessoa (ou para você, numa máquina nova) descobrir o que
configurar.

Variáveis reconhecidas, todas opcionais exceto a primeira:

| Variável | Efeito | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | embeddings e chat. Sem ela, `ingest`, `cli`, `web` e `avaliar` falham | — |
| `LLM_MODEL` | sobrescreve o modelo de chat | `gpt-5.4-mini` |
| `WEB_PORT` | porta do adaptador web | `3000` |

O `.env` vence o que está em `config.ts`. Para testar outro modelo sem mexer no
código, basta uma linha no `.env` — mas **atualize também os preços** em
`config.ts`, senão o custo reportado em cada mensagem vira ficção.

## Como adicionar um cliente real

```bash
npm run novo-tenant -- barbearia-do-ze "Barbearia do Zé"
```

Isso cria `data/tenants/barbearia-do-ze/` com `tenant.json`, `avaliacao.json` e
um `_LEIA-ME.md` explicando o que escrever em cada lugar. O comando **não
sobrescreve** uma pasta existente.

Depois:

1. Jogue os documentos do cliente (`.txt` e `.md`) na pasta.
2. Ajuste `promptDoSistema` e o bloco `agenda` em `tenant.json`.
3. Escreva em `avaliacao.json` as perguntas que os clientes fazem de verdade.
4. Rode:

```bash
npm run seed     -- barbearia-do-ze
npm run ingest   -- barbearia-do-ze
npm run calibrar -- barbearia-do-ze                # escolhe o limiar com dado
npm run avaliar  -- barbearia-do-ze --repeticoes 5 # mede qualidade e estabilidade
```

A ingestão é idempotente: arquivo cujo conteúdo não mudou é pulado, porque
embedding custa dinheiro. Mexeu num documento? Rode `ingest` de novo.

### O bloco `agenda` do `tenant.json`

É o que o bot usa para calcular horário livre. Fica em dado estruturado, e não
nos documentos, porque o `.txt` de horários é texto para o RAG ler em voz alta e
agenda precisa de algo que dê para calcular.

```json
"agenda": {
  "duracaoMin": 60,
  "janelas": {
    "1": [["08:00", "12:00"], ["13:00", "18:00"]],
    "6": [["08:00", "12:00"]]
  },
  "antecedenciaMinimaHoras": 2,
  "diasNoFuturo": 60
}
```

`janelas` é por dia da semana, com **0 = domingo**; dia ausente é dia fechado, e
duas janelas cobrem o almoço. A grade sai de `duracaoMin`, e um horário que não
caberia antes de fechar não é oferecido — consulta de 90min não começa 17:30 num
expediente que fecha 18:00.

**Os dois precisam concordar com o documento.** Se o `.txt` disser que abre
sábado e `janelas` não tiver o `"6"`, o bot informa um horário que ele não
consegue marcar. Quem não configurar nada cai no `AGENDA_PADRAO` (seg-sex,
8-12 e 13-18, 60min).

### Cliente que VENDE: `vende` e `produtos.json`

Para o bot montar pedido e informar total, duas coisas:

```json
"config": { "vende": true, "maximoDeLinhas": 5 }
```

e um **`produtos.json`** na pasta do tenant, que é a fonte de verdade dos preços
para a conta:

```json
{
  "taxaDeEntrega": { "pesoMinimoGratisKg": 2, "taxaCentavos": 500 },
  "produtos": [
    {
      "chave": "polpa-acerola",
      "nome": "polpa de acerola",
      "precoCentavos": 2500,
      "unidade": "kg",
      "pesoKg": 1,
      "termos": ["acerola", "polpa de acerola"]
    }
  ],
  "ambiguos": { "acai": ["polpa-acai", "acai-balde"] }
}
```

`.json` **não é ingerido** (o ingest só olha `.md` e `.txt`), então ele não
polui a busca.

Quatro coisas que valem entender antes de escrever o seu:

- **`precoCentavos`, não reais.** Somar `25.00` em float acumula erro, e um total
  errado por um centavo destrói mais confiança que um total ausente.
- **`termos` é casamento EXATO.** Produto que o modelo pede e não está na lista é
  **recusa**, não aproximação — quem pede manga não pode receber o preço do
  abacaxi. Escreva as formas que o cliente de fato usa.
- **`ambiguos`** é para termo que nomeia dois produtos **com preços diferentes**.
  O bot recebe as opções e **pergunta**, em vez de escolher. Na Polpa só o
  `acai` entra: polpa a R$ 35,00 o quilo contra balde pronto a R$ 43,00. Morango
  e maracujá existem como polpa e como fruta congelada, mas custam o mesmo —
  então não há o que perguntar.
- **`pesoKg: null`** quando o produto não é vendido por peso. Não é zero: a taxa
  de entrega é por peso, e com peso desconhecido a ferramenta devolve `taxa a
  confirmar` em vez de chutar. Assim que você souber o número, troque e a
  pergunta desaparece.

**O preço passa a existir em dois lugares** — aqui para a conta, no `.md` para a
resposta em prosa. É dívida real, e o conserto é um teste: `pedido.test.ts` falha
quando um preço da tabela não aparece em nenhum documento. Rode `npm test` depois
de mexer em preço.

`maximoDeLinhas` sobe de 3 para 5 porque recapitular um pedido com itens e total
não cabe em três linhas — e o corte é **silencioso**, então a linha perdida seria
a do total.

### O que mais afeta a qualidade

**Nos documentos:** use títulos (`## Assunto` no `.md`; no `.txt`, linha curta
sem ponto final isolada por linhas em branco). O chunker nunca junta duas seções
no mesmo pedaço, então título bom é separação boa. Um assunto por seção, e
sempre com o número junto do contexto — "A limpeza custa R$ 180,00" funciona,
tabela de preços solta não.

**Arquivo começando com `_` não é ingerido.** É assim que rascunhos, notas
internas e o próprio `_LEIA-ME.md` ficam na pasta sem virar resposta do bot.

**Na avaliação:** o conjunto precisa de três famílias de pergunta.

| Família | `esperaHandoff` | Por que importa |
|---|---|---|
| O documento responde | `false` | mede se o bot acha a informação |
| **Não responde, mas é do ramo** | `true` | **a mais importante** — a busca pontua alto e o bot tem de recusar mesmo assim |
| Fora do assunto | `true` | chega ao modelo com contexto fraco e ele precisa recusar |

A segunda família é onde o bot inventa se estiver mal calibrado. Na clínica de
exemplo é o caso `cnpj`: fala da clínica (score 0.593) mas a resposta não existe
nos documentos.

## Estrutura

```
src/
  config.ts          # todos os valores ajustáveis do projeto ficam aqui
  core/              # não conhece canal nenhum
    engine.ts        # porta única de entrada: responder(tenant, contato, texto)
    rag/             # chunking, embeddings, vetores, busca
    llm/             # cliente do modelo e montagem dos prompts
    tenant/          # carga do tenant e config efetiva
    conversation/    # janela de contexto e turno social (oi, obrigado, tchau)
    agenda/          # grade de horários, operações, ferramentas do bot e lembretes
    pedido/          # carrinho em tabela, catálogo de preços e ferramentas de venda
    alertas/         # avisos para o dono, que NÃO calam o bot (≠ handoff)
    avaliacao/       # regras de acerto, execução da suíte, arquivo, logs e estabilidade
    painel/          # números do painel (agregação é decisão, não formatação)
  storage/           # SQLite: conexão, migrations e repositórios
  adapters/
    cli/             # simulador no terminal (a borda que conhece o terminal)
    web/             # servidor HTTP: conversa, agenda, testes e painel (a borda que conhece HTTP)
  scripts/           # seed, ingestão, calibração, avaliação, relatório e lembretes
data/tenants/<slug>/ # documentos + tenant.json + avaliacao.json + produtos.json
                     # (_ no início do nome = não ingerido; .json nunca é ingerido)
logs/                # histórico das avaliações (versionado de propósito)
tests/
```

## Regras de comportamento do bot

Estão em `src/core/llm/prompts.ts` e valem para todo tenant:

1. Responde só com base nos chunks recuperados **daquele** tenant.
2. O limiar NÃO barra mensagem nenhuma. Toda mensagem chega ao modelo, que
   decide entre conversar (quando não é pergunta sobre o negócio) e escalar
   (quando é pergunta e o contexto não responde). O limiar só escolhe se o
   contexto vai como firme ou marcado como fraco.
   Saudação, agradecimento e despedida nem chegam à busca: são turno social,
   com prompt próprio e sem acionar ninguém.
   Depois de um handoff o bot fica mudo, mas oferece sempre o botão
   **Falar com o atendente virtual**, que destrava a conversa sem apagar o
   aviso pendente para a equipe.
3. Nunca inventa preço, prazo, horário ou disponibilidade.
4. No máximo 3 linhas, cortadas no código se o modelo passar. O teto é
   ajustável por tenant (`maximoDeLinhas`): quem monta pedido precisa de mais,
   e o corte é silencioso.
5. Uma mensagem por resposta.
6. Se faltam vários dados, pergunta tudo de uma vez — e **só os que faltam**.
7. **Marca, remarca e cancela consultas** pelas ferramentas de agenda. Nunca
   afirma disponibilidade sem consultar a agenda de verdade, e confirma com o
   cliente antes de cancelar ou remarcar — isso está na assinatura da
   ferramenta (`confirmado: boolean`), não só no prompt.
8. **Lembra da consulta no dia dela**, uma vez só, e oferece remarcar ou
   cancelar na própria mensagem. O lembrete é enfileirado no `outbox`; quem o
   entrega nesta fase é `npm run lembretes`.
9. Para marcar, precisa de **horário, nome completo e telefone com DDD**, e
   repete os dados antes de gravar. Os três estão na assinatura da ferramenta,
   não no prompt — e o telefone é conferido por contagem de dígitos, porque
   campo obrigatório de texto aceita "não informado".
10. **Espera 2,5s antes de responder**, e junta as mensagens que chegarem
    nesse intervalo num turno só. Ninguém escreve um parágrafo no WhatsApp:
    escreve "quero marcar", "pra sexta", "as 9". O contador reinicia a cada
    mensagem nova, com teto de 12s.
11. **Monta o pedido pelas ferramentas** quando o tenant tem `vende: true`.
    O carrinho vive em tabela, não na cabeça do modelo: a conta é somada em
    código, o pedido sobrevive a qualquer janela de contexto, e produto que não
    está no catálogo é **recusa** em vez de aproximação. Quem não liga `vende`
    continua proibido de vender.
12. **Nunca processa pagamento.** Anotar a forma escolhida é diferente — isso
    ele faz, e quem recebe o dinheiro é a pessoa na entrega.
13. **Nunca confirma horário de entrega.** Ele ANOTA o horário que o cliente
    pediu (obrigatório para fechar) e avisa que a responsável confirma. As duas
    coisas são diferentes, e confundi-las já travou uma conversa em laço: a
    coluna do banco se chama `preferred_time` justamente para ninguém conseguir
    gravar promessa por acidente.
14. **Avisa o dono do negócio sem parar de conversar** (`avisar_responsavel`).
    Diferente do handoff, que o cala. Pedido de desconto, horário a confirmar e
    dúvida de cobertura viram tarefa no painel, e a conversa continua.

Não são regras estéticas: no WhatsApp cada mensagem enviada tem custo, então
verbosidade vira prejuízo.

## Decisões técnicas

| Item | Escolha |
|---|---|
| Banco | `better-sqlite3` (binário pré-compilado, não precisa de compilador) |
| Busca vetorial | cosseno em memória, atrás da interface `BuscaVetorial` |
| Embeddings | OpenAI `text-embedding-3-small`, 1536 dimensões |
| LLM | OpenAI, id em `config.ts` ou na variável `LLM_MODEL` do `.env` |
| TypeScript | `tsx` para rodar, `tsc --noEmit` para checar — sem build |

`Embedder`, `LlmClient` e `BuscaVetorial` são interfaces: trocar de provedor ou
migrar para `sqlite-vec` é acrescentar uma implementação, não refatorar.

## Política de testes

O projeto tem **dois tipos de teste**, separados de propósito. Juntos, os dois
pioram: o determinístico fica lento e caro, e o não-determinístico some no ruído.

### `npm test` — unitários

Offline, determinísticos, grátis, ~2 segundos. Rode a cada salvamento.
Embedder e LLM são sempre dublês. **Nenhum teste unitário pode tocar a rede.**

Um teste só entra na suíte se falha por *um* motivo nomeável, se o nome descreve
comportamento e não implementação, e — quando nasce de um bug real — traz um
comentário dizendo qual era o caso. Exemplos no código: o handoff com a frase
reescrita em minúscula, e o desconto em porcentagem.

### `npm run avaliar` — qualidade das respostas

Chama a API de verdade, custa ~US$ 0,01 por execução, é não-determinística.
Rode depois de mexer em prompt, limiar, chunking, documentos ou modelo.

O critério de acerto são regras explícitas por pergunta, em
`data/tenants/<slug>/avaliacao.json`:

```jsonc
{
  "id": "preco-limpeza",
  "pergunta": "quanto custa a limpeza?",
  "deveConter": ["180"],        // todos precisam aparecer
  "naoPodeConter": [],          // nenhum pode aparecer
  "esperaHandoff": false,       // deve ou não pedir ajuda humana
  "fonteEsperada": "servicos.md"
}
```

Além dessas, **toda** resposta passa por uma checagem automática: qualquer valor
em reais, horário, prazo ou porcentagem citado precisa existir nos chunks
recuperados. É a verificação direta da regra "nunca invente preço, prazo,
horário ou disponibilidade" — a que dá prejuízo. Um modelo que acerta o texto
mas troca R$ 180 por R$ 190 passa em qualquer teste de palavra-chave e reprova
aqui.

A avaliação roda com `semPersistir`, então não cria conversas nem dispara
handoffs de verdade: avaliar não pode encher a fila da equipe.

### Estabilidade: por que acurácia sozinha engana

95% acertando sempre as mesmas perguntas é uma coisa; 95% sorteando quais é
outra, bem pior — em produção o cliente faz a pergunta **uma vez só**.

`npm run avaliar -- <slug> --repeticoes 5` roda a suíte cinco vezes e gera
`logs/ESTABILIDADE.md`, que mostra por pergunta quantas vezes passou, **quantos
textos distintos** o modelo produziu e a variação do `best_score`.

Essa variação separa as duas causas possíveis de oscilação: como a mesma
pergunta gera sempre o mesmo embedding, variação acima de zero significa que os
chunks mudaram (houve reingestão); variação zero com resultado oscilante é
hesitação do LLM.

Foi essa medição que achou o bug mais sério do projeto — veja
[PROGRESSO.md](PROGRESSO.md), Etapa 4.

### Os logs

```
logs/
  ULTIMO.md              # relatório da execução mais recente — abra este primeiro
  historico.jsonl        # append-only, uma linha por (execução, pergunta)
  avaliacoes/
    2026-09-23-21-59.md  # cada execução preservada
```

Cada relatório traz, por pergunta: passou ou falhou, **qual regra quebrou**, a
**resposta completa**, as **fontes com seus scores** e o **best_score** da busca.
E traz uma seção de **regressões** — o que passava antes e falhou agora. É a
seção mais importante: separa "eu piorei" de "o modelo variou".

Os logs são versionados de propósito. É com eles que se calibra limiar, top-k e
prompt com dado em vez de impressão.

## O limiar de confiança não é porteiro nem juiz

`npm run calibrar` mediu, na base da clínica de exemplo, que os dois grupos de
perguntas **se sobrepõem**:

- perguntas que a base responde: scores de 0.426 a 0.733
- perguntas sem resposta na base: scores de 0.331 a 0.593

`"qual o CNPJ da clínica?"` tira 0.593 porque *fala* da clínica — só que a
resposta não existe nos documentos. Nenhum número separa os dois grupos.

Ele já foi porteiro: abaixo do limiar, o bot respondia a frase de handoff sem
nem chamar o modelo. **Isso saiu**, porque medindo a conversa de verdade a conta
não fechava: `"boa tarde"` tirou 0.370 e chamou um atendente para responder a um
cumprimento. O limiar estava separando o que não dava para separar.

Hoje ele tem papel menor e honesto: escolhe se o contexto vai ao modelo como
firme ou marcado como fraco, e alimenta o `melhorScore` que o painel mostra. A
saída seca sobrou para um caso só — tenant sem chunk nenhum indexado. Quem
decide se é para escalar é o modelo.

Rode o `calibrar` de novo sempre que trocar o modelo de embeddings ou mexer
bastante nos documentos: o número continua valendo para saber se os documentos
estão cobrindo as perguntas.

## Estado atual

Acompanhe em [PROGRESSO.md](PROGRESSO.md) — passo a passo do que foi feito, o que
falta e por que cada decisão foi tomada. Atualizado ao fim de cada etapa.


**As 4 etapas da fase local estão prontas**, e mais cinco frentes depois delas:
ingestão, busca, CLI, estado de conversa com janela de contexto e memória
compactada, handoff com botão de volta, contabilidade de custo por mensagem,
adaptador web com conversa, agenda, painel e bateria de testes, suíte de
avaliação com logs e medição de estabilidade, a **agenda completa** (a recepção
opera pela página, o bot marca, remarca e cancela por tool calling, e o lembrete
do dia sai pelo `outbox`), o **agrupamento de mensagens seguidas**, os **avisos
para o dono** — que, diferente do handoff, não calam o bot — e o **pedido de
venda em tabela**, com carrinho, catálogo de preços e fechamento por contrato.

**481 testes unitários offline.** Última medição paga, em 2026-10-02 e já
**depois** das mudanças de prompt desta frente: **100% de acurácia e 100% de
estabilidade** em 5 rodadas consecutivas, 28/28 em todas, zero oscilação, por
US$ 0,0739.

Dois clientes de exemplo convivem, e é de propósito — eles exercitam caminhos
opostos do motor: a `clinica-sorriso` **agenda** e não vende; a
`polpa-santa-helena` **vende** e não agenda.

**Próximo passo natural:** fazer a auditoria cruzar o total que o bot escreveu
com a soma do carrinho. Hoje uma conversa que informou **R$ 60,00** num pedido de
**R$ 110,00** tirou 100% de aproveitamento — a régua lê texto e não confere
conta. É a mesma cegueira do "horário impossível", e agora que existe
`produtos.json` ela dá para fechar.
