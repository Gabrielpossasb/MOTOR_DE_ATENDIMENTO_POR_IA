/**
 * Cria a pasta de um cliente novo, já com os arquivos de configuração
 * preenchidos com modelos comentados.
 *
 * Uso: npm run novo-tenant -- barbearia-do-ze "Barbearia do Zé"
 *
 * Não sobrescreve nada: se a pasta já existir, o script para. Perder a
 * avaliação de um cliente por um comando repetido sem querer seria caro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

function principal(): void {
  const slug = process.argv[2];
  // Junta o resto: dependendo do shell, "Barbearia do Zé" chega como três
  // argumentos em vez de um, e o cliente ficaria chamado só de "Barbearia".
  const nome = process.argv.slice(3).join(' ').trim();

  if (!slug || !nome) {
    console.error('Uso: npm run novo-tenant -- <slug> "<Nome da Empresa>"');
    console.error('Exemplo: npm run novo-tenant -- barbearia-do-ze "Barbearia do Zé"');
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('O slug deve ter só letras minúsculas, números e hífen. Exemplo: barbearia-do-ze');
    process.exit(1);
  }

  const pasta = config.caminhos.documentosTenant(slug);

  if (fs.existsSync(pasta)) {
    console.error(`A pasta já existe: ${pasta}`);
    console.error('Apague-a manualmente se quiser recomeçar — este script não sobrescreve nada.');
    process.exit(1);
  }

  fs.mkdirSync(pasta, { recursive: true });

  fs.writeFileSync(path.join(pasta, 'tenant.json'), tenantJson(slug, nome), 'utf8');
  fs.writeFileSync(path.join(pasta, 'avaliacao.json'), avaliacaoJson(nome), 'utf8');
  fs.writeFileSync(path.join(pasta, 'LEIA-ME.md'), leiaMe(slug, nome), 'utf8');

  const relativa = path.relative(config.caminhos.raiz, pasta);

  console.log(`Pasta criada: ${relativa}\n`);
  console.log('Arquivos:');
  console.log('  tenant.json    — nome, prompt do sistema e ajustes (JÁ PODE EDITAR)');
  console.log('  avaliacao.json — perguntas de teste (PRECISA das perguntas reais do cliente)');
  console.log('  LEIA-ME.md     — o passo a passo, com o que escrever em cada lugar');
  console.log('');
  console.log('Próximos passos:');
  console.log(`  1. Coloque os documentos do cliente (.txt e .md) em ${relativa}`);
  console.log('  2. Ajuste o promptDoSistema em tenant.json');
  console.log('  3. Escreva as perguntas em avaliacao.json');
  console.log(`  4. npm run seed   -- ${slug}`);
  console.log(`  5. npm run ingest -- ${slug}`);
  console.log(`  6. npm run calibrar -- ${slug}      (ajusta o limiar)`);
  console.log(`  7. npm run avaliar  -- ${slug} --repeticoes 5`);
}

function tenantJson(slug: string, nome: string): string {
  return `${JSON.stringify(
    {
      slug,
      nome,
      promptDoSistema: `Você é o atendente virtual da ${nome}. Você atende pelo WhatsApp e fala com clientes e interessados. Seja educado, direto e objetivo.`,
      config: {
        topK: 4,
        limiarDeConfianca: 0.4,
      },
    },
    null,
    2,
  )}\n`;
}

function avaliacaoJson(nome: string): string {
  return `${JSON.stringify(
    {
      descricao: `Perguntas de avaliação da ${nome}. Troque os exemplos abaixo pelas perguntas REAIS que os clientes fazem.`,
      perguntas: [
        {
          id: 'exemplo-responde',
          pergunta: 'TROQUE: uma pergunta que os documentos respondem',
          deveConter: ['TROQUE: um trecho que a resposta precisa ter'],
          esperaHandoff: false,
          fonteEsperada: 'TROQUE: nome-do-arquivo.md',
          comentario: 'Apague este exemplo quando escrever as perguntas de verdade.',
        },
        {
          id: 'exemplo-recusa',
          pergunta: 'TROQUE: algo sobre o negócio que os documentos NÃO respondem',
          esperaHandoff: true,
          comentario:
            'O caso mais valioso do conjunto: fala do negócio, então a busca pontua alto, mas a resposta não existe. É onde o bot inventa se estiver mal calibrado.',
        },
        {
          id: 'exemplo-fora-do-assunto',
          pergunta: 'TROQUE: algo claramente de outro ramo',
          esperaHandoff: true,
          comentario: 'Deve ser barrado pelo limiar, sem nem chamar o LLM.',
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function leiaMe(slug: string, nome: string): string {
  return `# ${nome}

Pasta dos documentos e da avaliação deste cliente.

## 1. Os documentos

Jogue aqui os arquivos \`.txt\` e \`.md\` com o que o bot pode responder.
Outros formatos são ignorados — PDF e DOCX precisam ser convertidos antes.

**O que faz diferença na qualidade:**

- **Use títulos.** Em \`.md\`, \`## Assunto\`. Em \`.txt\`, uma linha curta sem
  ponto final e com linha em branco antes e depois. O chunker nunca junta duas
  seções no mesmo pedaço, então título bom é separação boa.
- **Um assunto por seção.** "Horários" e "Endereço" separados rendem mais que
  um bloco "Informações gerais".
- **Escreva o número junto do contexto.** "A limpeza custa R$ 180,00" funciona;
  uma tabela solta de preços sem dizer do que são, não.
- **Se falta a informação, escreva.** O bot só responde o que está aqui. A lista
  de "perguntas sem resposta" no painel existe para te dizer o que falta.

## 2. \`tenant.json\`

- \`promptDoSistema\` — quem o bot é. Cite a cidade e o tipo de negócio; isso
  ajuda o modelo a entender o contexto das perguntas.
- \`limiarDeConfianca\` — abaixo disso o bot nem chama o LLM. Ajuste com
  \`npm run calibrar -- ${slug}\` depois de ingerir os documentos.
- \`topK\` — quantos trechos vão para o modelo. Mais trechos custam mais tokens.

## 3. \`avaliacao.json\`

As perguntas que medem se o bot está bom. Escreva as que os clientes fazem de
verdade — se você tem histórico de WhatsApp, é dali que elas saem.

Um conjunto útil tem três famílias:

1. **Responde** (\`esperaHandoff: false\`) — o documento tem a resposta.
2. **Não responde, mas é do ramo** (\`esperaHandoff: true\`) — a busca vai
   pontuar alto e o bot precisa recusar mesmo assim. **É a família mais
   importante**: é onde ele inventa se estiver mal calibrado.
3. **Fora do assunto** (\`esperaHandoff: true\`) — deve ser barrado pelo limiar.

Campos:

| Campo | Para que serve |
|---|---|
| \`id\` | nome curto, usado nos logs e em \`npm run relatorio -- <id>\` |
| \`pergunta\` | o texto exatamente como o cliente escreveria |
| \`deveConter\` | trechos que a resposta precisa ter (compara sem acento e sem caixa) |
| \`naoPodeConter\` | trechos proibidos |
| \`esperaHandoff\` | \`true\` se o bot deve recusar |
| \`fonteEsperada\` | de qual arquivo a resposta deve vir |
| \`comentario\` | anotação para você; não afeta o resultado |

Não precisa listar preços em \`naoPodeConter\`: **toda** resposta já passa por
uma checagem automática que exige que qualquer valor em reais, horário, prazo
ou porcentagem exista nos trechos recuperados.

## 4. Rodar

\`\`\`bash
npm run seed   -- ${slug}
npm run ingest -- ${slug}

npm run calibrar -- ${slug}                # escolher o limiar com dado
npm run avaliar  -- ${slug} --repeticoes 5 # medir qualidade e estabilidade

npm run cli -- ${slug}                     # conversar no terminal
npm run web -- ${slug}                     # conversar no navegador + painel
\`\`\`

Depois de mexer nos documentos, rode \`ingest\` de novo: só os arquivos alterados
são reprocessados.
`;
}

principal();
