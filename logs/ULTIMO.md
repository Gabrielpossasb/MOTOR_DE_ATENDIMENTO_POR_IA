# Avaliação 2026-10-09-22-13 — polpa-santa-helena

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **97.1%** (34/35) |
| Custo total | US$ 0.073012 |
| Custo médio por pergunta | US$ 0.002086 |
| Latência média | 1399 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Corrigidas nesta execução

- desconto-atacado
- desconto-cartao-impresso

## Falhas (1)

### FALHOU · `conserta-geladeira`

**Pergunta:** vocês consertam freezer?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fora do ramo, mas dá para negar sem acionar ninguém — mesma lição do 'pizza' na clínica.

**Por que falhou:**
- `esperaHandoff`: desistiu de uma pergunta que a base responde

<sub>handoff: esperado não, obtido sim · best_score 0.455 · 1159ms · 2517→18 tokens · US$ 0.001969</sub>

<sub>fontes: nenhuma</sub>

## Passaram (34)

### OK · `preco-acai`

**Pergunta:** quanto custa a polpa de açaí?

**Resposta:** A polpa de açaí custa R$ 35,00 o quilo.
Vem em quilo fechado, com 10 pacotes de 100 g.

> Preço direto de um sabor da faixa mais cara.

<sub>handoff: esperado não, obtido não · best_score 0.712 · 1840ms · 2645→38 tokens · US$ 0.002155</sub>

<sub>fontes: catalogo.md §Polpas de R$ 35,00 o quilo (0.712), outros-produtos.md §Açaí pronto (0.708), catalogo.md §Polpas de R$ 25,00 o quilo (0.674), catalogo.md §Polpas de R$ 29,00 o quilo (0.628)</sub>

### OK · `preco-goiaba`

**Pergunta:** qual o valor da polpa de goiaba?

**Resposta:** A polpa de goiaba custa R$ 25,00 o quilo.
Cada quilo vem com 10 pacotes de 100 g, e não vendemos avulso.

> Faixa de R$ 25,00.

<sub>handoff: esperado não, obtido não · best_score 0.634 · 1873ms · 2690→43 tokens · US$ 0.002211</sub>

<sub>fontes: catalogo.md §Polpas de R$ 25,00 o quilo (0.634), catalogo.md §Como a polpa de fruta é embalada (0.606), catalogo.md §Polpas de R$ 35,00 o quilo (0.598), catalogo.md §Polpas de R$ 29,00 o quilo (0.567)</sub>

### OK · `preco-uva`

**Pergunta:** polpa de uva quanto sai?

**Resposta:** A polpa de uva sai R$ 29,00 o quilo.
Se quiser, me fala quantos quilos você quer 🙂

> Faixa do meio, a que menos aparece.

<sub>handoff: esperado não, obtido não · best_score 0.497 · 1216ms · 2657→32 tokens · US$ 0.002137</sub>

<sub>fontes: catalogo.md §Polpas de R$ 29,00 o quilo (0.497), catalogo.md §Polpas de R$ 25,00 o quilo (0.452), sobre-e-uso.md §Para que serve a polpa (0.446), catalogo.md §Lista completa de sabores de polpa (0.435)</sub>

### OK · `sabores`

**Pergunta:** quais sabores vocês têm?

**Resposta:** Temos abacaxi, abacaxi com hortelã, acerola, acerola com laranja, açaí, caju, cupuaçu, frutas vermelhas, goiaba, graviola, limão, maracujá, morango e uva.
Se quiser, eu já te passo os valores também.

> Pergunta mais comum de todas.

<sub>handoff: esperado não, obtido não · best_score 0.573 · 1467ms · 2656→75 tokens · US$ 0.002330</sub>

<sub>fontes: catalogo.md §Lista completa de sabores de polpa (0.573), catalogo.md §Polpas de R$ 25,00 o quilo (0.532), catalogo.md §Polpas de R$ 29,00 o quilo (0.524), catalogo.md §Polpas de R$ 35,00 o quilo (0.515)</sub>

### OK · `quantos-pacotes`

