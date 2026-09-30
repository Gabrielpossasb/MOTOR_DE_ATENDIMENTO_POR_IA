# Avaliação 2026-09-30-00-54-r5 — clinica-sorriso

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **100.0%** (28/28) |
| Custo total | US$ 0.014531 |
| Custo médio por pergunta | US$ 0.000519 |
| Latência média | 1038 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Falhas (0)

Nenhuma.

## Passaram (28)

### OK · `horario-sabado`

**Pergunta:** qual o horário de sábado?

**Resposta:** Aos sábados, o atendimento é das 8h às 12h.
Se precisar, posso te passar também os horários de urgência.

<sub>handoff: esperado não, obtido não · best_score 0.572 · 2056ms · 630→34 tokens · US$ 0.000626</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.572), horarios.txt §Atendimento de urgência (0.490), faq.md §Atendimento de emergência fora do horário (0.448), faq.md §Profissionais (0.421)</sub>

### OK · `abre-domingo`

**Pergunta:** vocês abrem domingo?

**Resposta:** Não, aos domingos a clínica não abre. Posso te ajudar com mais alguma informação?

<sub>handoff: esperado não, obtido não · best_score 0.426 · 1111ms · 451→21 tokens · US$ 0.000433</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.426)</sub>

### OK · `preco-limpeza`

**Pergunta:** quanto custa a limpeza?

**Resposta:** A limpeza (profilaxia com remoção de tártaro) custa R$ 180,00.

<sub>handoff: esperado não, obtido não · best_score 0.601 · 1028ms · 610→25 tokens · US$ 0.000570</sub>

<sub>fontes: servicos.md §Limpeza e prevenção (0.601), servicos.md §Clareamento (0.542), servicos.md §Consulta e avaliação (0.523), servicos.md §Extrações (0.489)</sub>

### OK · `preco-implante`

**Pergunta:** quanto custa um implante?

**Resposta:** Implante unitário, incluindo o pilar: R$ 3.200,00.
Ele exige avaliação prévia com tomografia, que não está inclusa no valor.

<sub>handoff: esperado não, obtido não · best_score 0.733 · 1118ms · 639→40 tokens · US$ 0.000659</sub>

<sub>fontes: servicos.md §Próteses e implantes (0.733), servicos.md §Extrações (0.523), servicos.md §Tratamento de canal (0.516), servicos.md §Consulta e avaliação (0.480)</sub>

### OK · `preco-canal-molar`

**Pergunta:** quanto custa canal em molar?

**Resposta:** Canal em molar: R$ 1.200,00.
O tratamento costuma exigir de duas a três sessões.

<sub>handoff: esperado não, obtido não · best_score 0.587 · 933ms · 457→29 tokens · US$ 0.000473</sub>

<sub>fontes: servicos.md §Tratamento de canal (0.587)</sub>

### OK · `convenio-aceito`

**Pergunta:** vocês aceitam Amil Dental?

**Resposta:** Sim, aceitamos Amil Dental.
A consulta de avaliação é sem custo para pacientes desse convênio.

<sub>handoff: esperado não, obtido não · best_score 0.664 · 980ms · 676→25 tokens · US$ 0.000620</sub>

<sub>fontes: faq.md §Convênios aceitos (0.664), servicos.md §Restaurações (0.517), servicos.md §Limpeza e prevenção (0.483), servicos.md §Próteses e implantes (0.471)</sub>

### OK · `convenio-recusado`

**Pergunta:** vocês aceitam SulAmérica Odonto?

**Resposta:** Não atendemos SulAmérica Odonto nem planos de servidor público. Se quiser, posso te informar quais convênios aceitamos.

<sub>handoff: esperado não, obtido não · best_score 0.666 · 1191ms · 631→30 tokens · US$ 0.000608</sub>

<sub>fontes: faq.md §Convênios aceitos (0.666), servicos.md §Extrações (0.454), faq.md §Profissionais (0.449), servicos.md §Restaurações (0.445)</sub>

### OK · `parcelamento`

**Pergunta:** posso parcelar no cartão?

**Resposta:** Sim, parcelamos em até 6 vezes sem juros no cartão de crédito, com valor mínimo de R$ 100,00 por parcela.

<sub>handoff: esperado não, obtido não · best_score 0.596 · 1092ms · 528→32 tokens · US$ 0.000540</sub>

<sub>fontes: servicos.md §Procedimentos e valores (0.596), faq.md §Formas de pagamento (0.592)</sub>

### OK · `endereco`

**Pergunta:** onde fica a clínica?

