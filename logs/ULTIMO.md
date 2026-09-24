# Avaliação 2026-09-24-12-52 — barbearia-do-ze

Modelo `gpt-5.4-mini` · limiar 0.424

| | |
|---|---|
| Acurácia | **100.0%** (8/8) |
| Custo total | US$ 0.002315 |
| Custo médio por pergunta | US$ 0.000289 |
| Latência média | 1137 ms |

> Primeira execução para este tenant: não há com o que comparar.

## Falhas (0)

Nenhuma.

## Passaram (8)

### OK · `preco-corte`

**Pergunta:** quanto custa o corte?

**Resposta:** Corte masculino tradicional: R$ 45,00.
Corte na máquina, sem tesoura: R$ 35,00.
Corte infantil, até 10 anos: R$ 40,00.

<sub>handoff: esperado não, obtido não · best_score 0.755 · 1813ms · 447→49 tokens · US$ 0.000556</sub>

<sub>fontes: servicos.md §Corte (0.755), servicos.md §Barba (0.605), servicos.md §Outros (0.511), atendimento.txt §Horário (0.432)</sub>

### OK · `combo`

**Pergunta:** tem desconto se eu fizer corte e barba junto?

**Resposta:** Combo corte mais barba: R$ 75,00.
Não tenho informação sobre desconto além desse valor aqui.

<sub>handoff: esperado não, obtido não · best_score 0.681 · 1744ms · 452→26 tokens · US$ 0.000456</sub>

<sub>fontes: servicos.md §Barba (0.681), servicos.md §Corte (0.593), servicos.md §Outros (0.574), atendimento.txt §Horário (0.541)</sub>

### OK · `abre-segunda`

**Pergunta:** vocês abrem na segunda?

**Resposta:** Não, na segunda a barbearia não abre.

<sub>handoff: esperado não, obtido não · best_score 0.444 · 1100ms · 294→14 tokens · US$ 0.000284</sub>

<sub>fontes: atendimento.txt §Horário (0.444)</sub>

### OK · `aceita-credito`

**Pergunta:** posso pagar no crédito?

**Resposta:** Não aceitamos cartão de crédito nem parcelamos.
Aceitamos dinheiro, Pix e cartão de débito.

<sub>handoff: esperado não, obtido não · best_score 0.542 · 1244ms · 277→25 tokens · US$ 0.000320</sub>

<sub>fontes: atendimento.txt §Pagamento (0.542)</sub>

### OK · `corte-feminino`

**Pergunta:** vocês cortam cabelo feminino?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.568 · 1338ms · 358→18 tokens · US$ 0.000350</sub>

<sub>fontes: nenhuma</sub>

### OK · `quanto-tempo-corte`

**Pergunta:** quanto tempo demora um corte?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.565 · 1080ms · 357→18 tokens · US$ 0.000349</sub>

<sub>fontes: nenhuma</sub>

### OK · `preco-progressiva`

**Pergunta:** quanto sai a progressiva?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.304 · 376ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>

### OK · `delivery`

**Pergunta:** vocês entregam pizza em casa?

**Resposta:** Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.

<sub>handoff: esperado sim, obtido sim · best_score 0.385 · 403ms · 0→0 tokens · US$ 0.000000</sub>

<sub>fontes: nenhuma</sub>
