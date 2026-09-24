# Avaliação 2026-09-24-03-54-r5 — clinica-sorriso

Modelo `gpt-5.4-mini` · limiar 0.4

| | |
|---|---|
| Acurácia | **100.0%** (24/24) |
| Custo total | US$ 0.010042 |
| Custo médio por pergunta | US$ 0.000418 |
| Latência média | 931 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Falhas (0)

Nenhuma.

## Passaram (24)

### OK · `horario-sabado`

**Pergunta:** qual o horário de sábado?

**Resposta:** Aos sábados, o atendimento é das 8h às 12h.

<sub>handoff: esperado não, obtido não · best_score 0.572 · 887ms · 498→20 tokens · US$ 0.000464</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.572), horarios.txt §Atendimento de urgência (0.490), faq.md §Atendimento de emergência fora do horário (0.448), faq.md §Profissionais (0.421)</sub>

### OK · `abre-domingo`

**Pergunta:** vocês abrem domingo?

**Resposta:** Não, aos domingos a clínica não abre.

<sub>handoff: esperado não, obtido não · best_score 0.426 · 943ms · 319→12 tokens · US$ 0.000293</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.426)</sub>

### OK · `preco-limpeza`

**Pergunta:** quanto custa a limpeza?

**Resposta:** A limpeza (profilaxia com remoção de tártaro) custa R$ 180,00.

<sub>handoff: esperado não, obtido não · best_score 0.601 · 887ms · 478→25 tokens · US$ 0.000471</sub>

<sub>fontes: servicos.md §Limpeza e prevenção (0.601), servicos.md §Clareamento (0.542), servicos.md §Consulta e avaliação (0.523), servicos.md §Extrações (0.489)</sub>

### OK · `preco-implante`

**Pergunta:** quanto custa um implante?

**Resposta:** Implante unitário, incluindo o pilar: R$ 3.200,00.
O implante exige avaliação prévia com tomografia, que não está inclusa no valor.

<sub>handoff: esperado não, obtido não · best_score 0.733 · 1232ms · 507→42 tokens · US$ 0.000569</sub>

<sub>fontes: servicos.md §Próteses e implantes (0.733), servicos.md §Extrações (0.523), servicos.md §Tratamento de canal (0.516), servicos.md §Consulta e avaliação (0.480)</sub>

### OK · `preco-canal-molar`

**Pergunta:** quanto custa canal em molar?

**Resposta:** Canal em molar: R$ 1.200,00.
O tratamento de canal costuma exigir de duas a três sessões.

<sub>handoff: esperado não, obtido não · best_score 0.587 · 963ms · 325→31 tokens · US$ 0.000383</sub>

<sub>fontes: servicos.md §Tratamento de canal (0.587)</sub>

### OK · `convenio-aceito`

**Pergunta:** vocês aceitam Amil Dental?

**Resposta:** Sim, aceitamos Amil Dental.
Para esse convênio, a consulta de avaliação é sem custo para o paciente.

<sub>handoff: esperado não, obtido não · best_score 0.664 · 958ms · 544→28 tokens · US$ 0.000534</sub>

<sub>fontes: faq.md §Convênios aceitos (0.664), servicos.md §Restaurações (0.518), servicos.md §Limpeza e prevenção (0.484), servicos.md §Próteses e implantes (0.472)</sub>

### OK · `convenio-recusado`

**Pergunta:** vocês aceitam SulAmérica Odonto?

**Resposta:** Não atendemos SulAmérica Odonto nem planos de servidor público.

<sub>handoff: esperado não, obtido não · best_score 0.666 · 953ms · 499→17 tokens · US$ 0.000451</sub>

<sub>fontes: faq.md §Convênios aceitos (0.666), servicos.md §Extrações (0.454), faq.md §Profissionais (0.449), servicos.md §Restaurações (0.445)</sub>

### OK · `parcelamento`

**Pergunta:** posso parcelar no cartão?

**Resposta:** Sim, parcelamos em até 6 vezes no cartão de crédito, sem juros.

<sub>handoff: esperado não, obtido não · best_score 0.596 · 931ms · 396→20 tokens · US$ 0.000387</sub>

<sub>fontes: servicos.md §Procedimentos e valores (0.596), faq.md §Formas de pagamento (0.592)</sub>

### OK · `endereco`

**Pergunta:** onde fica a clínica?

**Resposta:** Rua das Acácias, 412, bairro Jardim dos Estados, Campo Grande - MS.
Fica a duas quadras da Avenida Afonso Pena, no mesmo quarteirão da padaria Pão Nosso.

<sub>handoff: esperado não, obtido não · best_score 0.646 · 1111ms · 505→46 tokens · US$ 0.000586</sub>

<sub>fontes: horarios.txt §Horário de atendimento (0.646), faq.md §Como agendar (0.536), horarios.txt §Endereço (0.536), faq.md §Profissionais (0.534)</sub>

### OK · `estacionamento`

**Pergunta:** tem estacionamento?

