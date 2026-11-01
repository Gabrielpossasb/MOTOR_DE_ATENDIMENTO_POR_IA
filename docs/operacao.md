# Operação

Todos os comandos rodam da raiz do repositório (`FASE_LOCAL/`).

## Os comandos, um a um

### Grátis, sem rede

```bash
npm test                                  # 530 testes offline, ~8s
npm run test:watch                        # os mesmos, em watch
npm run typecheck                         # tsc --noEmit
npm run conversas -- <slug>               # aproveitamento por conversa
npm run conversas -- <slug> --id 22       # transcrito + relatório de uma conversa
npm run conversas -- <slug> --id 22 --md  # exporta para logs/conversas/
npm run lembretes -- <slug>               # enfileira os lembretes das consultas de hoje
npm run lembretes -- <slug> --data 2026-11-05
npm run lembretes -- <slug> --enviar      # marca a fila do dia como enviada
npm run relatorio                         # histórico de todas as avaliações
npm run relatorio -- <id-da-pergunta>     # trajetória de uma pergunta
npm run relatorio -- --instaveis          # perguntas que oscilam entre passar e falhar
npm run novo-tenant -- <slug> "<Nome>"    # cria data/tenants/<slug>/
npm run seed -- <slug>                    # cria ou atualiza o tenant no banco
```

### Pagos, chamam a OpenAI

```bash
npm run ingest -- <slug>                  # documentos -> chunks -> embeddings -> banco
npm run ingest -- <slug> --forcar         # reprocessa tudo, mesmo sem mudanças
npm run cli -- <slug>                     # conversa no terminal
npm run web -- <slug>                     # as quatro páginas em http://localhost:3000
npm run calibrar -- <slug>                # mede os scores do avaliacao.json e sugere o limiar
npm run avaliar -- <slug>                 # suíte de qualidade contra a API real
npm run avaliar -- <slug> --repeticoes 5  # roda 5x e mede estabilidade
```

A ingestão é idempotente: arquivo cujo conteúdo não mudou é pulado, porque
embedding custa dinheiro. Mexeu num documento, rode `ingest` de novo.

O CLI aceita entrada redirecionada, o que serve para testar em lote:

```bash
printf 'qual o horário de sábado?\nvocês vendem pizza?\nsair\n' | npm run cli -- clinica-sorriso
```

## As quatro páginas do `npm run web`

| Rota | O que é |
|---|---|
| `/` | a conversa, no formato de uma tela de celular |
| `/agenda` | a agenda da recepção: marcar, remarcar e cancelar na mão |
| `/testes` | ver, editar e rodar as perguntas do `avaliacao.json`, uma a uma, por grupo ou todas |
| `/painel` | números, handoffs a revisar, avisos para o dono e lembretes na fila |

Na conversa, **Nova conversa** (ou **Ctrl+Shift+N**) encerra a conversa atual e
começa outra do zero. Serve para testar linguagem natural sem abrir aba nova, e
para destravar uma conversa que caiu em handoff e deixou o bot mudo. Encerra sem
apagar: o histórico continua alimentando o painel.

Clicar numa linha da lista de conversas do painel abre o transcrito com o
relatório de auditoria daquela conversa.

## `.env` e `.env.example`

São arquivos com papéis opostos, e só um deles faz alguma coisa.

| | `.env` | `.env.example` |
|---|---|---|
| Contém | a chave real | um placeholder falso |
| Versionado no git | não (está no `.gitignore`) | sim |
| Lido pelo programa | sim, por `dotenv.config()` | nunca |

`.env.example` não influencia nada em tempo de execução. Ele é documentação:
existe para quem clona o projeto saber *quais* variáveis precisa definir, sem
que a chave real vá junto no repositório.

Variáveis reconhecidas, todas opcionais exceto a primeira:

| Variável | Efeito | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | embeddings e chat. Sem ela, `ingest`, `cli`, `web`, `calibrar` e `avaliar` falham | nenhum |
| `LLM_MODEL` | sobrescreve o modelo de chat | `gpt-5.4-mini` |
| `WEB_PORT` | porta do adaptador web | `3000` |

O `.env` vence o que está em `src/config.ts`. Para testar outro modelo sem mexer
no código basta uma linha no `.env`, mas **atualize também os preços** em
`config.ts` (`precoEntradaPorMilhaoDeTokens` e `precoSaidaPorMilhaoDeTokens`),
senão o custo reportado em cada mensagem vira ficção.

## Onde ficam as coisas ajustáveis

Tudo que é número de ajuste mora em [`src/config.ts`](../src/config.ts), e nada
fica solto no código. Os que mais se mexem:

| Chave | O que governa |
|---|---|
| `busca.topK` | quantos chunks recuperar por pergunta (4) |
| `busca.limiarDeConfianca` | se o contexto vai como firme ou marcado como fraco (0.4) |
| `conversa.mensagensNaJanela` | tamanho da janela de contexto (8) |
| `conversa.agrupamento.esperaMs` | silêncio que fecha o turno (10000) |
| `conversa.agrupamento.esperaMaximaMs` | teto desde a primeira mensagem do lote (30000) |
| `conversa.resumo.mensagensPreservadas` | o que sobra íntegro depois de compactar (4) |
| `agenda.maximoDeVoltas` | teto de idas e voltas com ferramenta num turno (3) |
| `agenda.lembrete.horaDeEnvio` | hora em que o lembrete do dia sai (07:30) |
| `resposta.maximoDeLinhas` | teto de mensagens por turno, antes do override do tenant (3) |

`topK`, `limiarDeConfianca`, `maximoDeLinhas` e `vende` podem ser sobrescritos
por cliente no `config` do `tenant.json`.

## Lembretes

`npm run lembretes` não gasta crédito: não passa nem por modelo nem por
embedding. Rodar duas vezes no mesmo dia não duplica nada, e quem garante é o
índice único `(appointment_id, kind)` da tabela `outbox`, a mesma disciplina do
`ingest`.

Nesta fase nada sai sozinho: o comando é o dublê do canal. O dia em que a Cloud
API entrar, ela drena a mesma tabela.

Atenção ao fuso ao mexer nisso: `starts_at` e `scheduled_for` são
`'YYYY-MM-DD HH:MM'` em hora local, enquanto `created_at` e `sent_at` saem em
UTC, porque vêm do `datetime('now')` do SQLite. Nunca compare um com o outro:
em Campo Grande são 4 horas de diferença, e um `WHERE scheduled_for <=
datetime('now')` adiantaria todo lembrete. Para saber o que já venceu, use
`lembretesAEnviar(db, tenantId, agora)`, que recebe o relógio injetado.

## Os logs

```
logs/
  ULTIMO.md              # relatório da execução mais recente, abra este primeiro
  ESTABILIDADE.md        # saída de --repeticoes
  historico.jsonl        # append-only, uma linha por (execução, pergunta)
  avaliacoes/            # cada execução preservada
  conversas/             # transcritos exportados com --md (NÃO versionado)
```

`logs/` é versionado de propósito: é com ele que se calibra limiar, `topK` e
prompt com dado em vez de impressão. A exceção é `logs/conversas/`, que está no
`.gitignore` porque transcrito de gente tem nome e telefone.

## Dado de cliente não vira commit

`data/*.db` e `logs/conversas/` estão no `.gitignore`. A rota que serve uma
conversa filtra por tenant no SQL e devolve 404 quando o id existe mas é de
outro cliente, em vez de 400: trocar o número na URL não pode ler a conversa do
vizinho.