**Resposta:** A clínica fica na Rua das Acácias, 412, bairro Jardim dos Estados, Campo Grande - MS.
Fica a duas quadras da Avenida Afonso Pena, no mesmo quarteirão da padaria Pão Nosso.

<sub>handoff: esperado não, obtido não · best_score 0.646 · 1067ms · 637→51 tokens · US$ 0.000707</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.646), faq.md §Como agendar (0.536), horarios.txt §Endereço (0.536), faq.md §Profissionais (0.534)</sub>

### OK · `estacionamento`

**Pergunta:** tem estacionamento?

**Resposta:** Sim, temos estacionamento próprio e gratuito para pacientes, com seis vagas.

<sub>handoff: esperado não, obtido não · best_score 0.471 · 958ms · 503→17 tokens · US$ 0.000454</sub>

<sub>fontes: horarios.txt §Endereço (0.471), faq.md §Remarcação e falta (0.403)</sub>

### OK · `primeira-consulta`

**Pergunta:** o que devo levar na primeira consulta?

**Resposta:** Leve um documento com foto e, se tiver convênio, a carteirinha.
Se tiver radiografia ou tomografia recente de outro lugar, traga também.
A primeira consulta dura em média 40 minutos.

<sub>handoff: esperado não, obtido não · best_score 0.628 · 1181ms · 638→49 tokens · US$ 0.000699</sub>

<sub>fontes: faq.md §Primeira consulta (0.628), servicos.md §Consulta e avaliação (0.505), faq.md §Atendimento infantil (0.471), faq.md §Como agendar (0.447)</sub>

### OK · `atendimento-infantil`

**Pergunta:** vocês atendem criança de 5 anos?

**Resposta:** Sim, atendemos crianças a partir de 3 anos. É necessário que um responsável acompanhe durante todo o atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.656 · 901ms · 442→27 tokens · US$ 0.000453</sub>

<sub>fontes: faq.md §Atendimento infantil (0.656)</sub>

### OK · `falta-consulta`

**Pergunta:** e se eu faltar na consulta?

**Resposta:** Faltas sem aviso podem gerar cobrança de 50% do valor da consulta.
Se quiser, posso te passar também como funciona a remarcação.

<sub>handoff: esperado não, obtido não · best_score 0.595 · 1020ms · 626→35 tokens · US$ 0.000627</sub>

<sub>fontes: faq.md §Remarcação e falta (0.595), faq.md §Atendimento infantil (0.481), faq.md §Primeira consulta (0.471), faq.md §Como agendar (0.454)</sub>

### OK · `urgencia`

**Pergunta:** tenho dor de dente, consigo atendimento hoje?

**Resposta:** Se for dor aguda, tem encaixe no mesmo dia, desde que você chegue até as 17h nos dias de semana ou até as 11h no sábado.

<sub>handoff: esperado não, obtido não · best_score 0.589 · 1543ms · 670→39 tokens · US$ 0.000678</sub>

<sub>fontes: horarios.txt §Atendimento de urgência (0.589), faq.md §Convênios aceitos (0.580), faq.md §Profissionais (0.573), servicos.md §Tratamento de canal (0.517)</sub>

### OK · `cnpj`

**Pergunta:** qual o CNPJ da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fala da clínica (score 0.593) mas a resposta não existe na base. O limiar não pega; quem tem de recusar é o modelo.

<sub>handoff: esperado sim, obtido sim · best_score 0.593 · 983ms · 621→18 tokens · US$ 0.000547</sub>

<sub>fontes: nenhuma</sub>

### OK · `dono-da-clinica`

**Pergunta:** quem é o dono da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Os documentos citam os profissionais, não a propriedade.

<sub>handoff: esperado sim, obtido sim · best_score 0.537 · 926ms · 622→18 tokens · US$ 0.000548</sub>

<sub>fontes: nenhuma</sub>

### OK · `cardiologista`

**Pergunta:** quanto custa uma consulta com cardiologista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> É consulta e é preço, então busca alto. Mas é outra especialidade.

<sub>handoff: esperado sim, obtido sim · best_score 0.582 · 903ms · 647→18 tokens · US$ 0.000566</sub>

<sub>fontes: nenhuma</sub>

### OK · `criptomoeda`

**Pergunta:** posso pagar em criptomoeda?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base lista formas de pagamento e não inclui esta.

<sub>handoff: esperado sim, obtido sim · best_score 0.497 · 872ms · 529→18 tokens · US$ 0.000478</sub>

<sub>fontes: nenhuma</sub>

### OK · `vaga-emprego`

**Pergunta:** vocês têm vaga de emprego para recepcionista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.403 · 1014ms · 440→18 tokens · US$ 0.000411</sub>