**Pergunta:** quantos pacotes vem em 1 kg?

**Resposta:** 1 kg de polpa vem com 10 pacotes de 100 g
Quer que eu te passe os sabores também?

> Informação que está no topo do catálogo e o cliente sempre pergunta.

<sub>handoff: esperado não, obtido não · best_score 0.726 · 1265ms · 2843→28 tokens · US$ 0.002258</sub>

<sub>fontes: catalogo.md §Pacote e quilo são coisas diferentes (0.726), catalogo.md §Como a polpa de fruta é embalada (0.565), outros-produtos.md §Pão de queijo congelado (0.541)</sub>

### OK · `acai-2l`

**Pergunta:** vocês têm açaí pronto pra vender?

**Resposta:** Temos sim, o balde de 2 litros sai por R$ 43,00.
Se quiser, me fala quantos baldes você quer e o endereço de entrega 🙂

> Açaí 2L é produto diferente da polpa de açaí; testa se não confunde.

<sub>handoff: esperado não, obtido não · best_score 0.706 · 1317ms · 2626→40 tokens · US$ 0.002150</sub>

<sub>fontes: outros-produtos.md §Açaí pronto (0.706), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.599), catalogo.md §Polpas de R$ 35,00 o quilo (0.574), catalogo.md §Polpas de R$ 25,00 o quilo (0.543)</sub>

### OK · `pao-de-queijo`

**Pergunta:** vende pão de queijo?

**Resposta:** Vendemos sim, o pão de queijo congelado sai a R$ 25,00 o quilo.
Vem em pacote fechado de 1 kg. Quantos quilos você quer?

> Produto fora da linha de polpas.

<sub>handoff: esperado não, obtido não · best_score 0.642 · 1380ms · 2703→42 tokens · US$ 0.002216</sub>

<sub>fontes: outros-produtos.md §Pão de queijo congelado (0.642), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.487), catalogo.md §Como a polpa de fruta é embalada (0.433), catalogo.md §Polpas de R$ 29,00 o quilo (0.420)</sub>

### OK · `taxa-entrega-1kg`

**Pergunta:** se eu comprar só 1 kg paga entrega?

**Resposta:** Sim, 1 kg paga R$ 5,00 de entrega.
Se quiser, me fala o sabor e quantos quilos você quer 🙂

> O caso que o catálogo impresso deixa ambíguo. Abaixo de 2 kg paga R$ 5,00.

<sub>handoff: esperado não, obtido não · best_score 0.736 · 1472ms · 2788→33 tokens · US$ 0.002240</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.736), catalogo.md §Pacote e quilo são coisas diferentes (0.580), entrega-e-pagamento.md §Desconto por quantidade (0.549)</sub>

### OK · `entrega-gratis`

**Pergunta:** a partir de quanto a entrega é gratis?

**Resposta:** A partir de 2 kg a entrega sai de graça.
Se quiser, me fala o que você vai querer que eu já vou montando aqui 🙂

> De 2 kg em diante é grátis.

<sub>handoff: esperado não, obtido não · best_score 0.661 · 1701ms · 2719→33 tokens · US$ 0.002188</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.661), entrega-e-pagamento.md §Como funciona a entrega (0.555), entrega-e-pagamento.md §Onde entregamos (0.513), entrega-e-pagamento.md §Desconto por quantidade (0.489)</sub>

### OK · `pagamento`

**Pergunta:** aceita pix?

**Resposta:** Aceitamos sim, pode ser Pix, dinheiro ou cartão na entrega.
Se quiser, me fala o que vai levar 🙂

> Forma de pagamento.

<sub>handoff: esperado não, obtido não · best_score 0.416 · 3004ms · 2453→27 tokens · US$ 0.001961</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.416)</sub>

### OK · `retirar`

**Pergunta:** posso buscar aí pra não pagar entrega?

**Resposta:** A gente trabalha só com entrega, não tem retirada no local.
Se quiser, me fala o que você quer e eu já te passo certinho 🙂

> Não há loja física. O bot precisa dizer que só trabalha com entrega, sem inventar endereço.

