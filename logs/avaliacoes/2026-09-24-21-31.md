# Avaliação 2026-09-24-21-31 — barbearia-do-ze

Modelo `gpt-5.4-mini` · limiar 0.424

| | |
|---|---|
| Acurácia | **90.9%** (10/11) |
| Custo total | US$ 0.003419 |
| Custo médio por pergunta | US$ 0.000311 |
| Latência média | 1115 ms |

## Regressões

Nenhuma. Nada que passava antes falhou agora.

## Falhas (1)

### FALHOU · `demo-expectativa-errada`

**Pergunta:** quanto custa a sobrancelha?

**Resposta:** Sobrancelha na navalha: R$ 20,00.

**Por que falhou:**
- `deveConter`: faltou "30"
- `fonteEsperada`: esperava atendimento.txt, citou: servicos.md, servicos.md, servicos.md

<sub>handoff: esperado não, obtido não · best_score 0.649 · 1023ms · 399→18 tokens · US$ 0.000380</sub>

<sub>fontes: servicos.md §Outros (0.649), servicos.md §Barba (0.473), servicos.md §Corte (0.445)</sub>

## Passaram (10)

### OK · `preco-corte`

**Pergunta:** quanto custa o corte?

**Resposta:** Corte masculino tradicional: R$ 45,00.
Corte na máquina, sem tesoura: R$ 35,00.
Corte infantil, até 10 anos: R$ 40,00.

<sub>handoff: esperado não, obtido não · best_score 0.755 · 1549ms · 447→49 tokens · US$ 0.000556</sub>

<sub>fontes: servicos.md §Corte (0.755), servicos.md §Barba (0.605), servicos.md §Outros (0.511), atendimento.txt §Horário (0.432)</sub>

### OK · `combo`

**Pergunta:** tem desconto se eu fizer corte e barba junto?

**Resposta:** Combo corte mais barba: R$ 75,00.
Não tenho informação sobre desconto além desse valor aqui.

<sub>handoff: esperado não, obtido não · best_score 0.681 · 1382ms · 452→26 tokens · US$ 0.000456</sub>

<sub>fontes: servicos.md §Barba (0.681), servicos.md §Corte (0.593), servicos.md §Outros (0.574), atendimento.txt §Horário (0.541)</sub>

### OK · `abre-segunda`

**Pergunta:** vocês abrem na segunda?

**Resposta:** Não, na segunda a barbearia não abre.

<sub>handoff: esperado não, obtido não · best_score 0.444 · 1244ms · 294→14 tokens · US$ 0.000284</sub>

<sub>fontes: atendimento.txt §Horário (0.444)</sub>

### OK · `aceita-credito`

**Pergunta:** posso pagar no crédito?

**Resposta:** Não aceitamos cartão de crédito.
Aceitamos dinheiro, Pix e cartão de débito.

<sub>handoff: esperado não, obtido não · best_score 0.542 · 1049ms · 277→22 tokens · US$ 0.000307</sub>

<sub>fontes: atendimento.txt §Pagamento (0.542)</sub>

### OK · `corte-feminino`

**Pergunta:** vocês cortam cabelo feminino?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.568 · 1126ms · 358→18 tokens · US$ 0.000350</sub>

<sub>fontes: nenhuma</sub>

### OK · `quanto-tempo-corte`

**Pergunta:** quanto tempo demora um corte?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.565 · 1309ms · 357→18 tokens · US$ 0.000349</sub>

<sub>fontes: nenhuma</sub>

### OK · `preco-progressiva`

**Pergunta:** quanto sai a progressiva?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.304 · 348ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>

### OK · `delivery`

**Pergunta:** vocês entregam pizza em casa?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.385 · 362ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>

### OK · `sobrancelha`

**Pergunta:** fazem sobrancelha?

**Resposta:** Sim, fazemos sobrancelha na navalha por R$ 20,00.

<sub>handoff: esperado não, obtido não · best_score 0.528 · 945ms · 284→20 tokens · US$ 0.000303</sub>

<sub>fontes: servicos.md §Outros (0.528)</sub>

### OK · `hora-marcada`

**Pergunta:** preciso marcar hora ou posso chegar e esperar?

**Resposta:** Atendemos por ordem de chegada e também com hora marcada.
Quem tem hora marcada tem preferência sobre a fila.
Para marcar, chame no WhatsApp (67) 99845-1200.

<sub>handoff: esperado não, obtido não · best_score 0.613 · 1929ms · 302→46 tokens · US$ 0.000434</sub>

<sub>fontes: atendimento.txt §Agendamento (0.613)</sub>
