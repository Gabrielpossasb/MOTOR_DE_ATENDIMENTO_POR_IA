# Como a qualidade é medida

O projeto tem **três réguas**, separadas de propósito. Juntas, todas pioram: a
determinística fica lenta e cara, e a não determinística some no ruído.

| Régua | Comando | Custo | Mede |
|---|---|---|---|
| Unitários | `npm test` | zero | comportamento do núcleo, offline |
| Suíte de qualidade | `npm run avaliar -- <slug>` | ~US$ 0,01 | pergunta isolada, contra a API real |
| Auditoria de conversa | `npm run conversas -- <slug>` | zero | a conversa inteira, lendo o banco |

As duas últimas discordam, e é para discordarem.

## `npm test`: os unitários

Offline, determinísticos, grátis, ~8 segundos, 530 testes em 20 arquivos. Rode a
cada salvamento. Embedder e LLM são sempre dublês, e **nenhum teste unitário
pode tocar a rede**.

Um teste só entra na suíte se falha por *um* motivo nomeável, se o nome descreve
comportamento e não implementação, e, quando nasce de um bug real, traz um
comentário dizendo qual era o caso.

Duas disciplinas que aparecem em quase todo arquivo:

- **Relógio e data sempre injetados.** Teste de agenda preso ao relógio real
  passa de manhã e falha à tarde.
- **Decisão de negócio tem teste offline.** O que conta como resolvido, o que é
  turno social, o que pode ir no resumo, quem pode mexer em qual agendamento:
  tudo isso mora no núcleo justamente para poder ser testado sem rede.

## `npm run avaliar`: a suíte de qualidade

Chama a API de verdade, custa ~US$ 0,01 por execução, é não determinística.
Rode depois de mexer em prompt, limiar, chunking, documentos ou modelo.

O critério de acerto são regras explícitas por pergunta, em
`data/tenants/<slug>/avaliacao.json`:

```jsonc
{
  "id": "preco-limpeza",
  "pergunta": "quanto custa a limpeza?",
  "deveConter": ["180"],        // todos precisam aparecer
  "naoPodeConter": [],          // nenhum pode aparecer
  "esperaHandoff": false,       // deve ou não pedir ajuda humana
  "fonteEsperada": "servicos.md"
}
```

Além dessas, **toda** resposta passa por uma checagem automática: qualquer valor
em reais, horário, prazo ou porcentagem citado precisa existir nos chunks
recuperados. É a verificação direta da regra "nunca invente preço, prazo,
horário ou disponibilidade", que é a que dá prejuízo. Um modelo que acerta o
texto mas troca R$ 180 por R$ 190 passa em qualquer teste de palavra-chave e
reprova aqui.

A avaliação roda com `semPersistir`, então não cria conversas nem dispara
handoffs de verdade: avaliar não pode encher a fila da equipe. Confirmado em
140 chamadas, zero linha escrita na agenda.

A mesma suíte roda pela página `/testes`, uma pergunta, um grupo ou todas, com
a estimativa de custo antes do clique.

### Expectativa cobra comportamento, não palavra

Quatro perguntas da suíte já falharam com o bot **respondendo certo**, e o
padrão é sempre o mesmo: `deveConter` e `naoPodeConter` comparam substring, e
substring não sobrevive a uma reescrita.

| expectativa | resposta correta que ela acusou |
|---|---|
| `deveConter: ["pix"]` | *"Aceitamos sim, e também dinheiro e cartão"* |
| `deveConter: ["desconto"]` | *"pelo cartão a condição já fica aplicada"* |
| `naoPodeConter: ["chave é"]` | *"quem envia a chave é a responsável"* |
| `naoPodeConter: ["entregamos em Dourados"]` | *"não entregamos em Dourados"* |

As duas últimas são o caso mais traiçoeiro: a frase proibida aparece **dentro**
da frase certa, com uma negação na frente.

Regra prática: escreva a expectativa sobre o que a resposta precisa **fazer**
(confirmar, negar, delegar, não citar valor), não sobre as palavras que você
imagina que ela vai usar. E quando a suíte acusar, leia a resposta antes de
mexer no código: metade das vezes o errado é a expectativa.

### Estabilidade: por que acurácia sozinha engana

95% acertando sempre as mesmas perguntas é uma coisa; 95% sorteando quais é
outra, bem pior, porque em produção o cliente faz a pergunta **uma vez só**.

```bash
npm run avaliar -- <slug> --repeticoes 5
```

Roda a suíte cinco vezes e gera `logs/ESTABILIDADE.md`, que mostra por pergunta
quantas vezes passou, **quantos textos distintos** o modelo produziu e a
variação do `best_score`.