<sub>handoff: esperado não, obtido não · best_score 0.560 · 1280ms · 2722→33 tokens · US$ 0.002190</sub>

<sub>fontes: entrega-e-pagamento.md §Taxa de entrega (0.560), entrega-e-pagamento.md §Onde entregamos (0.535), entrega-e-pagamento.md §Formas de pagamento (0.523), entrega-e-pagamento.md §Como funciona a entrega (0.521)</sub>

### OK · `conservacao`

**Pergunta:** preciso guardar no freezer?

**Resposta:** Sim, precisa ficar no congelador ou freezer.
Depois de descongelada, não pode congelar de novo.

> Dúvida de quem compra pela primeira vez.

<sub>handoff: esperado não, obtido não · best_score 0.593 · 1511ms · 2621→26 tokens · US$ 0.002083</sub>

<sub>fontes: sobre-e-uso.md §Como usar e conservar (0.593), sobre-e-uso.md §Para que serve a polpa (0.455), outros-produtos.md §Frutas congeladas, açaí e pão de queijo (0.447), outros-produtos.md §Frutas congeladas em pedaços (0.444)</sub>

### OK · `rende-quanto`

**Pergunta:** um pacote de 100g da quanto de suco?

**Resposta:** Um pacote de 100 g dá 1 copo de suco.
Se quiser, eu também te passo os sabores e valores 🙂

> Rendimento, o argumento de venda do catálogo.

<sub>handoff: esperado não, obtido não · best_score 0.670 · 1585ms · 2722→30 tokens · US$ 0.002177</sub>

<sub>fontes: catalogo.md §Como a polpa de fruta é embalada (0.670), sobre-e-uso.md §Como usar e conservar (0.645), catalogo.md §Pacote e quilo são coisas diferentes (0.601), catalogo.md §Polpas de R$ 25,00 o quilo (0.556)</sub>

### OK · `conservante`

**Pergunta:** tem conservante na polpa?

**Resposta:** Não, as polpas são 100% fruta, sem conservantes e sem aditivos.
Se quiser, te passo os sabores também.

> 100% fruta, sem conservantes. Resposta errada aqui é problema de rótulo.

<sub>handoff: esperado não, obtido não · best_score 0.506 · 1424ms · 2583→31 tokens · US$ 0.002077</sub>

<sub>fontes: sobre-e-uso.md §Para que serve a polpa (0.506), sobre-e-uso.md §Qualidade (0.493), catalogo.md §Polpas de fruta congeladas (0.438), sobre-e-uso.md §Como usar e conservar (0.437)</sub>

### OK · `instagram`

**Pergunta:** qual o instagram de vocês?

**Resposta:** @polpasantahelena
Se quiser, te passo também o WhatsApp 🙂

> Dado de contato.

<sub>handoff: esperado não, obtido não · best_score 0.474 · 1092ms · 2397→20 tokens · US$ 0.001888</sub>

<sub>fontes: sobre-e-uso.md §Contato e redes sociais (0.474)</sub>

### OK · `polpa-manga`

**Pergunta:** tem polpa de manga?

**Resposta:** Não trabalhamos com manga.
Temos abacaxi, acerola, açaí, caju, cupuaçu, frutas vermelhas, goiaba, graviola, limão, maracujá, morango e uva.

> Sabor do ramo que NAO existe. O documento lista os 14 e diz o que fazer com o que esta fora, entao a base RESPONDE: negar e listar. Esperava handoff e estava errado - conferido conversando. O que se cobra e nao inventar preco de manga.

<sub>handoff: esperado não, obtido não · best_score 0.459 · 1377ms · 2642→56 tokens · US$ 0.002234</sub>

<sub>fontes: sobre-e-uso.md §Para que serve a polpa (0.459), catalogo.md §Lista completa de sabores de polpa (0.448), catalogo.md §Polpas de fruta congeladas (0.445), sobre-e-uso.md §Sobre a Polpa Santa Helena (0.427)</sub>

### OK · `desconto-atacado`

**Pergunta:** faz desconto se eu levar 20 kg?

