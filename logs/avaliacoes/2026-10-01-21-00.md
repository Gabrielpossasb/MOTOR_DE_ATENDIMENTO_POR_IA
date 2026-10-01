# Avaliação 2026-10-01-21-00 — polpa-santa-helena

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **88.5%** (23/26) |
| Custo total | US$ 0.019324 |
| Custo médio por pergunta | US$ 0.000743 |
| Latência média | 1130 ms |

## Regressões

- **desconto-atacado** — deveria pedir ajuda humana, mas respondeu como se soubesse

## Corrigidas nesta execução

- quantos-pacotes
- pao-de-queijo
- pedido-torto

## Falhas (3)

### FALHOU · `desconto-atacado`

**Pergunta:** faz desconto se eu levar 20 kg?

**Resposta:** No momento não tenho informação de desconto para 20 kg.
Se quiser, posso te passar os valores dos sabores e a taxa de entrega.

> Política de atacado não existe nos documentos. Clássico de invenção.

**Por que falhou:**
- `esperaHandoff`: deveria pedir ajuda humana, mas respondeu como se soubesse

<sub>handoff: esperado sim, obtido não · best_score 0.572 · 1196ms · 878→32 tokens · US$ 0.000803</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.572), catalogo.md §Quanto vem em 1 quilo (0.467), outros-produtos.md §Pão de queijo congelado (0.446), catalogo.md §Polpas de R$ 25,00 o quilo (0.426)</sub>

### FALHOU · `bairros`

**Pergunta:** vocês entregam no bairro Tiradentes?

**Resposta:** Entregamos sim, é só combinar o endereço certinho na hora do pedido.
Se quiser, já me manda o que vai pedir e eu te passo o total com a entrega.

> A área de entrega não está escrita em lugar nenhum.

**Por que falhou:**
- `esperaHandoff`: deveria pedir ajuda humana, mas respondeu como se soubesse

<sub>handoff: esperado sim, obtido não · best_score 0.450 · 1332ms · 789→41 tokens · US$ 0.000776</sub>

<sub>fontes: entrega-e-pagamento.md §Como funciona a entrega (0.450), entrega-e-pagamento.md §Formas de pagamento (0.412), entrega-e-pagamento.md §Taxa de entrega (0.402)</sub>

### FALHOU · `conserta-geladeira`

**Pergunta:** vocês consertam freezer?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fora do ramo, mas dá para negar sem acionar ninguém — mesma lição do 'pizza' na clínica.

**Por que falhou:**
- `esperaHandoff`: desistiu de uma pergunta que a base responde

<sub>handoff: esperado não, obtido sim · best_score 0.455 · 973ms · 769→18 tokens · US$ 0.000658</sub>

<sub>fontes: nenhuma</sub>

## Passaram (23)

### OK · `preco-acai`

**Pergunta:** quanto custa a polpa de açaí?

**Resposta:** A polpa de açaí custa R$ 35,00 o quilo.
Se quiser, posso te passar os outros sabores também.

> Preço direto de um sabor da faixa mais cara.

<sub>handoff: esperado não, obtido não · best_score 0.712 · 1493ms · 897→33 tokens · US$ 0.000821</sub>

<sub>fontes: catalogo.md §Polpas de R$ 35,00 o quilo (0.712), outros-produtos.md §Açaí pronto (0.706), catalogo.md §Polpas de R$ 25,00 o quilo (0.675), catalogo.md §Polpas de R$ 29,00 o quilo (0.628)</sub>

### OK · `preco-goiaba`

**Pergunta:** qual o valor da polpa de goiaba?

**Resposta:** A polpa de goiaba custa R$ 25,00 o quilo.
Se quiser, posso te passar os outros sabores também.

> Faixa de R$ 25,00.

<sub>handoff: esperado não, obtido não · best_score 0.634 · 1218ms · 863→33 tokens · US$ 0.000796</sub>

<sub>fontes: catalogo.md §Polpas de R$ 25,00 o quilo (0.634), catalogo.md §Polpas de R$ 35,00 o quilo (0.598), catalogo.md §Polpas de R$ 29,00 o quilo (0.567), sobre-e-uso.md §Para que serve a polpa (0.515)</sub>

### OK · `preco-uva`

