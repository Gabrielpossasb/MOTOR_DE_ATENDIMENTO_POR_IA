# Avaliação 2026-10-05-01-47 — clinica-sorriso

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **100.0%** (28/28) |
| Custo total | US$ 0.015322 |
| Custo médio por pergunta | US$ 0.000547 |
| Latência média | 999 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Falhas (0)

Nenhuma.

## Passaram (28)

### OK · `horario-sabado`

**Pergunta:** qual o horário de sábado?

**Resposta:** Aos sábados, atendemos das 8h às 12h.
Posso te ajudar com mais alguma coisa?

<sub>handoff: esperado não, obtido não · best_score 0.572 · 1900ms · 690→28 tokens · US$ 0.000644</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.572), horarios.txt §Atendimento de urgência (0.490), faq.md §Atendimento de emergência fora do horário (0.448), faq.md §Profissionais (0.421)</sub>

### OK · `abre-domingo`

**Pergunta:** vocês abrem domingo?

**Resposta:** Não, aos domingos a clínica não abre.
Se quiser, posso te passar o horário de atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.426 · 1143ms · 511→23 tokens · US$ 0.000487</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.426)</sub>

### OK · `preco-limpeza`

**Pergunta:** quanto custa a limpeza?

**Resposta:** A limpeza custa R$ 180,00.
Se quiser, posso te passar também os outros valores.

<sub>handoff: esperado não, obtido não · best_score 0.601 · 1024ms · 670→24 tokens · US$ 0.000611</sub>

<sub>fontes: servicos.md §Limpeza e prevenção (0.601), servicos.md §Clareamento (0.542), servicos.md §Consulta e avaliação (0.523), servicos.md §Extrações (0.489)</sub>

### OK · `preco-implante`

**Pergunta:** quanto custa um implante?

**Resposta:** Implante unitário, incluindo o pilar: R$ 3.200,00.
Ele exige avaliação prévia com tomografia, que não está inclusa.

<sub>handoff: esperado não, obtido não · best_score 0.733 · 1029ms · 699→37 tokens · US$ 0.000691</sub>

<sub>fontes: servicos.md §Próteses e implantes (0.733), servicos.md §Extrações (0.523), servicos.md §Tratamento de canal (0.516), servicos.md §Consulta e avaliação (0.480)</sub>

### OK · `preco-canal-molar`

**Pergunta:** quanto custa canal em molar?

**Resposta:** Canal em molar: R$ 1.200,00.
Costuma exigir de duas a três sessões.

<sub>handoff: esperado não, obtido não · best_score 0.587 · 1071ms · 517→27 tokens · US$ 0.000509</sub>

<sub>fontes: servicos.md §Tratamento de canal (0.587)</sub>

### OK · `convenio-aceito`

**Pergunta:** vocês aceitam Amil Dental?

**Resposta:** Sim, aceitamos Amil Dental.
A avaliação é sem custo para esse convênio.

<sub>handoff: esperado não, obtido não · best_score 0.664 · 1033ms · 736→21 tokens · US$ 0.000647</sub>

<sub>fontes: faq.md §Convênios aceitos (0.664), servicos.md §Restaurações (0.518), servicos.md §Limpeza e prevenção (0.484), servicos.md §Próteses e implantes (0.472)</sub>

### OK · `convenio-recusado`

**Pergunta:** vocês aceitam SulAmérica Odonto?

**Resposta:** Não atendemos SulAmérica Odonto.
Se quiser, posso te informar os convênios que aceitamos.

<sub>handoff: esperado não, obtido não · best_score 0.666 · 1034ms · 691→26 tokens · US$ 0.000635</sub>

<sub>fontes: faq.md §Convênios aceitos (0.666), servicos.md §Extrações (0.454), faq.md §Profissionais (0.449), servicos.md §Restaurações (0.445)</sub>

### OK · `parcelamento`

**Pergunta:** posso parcelar no cartão?

**Resposta:** Sim, pode.
Parcelamos em até 6 vezes sem juros no cartão de crédito.

<sub>handoff: esperado não, obtido não · best_score 0.596 · 1070ms · 588→21 tokens · US$ 0.000536</sub>

<sub>fontes: servicos.md §Procedimentos e valores (0.596), faq.md §Formas de pagamento (0.592)</sub>

### OK · `endereco`

**Pergunta:** onde fica a clínica?

**Resposta:** Rua das Acácias, 412, Jardim dos Estados, Campo Grande - MS.
Fica a duas quadras da Av. Afonso Pena, no mesmo quarteirão da padaria Pão Nosso.

