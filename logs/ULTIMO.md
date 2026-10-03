# Avaliação 2026-10-03-01-04-r5 — clinica-sorriso

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **100.0%** (28/28) |
| Custo total | US$ 0.014752 |
| Custo médio por pergunta | US$ 0.000527 |
| Latência média | 1097 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Falhas (0)

Nenhuma.

## Passaram (28)

### OK · `horario-sabado`

**Pergunta:** qual o horário de sábado?

**Resposta:** Aos sábados, o atendimento é das 8h às 12h.
Se precisar, posso te passar também os horários de urgência.

<sub>handoff: esperado não, obtido não · best_score 0.572 · 1046ms · 638→34 tokens · US$ 0.000632</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.572), horarios.txt §Atendimento de urgência (0.490), faq.md §Atendimento de emergência fora do horário (0.448), faq.md §Profissionais (0.421)</sub>

### OK · `abre-domingo`

**Pergunta:** vocês abrem domingo?

**Resposta:** Não, aos domingos a clínica não abre.
Se precisar, posso te passar o horário de atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.426 · 1195ms · 459→24 tokens · US$ 0.000452</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.426)</sub>

### OK · `preco-limpeza`

**Pergunta:** quanto custa a limpeza?

**Resposta:** A limpeza (profilaxia com remoção de tártaro) custa R$ 180,00.

<sub>handoff: esperado não, obtido não · best_score 0.601 · 1104ms · 618→25 tokens · US$ 0.000576</sub>

<sub>fontes: servicos.md §Limpeza e prevenção (0.601), servicos.md §Clareamento (0.542), servicos.md §Consulta e avaliação (0.523), servicos.md §Extrações (0.489)</sub>

### OK · `preco-implante`

**Pergunta:** quanto custa um implante?

**Resposta:** Implante unitário, incluindo o pilar: R$ 3.200,00.
Ele exige avaliação prévia com tomografia, que não está inclusa no valor.

<sub>handoff: esperado não, obtido não · best_score 0.733 · 1038ms · 647→40 tokens · US$ 0.000665</sub>

<sub>fontes: servicos.md §Próteses e implantes (0.733), servicos.md §Extrações (0.523), servicos.md §Tratamento de canal (0.516), servicos.md §Consulta e avaliação (0.480)</sub>

### OK · `preco-canal-molar`

**Pergunta:** quanto custa canal em molar?

**Resposta:** Canal em molar: R$ 1.200,00.
O tratamento de canal costuma exigir de duas a três sessões.

<sub>handoff: esperado não, obtido não · best_score 0.587 · 1013ms · 465→31 tokens · US$ 0.000488</sub>

<sub>fontes: servicos.md §Tratamento de canal (0.587)</sub>

### OK · `convenio-aceito`

**Pergunta:** vocês aceitam Amil Dental?

**Resposta:** Sim, aceitamos Amil Dental.
A consulta de avaliação é sem custo para esse convênio.

<sub>handoff: esperado não, obtido não · best_score 0.664 · 1167ms · 684→24 tokens · US$ 0.000621</sub>

<sub>fontes: faq.md §Convênios aceitos (0.664), servicos.md §Restaurações (0.518), servicos.md §Limpeza e prevenção (0.484), servicos.md §Próteses e implantes (0.472)</sub>

### OK · `convenio-recusado`

**Pergunta:** vocês aceitam SulAmérica Odonto?

**Resposta:** Não atendemos SulAmérica Odonto nem planos de servidor público. Se o seu plano não está nesta lista, o atendimento é como particular.

<sub>handoff: esperado não, obtido não · best_score 0.666 · 1034ms · 639→32 tokens · US$ 0.000623</sub>

<sub>fontes: faq.md §Convênios aceitos (0.666), servicos.md §Extrações (0.454), faq.md §Profissionais (0.449), servicos.md §Restaurações (0.445)</sub>

### OK · `parcelamento`

**Pergunta:** posso parcelar no cartão?

**Resposta:** Sim, parcelamos em até 6 vezes no cartão de crédito, sem juros.

<sub>handoff: esperado não, obtido não · best_score 0.596 · 975ms · 536→20 tokens · US$ 0.000492</sub>

<sub>fontes: servicos.md §Procedimentos e valores (0.596), faq.md §Formas de pagamento (0.592)</sub>

### OK · `endereco`

**Pergunta:** onde fica a clínica?

**Resposta:** A clínica fica na Rua das Acácias, 412, bairro Jardim dos Estados, Campo Grande - MS.
Fica a duas quadras da Avenida Afonso Pena, no mesmo quarteirão da padaria Pão Nosso.

