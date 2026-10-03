# Plano: o bot monta o pedido

**Estado:** aprovado e **não iniciado**. Nenhuma linha deste plano foi escrita
no código.
**Escrito em:** 2026-10-01, a partir da conversa 33 da Polpa Santa Helena.
**Nada aqui está medido.** Os números citados são do que já aconteceu; o que o
plano promete só vale depois de rodar.

---

## Contexto

A conversa 33 (Polpa Santa Helena, 9 turnos, web) tirou **100% de
aproveitamento** na auditoria e contém o pior defeito desta fase:

> **CLIENTE** qual o valor de tudo?
> **BOT** Vou confirmar o total certinho com a responsável, tá? / Se quiser, me
> manda de novo os itens e quantidades do pedido pra eu conferir tudo.

E ainda gerou alerta (`kind: 'outro'`, origem `ferramenta`): o bot escalou uma
**soma** para a dona do negócio.

**Ele não estava sendo preguiçoso: ele não tinha os dados.** `summary_until_message_id`
era 191, então a janela íntegra tinha 4 mensagens (todas sobre taxa de entrega)
e o resto era este resumo gravado em `conversations.summary`:

```
- Cliente quer encomendar para amanhã: 2 pacotes de pão de queijo, 1 kg de
  polpa de acerola e 1 kg de polpa de maracujá.
- Cliente também informou que quer 1 kg de acerola e 1 kg de maracujá;
  pedido de polpas ficou mais específico.
- Assunto de valores dos itens já foi respondido.    ← os preços, apagados
```

A regra 3 do `montarPromptDeResumo` manda exatamente isso: *"NÃO copie preço…
Escreva que o assunto foi respondido, sem o número."* Ela está **certa** para a
clínica — preço no resumo vira fonte de verdade paralela e desatualizada. Ela é
**destrutiva** para um pedido em montagem, que é a única coisa que precisa
carregar número ao longo da conversa.

Repare também na segunda linha: o resumidor não soube se o segundo pedido
**somava** ou **substituía**, e hedgeou. Nenhum prompt conserta isso.

### O que mais a conversa expôs

| # | sintoma sentido na conversa | causa real |
|---|---|---|
| 1 | repete "vem 10 pacotes em 1 kg" | está como instrução permanente no `promptDoSistema` **e** como seção própria no `catalogo.md`, que ganha a busca em toda pergunta com "1 kg de…" |
| 2 | não monta o pedido, só dá preços | a memória acima. A aritmética está correta em **todas** as contas (2×35+25=95, 12×35=420): ele sabe multiplicar, não sabe lembrar |
| 3 | saudação largada | `ORIENTACAO.saudacao` só diz "cumprimente de volta", sem forma; e a regra 4 do prompt social ("não repita frase") empurra para a criatividade |
| 4 | não manda catálogo | nada no sistema sabe mandar catálogo, e não cabe: 14 sabores em 3 faixas não entram em 3 linhas |
| 5 | pede nome/endereço/pagamento cedo demais | ele **obedece** a regra global 7 ("pergunte TODOS de uma vez") somada ao `promptDoSistema` ("colete de uma vez só as quatro coisas") |

Três achados que ninguém tinha notado:

- **O prompt se contradiz.** Regra global 8: *"Não tente vender nem processar
  pagamento."* `promptDoSistema`: *"junte o pedido"*, *"Some o pedido e informe o
  total"*. Vender virou recurso e ninguém avisou a regra 8 — mesma história que
  "agendar" já viveu aqui.
- **Erro factual.** Turno 4: *"Pão de queijo: R$ 25,00 o quilo. Cada quilo vem
  com 10 pacotes de 100 g."* Essa é a embalagem da **polpa**; o documento não
  diz como o pão de queijo vem, e ele preencheu com o vizinho. "2 pacotes" nunca
  virou quantidade, então nenhum total era possível.
- **A auditoria é cega para este negócio.** A lista `DADOS` é vocabulário de
  clínica (`nome`, `telefone`, `convenio`, `data`, `horario`). Não existe
  `endereco` nem `pagamento` — os dois campos que ele mais repete. É por isso que
  a 33 deu 100%.