**Pergunta:** polpa de uva quanto sai?

**Resposta:** A polpa de uva sai R$ 29,00 o quilo.
Se quiser, me fala quantos kg você quer e eu te passo o total com a entrega.

> Faixa do meio, a que menos aparece.

<sub>handoff: esperado não, obtido não · best_score 0.497 · 1329ms · 909→41 tokens · US$ 0.000866</sub>

<sub>fontes: catalogo.md §Polpas de R$ 29,00 o quilo (0.497), catalogo.md §Polpas de R$ 25,00 o quilo (0.452), sobre-e-uso.md §Para que serve a polpa (0.446), catalogo.md §Lista completa de sabores de polpa (0.435)</sub>

### OK · `sabores`

**Pergunta:** quais sabores vocês têm?

**Resposta:** Temos 14 sabores: abacaxi, abacaxi com hortelã, acerola, acerola com laranja, açaí, caju, cupuaçu, frutas vermelhas, goiaba, graviola, limão, maracujá, morango e uva.
Se quiser, te passo também os preços de cada um.

> Pergunta mais comum de todas.

<sub>handoff: esperado não, obtido não · best_score 0.573 · 1261ms · 908→81 tokens · US$ 0.001046</sub>

<sub>fontes: catalogo.md §Lista completa de sabores de polpa (0.573), catalogo.md §Polpas de R$ 25,00 o quilo (0.532), catalogo.md §Polpas de R$ 29,00 o quilo (0.524), catalogo.md §Polpas de R$ 35,00 o quilo (0.515)</sub>

### OK · `quantos-pacotes`

**Pergunta:** quantos pacotes vem em 1 kg?

**Resposta:** 1 kg vem com 10 pacotes de 100 g. Cada pacote rende 1 copo de suco.

> Informação que está no topo do catálogo e o cliente sempre pergunta.

<sub>handoff: esperado não, obtido não · best_score 0.708 · 1207ms · 876→27 tokens · US$ 0.000779</sub>

<sub>fontes: catalogo.md §Quanto vem em 1 quilo (0.708), entrega-e-pagamento.md §Taxa de entrega (0.476), sobre-e-uso.md §Como usar e conservar (0.473), outros-produtos.md §Pão de queijo congelado (0.414)</sub>

### OK · `acai-2l`

**Pergunta:** vocês têm açaí pronto pra vender?

**Resposta:** Temos sim: açaí Pura Polpa de 2 litros por R$ 43,00 o balde.
Se quiser, já me fala a quantidade.

> Açaí 2L é produto diferente da polpa de açaí; testa se não confunde.

<sub>handoff: esperado não, obtido não · best_score 0.706 · 1335ms · 878→39 tokens · US$ 0.000834</sub>

<sub>fontes: outros-produtos.md §Açaí pronto (0.706), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.599), catalogo.md §Polpas de R$ 35,00 o quilo (0.574), catalogo.md §Polpas de R$ 25,00 o quilo (0.543)</sub>

### OK · `pao-de-queijo`

**Pergunta:** vende pão de queijo?

**Resposta:** Vendo sim, pão de queijo congelado sai a R$ 25,00 o quilo.
Se quiser, me fala a quantidade que você quer.

> Produto fora da linha de polpas.

<sub>handoff: esperado não, obtido não · best_score 0.651 · 1081ms · 739→36 tokens · US$ 0.000716</sub>

<sub>fontes: outros-produtos.md §Pão de queijo congelado (0.651), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.487), catalogo.md §Polpas de R$ 29,00 o quilo (0.420)</sub>

### OK · `taxa-entrega-1kg`

**Pergunta:** se eu comprar só 1 kg paga entrega?

**Resposta:** Sim, 1 kg paga R$ 5,00 de entrega.
A partir de 2 kg, a entrega é grátis.

> O caso que o catálogo impresso deixa ambíguo. Abaixo de 2 kg paga R$ 5,00.

<sub>handoff: esperado não, obtido não · best_score 0.731 · 1059ms · 871→31 tokens · US$ 0.000793</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.731), catalogo.md §Quanto vem em 1 quilo (0.536), entrega-e-pagamento.md §Como funciona a entrega (0.504), entrega-e-pagamento.md §Formas de pagamento (0.476)</sub>