**Resposta:** Sim, acima de 10 kg tem condição especial.
Vou chamar a responsável pra confirmar o valor.

> A politica EXISTE: diz que existe condicao acima de 10 kg e que a responsavel fecha, sem estimar percentual. SEM `esperaHandoff` de proposito -- o comportamento desenhado e chamar `avisar_responsavel`, e a avaliacao roda sem conversa, logo sem ferramenta nenhuma. Sem ela o modelo cai na frase de handoff, que e o certo quando nao ha como avisar. O que esta pergunta mede aqui e o CONTEUDO; o comportamento de alerta so se mede conversando.

<sub>handoff: esperado não, obtido não · best_score 0.672 · 1201ms · 2787→23 tokens · US$ 0.002194</sub>

<sub>fontes: entrega-e-pagamento.md §Desconto por quantidade (0.672), entrega-e-pagamento.md §Taxa de entrega (0.568), catalogo.md §Pacote e quilo são coisas diferentes (0.475)</sub>

### OK · `prazo-validade`

**Pergunta:** qual a validade da polpa congelada?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Não está documentado. Inventar validade de alimento é grave.

<sub>handoff: esperado sim, obtido sim · best_score 0.617 · 1112ms · 2585→18 tokens · US$ 0.002020</sub>

<sub>fontes: nenhuma</sub>

### OK · `bairros`

**Pergunta:** vocês entregam no bairro Tiradentes?

**Resposta:** Entregamos sim, em qualquer bairro de Campo Grande.
Qual horário fica melhor pra você?

> A area de entrega esta escrita agora: toda Campo Grande, em qualquer bairro. Escalar isso seria desistir de algo que o documento responde. O caso oposto -- lugar FORA da cobertura -- esta em 'fora-de-cobertura-dourados'.

<sub>handoff: esperado não, obtido não · best_score 0.578 · 1224ms · 2637→22 tokens · US$ 0.002077</sub>

<sub>fontes: entrega-e-pagamento.md §Onde entregamos (0.578), entrega-e-pagamento.md §Como funciona a entrega (0.464), entrega-e-pagamento.md §Formas de pagamento (0.404)</sub>

### OK · `horario-entrega`

**Pergunta:** que horas vocês entregam?

**Resposta:** A gente combina a entrega com você e a responsável confirma depois.
Qual horário fica melhor pra você?

> Nao ha janela fixa: o documento diz que o horario e combinado com o cliente. Entao a base responde, e o erro seria inventar um horario.

<sub>handoff: esperado não, obtido não · best_score 0.575 · 1291ms · 2708→23 tokens · US$ 0.002135</sub>

<sub>fontes: entrega-e-pagamento.md §Como funciona a entrega (0.575), entrega-e-pagamento.md §Onde entregamos (0.494), entrega-e-pagamento.md §Formas de pagamento (0.436), entrega-e-pagamento.md §O que precisamos para fechar o pedido (0.432)</sub>

### OK · `cnpj`

**Pergunta:** qual o cnpj de vocês?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fala do negócio e não está nos documentos — o caso que mais engana o limiar.

<sub>handoff: esperado sim, obtido sim · best_score 0.468 · 1141ms · 2517→18 tokens · US$ 0.001969</sub>

<sub>fontes: nenhuma</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fora do domínio.

<sub>handoff: esperado sim, obtido sim · best_score 0.305 · 1145ms · 2534→18 tokens · US$ 0.001982</sub>

<sub>fontes: nenhuma</sub>

### OK · `saudacao-alongada`

**Pergunta:** bom diaa

**Resposta:** Bom dia! Tudo bem? Em que posso ajudar?

> Turno social com alongamento. Não pode virar handoff nem citar preço.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 1028ms · 2126→14 tokens · US$ 0.001657</sub>

<sub>fontes: nenhuma</sub>

### OK · `agradecimento`

**Pergunta:** vlw obrigado

**Resposta:** Imagina, estamos por aqui 😊

> Turno social.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 1110ms · 2084→10 tokens · US$ 0.001608</sub>

<sub>fontes: nenhuma</sub>

### OK · `pedido-torto`