### Decisões já tomadas

- **Vai até o pedido estruturado**, não só o conserto de prompt.
- **Pão de queijo: pacote fechado de 1 kg, R$ 25,00.** "2 pacotes" = 2 kg = R$ 50,00.
- **A saudação padrão vale para todos os tenants.** Conferido: as perguntas
  sociais do `avaliacao.json` da clínica usam só `naoPodeConter` (proíbem
  handoff e preço), então **isto não custa remedição da suíte paga**.

---

# Parte 1 — a conversa flui

## 1.1 Vender deixa de ser proibido (`prompts.ts`, `config.ts`, `CLAUDE.md`)

`regrasDoBot()` passa a receber se o tenant vende. Para quem tem
`config.pedido`, a regra 8 troca de "não tente vender" para:

> *"Você PODE montar o pedido e informar o total. Não processe pagamento: a
> forma de pagamento é apenas anotada."*

A segunda metade continua valendo para todos. E `CLAUDE.md` ganha a mesma
ressalva que a agenda tem hoje: **vender era fora de escopo e virou recurso por
decisão de produto; se achar a proibição solta em algum lugar, é resquício.**

Junto disso: **`resposta.maximoDeLinhas` vira sobrescrevível por tenant.** Hoje
é 3 global, e `limitarLinhas` **corta em silêncio** — num recapitulativo de
pedido a linha cortada seria justamente o total, a pior truncagem possível.
Dois casos reais na conversa 32 já encostaram no teto (msgs 155 e 165, 3 linhas
exatas).

## 1.2 O resumo passa a carregar o pedido (`prompts.ts`)

Exceção nova em `montarPromptDeResumo`, ao lado da regra 3:

> *"O PEDIDO EM ANDAMENTO é exceção à regra 3: itens, quantidades, o total já
> informado e os dados de fechamento (nome, endereço, horário desejado, forma de
> pagamento) ficam no resumo COM os números. É dado do atendimento, não consulta
> ao catálogo."*

É a correção de uma linha que conserta o turno 9. A proibição continua valendo
para tudo que o bot só *informou* — preço de item que o cliente não pediu, prazo,
cobertura.

O risco assumido, a explicitar em comentário: um preço de item já no carrinho
fica congelado no resumo. Para um pedido em andamento isso é o comportamento
certo — não se reprecifica no meio da venda.

## 1.3 A saudação ganha forma (`prompts.ts`)

`ORIENTACAO.saudacao` passa a dar a estrutura, não só a intenção:

> *"Cumprimente de volta no período do dia que a pessoa usou, pergunte como ela
> está e ofereça ajuda — na forma «Bom dia! Tudo bem? Em que posso ajudar?». As
> palavras podem variar; a estrutura, não."*

E a regra 4 do `montarPromptSocial` ("não repita uma frase que já usou") afrouxa
para *"não repita a frase inteira; a estrutura pode repetir"* — hoje ela briga
com qualquer padrão.

Isto só alcança saudação **pura**: `classificarTurnoSocial` já devolve
`undefined` quando sobra conteúdo, e o caso está testado na suíte paga
(`social-com-pergunta-junto`: *"boa tarde, vocês abrem no sábado?"* tem de
responder o horário).

## 1.4 O "10 pacotes" sai do prompt e volta ao documento

- **`tenant.json`**: apagar a última linha (`"Cada quilo de polpa tem 10 pacotes
  de 100 g."`). O fato está no `catalogo.md`; no prompt ele lê como *"diga
  sempre isto"*.
- **`catalogo.md`**: `## Quanto vem em 1 quilo` → `## Como a polpa é embalada`, e
  o corpo diz **polpa** explicitamente. Hoje o título é genérico e por isso o
  chunk ganha a busca em "1 kg de pão de queijo".
- **`outros-produtos.md`**: seção nova dizendo que o pão de queijo vem em
  **pacote fechado de 1 kg por R$ 25,00**, e que 2 pacotes são 2 kg.