### OK · `entrega-gratis`

**Pergunta:** a partir de quanto a entrega é gratis?

**Resposta:** A entrega é grátis a partir de 2 kg.
Abaixo disso, a taxa é R$ 5,00.

> De 2 kg em diante é grátis.

<sub>handoff: esperado não, obtido não · best_score 0.670 · 1106ms · 788→29 tokens · US$ 0.000722</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.670), entrega-e-pagamento.md §Como funciona a entrega (0.533), entrega-e-pagamento.md §Formas de pagamento (0.471)</sub>

### OK · `pagamento`

**Pergunta:** aceita pix?

**Resposta:** Sim, aceitamos Pix, dinheiro e cartão na entrega. Posso te ajudar com seu pedido?

> Forma de pagamento.

<sub>handoff: esperado não, obtido não · best_score 0.433 · 1245ms · 618→23 tokens · US$ 0.000567</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.433)</sub>

### OK · `retirar`

**Pergunta:** posso buscar aí pra não pagar entrega?

**Resposta:** Não temos loja física, só entregamos.
A taxa é R$ 5,00 abaixo de 2 kg; a partir de 2 kg a entrega é grátis.

> Não há loja física. O bot precisa dizer que só trabalha com entrega, sem inventar endereço.

<sub>handoff: esperado não, obtido não · best_score 0.569 · 1131ms · 863→39 tokens · US$ 0.000823</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.569), entrega-e-pagamento.md §Formas de pagamento (0.520), entrega-e-pagamento.md §Como funciona a entrega (0.519), entrega-e-pagamento.md §O que precisamos para fechar o pedido (0.425)</sub>

### OK · `conservacao`

**Pergunta:** preciso guardar no freezer?

**Resposta:** Sim, precisa ficar no congelador ou freezer.
Depois de descongelada, não deve congelar de novo.

> Dúvida de quem compra pela primeira vez.

<sub>handoff: esperado não, obtido não · best_score 0.593 · 1017ms · 873→27 tokens · US$ 0.000776</sub>

<sub>fontes: sobre-e-uso.md §Como usar e conservar (0.593), sobre-e-uso.md §Para que serve a polpa (0.455), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.447), outros-produtos.md §Frutas congeladas em pedaços (0.444)</sub>

### OK · `rende-quanto`

**Pergunta:** um pacote de 100g da quanto de suco?

**Resposta:** Um pacote de 100 g dá 1 copo de suco.
Se quiser, posso te passar os sabores e preços também.

> Rendimento, o argumento de venda do catálogo.

<sub>handoff: esperado não, obtido não · best_score 0.698 · 980ms · 890→31 tokens · US$ 0.000807</sub>

<sub>fontes: catalogo.md §Quanto vem em 1 quilo (0.698), sobre-e-uso.md §Como usar e conservar (0.645), catalogo.md §Polpas de R$ 25,00 o quilo (0.556), catalogo.md §Polpas de R$ 35,00 o quilo (0.544)</sub>

### OK · `conservante`

**Pergunta:** tem conservante na polpa?

**Resposta:** Não, as polpas são 100% fruta, sem conservantes e sem aditivos.
Se quiser, te explico também como usar ou quais sabores temos.

> 100% fruta, sem conservantes. Resposta errada aqui é problema de rótulo.

<sub>handoff: esperado não, obtido não · best_score 0.506 · 1006ms · 835→37 tokens · US$ 0.000793</sub>

<sub>fontes: sobre-e-uso.md §Para que serve a polpa (0.506), sobre-e-uso.md §Qualidade (0.493), catalogo.md §Polpas de fruta congeladas (0.438), sobre-e-uso.md §Como usar e conservar (0.437)</sub>

### OK · `instagram`

**Pergunta:** qual o instagram de vocês?

**Resposta:** Nosso Instagram é @polpasantahelena 😊
Se precisar de algo, me fala!

> Dado de contato.

<sub>handoff: esperado não, obtido não · best_score 0.474 · 1002ms · 649→23 tokens · US$ 0.000590</sub>

<sub>fontes: sobre-e-uso.md §Contato e redes sociais (0.474)</sub>

### OK · `polpa-manga`

**Pergunta:** tem polpa de manga?