<sub>handoff: esperado não, obtido não · best_score 0.646 · 1176ms · 697→46 tokens · US$ 0.000730</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.646), faq.md §Como agendar (0.536), horarios.txt §Endereço (0.536), faq.md §Profissionais (0.534)</sub>

### OK · `estacionamento`

**Pergunta:** tem estacionamento?

**Resposta:** Sim, temos estacionamento próprio e gratuito para pacientes.
São seis vagas.

<sub>handoff: esperado não, obtido não · best_score 0.471 · 931ms · 563→17 tokens · US$ 0.000499</sub>

<sub>fontes: horarios.txt §Endereço (0.471), faq.md §Remarcação e falta (0.403)</sub>

### OK · `primeira-consulta`

**Pergunta:** o que devo levar na primeira consulta?

**Resposta:** Traga um documento com foto e, se tiver convênio, a carteirinha.
Se tiver radiografia ou tomografia recente, leve também.

<sub>handoff: esperado não, obtido não · best_score 0.628 · 907ms · 698→34 tokens · US$ 0.000677</sub>

<sub>fontes: faq.md §Primeira consulta (0.628), servicos.md §Consulta e avaliação (0.505), faq.md §Atendimento infantil (0.471), faq.md §Como agendar (0.447)</sub>

### OK · `atendimento-infantil`

**Pergunta:** vocês atendem criança de 5 anos?

**Resposta:** Sim, atendemos crianças a partir de 3 anos.
É necessário um responsável acompanhar durante todo o atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.656 · 967ms · 502→25 tokens · US$ 0.000489</sub>

<sub>fontes: faq.md §Atendimento infantil (0.656)</sub>

### OK · `falta-consulta`

**Pergunta:** e se eu faltar na consulta?

**Resposta:** Faltas sem aviso podem gerar cobrança de 50% do valor da consulta.
Se quiser, posso te explicar como funciona a remarcação também.

<sub>handoff: esperado não, obtido não · best_score 0.595 · 974ms · 686→34 tokens · US$ 0.000668</sub>

<sub>fontes: faq.md §Remarcação e falta (0.595), faq.md §Atendimento infantil (0.481), faq.md §Primeira consulta (0.471), faq.md §Como agendar (0.454)</sub>

### OK · `urgencia`

**Pergunta:** tenho dor de dente, consigo atendimento hoje?

**Resposta:** Sim, consegue.
Se chegar até as 17h, tem encaixe no mesmo dia.

<sub>handoff: esperado não, obtido não · best_score 0.589 · 1201ms · 730→22 tokens · US$ 0.000647</sub>

<sub>fontes: horarios.txt §Atendimento de urgência (0.589), faq.md §Convênios aceitos (0.580), faq.md §Profissionais (0.573), servicos.md §Tratamento de canal (0.517)</sub>

### OK · `cnpj`

**Pergunta:** qual o CNPJ da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fala da clínica (score 0.593) mas a resposta não existe na base. O limiar não pega; quem tem de recusar é o modelo.

<sub>handoff: esperado sim, obtido sim · best_score 0.593 · 1141ms · 681→18 tokens · US$ 0.000592</sub>

<sub>fontes: nenhuma</sub>

### OK · `dono-da-clinica`

**Pergunta:** quem é o dono da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Os documentos citam os profissionais, não a propriedade.

<sub>handoff: esperado sim, obtido sim · best_score 0.537 · 931ms · 682→18 tokens · US$ 0.000593</sub>

<sub>fontes: nenhuma</sub>

### OK · `cardiologista`

**Pergunta:** quanto custa uma consulta com cardiologista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> É consulta e é preço, então busca alto. Mas é outra especialidade.

<sub>handoff: esperado sim, obtido sim · best_score 0.582 · 877ms · 707→18 tokens · US$ 0.000611</sub>

<sub>fontes: nenhuma</sub>

### OK · `criptomoeda`

**Pergunta:** posso pagar em criptomoeda?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base lista formas de pagamento e não inclui esta.

<sub>handoff: esperado sim, obtido sim · best_score 0.497 · 1032ms · 589→18 tokens · US$ 0.000523</sub>

<sub>fontes: nenhuma</sub>

### OK · `vaga-emprego`

**Pergunta:** vocês têm vaga de emprego para recepcionista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.403 · 889ms · 500→18 tokens · US$ 0.000456</sub>

<sub>fontes: nenhuma</sub>