<sub>handoff: esperado não, obtido não · best_score 0.646 · 1333ms · 645→51 tokens · US$ 0.000713</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.646), faq.md §Como agendar (0.536), horarios.txt §Endereço (0.536), faq.md §Profissionais (0.534)</sub>

### OK · `estacionamento`

**Pergunta:** tem estacionamento?

**Resposta:** Sim, temos estacionamento próprio e gratuito para pacientes, com seis vagas.

<sub>handoff: esperado não, obtido não · best_score 0.471 · 963ms · 511→17 tokens · US$ 0.000460</sub>

<sub>fontes: horarios.txt §Endereço (0.471), faq.md §Remarcação e falta (0.403)</sub>

### OK · `primeira-consulta`

**Pergunta:** o que devo levar na primeira consulta?

**Resposta:** Traga um documento com foto e, se tiver convênio, a carteirinha.
Se você já fez radiografia ou tomografia recente em outro lugar, traga também.
A primeira consulta dura em média 40 minutos.

<sub>handoff: esperado não, obtido não · best_score 0.628 · 1457ms · 646→51 tokens · US$ 0.000714</sub>

<sub>fontes: faq.md §Primeira consulta (0.628), servicos.md §Consulta e avaliação (0.505), faq.md §Atendimento infantil (0.471), faq.md §Como agendar (0.447)</sub>

### OK · `atendimento-infantil`

**Pergunta:** vocês atendem criança de 5 anos?

**Resposta:** Sim, atendemos crianças a partir de 3 anos. É necessário que um responsável acompanhe durante todo o atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.656 · 1043ms · 450→27 tokens · US$ 0.000459</sub>

<sub>fontes: faq.md §Atendimento infantil (0.656)</sub>

### OK · `falta-consulta`

**Pergunta:** e se eu faltar na consulta?

**Resposta:** Faltas sem aviso podem gerar cobrança de 50% do valor da consulta.
Se quiser, posso te passar também como funciona a remarcação.

<sub>handoff: esperado não, obtido não · best_score 0.595 · 1140ms · 634→35 tokens · US$ 0.000633</sub>

<sub>fontes: faq.md §Remarcação e falta (0.595), faq.md §Atendimento infantil (0.481), faq.md §Primeira consulta (0.471), faq.md §Como agendar (0.454)</sub>

### OK · `urgencia`

**Pergunta:** tenho dor de dente, consigo atendimento hoje?

**Resposta:** Sim, casos de dor aguda têm encaixe no mesmo dia, se você chegar até as 17h nos dias de semana ou até as 11h no sábado.
Se quiser, me diga que horas você consegue vir.

<sub>handoff: esperado não, obtido não · best_score 0.589 · 1141ms · 678→50 tokens · US$ 0.000734</sub>

<sub>fontes: horarios.txt §Atendimento de urgência (0.589), faq.md §Convênios aceitos (0.580), faq.md §Profissionais (0.573), servicos.md §Tratamento de canal (0.517)</sub>

### OK · `cnpj`

**Pergunta:** qual o CNPJ da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Fala da clínica (score 0.593) mas a resposta não existe na base. O limiar não pega; quem tem de recusar é o modelo.

<sub>handoff: esperado sim, obtido sim · best_score 0.593 · 1079ms · 629→18 tokens · US$ 0.000553</sub>

<sub>fontes: nenhuma</sub>

### OK · `dono-da-clinica`

**Pergunta:** quem é o dono da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Os documentos citam os profissionais, não a propriedade.

<sub>handoff: esperado sim, obtido sim · best_score 0.537 · 1005ms · 630→18 tokens · US$ 0.000554</sub>

<sub>fontes: nenhuma</sub>

### OK · `cardiologista`

**Pergunta:** quanto custa uma consulta com cardiologista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> É consulta e é preço, então busca alto. Mas é outra especialidade.

<sub>handoff: esperado sim, obtido sim · best_score 0.582 · 1193ms · 655→18 tokens · US$ 0.000572</sub>

<sub>fontes: nenhuma</sub>

### OK · `criptomoeda`

**Pergunta:** posso pagar em criptomoeda?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base lista formas de pagamento e não inclui esta.

<sub>handoff: esperado sim, obtido sim · best_score 0.497 · 1003ms · 537→18 tokens · US$ 0.000484</sub>

<sub>fontes: nenhuma</sub>

### OK · `vaga-emprego`

**Pergunta:** vocês têm vaga de emprego para recepcionista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.403 · 1105ms · 448→18 tokens · US$ 0.000417</sub>

<sub>fontes: nenhuma</sub>

### OK · `pizza`

**Pergunta:** vocês vendem pizza?