**Pergunta:** queria 1 kg de polpa de morango

**Resposta:** Morango é R$ 35,00 o quilo.
1 kg de polpa vem com 10 pacotes de 100 g e rende 10 copos.
Quer mais algum sabor?

> Intencao de compra escrita como gente escreve. UM quilo de proposito: com 2 kg a resposta certa e R$ 70,00, que a regra numeroInventado acusa por nao estar literalmente nos chunks. A regra nao distingue conta de invencao - ver a pendencia no SESSAO.

<sub>handoff: esperado não, obtido não · best_score 0.609 · 1376ms · 2727→43 tokens · US$ 0.002239</sub>

<sub>fontes: catalogo.md §Polpas de R$ 35,00 o quilo (0.609), catalogo.md §Como a polpa de fruta é embalada (0.581), catalogo.md §Polpas de R$ 25,00 o quilo (0.565), outros-produtos.md §Frutas congeladas em pedaços (0.563)</sub>

### OK · `unidade-pacote-virou-quilo`

**Pergunta:** quero 5 polpas de acerola e 5 de maracuja

**Resposta:** A polpa sai em quilo fechado: 1 kg vem com 10 pacotes de 100 g.
Então 5 polpas de acerola e 5 de maracujá dão 1 kg de cada, certo?

> O mal-entendido mais caro, de uma conversa real: '5 polpas' sao 5 pacotes de 100 g, nao 5 kg. Somado como quilo da R$ 300 em vez de uns R$ 30. Tem de explicar o quilo fechado e PERGUNTAR, nunca supor. A recusa tambem existe no contrato (unidadeIncompativel), mas a avaliacao roda sem ferramenta, entao aqui mede-se a resposta pelos documentos.

<sub>handoff: esperado não, obtido não · best_score 0.633 · 1649ms · 2783→51 tokens · US$ 0.002317</sub>

<sub>fontes: catalogo.md §Polpas de R$ 25,00 o quilo (0.633), catalogo.md §Polpas de R$ 35,00 o quilo (0.622), catalogo.md §Lista completa de sabores de polpa (0.567), catalogo.md §Polpas de R$ 29,00 o quilo (0.552)</sub>

### OK · `unidade-pacote-avulso`

**Pergunta:** pode me vender 3 pacotinhos de goiaba?

**Resposta:** Goiaba sai em quilo fechado, e 1 kg vem com 10 pacotes de 100 g.
Quantos quilos você quer?

> Pacote avulso nao existe: o minimo de cada sabor e 1 quilo. Nao pode virar venda de 3 pacotes nem recusa seca sem explicar.

<sub>handoff: esperado não, obtido não · best_score 0.590 · 1464ms · 2693→34 tokens · US$ 0.002173</sub>

<sub>fontes: catalogo.md §Polpas de R$ 25,00 o quilo (0.590), catalogo.md §Como a polpa de fruta é embalada (0.572), catalogo.md §Polpas de R$ 35,00 o quilo (0.547), catalogo.md §Polpas de R$ 29,00 o quilo (0.543)</sub>

### OK · `brinde`

**Pergunta:** vem algum brinde no pedido?

**Resposta:** Por enquanto não temos brinde.
Vou avisar a responsável que perguntaram 🙂

> Ja foi dado brinde uma vez e hoje nao vale. Nao pode prometer nem inventar; a palavra-chave 'brinde' tambem gera alerta para o dono decidir se volta a dar.

<sub>handoff: esperado não, obtido não · best_score 0.605 · 1290ms · 2480→19 tokens · US$ 0.001946</sub>

<sub>fontes: entrega-e-pagamento.md §Brinde (0.605), entrega-e-pagamento.md §O que precisamos para fechar o pedido (0.443)</sub>

### OK · `desconto-cartao-impresso`

**Pergunta:** recebi o cartao de voces, tenho desconto na primeira compra?

**Resposta:** Tem sim, pelo cartão o desconto já é aplicado no pedido.
Me fala o que você quer e a quantidade em quilos 🙂