- `npm run ingest -- polpa-santa-helena` depois.

Com o carrinho estruturado (Parte 2) a nota de embalagem passa a sair uma vez,
quando o item entra no pedido.

## 1.5 Catálogo como anexo, não como texto (`src/core/catalogo/`)

Ferramenta `enviar_catalogo`, opt-in por `tenant.config.catalogo`, no molde
exato de `FERRAMENTA_DE_AVISO`. Devolve:

```json
{ "ok": true, "instrucao": "O catálogo foi enviado ao cliente. NÃO liste sabores nem preços na sua resposta; diga que o catálogo está aí e pergunte o que ele quer." }
```

O núcleo devolve o catálogo como **anexo/ação** (`{id:'catalogo'}`), reusando o
mecanismo de `AcaoSugerida` que já existe em `engine.ts` — o mesmo que fez o
botão "falar com o atendente virtual" sem o núcleo saber o que é um botão. Nesta
fase a página desenha uma linha só, `catálogo`; no WhatsApp vira imagem ou
mensagem de catálogo e **nenhuma linha do núcleo muda**.

**Duas redes, como nos alertas**, porque a lição do `"descontinho"` foi medida: o
modelo não chamou a ferramenta e quem pegou foi a palavra-chave. Então
ferramenta **mais** rede determinística (`config.catalogo.palavras`: `catalog`,
`tabela`, `lista de sabor`, `quais sabores`, `que sabores`, `quero pedir polpa`).

Ganho de token real: hoje a lista de 14 sabores sai como tokens de saída em toda
pergunta de sabor.

## 1.6 `"ok"` deixa de ser beco sem saída (`turno-social.ts`, `engine.ts`)

No turno 3 o `"ok"` caiu em `confirmacao` → prompt social (sem documentos, sem
negócio) → *"Perfeito, fico no aguardo 😊"*, logo depois de o bot ter feito
quatro perguntas. Ar morto.

Decisão no núcleo, determinística e testável: **`confirmacao` não atalha para o
caminho social quando a última mensagem do bot terminou em pergunta.** As outras
três categorias não mudam — um "obrigado" é social mesmo depois de pergunta.
Helper novo em `conversation-service.ts`, consumido por `engine.ts` antes do
desvio social.

## 1.7 Cada reclamação ganha um detector (`auditoria.ts`)

Sem isto não há como dizer se o conserto funcionou — e a 33 provou que 100% não
quer dizer nada. A lista `DADOS` passa a ser **extensível por tenant** (hoje é
constante de módulo com vocabulário de clínica).

| detector | pega qual reclamação |
|---|---|
| `endereco` e `pagamento` em `DADOS` | `pedido_repetido` finalmente funciona para este negócio |
| `repetiu_informacao` (grave) | o "10 pacotes" dito duas vezes — sobreposição de n-gramas entre turnos do bot, ignorando o que o cliente perguntou de novo |
| `pediu_dado_cedo_demais` (grave) | pediu endereço ou pagamento antes de existir produto **com quantidade** na conversa |
| `nao_somou` (grave) | cliente pediu o total e a resposta não tem `R$` — é o turno 9 |
| `escalou_o_que_sabia` (aviso) | `avisar_responsavel` com motivo `outro`: `outro` significa que o modelo não soube nomear o próprio motivo |

Cada um nasce de um caso real desta conversa, e o comentário diz qual — como
manda o projeto. Os dois últimos cruzam mensagem com alerta, então a auditoria
passa a ler a tabela `alerts`.

Nota: `nao_somou` e `pediu_dado_cedo_demais` são padrão de texto e vão errar.
Vêm com o trecho, como todos os outros.

---

# Parte 2 — o pedido vira estado

O valor aqui **não é a aritmética** — ele já soma certo. É o **contrato**, o
mesmo caminho que consertou "marcou sem telefone e sem confirmar": pedido não
fecha sem itens, dado já informado não pode ser pedido de novo, e o carrinho não
depende de janela nem de resumo. Mesma forma da agenda, que já provou o desenho.