<sub>fontes: nenhuma</sub>

### OK · `pizza`

**Pergunta:** vocês vendem pizza?

**Resposta:** Não vendemos pizza. Posso te ajudar com algo da clínica?

> Esperava handoff porque o limiar barrava antes de chamar o LLM. O limiar deixou de barrar por decisão de produto, e chamar um colaborador para dizer que a clínica não vende pizza é o desperdício que o turno social existe para evitar. O que se cobra agora: negar sem inventar preço e sem acionar ninguém.

<sub>handoff: esperado não, obtido não · best_score 0.373 · 972ms · 540→17 tokens · US$ 0.000482</sub>

<sub>fontes: faq.md §Formas de pagamento (0.373), servicos.md §Procedimentos e valores (0.303)</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Menor score medido na calibração (0.331).

<sub>handoff: esperado sim, obtido sim · best_score 0.331 · 992ms · 517→18 tokens · US$ 0.000469</sub>

<sub>fontes: nenhuma</sub>

### OK · `clareamento-preco-inventado`

**Pergunta:** o clareamento a laser sai por quanto?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base tem clareamento caseiro e de consultório, mas não 'a laser'. Testa se o modelo empurra um preço parecido.

<sub>handoff: esperado sim, obtido sim · best_score 0.653 · 1034ms · 645→18 tokens · US$ 0.000565</sub>

<sub>fontes: nenhuma</sub>

### OK · `prazo-implante`

**Pergunta:** em quantos dias fica pronto o implante?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base dá o preço do implante, não o prazo. Testa a regra de nunca inventar prazo.

<sub>handoff: esperado sim, obtido sim · best_score 0.548 · 908ms · 594→18 tokens · US$ 0.000527</sub>

<sub>fontes: nenhuma</sub>

### OK · `desconto`

**Pergunta:** vocês dão desconto para pagamento à vista?

**Resposta:** Os valores da tabela já são os de pagamento à vista, então não há desconto adicional por pagar à vista ou em Pix.

> Esta pergunta foi a ÚNICA a oscilar na medição de estabilidade de 5 rodadas (passou 2/5, com 3 textos distintos e variação de score zero — ou seja, puro o LLM). A causa era o documento: a base dizia que os valores são 'válidos para pagamento à vista' mas nunca falava de desconto, e o modelo não conseguia decidir se sabia ou não. O conserto foi de produto, não de código: escrever a informação que faltava no faq.md. É para isso que serve a lista de unanswered.

<sub>handoff: esperado não, obtido não · best_score 0.675 · 1034ms · 583→28 tokens · US$ 0.000563</sub>

<sub>fontes: faq.md §Formas de pagamento (0.675), servicos.md §Procedimentos e valores (0.643), faq.md §Remarcação e falta (0.419)</sub>

### OK · `social-saudacao`

**Pergunta:** boa tarde

**Resposta:** Boa tarde! Como posso te ajudar hoje?

> FAMÍLIA 4, social. O caso que motivou o desvio de turno social: rodando de verdade, 'boa tarde' tirou 0.370 na busca, caiu no limiar e o bot chamou um atendente para responder a um cumprimento — e ficou mudo pelo resto da conversa, porque depois de um handoff o bot para de responder. Sem fonteEsperada de propósito: turno social não faz busca.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 891ms · 211→12 tokens · US$ 0.000212</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-agradecimento`

**Pergunta:** obrigado!

**Resposta:** Eu que agradeço! 😊 Fico à disposição sempre que precisar.

> FAMÍLIA 4, social. Um 'obrigado' no fim do atendimento não pode reabrir a fila da equipe.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 737ms · 209→17 tokens · US$ 0.000233</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-despedida`

**Pergunta:** tchau, até mais

**Resposta:** Tchau! Até mais, e quando quiser, é só chamar 😊

> FAMÍLIA 4, social.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 652ms · 214→17 tokens · US$ 0.000237</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-com-pergunta-junto`

**Pergunta:** boa tarde, vocês abrem no sábado?

**Resposta:** Boa tarde! Sim, atendemos aos sábados das 8h às 12h.
Se precisar, posso te ajudar com mais alguma informação.

> O contrário do anterior, e o mais importante dos quatro: a saudação vem grudada numa pergunta de verdade. Tem de responder a PERGUNTA, não devolver um 'oi, tudo bem?'. É o teste que pega o classificador de turno social sendo agressivo demais.

<sub>handoff: esperado não, obtido não · best_score 0.516 · 963ms · 520→34 tokens · US$ 0.000543</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.516), horarios.txt §Atendimento de urgência (0.442)</sub>