**Resposta:** Não trabalhamos com manga. Temos 14 sabores: abacaxi, abacaxi com hortelã, acerola, acerola com laranja, açaí, caju, cupuaçu, frutas vermelhas, goiaba, graviola, limão, maracujá, morango e uva.

> Sabor do ramo que NAO existe. O documento lista os 14 e diz o que fazer com o que esta fora, entao a base RESPONDE: negar e listar. Esperava handoff e estava errado - conferido conversando. O que se cobra e nao inventar preco de manga.

<sub>handoff: esperado não, obtido não · best_score 0.459 · 1286ms · 894→73 tokens · US$ 0.000999</sub>

<sub>fontes: sobre-e-uso.md §Para que serve a polpa (0.459), catalogo.md §Lista completa de sabores de polpa (0.448), catalogo.md §Polpas de fruta congeladas (0.445), sobre-e-uso.md §Sobre a Polpa Santa Helena (0.427)</sub>

### OK · `prazo-validade`

**Pergunta:** qual a validade da polpa congelada?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Não está documentado. Inventar validade de alimento é grave.

<sub>handoff: esperado sim, obtido sim · best_score 0.617 · 1046ms · 837→18 tokens · US$ 0.000709</sub>

<sub>fontes: nenhuma</sub>

### OK · `horario-entrega`

**Pergunta:** que horas vocês entregam?

**Resposta:** A entrega é combinada com cada cliente no momento do pedido.
Me fala o nome de quem recebe, endereço completo, dia e horário que pode receber e a forma de pagamento?

> Nao ha janela fixa: o documento diz que o horario e combinado com o cliente. Entao a base responde, e o erro seria inventar um horario.

<sub>handoff: esperado não, obtido não · best_score 0.525 · 1177ms · 860→40 tokens · US$ 0.000825</sub>

<sub>fontes: entrega-e-pagamento.md §Como funciona a entrega (0.525), entrega-e-pagamento.md §Formas de pagamento (0.436), entrega-e-pagamento.md §O que precisamos para fechar o pedido (0.432), entrega-e-pagamento.md §Taxa de entrega (0.404)</sub>

### OK · `cnpj`

**Pergunta:** qual o cnpj de vocês?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fala do negócio e não está nos documentos — o caso que mais engana o limiar.

<sub>handoff: esperado sim, obtido sim · best_score 0.415 · 1060ms · 650→18 tokens · US$ 0.000569</sub>

<sub>fontes: nenhuma</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fora do domínio.

<sub>handoff: esperado sim, obtido sim · best_score 0.281 · 1221ms · 740→18 tokens · US$ 0.000636</sub>

<sub>fontes: nenhuma</sub>

### OK · `saudacao-alongada`

**Pergunta:** bom diaa

**Resposta:** Bom diaaa! 😊 Me conta o que você precisa por aqui.

> Turno social com alongamento. Não pode virar handoff nem citar preço.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 938ms · 417→17 tokens · US$ 0.000389</sub>

<sub>fontes: nenhuma</sub>

### OK · `agradecimento`

**Pergunta:** vlw obrigado

**Resposta:** Por nada! Fico à disposição 😊

> Turno social.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 597ms · 413→11 tokens · US$ 0.000359</sub>

<sub>fontes: nenhuma</sub>

### OK · `pedido-torto`

**Pergunta:** queria 1 kg de polpa de morango

**Resposta:** Temos sim: polpa de morango R$ 35,00 o kg.
1 kg = 10 pacotes de 100 g.
Quer que eu anote o pedido?

> Intencao de compra escrita como gente escreve. UM quilo de proposito: com 2 kg a resposta certa e R$ 70,00, que a regra numeroInventado acusa por nao estar literalmente nos chunks. A regra nao distingue conta de invencao - ver a pendencia no SESSAO.

<sub>handoff: esperado não, obtido não · best_score 0.609 · 1091ms · 901→43 tokens · US$ 0.000869</sub>

<sub>fontes: catalogo.md §Polpas de R$ 35,00 o quilo (0.609), catalogo.md §Polpas de R$ 25,00 o quilo (0.565), outros-produtos.md §Frutas congeladas em pedaços (0.564), catalogo.md §Polpas de R$ 29,00 o quilo (0.548)</sub>