**Resposta:** Oi! Não vendemos pizza. Em que posso te ajudar?

> Esperava handoff porque o limiar barrava antes de chamar o LLM. O limiar deixou de barrar por decisão de produto, e chamar um colaborador para dizer que a clínica não vende pizza é o desperdício que o turno social existe para evitar. O que se cobra agora: negar sem inventar preço e sem acionar ninguém.

<sub>handoff: esperado não, obtido não · best_score 0.373 · 1514ms · 548→16 tokens · US$ 0.000483</sub>

<sub>fontes: faq.md §Formas de pagamento (0.373), servicos.md §Procedimentos e valores (0.303)</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> Menor score medido na calibração (0.331).

<sub>handoff: esperado sim, obtido sim · best_score 0.331 · 1927ms · 525→18 tokens · US$ 0.000475</sub>

<sub>fontes: nenhuma</sub>

### OK · `clareamento-preco-inventado`

**Pergunta:** o clareamento a laser sai por quanto?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base tem clareamento caseiro e de consultório, mas não 'a laser'. Testa se o modelo empurra um preço parecido.

<sub>handoff: esperado sim, obtido sim · best_score 0.653 · 990ms · 653→18 tokens · US$ 0.000571</sub>

<sub>fontes: nenhuma</sub>

### OK · `prazo-implante`

**Pergunta:** em quantos dias fica pronto o implante?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

> A base dá o preço do implante, não o prazo. Testa a regra de nunca inventar prazo.

<sub>handoff: esperado sim, obtido sim · best_score 0.548 · 914ms · 602→18 tokens · US$ 0.000533</sub>

<sub>fontes: nenhuma</sub>

### OK · `desconto`

**Pergunta:** vocês dão desconto para pagamento à vista?

**Resposta:** Os valores da tabela já são os de pagamento à vista, então não há desconto adicional por pagar à vista ou em Pix.

> Esta pergunta foi a ÚNICA a oscilar na medição de estabilidade de 5 rodadas (passou 2/5, com 3 textos distintos e variação de score zero — ou seja, puro o LLM). A causa era o documento: a base dizia que os valores são 'válidos para pagamento à vista' mas nunca falava de desconto, e o modelo não conseguia decidir se sabia ou não. O conserto foi de produto, não de código: escrever a informação que faltava no faq.md. É para isso que serve a lista de unanswered.

<sub>handoff: esperado não, obtido não · best_score 0.675 · 1008ms · 591→28 tokens · US$ 0.000569</sub>

<sub>fontes: faq.md §Formas de pagamento (0.675), servicos.md §Procedimentos e valores (0.643), faq.md §Remarcação e falta (0.419)</sub>

### OK · `social-saudacao`

**Pergunta:** boa tarde

**Resposta:** Boa tarde! Tudo bem? Em que posso ajudar?

> FAMÍLIA 4, social. O caso que motivou o desvio de turno social: rodando de verdade, 'boa tarde' tirou 0.370 na busca, caiu no limiar e o bot chamou um atendente para responder a um cumprimento — e ficou mudo pelo resto da conversa, porque depois de um handoff o bot para de responder. Sem fonteEsperada de propósito: turno social não faz busca.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 801ms · 260→14 tokens · US$ 0.000258</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-agradecimento`

**Pergunta:** obrigado!

**Resposta:** Eu que agradeço! 😊 Fico à disposição sempre que precisar.

> FAMÍLIA 4, social. Um 'obrigado' no fim do atendimento não pode reabrir a fila da equipe.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 643ms · 220→17 tokens · US$ 0.000242</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-despedida`

**Pergunta:** tchau, até mais

**Resposta:** Tchau! Fique à vontade para voltar quando quiser 😊

> FAMÍLIA 4, social.

<sub>handoff: esperado não, obtido não · best_score 0.000 · 633ms · 225→15 tokens · US$ 0.000236</sub>

<sub>fontes: nenhuma</sub>

### OK · `social-com-pergunta-junto`

**Pergunta:** boa tarde, vocês abrem no sábado?

**Resposta:** Boa tarde! Sim, atendemos aos sábados das 8h às 12h.
Se precisar, posso te passar mais informações.

> O contrário do anterior, e o mais importante dos quatro: a saudação vem grudada numa pergunta de verdade. Tem de responder a PERGUNTA, não devolver um 'oi, tudo bem?'. É o teste que pega o classificador de turno social sendo agressivo demais.

<sub>handoff: esperado não, obtido não · best_score 0.516 · 1252ms · 528→32 tokens · US$ 0.000540</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.516), horarios.txt §Atendimento de urgência (0.442)</sub>
