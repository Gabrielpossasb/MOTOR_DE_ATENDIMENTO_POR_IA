# Como colocar um cliente novo no motor

```bash
npm run novo-tenant -- barbearia-do-ze "Barbearia do Zé"
```

Cria `data/tenants/barbearia-do-ze/` com `tenant.json`, `avaliacao.json` e um
`_LEIA-ME.md` explicando o que escrever em cada lugar. O comando **não
sobrescreve** uma pasta existente: perder a avaliação de um cliente por um
comando repetido sem querer seria caro.

Depois:

1. Jogue os documentos do cliente (`.txt` e `.md`) na pasta.
2. Ajuste `promptDoSistema` e, se o negócio marca horário, o bloco `agenda` do
   `tenant.json`.
3. Escreva em `avaliacao.json` as perguntas que os clientes fazem de verdade.
4. Rode:

```bash
npm run seed     -- barbearia-do-ze
npm run ingest   -- barbearia-do-ze
npm run calibrar -- barbearia-do-ze                 # escolhe o limiar com dado
npm run avaliar  -- barbearia-do-ze --repeticoes 5  # mede qualidade e estabilidade
```

## O que entra na busca e o que não entra

| Arquivo | Ingerido? |
|---|---|
| `servicos.md`, `horarios.txt` | sim |
| `_LEIA-ME.md`, `_rascunho.txt` | não, nome começa com `_` |
| `tenant.json`, `produtos.json`, `avaliacao.json` | não, `.json` nunca é ingerido |

É assim que rascunho, nota interna e tabela de preço estruturada ficam na pasta
sem virar resposta do bot.

## O bloco `agenda` do `tenant.json`

É o que o bot usa para calcular horário livre. Fica em dado estruturado, e não
nos documentos, porque o `.txt` de horários é texto para o RAG ler em voz alta e
agenda precisa de algo que dê para calcular.

```json
"agenda": {
  "duracaoMin": 60,
  "janelas": {
    "1": [["08:00", "12:00"], ["13:00", "18:00"]],
    "6": [["08:00", "12:00"]]
  },
  "antecedenciaMinimaHoras": 2,
  "diasNoFuturo": 60
}
```

`janelas` é por dia da semana, com **0 = domingo**. Dia ausente é dia fechado, e
duas janelas cobrem o almoço. A grade sai de `duracaoMin`, e um horário que não
caberia antes de fechar não é oferecido: consulta de 90 min não começa 17:30 num
expediente que fecha 18:00.

**A grade e os documentos precisam concordar.** Se o `.txt` disser que abre
sábado e `janelas` não tiver o `"6"`, o bot informa um horário que ele não
consegue marcar. Quem não configurar nada cai no `AGENDA_PADRAO`
(`src/core/agenda/disponibilidade.ts`): segunda a sexta, 8 às 12 e 13 às 18,
60 min.

A agenda é opt-in: sem o bloco `agenda`, as ferramentas de marcar, remarcar e
cancelar nem são oferecidas ao modelo. Não é só economia de token, são ~700
tokens por mensagem, é vocabulário: as ferramentas falam "consulta", "paciente"
e "convênio", e isso vaza na conversa de quem não agenda.

## Cliente que vende: `vende` e `produtos.json`

Para o bot montar pedido e informar total, duas coisas. No `tenant.json`:

```json
"config": { "vende": true, "maximoDeLinhas": 5 }
```

E um `produtos.json` na pasta do tenant, que é a fonte de verdade dos preços
para a conta:

```json
{
  "taxaDeEntrega": { "pesoMinimoGratisKg": 2, "taxaCentavos": 500 },
  "produtos": [
    {
      "chave": "polpa-acerola",
      "nome": "polpa de acerola",
      "precoCentavos": 2500,
      "unidade": "kg",
      "pesoKg": 1,
      "termos": ["acerola", "polpa de acerola"]
    }
  ],
  "ambiguos": { "acai": ["polpa-acai", "acai-balde"] }
}
```

Quatro coisas que valem entender antes de escrever o seu:

- **`precoCentavos`, não reais.** Somar `25.00` em float acumula erro, e um
  total errado por um centavo destrói mais confiança que um total ausente.
- **`termos` é casamento exato.** Produto que o cliente pede e não está na lista
  é recusa, não aproximação: quem pede manga não pode receber o preço do
  abacaxi. Escreva as formas que o cliente de fato usa.
- **`ambiguos`** é para termo que nomeia dois produtos **com preços
  diferentes**. O bot recebe as opções e pergunta, em vez de escolher. Na Polpa
  só o `acai` entra: polpa a R$ 35,00 o quilo contra balde pronto a R$ 43,00.
  Morango e maracujá existem como polpa e como fruta congelada, mas custam o
  mesmo, então não há o que perguntar.
- **`pesoKg: null`** quando o produto não é vendido por peso. Não é zero: a taxa
  de entrega é por peso, e com peso desconhecido a ferramenta devolve "taxa a
  confirmar" em vez de chutar.

O preço passa a existir em dois lugares, aqui para a conta e no `.md` para a
resposta em prosa. É dívida real, e o conserto é um teste: `tests/pedido.test.ts`
falha quando um preço da tabela não aparece em nenhum documento. Rode `npm test`
depois de mexer em preço.

`maximoDeLinhas` sobe de 3 para 5 porque recapitular um pedido com itens e total
não cabe em três linhas, e o corte é silencioso: a linha perdida seria a do
total.

## Avisos para o dono: o bloco `alertas`

Palavra do cliente que precisa virar tarefa no painel, mesmo que o modelo não
chame a ferramenta `avisar_responsavel`:

```json
"alertas": [
  {
    "tipo": "desconto",
    "palavras": ["descont", "atacado", "mais barato"],
    "detalhe": "Cliente pediu desconto. A partir de 10 kg a condição é combinada caso a caso."
  }
]
```

A rede de palavra-chave e a ferramenta erram de formas opostas, e por isso
existem as duas. Diferente do handoff, o aviso não cala o bot: a conversa
continua enquanto a tarefa espera no painel.

## O que mais afeta a qualidade das respostas

**Nos documentos:** use títulos (`## Assunto` no `.md`; no `.txt`, linha curta
sem ponto final isolada por linhas em branco). O chunker nunca junta duas seções
no mesmo pedaço, então título bom é separação boa. Um assunto por seção, e
sempre com o número junto do contexto. "A limpeza custa R$ 180,00" funciona,
tabela de preços solta não.

**Na avaliação:** o conjunto precisa de três famílias de pergunta.

| Família | `esperaHandoff` | Por que importa |
|---|---|---|
| O documento responde | `false` | mede se o bot acha a informação |
| Não responde, mas é do ramo | `true` | **a mais importante**: a busca pontua alto e o bot tem de recusar mesmo assim |
| Fora do assunto | `true` | chega ao modelo com contexto fraco e ele precisa recusar |

A segunda família é onde o bot inventa se estiver mal calibrado. Na clínica de
exemplo é o caso `cnpj`: fala da clínica (score 0.593) mas a resposta não existe
nos documentos.

Detalhe de como medir em [avaliacao.md](avaliacao.md).