> O cliente mencionou o cartao, entao o desconto vale. NAO exige mais o valor na resposta: quem aplica e informa o total e a ferramenta `aplicar_desconto`, e sem conversa ela nao existe. Citar R$ 10,00 de cabeca seria justamente o que o prompt proibe. O oposto -- nao vazar para quem nao mencionou -- esta em 'desconto-cartao-nao-mencionado'.

<sub>handoff: esperado não, obtido não · best_score 0.488 · 1375ms · 2647→29 tokens · US$ 0.002116</sub>

<sub>fontes: entrega-e-pagamento.md §Desconto por quantidade (0.488), entrega-e-pagamento.md §Formas de pagamento (0.460), entrega-e-pagamento.md §Brinde (0.433)</sub>

### OK · `desconto-cartao-nao-mencionado`

**Pergunta:** e a primeira vez que eu compro com voces

**Resposta:** Que bom te atender por aqui 😊
Me fala o que você quer levar: polpa, fruta congelada, açaí ou pão de queijo?

> FAMILIA 2, a mais importante: o cliente diz que e a primeira compra mas NAO menciona o cartao impresso. Oferecer o desconto aqui e dar dinheiro a quem nao tem direito. O bot nunca oferece por conta propria.

<sub>handoff: esperado não, obtido não · best_score 0.400 · 1309ms · 2458→34 tokens · US$ 0.001997</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.400)</sub>

### OK · `cartao-maquininha`

**Pergunta:** voces aceitam cartao de credito?

**Resposta:** Aceitamos sim, mas no momento é só por aproximação no celular, sem maquininha de chip e senha.
Se quiser, me fala o que você vai pedir também.

> Cartao so por aproximacao, sem maquininha de chip e senha. Responder 'aceitamos cartao' seco faz o cliente chegar na entrega sem conseguir pagar.

<sub>handoff: esperado não, obtido não · best_score 0.524 · 1308ms · 2458→39 tokens · US$ 0.002019</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.524)</sub>

### OK · `nota-fiscal-pj`

**Pergunta:** voces emitem nota fiscal? eu compro pela empresa

**Resposta:** Emitimos NF-e para empresa, sim.
Me passa o nome, endereço completo, dia/horário e a forma de pagamento 🙂

> Emite NF-e para CNPJ. Apareceu nas conversas com os dois clientes B2B.

<sub>handoff: esperado não, obtido não · best_score 0.509 · 1207ms · 2651→30 tokens · US$ 0.002124</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.509), entrega-e-pagamento.md §O que precisamos para fechar o pedido (0.429), entrega-e-pagamento.md §Desconto por quantidade (0.409)</sub>

### OK · `pix-chave`

**Pergunta:** me manda a chave pix ai

**Resposta:** Quem manda a chave Pix é a responsável, eu só anoto por aqui.
Se quiser, já me fala o que vai levar e o endereço de entrega.

> FAMILIA 2. Quem manda a chave e confere o pagamento e a responsavel, nao o atendimento. Chave Pix inventada pelo modelo manda dinheiro de cliente para desconhecido.

<sub>handoff: esperado não, obtido não · best_score 0.467 · 1460ms · 2455→35 tokens · US$ 0.001999</sub>

<sub>fontes: entrega-e-pagamento.md §Formas de pagamento (0.467)</sub>

### OK · `fora-de-cobertura-dourados`

**Pergunta:** voces entregam em Dourados?

**Resposta:** Não entregamos em Dourados.
Só em Campo Grande e Terenos.

> O par do 'bairros': Dourados nao e Campo Grande nem Terenos, e o documento diz que fora desses dois nao temos entrega. Tem de negar com clareza, sem prometer confirmar e sem inventar cobertura. O naoPodeConter original dizia 'entregamos em Dourados' e acusava a resposta CORRETA: substring nao sobrevive a um 'nao' na frente.

<sub>handoff: esperado não, obtido não · best_score 0.614 · 1315ms · 2517→20 tokens · US$ 0.001978</sub>

<sub>fontes: entrega-e-pagamento.md §Onde entregamos (0.614), entrega-e-pagamento.md §Como funciona a entrega (0.424)</sub>
