# Estabilidade — polpa-santa-helena · gpt-5.4-mini

3 execuções da mesma suíte de 26 perguntas.

| | |
|---|---|
| Acurácia média | **83.3%** |
| Estabilidade | **92.3%** (24/26 sempre iguais) |
| Sempre passaram | 21 |
| Sempre falharam | 3 |
| **Oscilaram** | **2** |
| Custo total | US$ 0.054945 |

## Perguntas que oscilaram

São a fronteira em que o modelo hesita. Mexer no prompt, no limiar ou nos documentos rende mais aqui do que em qualquer outro lugar.

| Pergunta | Passou | Respostas distintas | Variação do score |
|---|---|---|---|
| `pao-de-queijo` | 1/3 | 2 | 0.000 |
| `pedido-torto` | 1/3 | 2 | 0.000 |

## Todas as perguntas

| Pergunta | Passou | Respostas distintas | Variação do score |
|---|---|---|---|
| `pao-de-queijo` **oscila** | 1/3 | 2 | 0.000 |
| `pedido-torto` **oscila** | 1/3 | 2 | 0.000 |
| `quantos-pacotes` (sempre falha) | 0/3 | 1 | 0.000 |
| `bairros` (sempre falha) | 0/3 | 3 | 0.000 |
| `conserta-geladeira` (sempre falha) | 0/3 | 1 | 0.000 |
| `preco-acai` | 3/3 | 1 | 0.000 |
| `preco-goiaba` | 3/3 | 2 | 0.000 |
| `preco-uva` | 3/3 | 2 | 0.000 |
| `sabores` | 3/3 | 2 | 0.000 |
| `acai-2l` | 3/3 | 3 | 0.000 |
| `taxa-entrega-1kg` | 3/3 | 2 | 0.000 |
| `entrega-gratis` | 3/3 | 2 | 0.000 |
| `pagamento` | 3/3 | 1 | 0.000 |
| `retirar` | 3/3 | 3 | 0.000 |
| `conservacao` | 3/3 | 2 | 0.000 |
| `rende-quanto` | 3/3 | 1 | 0.000 |
| `conservante` | 3/3 | 3 | 0.000 |
| `instagram` | 3/3 | 1 | 0.000 |
| `polpa-manga` | 3/3 | 1 | 0.000 |
| `desconto-atacado` | 3/3 | 1 | 0.000 |
| `prazo-validade` | 3/3 | 1 | 0.000 |
| `horario-entrega` | 3/3 | 3 | 0.000 |
| `cnpj` | 3/3 | 1 | 0.000 |
| `previsao-tempo` | 3/3 | 1 | 0.000 |
| `saudacao-alongada` | 3/3 | 1 | 0.000 |
| `agradecimento` | 3/3 | 1 | 0.000 |

<sub>A **variação do score** mede a busca, não o modelo: a mesma pergunta gera sempre o mesmo embedding, então variação acima de zero indica que os chunks mudaram entre as execuções — normalmente porque houve reingestão.</sub>