**Resposta:** Sim, temos estacionamento próprio e gratuito para pacientes, com seis vagas.

<sub>handoff: esperado não, obtido não · best_score 0.471 · 943ms · 371→17 tokens · US$ 0.000355</sub>

<sub>fontes: horarios.txt §Endereço (0.471), faq.md §Remarcação e falta (0.403)</sub>

### OK · `primeira-consulta`

**Pergunta:** o que devo levar na primeira consulta?

**Resposta:** Traga um documento com foto e, se tiver convênio, a carteirinha.
Se você já fez radiografia ou tomografia recente em outro lugar, traga também.
A primeira consulta dura em média 40 minutos.

<sub>handoff: esperado não, obtido não · best_score 0.628 · 1008ms · 506→51 tokens · US$ 0.000609</sub>

<sub>fontes: faq.md §Primeira consulta (0.628), servicos.md §Consulta e avaliação (0.505), faq.md §Atendimento infantil (0.471), faq.md §Como agendar (0.447)</sub>

### OK · `atendimento-infantil`

**Pergunta:** vocês atendem criança de 5 anos?

**Resposta:** Sim, atendemos crianças a partir de 3 anos.
É necessário que um responsável acompanhe a criança durante todo o atendimento.

<sub>handoff: esperado não, obtido não · best_score 0.656 · 990ms · 310→30 tokens · US$ 0.000368</sub>

<sub>fontes: faq.md §Atendimento infantil (0.656)</sub>

### OK · `falta-consulta`

**Pergunta:** e se eu faltar na consulta?

**Resposta:** Faltas sem aviso podem gerar cobrança de 50% do valor da consulta.
Se quiser, posso te passar também a regra de remarcação.

<sub>handoff: esperado não, obtido não · best_score 0.595 · 1093ms · 494→35 tokens · US$ 0.000528</sub>

<sub>fontes: faq.md §Remarcação e falta (0.595), faq.md §Atendimento infantil (0.481), faq.md §Primeira consulta (0.471), faq.md §Como agendar (0.454)</sub>

### OK · `urgencia`

**Pergunta:** tenho dor de dente, consigo atendimento hoje?

**Resposta:** Casos de dor aguda têm encaixe no mesmo dia, desde que você chegue até as 17h nos dias de semana ou até as 11h no sábado.
Fora desses horários, não há plantão.

<sub>handoff: esperado não, obtido não · best_score 0.589 · 1006ms · 538→50 tokens · US$ 0.000629</sub>

<sub>fontes: horarios.txt §Atendimento de urgência (0.589), faq.md §Convênios aceitos (0.580), faq.md §Profissionais (0.573), servicos.md §Tratamento de canal (0.517)</sub>

### OK · `cnpj`

**Pergunta:** qual o CNPJ da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.593 · 1281ms · 489→18 tokens · US$ 0.000448</sub>

<sub>fontes: nenhuma</sub>

### OK · `dono-da-clinica`

**Pergunta:** quem é o dono da clínica?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.537 · 938ms · 490→18 tokens · US$ 0.000449</sub>

<sub>fontes: nenhuma</sub>

### OK · `cardiologista`

**Pergunta:** quanto custa uma consulta com cardiologista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.582 · 975ms · 515→18 tokens · US$ 0.000467</sub>

<sub>fontes: nenhuma</sub>

### OK · `criptomoeda`

**Pergunta:** posso pagar em criptomoeda?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.497 · 902ms · 397→18 tokens · US$ 0.000379</sub>

<sub>fontes: nenhuma</sub>

### OK · `vaga-emprego`

**Pergunta:** vocês têm vaga de emprego para recepcionista?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.403 · 906ms · 308→18 tokens · US$ 0.000312</sub>

<sub>fontes: nenhuma</sub>

### OK · `pizza`

**Pergunta:** vocês vendem pizza?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.373 · 274ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>

### OK · `previsao-tempo`

**Pergunta:** qual a previsão do tempo amanhã?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.331 · 277ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>

### OK · `clareamento-preco-inventado`

**Pergunta:** o clareamento a laser sai por quanto?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.653 · 948ms · 513→18 tokens · US$ 0.000466</sub>

<sub>fontes: nenhuma</sub>

### OK · `prazo-implante`

**Pergunta:** em quantos dias fica pronto o implante?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.548 · 955ms · 462→18 tokens · US$ 0.000428</sub>

<sub>fontes: nenhuma</sub>

### OK · `desconto`

**Pergunta:** vocês dão desconto para pagamento à vista?

**Resposta:** Os valores da tabela já são os de pagamento à vista, então não há desconto adicional por pagar à vista ou em Pix.

<sub>handoff: esperado não, obtido não · best_score 0.675 · 990ms · 451→28 tokens · US$ 0.000464</sub>

<sub>fontes: faq.md §Formas de pagamento (0.675), servicos.md §Procedimentos e valores (0.643), faq.md §Remarcação e falta (0.419)</sub>
