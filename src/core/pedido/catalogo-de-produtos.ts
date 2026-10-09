/**
 * O catálogo de produtos com preço, lido do `produtos.json` do tenant.
 *
 * POR QUE ISTO EXISTE SEPARADO DO RAG. Os documentos `.md` são texto para o
 * modelo ler em voz alta; uma conta precisa de algo que dê para somar. São duas
 * necessidades diferentes sobre o mesmo dado, e é a mesma razão pela qual a
 * agenda vive no `tenant.json` e não num `.txt` de horários.
 *
 * O preço passa a existir em dois lugares, e isso é dívida real. O conserto é
 * um TESTE que falha quando os dois divergem — ver `pedido.test.ts`. Barato,
 * offline, e pega a deriva no dia em que ela nasce, em vez de no dia em que um
 * cliente recebe o preço errado.
 *
 * `.json` não é ingerido (o ingest só olha `.md` e `.txt`), então este arquivo
 * não polui a busca.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { normalizar } from '../texto.js';

export interface Produto {
  chave: string;
  /** Como o cliente vai ler o nome, com acento e tudo. */
  nome: string;
  precoCentavos: number;
  /** "kg", "pacote de 1 kg", "balde de 2 litros". */
  unidade: string;
  /**
   * Peso de uma unidade, para a taxa de entrega.
   *
   * `null` quando o produto não é vendido por peso. Não é zero: zero afirmaria
   * que ele não pesa nada, e a diferença aparece na taxa.
   */
  pesoKg: number | null;
  /** Formas exatas que o modelo pode escrever para pedir este produto. */
  termos: string[];
}

export interface TaxaDeEntrega {
  pesoMinimoGratisKg: number;
  taxaCentavos: number;
}

/**
 * Um desconto que o bot PODE aplicar.
 *
 * Decisão do dono: "são apenas descontos que estiverem cadastrados". O bot não
 * consegue inventar um porque só existem os que estão aqui, e a ferramenta
 * recusa qualquer chave fora da lista — a mesma forma do `confirmado: boolean`
 * e do índice único de vaga.
 *
 * Desconto SEM valor fixo não entra aqui. O de acima de 10 quilos é combinado
 * caso a caso com a responsável, então ele continua sendo alerta, não cálculo:
 * é essa a diferença entre "o bot aplica" e "o bot avisa".
 */
export interface Desconto {
  chave: string;
  /** Como o cliente vai ler. */
  nome: string;
  valorCentavos: number;
  /**
   * O cliente precisa ter dito uma destas palavras em alguma mensagem da
   * conversa.
   *
   * Vazio ou ausente = sem essa exigência. Existe porque a condição "só para
   * quem recebeu o cartão" vazava quando era regra de prompt: o bot explicava a
   * condição e perguntava *"você recebeu esse cartão?"*, ensinando quem não tem
   * a dizer que tem. Como contrato, o desconto não sai sem a menção.
   */
  exigeMencaoDoCliente?: string[];
  /** Recusa se este contato já tem pedido confirmado. */
  apenasPrimeiraCompra?: boolean;
  /** A condição em português, para o bot explicar ao cliente. */
  condicao?: string;
}

export interface CatalogoDeProdutos {
  produtos: Produto[];
  taxaDeEntrega: TaxaDeEntrega;
  /** Termo -> produtos que ele nomeia, quando é mais de um com preços diferentes. */
  ambiguos: Record<string, string[]>;
  /** Os únicos descontos que o bot pode aplicar. Vazio = nenhum. */
  descontos: Desconto[];
}

/** O que a resolução de um termo pode devolver. */
export type Resolucao =
  | { tipo: 'achado'; produto: Produto }
  /** O termo nomeia mais de um produto. O bot precisa PERGUNTAR, não escolher. */
  | { tipo: 'ambiguo'; termo: string; opcoes: Produto[] }
  | { tipo: 'inexistente'; termo: string };

interface ArquivoDeProdutos {
  taxaDeEntrega?: TaxaDeEntrega;
  produtos?: Produto[];
  ambiguos?: Record<string, unknown>;
  descontos?: Desconto[];
}

/**
 * Normalização dos termos de busca.
 *
 * Tira o que o cliente e o modelo escrevem de forma variável e que não
 * distingue produto nenhum: plural, "de", e a palavra "congelado" quando ela
 * não é o que separa dois produtos. Não é agressiva de propósito — quanto mais
 * ela mexe, mais chance de dois produtos virarem o mesmo termo.
 */
function chaveDeBusca(termo: string): string {
  return normalizar(termo)
    .replace(/\bpolpas\b/g, 'polpa')
    .replace(/\s+/g, ' ')
    .trim();
}