### OK · `pizza`

**Pergunta:** vocês vendem pizza?

**Resposta:** Não vendemos pizza.
Posso te ajudar com algo da clínica?

> Esperava handoff porque o limiar barrava antes de chamar o LLM. O limiar deixou de barrar por decisão de produto, e chamar um colaborador para dizer que a clínica não vende pizza é o desperdício que o turno social existe para evitar. O que se cobra agora: negar sem inventar preço e sem acionar ninguém.

<sub>handoff: esperado não, obtido não · best_score 0.373 · 1036ms · 600→18 tokens · US$ 0.000531</sub>

<sub>fontes: faq.md §Formas de pagamento (0.373), servicos.md §Procedimentos e valores (0.303)</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Menor score medido na calibração (0.331).

<sub>handoff: esperado sim, obtido sim · best_score 0.331 · 926ms · 577→18 tokens · US$ 0.000514</sub>

<sub>fontes: nenhuma</sub>

### OK · `clareamento-preco-inventado`

**Pergunta:** o clareamento a laser sai por quanto?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base tem clareamento caseiro e de consultório, mas não 'a laser'. Testa se o modelo empurra um preço parecido.

<sub>handoff: esperado sim, obtido sim · best_score 0.653 · 1149ms · 705→18 tokens · US$ 0.000610</sub>

<sub>fontes: nenhuma</sub>

### OK · `prazo-implante`

**Pergunta:** em quantos dias fica pronto o implante?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base dá o preço do implante, não o prazo. Testa a regra de nunca inventar prazo.

<sub>handoff: esperado sim, obtido sim · best_score 0.548 · 876ms · 654→18 tokens · US$ 0.000572</sub>

<sub>fontes: nenhuma</sub>

### OK · `desconto`

**Pergunta:** vocês dão desconto para pagamento à vista?

**Resposta:** Não, os valores da tabela já são à vista.
Também não há desconto extra no Pix.

> Esta pergunta foi a ÚNICA a oscilar na medição de estabilidade de 5 rodadas (passou 2/5, com 3 textos distintos e variação de score zero — ou seja, puro o LLM). A causa era o documento: a base dizia que os valores são 'válidos para pagamento à vista' mas nunca falava de desconto, e o modelo não conseguia decidir se sabia ou não. O conserto foi de produto, não de código: escrever a informação que faltava no faq.md. É para isso que serve a lista de unanswered.

<sub>handoff: esperado não, obtido não · best_score 0.675 · 906ms · 643→23 tokens · US$ 0.000586</sub>

<sub>fontes: faq.md §Formas de pagamento (0.675), servicos.md §Procedimentos e valores (0.643), faq.md §Remarcação e falta (0.419)</sub>

### OK · `social-saudacao`

**Pergunta:** boa tarde

**Resposta:** Boa tarde! Tudo bem? Em que posso ajudar?

> FAMÍLIA 4, social. O caso que motivou o desvio de turno social: rodando de verdade, 'boa tarde' tirou 0.370 na busca, caiu no limiar e o bot chamou um atendente para responder a um cumprimento — e ficou mudo pelo resto da conversa, porque depois de um handoff o bot para de responder. Sem fonteEsperada de propósito: turno social não faz busca.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 596ms · 260→14 tokens · US$ 0.000258</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-agradecimento`

**Pergunta:** obrigado!

**Resposta:** Imagina! 😊 Estamos à disposição sempre que precisar.

> FAMÍLIA 4, social. Um 'obrigado' no fim do atendimento não pode reabrir a fila da equipe.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 648ms · 220→14 tokens · US$ 0.000228</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-despedida`

**Pergunta:** tchau, até mais

**Resposta:** Tchau! 😊 Quando quiser, é só chamar por aqui.

> FAMÍLIA 4, social.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 601ms · 225→16 tokens · US$ 0.000241</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-com-pergunta-junto`

**Pergunta:** boa tarde, vocês abrem no sábado?

**Resposta:** Boa tarde!
Sim, atendemos aos sábados das 8h às 12h.

> O contrário do anterior, e o mais importante dos quatro: a saudação vem grudada numa pergunta de verdade. Tem de responder a PERGUNTA, não devolver um 'oi, tudo bem?'. É o teste que pega o classificador de turno social sendo agressivo demais.

<sub>handoff: esperado não, obtido não · best_score 0.516 · 893ms · 580→23 tokens · US$ 0.000539</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.516), horarios.txt §Atendimento de urgência (0.442)</sub>