## 2.1 `007_pedidos.sql`

```
orders       id, tenant_id, conversation_id, contact_id, status
             (rascunho|confirmado|cancelado), customer_name, address,
             preferred_time, payment_method, created_at, confirmed_at
order_items  id, order_id, product_key, label, quantity, unit,
             unit_price_cents, weight_kg
```

- Preço **em centavos**: `R$ 25,00` em float acumula erro na soma, e um total
  errado por um centavo destrói mais confiança que um total ausente.
- `unit_price_cents` é **copiado** para o item no momento em que ele entra. O
  pedido é um registro histórico; mudar o `produtos.json` não pode reescrever
  pedido já feito.
- Índice único parcial: **um rascunho por conversa** (`WHERE status =
  'rascunho'`), mesma disciplina de `alerts` e `outbox` — e por isso duas
  mensagens simultâneas não criam dois carrinhos.
- `weight_kg` existe separado da quantidade porque a taxa de entrega é por
  **peso** e não todo produto é vendido por quilo (ver questões abertas).

## 2.2 `data/tenants/polpa-santa-helena/produtos.json`

Fonte de verdade dos preços para a ferramenta. `.json` não é ingerido (só `.md`
e `.txt`), então não polui o RAG.

O preço passa a existir em dois lugares — o `.json` para a conta e o `.md` para
a resposta em prosa. É dívida real, e o conserto é um **teste** que falha quando
divergem: todo preço do `produtos.json` tem de aparecer literalmente nos
documentos ingeridos do tenant. Barato, offline, e pega a deriva no dia em que
ela nasce.

## 2.3 `src/core/pedido/` — serviço e ferramentas

Opt-in por `tenant.config.pedido`, exatamente como `tenant.config.agenda !==
undefined` já decide a agenda em `engine.ts:303`.

| ferramenta | contrato |
|---|---|
| `ver_pedido` | carrinho + total + taxa, calculados em código |
| `adicionar_ao_pedido(produto, quantidade)` | **produto desconhecido é recusa, nunca o vizinho** |
| `remover_do_pedido(produto)` / `limpar_pedido` | o cliente muda de ideia |
| `anotar_dados_da_entrega(nome?, endereco?, horario?, pagamento?)` | acumulativo, todos opcionais |
| `fechar_pedido(confirmado)` | recusa carrinho vazio e recusa campo faltando, e nomeia qual falta |

Quatro decisões que importam:

1. **Recusa de produto desconhecido** é a regra 4 do prompt ("item PARECIDO não
   é resposta") virando contrato. O modelo pedir manga tem de devolver
   `{ok:false, motivo:'não temos manga'}` com a lista do que existe — não o
   preço do abacaxi.
2. **Toda ferramenta devolve o carrinho inteiro**, não só o delta. É o que faz a
   resposta natural do bot virar *"anotei: X e Y, total até agora R$ Z — quer
   mais alguma coisa?"*, que é a reclamação 2 resolvida pela forma do dado e não
   por uma regra nova de prompt.
3. **`anotar_dados_da_entrega` é acumulativo e parcial**, então dado que o
   cliente mandou sem ninguém pedir fica gravado na hora — e o resultado da
   ferramenta diz o que já está lá, que é o que impede o segundo pedido. É a
   pendência nº 1 do `SESSAO.md` (`pedido_repetido`), que duas regras de prompt
   (a global 7 e a A2) já tentaram e não resolveram.
4. **`confirmado: false` primeiro**, como `criar_agendamento`. E
   `fechar_pedido` **nunca** grava horário como confirmado: o campo é
   `preferred_time`, "o horário que o cliente pediu", e o fechamento dispara
   `confirmar_entrega` no `alerts`. O nome da coluna é que garante isso, não o
   prompt.

`semPersistir` honrado em todas — `npm run avaliar` roda com ela e não pode
criar pedido no banco do cliente.

## 2.4 O `promptDoSistema` reescrito em etapas

Hoje é lista plana de oito blocos, e é dela que sai o despejo das quatro
perguntas na segunda mensagem. Vira sequência explícita:

1. **Descobrir o que a pessoa quer.** Sem itens no pedido, não se pede endereço
   nem pagamento. O nome pode ser perguntado antes, por educação.
2. **Montar.** Cada item vai para o pedido com a ferramenta; o total vem dela.
3. **Fechar.** Só com pedido não-vazio: endereço, horário desejado, pagamento —
   pedindo de uma vez **só o que ainda falta**.
4. **Confirmar.** Recapitular tudo e esperar o sim.

Mais: *"Dado que o cliente mandar sem você pedir, anote na hora com
`anotar_dados_da_entrega` e confirme no fim — nunca pergunte de novo."*

A regra 7 global ("pergunte todos de uma vez") continua valendo — ela não está
errada, estava sendo aplicada na etapa errada. A etapa é que faltava.

---

## Verificação

**Offline:** `npm test` e `npm run typecheck` verdes. Testes novos por arquivo
tocado, e cada um nomeando o caso real: o resumo que apagou os preços, o
`"ok"` depois de pergunta, o produto inexistente, o fechamento com carrinho
vazio, o `produtos.json` divergindo do documento.

**A medição que decide, de graça:** `npm run conversas -- polpa-santa-helena
--id 33` **antes** de qualquer mudança, com os detectores novos já no lugar. A
33 tem de deixar de dar 100% — se continuar dando, os detectores estão errados e
não há o que medir depois. Essa é a primeira coisa a rodar, antes de consertar
qualquer prompt.

**De verdade, na página,** refazendo a conversa 33 quase palavra por palavra:
`boa noite` → `quero pedir polpas` → `2 pacotes de pao de queijo` →
`1 kg de acerola com laranja` → `1 kg de maracuja` → `a entrega sera cobrada?` →
`qual o valor de tudo?`

O que tem de acontecer:

| | esperado |
|---|---|
| saudação | `Boa noite! Tudo bem? Em que posso ajudar?` |
| "quero pedir polpas" | catálogo (uma linha), **sem** pedir nome/endereço/pagamento |
| pão de queijo | 2 pacotes = **2 kg = R$ 50,00**, sem falar de 10 pacotes de 100 g |
| embalagem da polpa | dita **uma vez só** |
| "a entrega será cobrada?" | *"no seu caso é grátis"* — aplicando o peso do carrinho, não a política genérica |
| **"qual o valor de tudo?"** | o total, com os itens — **nenhum** `avisar_responsavel` |
| endereço/pagamento | só depois do pedido montado |

Depois: `npm run conversas --id <nova>` com aproveitamento melhor que 89%, e o
`/painel` sem alerta `outro`.

**A suíte paga precisa ser refeita**, e a razão é específica: a regra 8 e o
`maximoDeLinhas` são **globais** e entram no prompt da clínica. O baseline é
100%/100% em 5 rodadas (~US$ 0,06) e ele não pode cair. A saudação não entra
nessa conta — já conferido acima.

---

## Questões abertas, registradas e não inventadas

1. **O balde de açaí de 2 litros conta para os 2 kg de entrega grátis?** A taxa
   é por **peso** e esse produto é vendido por **volume**. Hoje nenhum documento
   responde, e `weight_kg` precisa de um número. Perguntar antes de implementar
   a taxa.
2. **A frase de handoff** — *"vou chamar alguém da equipe"* — é esquisita num
   negócio de uma pessoa. `config.resposta.fraseDeHandoff` é global. Já era
   pendência; a Parte 1 não a toca.
3. **`desconto-atacado` no `avaliacao.json`** espera a resposta antiga e agora o
   comportamento é alerta. A avaliação roda sem conversa, logo sem ferramenta —
   a expectativa é que está inconsistente, não o código.
4. **As seis conversas de teste (ids 26–31)** continuam poluindo as métricas do
   painel, e a pergunta de apagar segue sem resposta. A **22** (consulta real de
   Gabriel) e a **32/33** não se apagam.