Essa variação separa as duas causas possíveis de oscilação: como a mesma
pergunta gera sempre o mesmo embedding, variação acima de zero significa que os
chunks mudaram (houve reingestão); variação zero com resultado oscilante é
hesitação do LLM.

Foi essa medição que achou o bug mais sério do projeto, descrito em
[PROGRESSO.md](../PROGRESSO.md), Etapa 4: o modelo parafraseava a frase de
handoff, escapava da detecção, e a conversa ficava marcada como resolvida sem
ninguém ser chamado.

### Os relatórios

Cada relatório traz, por pergunta: passou ou falhou, **qual regra quebrou**, a
**resposta completa**, as **fontes com seus scores** e o **best_score** da
busca. E traz uma seção de **regressões**, o que passava antes e falhou agora.
É a seção mais importante, porque separa "eu piorei" de "o modelo variou".

```bash
npm run relatorio                      # histórico de todas as execuções
npm run relatorio -- preco-limpeza     # trajetória de uma pergunta
npm run relatorio -- --instaveis       # as que oscilam entre passar e falhar
```

## `npm run conversas`: a auditoria de conversa

A suíte mede **pergunta isolada**, e há defeito que só aparece ao longo de uma
conversa: pedir duas vezes o mesmo dado, afirmar preço com contexto vazio,
perder o fio. A auditoria lê o banco, não chama a API, e por isso **medir antes
e depois de mexer no prompt não custa nada**.

O **aproveitamento** é contagem, não nota: turnos sem problema grave sobre
turnos do bot. Nota composta com pesos escolhidos a dedo pareceria precisa e não
seria.

Os achados que ela sabe detectar estão em
[`src/core/conversation/auditoria.ts`](../src/core/conversation/auditoria.ts):

| Achado | O que é |
|---|---|
| `pedido_repetido` | pediu um dado que a conversa já tinha. É o que o cliente sente |
| `pedido_insistente` | repetiu o pedido antes de o cliente ter respondido |
| `afirmou_com_contexto_fraco` | citou número, preço ou horário sem nenhum trecho acima do limiar |
| `sem_fonte` | respondeu sem citar fonte, e a mensagem não era social |
| `handoff` | desistiu e chamou a equipe |
| `repetiu_informacao` | repetiu um fato numérico sem o cliente ter puxado o assunto |
| `pediu_dado_cedo_demais` | pediu endereço ou pagamento antes de existir pedido |
| `nao_somou` | o cliente pediu o total e a resposta não traz valor nenhum |
| `afirmou_ter_anotado` | disse que anotou sem ter chamado a ferramenta que anota |
| `nao_gravou_o_dado` | o cliente deu um dado novo e o bot respondeu sem gravar nada |

É um **lint, não um juiz**. A detecção é por padrão de texto e erra, então cada
achado carrega o trecho da resposta que o gerou, para uma pessoa julgar. Um
falso positivo custa uma linha para ler e descartar; o contrário, esconder um
defeito, custa cliente.

O mesmo relatório abre no `/painel`, clicando numa conversa.

### O que ela ainda não pega

Duas cegueiras conhecidas, as duas do mesmo tipo: a régua lê texto e não cruza
com o estado.

1. **Horário impossível.** Uma conversa em que o bot confirmou um horário já
   ocupado tirou 100% de aproveitamento. Bastaria consultar `horariosLivres`
   para a data e a hora citadas na resposta.
2. **Total errado.** Uma conversa que informou R$ 60,00 num pedido de R$ 110,00
   também tirou 100%. Agora que existe `produtos.json`, dá para fechar.

## O limiar de confiança não é porteiro nem juiz

`npm run calibrar` mediu, na base da clínica de exemplo, que os dois grupos de
pergunta **se sobrepõem**:

- perguntas que a base responde: scores de 0.426 a 0.733
- perguntas sem resposta na base: scores de 0.331 a 0.593

`"qual o CNPJ da clínica?"` tira 0.593 porque *fala* da clínica, só que a
resposta não existe nos documentos. Nenhum número separa os dois grupos.

O limiar já foi porteiro: abaixo dele, o bot respondia a frase de handoff sem
nem chamar o modelo. Isso saiu, porque medindo a conversa de verdade a conta não
fechava: `"boa tarde"` tirou 0.370 e chamou um atendente para responder a um
cumprimento, e, pior, o handoff deixava o bot mudo pelo resto da conversa.

Hoje ele tem papel menor e honesto: escolhe se o contexto vai ao modelo como
firme ou marcado como fraco, e alimenta o `melhorScore` que o painel mostra. A
saída seca sobrou para um caso só, tenant sem chunk nenhum indexado. Quem decide
se é para escalar é o modelo.

Rode o `calibrar` de novo sempre que trocar o modelo de embeddings ou mexer
bastante nos documentos: o número continua valendo para saber se os documentos
estão cobrindo as perguntas.