let cacheSlug: string | undefined;
let cache: CatalogoDeProdutos | undefined;

/**
 * Carrega o catálogo do tenant.
 *
 * Guarda o último em memória porque toda chamada de ferramenta precisa dele e
 * ler o arquivo a cada item de pedido seria I/O à toa. O cache é por slug: dois
 * tenants na mesma execução não compartilham preço — isso seria um vazamento
 * entre clientes, não uma otimização.
 */
export function carregarCatalogoDeProdutos(slug: string): CatalogoDeProdutos {
  if (cacheSlug === slug && cache) return cache;

  const arquivo = path.join(config.caminhos.documentosTenant(slug), 'produtos.json');

  if (!fs.existsSync(arquivo)) {
    throw new Error(
      `O tenant "${slug}" tem pedido ligado mas não tem produtos.json. ` +
        `Sem tabela de preços não há como somar um pedido.`,
    );
  }

  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ArquivoDeProdutos;

  const produtos = (dados.produtos ?? []).filter((p) => !p.chave.startsWith('_'));
  if (produtos.length === 0) {
    throw new Error(`produtos.json de "${slug}" não tem nenhum produto.`);
  }

  if (!dados.taxaDeEntrega) {
    throw new Error(`produtos.json de "${slug}" não tem taxaDeEntrega.`);
  }

  // As chaves que começam com `_` são comentário para quem edita o arquivo —
  // JSON não tem comentário, e esta é a convenção já usada no resto do projeto.
  const ambiguos: Record<string, string[]> = {};
  for (const [termo, chaves] of Object.entries(dados.ambiguos ?? {})) {
    if (termo.startsWith('_') || !Array.isArray(chaves)) continue;
    ambiguos[chaveDeBusca(termo)] = chaves as string[];
  }

  // Entrada sem `chave` e comentario para quem edita o arquivo: JSON nao tem
  // comentario, e a convencao de prefixar com `_` ja e usada no resto do projeto.
  const descontos = (dados.descontos ?? []).filter(
    (d) => typeof d.chave === 'string' && d.chave.length > 0 && Number.isFinite(d.valorCentavos),
  );

  cache = { produtos, taxaDeEntrega: dados.taxaDeEntrega, ambiguos, descontos };
  cacheSlug = slug;
  return cache;
}

/** Esquece o catálogo em memória. Só os testes precisam disso. */
export function limparCacheDeProdutos(): void {
  cacheSlug = undefined;
  cache = undefined;
}

/**
 * Acha o produto que o modelo pediu.
 *
 * Casamento EXATO contra a lista de termos, e não por aproximação. Aproximar é
 * o erro que a regra 4 do prompt proíbe em palavras ("item PARECIDO não é
 * resposta"): quem pede manga não pode receber o preço do abacaxi, e quem pede
 * "açaí" não pode receber o preço do balde sem ninguém perguntar. Termo
 * desconhecido é recusa, com a lista do que existe.
 */
export function resolverProduto(catalogo: CatalogoDeProdutos, termo: string): Resolucao {
  const busca = chaveDeBusca(termo);

  if (busca.length === 0) return { tipo: 'inexistente', termo };

  const chavesAmbiguas = catalogo.ambiguos[busca];
  if (chavesAmbiguas) {
    const opcoes = catalogo.produtos.filter((p) => chavesAmbiguas.includes(p.chave));
    if (opcoes.length > 1) return { tipo: 'ambiguo', termo, opcoes };
  }

  for (const produto of catalogo.produtos) {
    if (produto.chave === busca) return { tipo: 'achado', produto };
    if (chaveDeBusca(produto.nome) === busca) return { tipo: 'achado', produto };
    if (produto.termos.some((t) => chaveDeBusca(t) === busca)) return { tipo: 'achado', produto };
  }

  return { tipo: 'inexistente', termo };
}

/** Os nomes do catálogo, para a recusa dizer o que existe. */
export function nomesDoCatalogo(catalogo: CatalogoDeProdutos): string[] {
  return catalogo.produtos.map((p) => p.nome);
}

/**
 * Acha um desconto cadastrado pela chave.
 *
 * Casamento exato, e `undefined` para qualquer coisa fora da lista: e isto que
 * torna desconto inventado impossivel, em vez de improvavel.
 */
export function acharDesconto(
  catalogo: CatalogoDeProdutos,
  chave: string,
): Desconto | undefined {
  const buscada = normalizar(chave);
  return catalogo.descontos.find((d) => normalizar(d.chave) === buscada);
}

/** As chaves cadastradas, para a assinatura da ferramenta e para a recusa. */
export function chavesDeDesconto(catalogo: CatalogoDeProdutos): string[] {
  return catalogo.descontos.map((d) => d.chave);
}

export function emReais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}
