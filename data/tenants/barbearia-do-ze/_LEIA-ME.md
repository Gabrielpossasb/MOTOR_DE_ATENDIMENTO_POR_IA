# Barbearia do Zé

Pasta dos documentos e da avaliação deste cliente.

## 1. Os documentos

Jogue aqui os arquivos `.txt` e `.md` com o que o bot pode responder.
Outros formatos são ignorados — PDF e DOCX precisam ser convertidos antes.

**O que faz diferença na qualidade:**

- **Use títulos.** Em `.md`, `## Assunto`. Em `.txt`, uma linha curta sem
  ponto final e com linha em branco antes e depois. O chunker nunca junta duas
  seções no mesmo pedaço, então título bom é separação boa.
- **Um assunto por seção.** "Horários" e "Endereço" separados rendem mais que
  um bloco "Informações gerais".
- **Escreva o número junto do contexto.** "A limpeza custa R$ 180,00" funciona;
  uma tabela solta de preços sem dizer do que são, não.
- **Se falta a informação, escreva.** O bot só responde o que está aqui. A lista
  de "perguntas sem resposta" no painel existe para te dizer o que falta.

## 2. `tenant.json`

- `promptDoSistema` — quem o bot é. Cite a cidade e o tipo de negócio; isso
  ajuda o modelo a entender o contexto das perguntas.
- `limiarDeConfianca` — abaixo disso o bot nem chama o LLM. Ajuste com
  `npm run calibrar -- barbearia-do-ze` depois de ingerir os documentos.
- `topK` — quantos trechos vão para o modelo. Mais trechos custam mais tokens.

## 3. `avaliacao.json`

As perguntas que medem se o bot está bom. Escreva as que os clientes fazem de
verdade — se você tem histórico de WhatsApp, é dali que elas saem.

Um conjunto útil tem três famílias:

1. **Responde** (`esperaHandoff: false`) — o documento tem a resposta.
2. **Não responde, mas é do ramo** (`esperaHandoff: true`) — a busca vai
   pontuar alto e o bot precisa recusar mesmo assim. **É a família mais
   importante**: é onde ele inventa se estiver mal calibrado.
3. **Fora do assunto** (`esperaHandoff: true`) — deve ser barrado pelo limiar.

Campos:

| Campo | Para que serve |
|---|---|
| `id` | nome curto, usado nos logs e em `npm run relatorio -- <id>` |
| `pergunta` | o texto exatamente como o cliente escreveria |
| `deveConter` | trechos que a resposta precisa ter (compara sem acento e sem caixa) |
| `naoPodeConter` | trechos proibidos |
| `esperaHandoff` | `true` se o bot deve recusar |
| `fonteEsperada` | de qual arquivo a resposta deve vir |
| `comentario` | anotação para você; não afeta o resultado |

Não precisa listar preços em `naoPodeConter`: **toda** resposta já passa por
uma checagem automática que exige que qualquer valor em reais, horário, prazo
ou porcentagem exista nos trechos recuperados.

## 4. Rodar

```bash
npm run seed   -- barbearia-do-ze
npm run ingest -- barbearia-do-ze

npm run calibrar -- barbearia-do-ze                # escolher o limiar com dado
npm run avaliar  -- barbearia-do-ze --repeticoes 5 # medir qualidade e estabilidade

npm run cli -- barbearia-do-ze                     # conversar no terminal
npm run web -- barbearia-do-ze                     # conversar no navegador + painel
```

Depois de mexer nos documentos, rode `ingest` de novo: só os arquivos alterados
são reprocessados.
