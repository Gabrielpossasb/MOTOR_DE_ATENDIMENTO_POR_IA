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
npm run web    -- clinica-sorriso   # conversa e painel no navegador
```

Outros comandos:

```bash
npm test                              # testes unitários (não usa rede nem crédito)
npm run typecheck                     # checagem de tipos
npm run ingest -- <slug> --forcar     # reprocessa tudo, mesmo sem mudanças
npm run calibrar -- <slug>            # mede os scores de busca para ajustar o limiar
npm run avaliar -- <slug>             # suíte de qualidade contra a API real (~US$ 0,01)
npm run avaliar -- <slug> --repeticoes 5  # roda 5x e mede estabilidade (~US$ 0,05)
npm run relatorio                     # histórico de todas as avaliações
npm run relatorio -- <id-da-pergunta> # trajetória de uma pergunta
npm run relatorio -- --instaveis      # perguntas que oscilam entre passar e falhar
```

O CLI também aceita entrada redirecionada, o que serve para testar em lote:

```bash
printf 'qual o horário de sábado?\nvocês vendem pizza?\nsair\n' | npm run cli -- clinica-sorriso
```

## Como adicionar um cliente

1. Crie `data/tenants/<slug>/tenant.json`:

```json
{
  "slug": "<slug>",
  "nome": "Nome do cliente",
  "promptDoSistema": "Você é o atendente virtual da ...",
  "config": { "topK": 4, "limiarDeConfianca": 0.4 }
}
```

2. Jogue os documentos (`.txt` e `.md`) na mesma pasta.
3. `npm run seed -- <slug>` e depois `npm run ingest -- <slug>`.

A ingestão é idempotente: arquivo cujo conteúdo não mudou é pulado, porque
embedding custa dinheiro.

## Estrutura

```
src/
  config.ts          # todos os valores ajustáveis do projeto ficam aqui
  core/              # não conhece canal nenhum
    engine.ts        # porta única de entrada: responder(tenant, contato, texto)
    rag/             # chunking, embeddings, vetores, busca
    llm/             # cliente do modelo e montagem dos prompts
    tenant/          # carga do tenant e config efetiva
    conversation/    # janela de contexto da conversa
    avaliacao/       # regras de acerto e escrita dos logs
  storage/           # SQLite: conexão, migrations e repositórios
    painel/          # números do painel (agregação é decisão, não formatação)
  adapters/
    cli/             # simulador no terminal (a borda que conhece o terminal)
    web/             # servidor HTTP, conversa e painel (a borda que conhece HTTP)
  scripts/           # seed, ingestão, calibração, avaliação e relatório
data/tenants/<slug>/ # documentos brutos + tenant.json + avaliacao.json
logs/                # histórico das avaliações (versionado de propósito)
tests/
```

## Regras de comportamento do bot

Estão em `src/core/llm/prompts.ts` e valem para todo tenant:

1. Responde só com base nos chunks recuperados **daquele** tenant.
2. Sem chunk relevante (ou confiança abaixo do limiar): responde que vai chamar
   alguém da equipe. Nesse caso o LLM nem é chamado — não se paga por uma
   resposta que já se sabe que não existe.
3. Nunca inventa preço, prazo, horário ou disponibilidade.
4. No máximo 3 linhas, cortadas no código se o modelo passar.
5. Uma mensagem por resposta.
6. Se faltam vários dados, pergunta tudo de uma vez.

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

## O limiar de confiança é porteiro, não juiz

`npm run calibrar` mediu, na base da clínica de exemplo, que os dois grupos de
perguntas **se sobrepõem**:

- perguntas que a base responde: scores de 0.426 a 0.733
- perguntas sem resposta na base: scores de 0.331 a 0.593

`"qual o CNPJ da clínica?"` tira 0.593 porque *fala* da clínica — só que a
resposta não existe nos documentos. Nenhum número separa os dois grupos.

Por isso o limiar (0.40) é escolhido para ficar **abaixo da pergunta legítima
mais fraca**: ele nunca barra cliente de verdade, e ainda assim filtra de graça
o que é claramente fora do assunto. Quem julga o resto é o LLM, com a regra de
recusar quando o contexto não responde.

Rode o `calibrar` de novo sempre que trocar o modelo de embeddings ou mexer
bastante nos documentos.

## Estado atual

Acompanhe em [PROGRESSO.md](PROGRESSO.md) — passo a passo do que foi feito, o que
falta e por que cada decisão foi tomada. Atualizado ao fim de cada etapa.


**As 4 etapas da fase local estão prontas.** Ingestão, busca, CLI, estado de
conversa com janela de contexto, handoff persistido, contabilidade de custo por
mensagem, adaptador web com painel, suíte de avaliação com logs e medição de
estabilidade.

142 testes unitários offline. Última medição: **100% de acurácia e 100% de
estabilidade** em 5 rodadas consecutivas.

**Próximo passo natural:** trocar os documentos da clínica fictícia pelos de um
cliente real, escrever as perguntas de avaliação desse cliente e calibrar. Só
depois disso vale gastar com a infraestrutura do WhatsApp.
