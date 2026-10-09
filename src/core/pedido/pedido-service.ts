/**
 * O pedido em montagem: itens, dados de entrega e a conta.
 *
 * A conta é feita AQUI, em código, e não pelo modelo. O motivo está medido na
 * conversa 34: com o prompt consertado o bot passou a montar o pedido e passou
 * a errar o total — listou três itens e informou o preço de dois (R$ 60,00 onde
 * a soma era R$ 110,00). A aritmética dele está certa em cada conta isolada; o
 * que ele não consegue é manter uma lista ao longo da conversa.
 *
 * Resultados são tipados (`{ok:true}` | `{ok:false, motivo}`), e não exceções:
 * quem chama é uma ferramenta, e tudo o que der errado precisa virar texto que
 * o modelo leia e explique ao cliente.
 */
import type { Db } from '../../storage/db.js';
import {
  acharDesconto,
  chavesDeDesconto,
  emReais,
  nomesDoCatalogo,
  resolverProduto,
  type CatalogoDeProdutos,
  type Desconto,
  type Produto,
} from './catalogo-de-produtos.js';

export interface ItemDoPedido {
  id: number;
  chave: string;
  rotulo: string;
  quantidade: number;
  unidade: string;
  precoUnitarioCentavos: number;
  pesoKg: number | null;
  subtotalCentavos: number;
}

export interface DadosDaEntrega {
  nome?: string;
  endereco?: string;
  /** O horário que o CLIENTE pediu. Nunca um horário confirmado. */
  horarioDesejado?: string;
  formaDePagamento?: string;
}

export interface Pedido {
  id: number;
  status: 'rascunho' | 'confirmado' | 'cancelado';
  itens: ItemDoPedido[];
  dados: DadosDaEntrega;
  /** Soma dos itens, sem a taxa. */
  itensCentavos: number;
  taxaCentavos: number;
  /** Desconto cadastrado aplicado, se houver. */
  desconto?: { chave: string; nome: string; valorCentavos: number };
  totalCentavos: number;
  pesoKg: number;
  /**
   * A taxa não pôde ser determinada.
   *
   * Acontece quando o pedido tem item sem peso conhecido (o balde de açaí é de
   * 2 litros) e o peso conhecido ainda não chegou ao mínimo da entrega grátis.
   * Nesse caso o bot tem de confirmar, não chutar.
   */
  taxaIndefinida: boolean;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** Os quatro dados de fechamento, com o rótulo que o cliente lê. */
const CAMPOS_DE_FECHAMENTO: { campo: keyof DadosDaEntrega; rotulo: string }[] = [
  { campo: 'nome', rotulo: 'o nome de quem recebe' },
  { campo: 'endereco', rotulo: 'o endereço completo' },
  { campo: 'horarioDesejado', rotulo: 'o horário que fica melhor' },
  { campo: 'formaDePagamento', rotulo: 'a forma de pagamento' },
];

interface LinhaDePedido {
  id: number;
  status: string;
  customer_name: string | null;
  address: string | null;
  preferred_time: string | null;
  payment_method: string | null;
  /** Taxa congelada no fechamento. NULL enquanto e rascunho. */
  delivery_fee_cents: number | null;
  discount_key: string | null;
  discount_cents: number | null;
}

interface LinhaDeItem {
  id: number;
  product_key: string;
  label: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  weight_kg: number | null;
}

/** O rascunho desta conversa, ou `undefined` se ainda não existe nenhum. */
export function rascunhoDaConversa(db: Db, conversaId: number): Pedido | undefined {
  const linha = db
    .prepare(
      `SELECT id, status, customer_name, address, preferred_time, payment_method,
              delivery_fee_cents, discount_key, discount_cents
       FROM orders WHERE conversation_id = ? AND status = 'rascunho'`,
    )
    .get(conversaId) as LinhaDePedido | undefined;

  return linha ? montar(db, linha) : undefined;
}

export function pedidoPorId(db: Db, pedidoId: number): Pedido | undefined {
  const linha = db
    .prepare(
      `SELECT id, status, customer_name, address, preferred_time, payment_method,
              delivery_fee_cents, discount_key, discount_cents
       FROM orders WHERE id = ?`,
    )
    .get(pedidoId) as LinhaDePedido | undefined;

  return linha ? montar(db, linha) : undefined;
}

/**
 * Pedidos já confirmados de um tenant, do mais novo para o mais velho.
 * Alimenta o painel — é o que a dona do negócio precisa separar e entregar.
 */
export function pedidosConfirmados(
  db: Db,
  tenantId: number,
  limite = 20,
  /** Para trocar a chave do desconto pelo nome que uma pessoa lê no painel. */
  catalogo?: CatalogoDeProdutos,
): Pedido[] {
  const linhas = db
    .prepare(
      `SELECT id, status, customer_name, address, preferred_time, payment_method,
              delivery_fee_cents, discount_key, discount_cents
       FROM orders WHERE tenant_id = ? AND status = 'confirmado'
       ORDER BY confirmed_at DESC, id DESC LIMIT ?`,
    )
    .all(tenantId, limite) as LinhaDePedido[];

  return linhas.map((l) => {
    const pedido = montar(db, l);

    if (pedido.desconto && catalogo) {
      const cadastrado = acharDesconto(catalogo, pedido.desconto.chave);
      if (cadastrado) pedido.desconto.nome = cadastrado.nome;
    }

    return pedido;
  });
}

function montar(db: Db, linha: LinhaDePedido, taxa?: CatalogoDeProdutos['taxaDeEntrega']): Pedido {
  const itens = (
    db
      .prepare(
        `SELECT id, product_key, label, quantity, unit, unit_price_cents, weight_kg
         FROM order_items WHERE order_id = ? ORDER BY id`,
      )
      .all(linha.id) as LinhaDeItem[]
  ).map((i) => ({
    id: i.id,
    chave: i.product_key,
    rotulo: i.label,
    quantidade: i.quantity,
    unidade: i.unit,
    precoUnitarioCentavos: i.unit_price_cents,
    pesoKg: i.weight_kg,
    // Arredonda aqui, e não no fim: quantidade fracionária vezes preço em
    // centavos pode dar fração de centavo, e somar frações antes de arredondar
    // deixa o total um centavo fora do que o cliente soma na calculadora.
    subtotalCentavos: Math.round(i.quantity * i.unit_price_cents),
  }));

  const itensCentavos = itens.reduce((s, i) => s + i.subtotalCentavos, 0);
  const pesoKg = itens.reduce((s, i) => s + (i.pesoKg === null ? 0 : i.pesoKg * i.quantidade), 0);
  const temItemSemPeso = itens.some((i) => i.pesoKg === null);

  const minimo = taxa?.pesoMinimoGratisKg ?? Infinity;
  const valorDaTaxa = taxa?.taxaCentavos ?? 0;

  const gratis = pesoKg >= minimo;
  // Só é indefinida quando o peso conhecido AINDA não garante a gratuidade: se
  // já passou do mínimo, o item sem peso não muda nada e não há o que confirmar.
  const taxaIndefinida = temItemSemPeso && !gratis && taxa !== undefined;
  const calculada = gratis || taxaIndefinida ? 0 : itens.length === 0 ? 0 : valorDaTaxa;

  // Pedido fechado mostra a taxa que FOI cobrada, não a que a tabela de hoje
  // daria. Mesma razão pela qual o preço do item é copiado no momento em que
  // ele entra: o pedido é registro histórico.
  const taxaCentavos = linha.delivery_fee_cents ?? calculada;

  const descontoCentavos = linha.discount_cents ?? 0;

  return {
    id: linha.id,
    status: linha.status as Pedido['status'],
    itens,
    ...(linha.discount_key && descontoCentavos > 0
      ? {
          desconto: {
            chave: linha.discount_key,
            // O nome fica no catálogo; aqui vai a chave como rótulo de reserva,
            // porque `montar` não recebe o catálogo em todos os caminhos.
            nome: linha.discount_key,
            valorCentavos: descontoCentavos,
          },
        }
      : {}),
    dados: {
      ...(linha.customer_name ? { nome: linha.customer_name } : {}),
      ...(linha.address ? { endereco: linha.address } : {}),
      ...(linha.preferred_time ? { horarioDesejado: linha.preferred_time } : {}),
      ...(linha.payment_method ? { formaDePagamento: linha.payment_method } : {}),
    },
    itensCentavos,
    taxaCentavos,
    // Nunca abaixo de zero: desconto maior que o pedido viraria o bot pagando
    // para entregar. Se isso acontecer, o cadastro do desconto está errado.
    totalCentavos: Math.max(0, itensCentavos + taxaCentavos - descontoCentavos),
    pesoKg,
    taxaIndefinida,
  };
}

/** Recalcula o pedido já conhecendo a tabela de taxa. */
export function comTaxa(db: Db, pedidoId: number, catalogo: CatalogoDeProdutos): Pedido | undefined {
  const linha = db
    .prepare(
      `SELECT id, status, customer_name, address, preferred_time, payment_method,
              delivery_fee_cents, discount_key, discount_cents
       FROM orders WHERE id = ?`,
    )
    .get(pedidoId) as LinhaDePedido | undefined;

  if (!linha) return undefined;

  const pedido = montar(db, linha, catalogo.taxaDeEntrega);

  // `montar` nao recebe o catalogo em todos os caminhos, entao usa a chave como
  // rotulo de reserva. Aqui da para trocar pelo nome que o cliente vai ler.
  if (pedido.desconto) {
    const cadastrado = acharDesconto(catalogo, pedido.desconto.chave);
    if (cadastrado) pedido.desconto.nome = cadastrado.nome;
  }

  return pedido;
}

function garantirRascunho(
  db: Db,
  tenantId: number,
  conversaId: number,
  contatoId: string,
): number {
  const existente = db
    .prepare(`SELECT id FROM orders WHERE conversation_id = ? AND status = 'rascunho'`)
    .get(conversaId) as { id: number } | undefined;

  if (existente) return existente.id;

  const r = db
    .prepare(
      `INSERT INTO orders (tenant_id, conversation_id, contact_id) VALUES (?, ?, ?)`,
    )
    .run(tenantId, conversaId, contatoId);

  return Number(r.lastInsertRowid);
}

function tocar(db: Db, pedidoId: number): void {
  db.prepare(`UPDATE orders SET updated_at = datetime('now') WHERE id = ?`).run(pedidoId);
}

export interface ContextoDoPedido {
  db: Db;
  tenantId: number;
  conversaId: number;
  contatoId: string;
  catalogo: CatalogoDeProdutos;
  /**
   * A mensagem que o cliente mandou NESTE turno.
   *
   * Precisa vir por parâmetro porque ela ainda não está em `messages`: o motor
   * grava a conversa depois de gerar a resposta, então durante a chamada de
   * ferramenta o banco não a tem. Sem isto, tudo que depende do que o cliente
   * acabou de dizer fica cego — e o custo foi uma conversa travada: o cliente
   * respondeu `"a polpa"` à escolha entre polpa e balde, a checagem não viu a
   * resposta, e o bot repetiu a mesma pergunta até o fim.
   */
  mensagemAtual?: string;
}

/**
 * Põe um item no pedido, ou soma na quantidade do que já estava lá.
 *
 * Soma em vez de duplicar porque "quero mais 1 kg de açaí" não cria um segundo
 * açaí: o índice único `(order_id, product_key)` garante isso no banco, e aqui
 * a soma é o comportamento que faz o recapitulativo ficar legível.
 */
export function adicionarItem(
  ctx: ContextoDoPedido,
  termo: string,
  quantidade: number,
): Resultado<Pedido> {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { ok: false, motivo: 'A quantidade precisa ser um número maior que zero.' };
  }

  const resolucao = resolverProduto(ctx.catalogo, termo);

  if (resolucao.tipo === 'inexistente') {
    return {
      ok: false,
      motivo:
        `Não trabalhamos com "${termo}". Não ofereça um produto parecido no lugar: ` +
        `diga que não temos esse e, se fizer sentido, cite o que existe. ` +
        `O catálogo é: ${nomesDoCatalogo(ctx.catalogo).join(', ')}.`,
    };
  }

  if (resolucao.tipo === 'ambiguo') {
    const opcoes = resolucao.opcoes
      .map((p) => `${p.nome} (${emReais(p.precoCentavos)} o ${p.unidade})`)
      .join(' ou ');
    return {
      ok: false,
      motivo:
        `"${termo}" pode ser ${opcoes}. PERGUNTE ao cliente qual dos dois antes de ` +
        `somar — os preços são diferentes e escolher por ele seria inventar.`,
    };
  }

  const produto = resolucao.produto;

  const gravar = ctx.db.transaction(() => {
    const pedidoId = garantirRascunho(ctx.db, ctx.tenantId, ctx.conversaId, ctx.contatoId);

    ctx.db
      .prepare(
        `INSERT INTO order_items
           (order_id, product_key, label, quantity, unit, unit_price_cents, weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id, product_key)
           DO UPDATE SET quantity = quantity + excluded.quantity`,
      )
      .run(
        pedidoId,
        produto.chave,
        produto.nome,
        quantidade,
        produto.unidade,
        produto.precoCentavos,
        produto.pesoKg,
      );

    tocar(ctx.db, pedidoId);
    return pedidoId;
  });

  const pedidoId = gravar();
  const pedido = comTaxa(ctx.db, pedidoId, ctx.catalogo);
  return pedido ? { ok: true, valor: pedido } : { ok: false, motivo: 'Não consegui ler o pedido.' };
}

export function removerItem(ctx: ContextoDoPedido, termo: string): Resultado<Pedido> {
  const atual = rascunhoDaConversa(ctx.db, ctx.conversaId);
  if (!atual) return { ok: false, motivo: 'Não há pedido em montagem nesta conversa.' };

  const resolucao = resolverProduto(ctx.catalogo, termo);
  if (resolucao.tipo !== 'achado') {
    return { ok: false, motivo: `Não encontrei "${termo}" no catálogo para remover.` };
  }

  const r = ctx.db
    .prepare('DELETE FROM order_items WHERE order_id = ? AND product_key = ?')
    .run(atual.id, resolucao.produto.chave);

  if (r.changes === 0) {
    return { ok: false, motivo: `${resolucao.produto.nome} não está no pedido.` };
  }

  tocar(ctx.db, atual.id);
  const pedido = comTaxa(ctx.db, atual.id, ctx.catalogo);
  return pedido ? { ok: true, valor: pedido } : { ok: false, motivo: 'Não consegui ler o pedido.' };
}

/**
 * Anota os dados de entrega que o cliente deu, sem apagar o que já havia.
 *
 * Acumulativo e parcial de propósito, e é o que mata o defeito mais reclamado
 * desta fase: dado que o cliente mandou sem ninguém pedir fica gravado na hora,
 * e o resultado da ferramenta diz o que já está lá — então o modelo vê que não
 * precisa perguntar de novo. Duas regras de prompt (a 7 global e a A2 da
 * agenda) tentaram isso e não bastaram.
 */
export function anotarDados(ctx: ContextoDoPedido, dados: DadosDaEntrega): Resultado<Pedido> {
  const informados = Object.entries(dados).filter(
    ([, v]) => typeof v === 'string' && v.trim().length > 0,
  );

  if (informados.length === 0) {
    return { ok: false, motivo: 'Nenhum dado foi informado para anotar.' };
  }

  const gravar = ctx.db.transaction(() => {
    const pedidoId = garantirRascunho(ctx.db, ctx.tenantId, ctx.conversaId, ctx.contatoId);

    const coluna: Record<string, string> = {
      nome: 'customer_name',
      endereco: 'address',
      horarioDesejado: 'preferred_time',
      formaDePagamento: 'payment_method',
    };

    for (const [chave, valor] of informados) {
      const nomeDaColuna = coluna[chave];
      if (!nomeDaColuna) continue;
      ctx.db
        .prepare(`UPDATE orders SET ${nomeDaColuna} = ? WHERE id = ?`)
        .run(String(valor).trim(), pedidoId);
    }

    tocar(ctx.db, pedidoId);
    return pedidoId;
  });

  const pedidoId = gravar();
  const pedido = comTaxa(ctx.db, pedidoId, ctx.catalogo);
  return pedido ? { ok: true, valor: pedido } : { ok: false, motivo: 'Não consegui ler o pedido.' };
}

/**
 * Aplica um desconto CADASTRADO ao pedido.
 *
 * Três recusas, e as três são contrato e não prompt:
 *
 * 1. **Chave fora da lista.** O bot não consegue inventar desconto porque só
 *    existem os do `produtos.json`. É a decisão do dono — "são apenas descontos
 *    que estiverem cadastrados" — virando impossibilidade.
 * 2. **O cliente não mencionou.** O desconto do cartão impresso exige que ele
 *    tenha falado "cartão" ou "panfleto" em alguma mensagem desta conversa. Como
 *    regra de prompt isso vazava: o bot explicava a condição e perguntava *"você
 *    recebeu esse cartão?"*, ensinando quem não tem a dizer que tem. Aqui a
 *    menção é conferida no histórico, então a explicação pode escapar mas o
 *    DINHEIRO não sai.
 * 3. **Não é a primeira compra.** Confere pedido confirmado anterior do mesmo
 *    contato. No WhatsApp o contato é o telefone e isto funciona; nesta fase
 *    local o id é aleatório por sessão, então quase nunca dispara.
 */
export function aplicarDesconto(ctx: ContextoDoPedido, chave: string): Resultado<Pedido> {
  const atual = rascunhoDaConversa(ctx.db, ctx.conversaId);
  if (!atual) return { ok: false, motivo: 'Não há pedido em montagem nesta conversa.' };
  if (atual.itens.length === 0) {
    return { ok: false, motivo: 'O pedido está vazio: escolha os itens antes de aplicar desconto.' };
  }

  const desconto = acharDesconto(ctx.catalogo, chave);
  if (!desconto) {
    const cadastrados = chavesDeDesconto(ctx.catalogo);
    return {
      ok: false,
      motivo:
        cadastrados.length === 0
          ? 'Não existe nenhum desconto cadastrado. NÃO prometa desconto: avise a responsável ' +
            'com `avisar_responsavel`.'
          : `"${chave}" não é um desconto cadastrado. Os únicos que existem são: ` +
            `${cadastrados.join(', ')}. Para qualquer outro, NÃO prometa nada e avise a ` +
            `responsável com \`avisar_responsavel\`.`,
    };
  }

  const faltaMencao = exigeMencaoNaoAtendida(ctx, desconto);
  if (faltaMencao) return { ok: false, motivo: faltaMencao };

  if (desconto.apenasPrimeiraCompra === true && jaComprou(ctx)) {
    return {
      ok: false,
      motivo:
        `${desconto.nome} vale só na primeira compra, e este cliente já tem pedido fechado ` +
        `antes. NÃO aplique e NÃO ofereça.`,
    };
  }

  ctx.db
    .prepare(
      `UPDATE orders SET discount_key = ?, discount_cents = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'rascunho'`,
    )
    .run(desconto.chave, desconto.valorCentavos, atual.id);

  const pedido = comTaxa(ctx.db, atual.id, ctx.catalogo);
  return pedido ? { ok: true, valor: pedido } : { ok: false, motivo: 'Não consegui ler o pedido.' };
}

/** O histórico do cliente MAIS a mensagem deste turno, que ainda não foi gravada. */
export function tudoQueOClienteDisse(ctx: ContextoDoPedido): string {
  const historico = ditoPeloClienteNaConversa(ctx.db, ctx.conversaId);
  const atual = (ctx.mensagemAtual ?? '').toLowerCase();
  return atual.length > 0 ? `${historico} 
 ${atual}` : historico;
}

/** A recusa por falta de menção, ou `undefined` quando a condição está cumprida. */
/**
 * Tudo que o CLIENTE escreveu nesta conversa, em minúsculas.
 *
 * Três coisas dependem disto, e todas são contrato e não prompt: a menção que
 * libera um desconto, a escolha entre dois produtos de nome ambíguo, e a
 * unidade em que ele contou. Em todas vale o que ELE disse, não o que o modelo
 * deduziu — porque foi exatamente deduzindo que o bot trocou "2 kg de açaí" por
 * "1 balde de açaí pronto".
 */
export function ditoPeloClienteNaConversa(db: Db, conversaId: number): string {
  return (
    db
      .prepare(`SELECT content FROM messages WHERE conversation_id = ? AND role = 'user'`)
      .all(conversaId) as { content: string }[]
  )
    .map((m) => m.content.toLowerCase())
    .join(' \n ');
}

function exigeMencaoNaoAtendida(ctx: ContextoDoPedido, desconto: Desconto): string | undefined {
  const palavras = desconto.exigeMencaoDoCliente ?? [];
  if (palavras.length === 0) return undefined;

  const ditoPeloCliente = tudoQueOClienteDisse(ctx);

  if (palavras.some((palavra) => ditoPeloCliente.includes(palavra.toLowerCase()))) return undefined;

  return (
    `${desconto.nome} só vale se o CLIENTE mencionar. Ele não falou nada disso nesta conversa, ` +
    `então o desconto NÃO se aplica — e você também não pode contar que ele existe nem ` +
    `perguntar se a pessoa tem, porque isso ensina quem não tem a dizer que tem.`
  );
}

/**
 * Um desconto cadastrado cujas condições JÁ estão cumpridas e que ainda não foi
 * aplicado.
 *
 * Existe para o modelo não deixar dinheiro do cliente na mesa por esquecimento.
 * Medido: o cliente abriu a conversa com *"recebi o cartão de vocês na feira"*,
 * montou o pedido, e no fim perguntou *"tenho desconto com o cartão?"*. O bot
 * respondeu *"vou confirmar isso pra você"* e NUNCA chamou `aplicar_desconto` —
 * o desconto a que ele tinha direito simplesmente não saiu.
 *
 * É a mesma forma da rede de unidade e da rede de palavra-chave dos alertas: o
 * modelo esquece de chamar a ferramenta, então o código avisa que é hora. A
 * diferença é que esta rede é POSITIVA — manda fazer algo que o cliente tem
 * direito, em vez de impedir algo errado.
 */
export function descontoAplicavel(ctx: ContextoDoPedido): Desconto | undefined {
  const atual = rascunhoDaConversa(ctx.db, ctx.conversaId);
  if (!atual || atual.itens.length === 0 || atual.desconto) return undefined;

  return ctx.catalogo.descontos.find(
    (d) =>
      exigeMencaoNaoAtendida(ctx, d) === undefined &&
      !(d.apenasPrimeiraCompra === true && jaComprou(ctx)),
  );
}

/** Este contato já fechou pedido antes? */
function jaComprou(ctx: ContextoDoPedido): boolean {
  const linha = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders
       WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmado'`,
    )
    .get(ctx.tenantId, ctx.contatoId) as { n: number };

  return linha.n > 0;
}

/** O que ainda falta para o pedido poder ser fechado. */
export function faltaParaFechar(pedido: Pedido): string[] {
  const faltando: string[] = [];

  if (pedido.itens.length === 0) faltando.push('o pedido não tem nenhum item');

  for (const { campo, rotulo } of CAMPOS_DE_FECHAMENTO) {
    if (!pedido.dados[campo]) faltando.push(rotulo);
  }

  return faltando;
}

/**
 * Fecha o pedido.
 *
 * Duas coisas que o prompt NÃO garante e esta função garante:
 *
 * 1. **Pedido vazio não fecha.** É o contrato por trás de "não peça endereço
 *    antes de o cliente escolher nada": mesmo que o modelo desobedeça a ordem
 *    das etapas, não existe venda registrada sem item.
 * 2. **`confirmado: false` não grava.** Devolve o que ACONTECERIA, para o bot
 *    ler de volta ao cliente e esperar o sim — a mesma disciplina de
 *    `criar_agendamento`.
 *
 * E o horário fechado nunca é promessa: `preferred_time` é o que o cliente
 * pediu, e quem confirma é a responsável.
 */
export function fecharPedido(ctx: ContextoDoPedido, confirmado: boolean): Resultado<Pedido> {
  const atual = rascunhoDaConversa(ctx.db, ctx.conversaId);
  if (!atual) return { ok: false, motivo: 'Não há pedido em montagem nesta conversa.' };

  const pedido = comTaxa(ctx.db, atual.id, ctx.catalogo);
  if (!pedido) return { ok: false, motivo: 'Não consegui ler o pedido.' };

  const falta = faltaParaFechar(pedido);
  if (falta.length > 0) {
    return { ok: false, motivo: `Ainda falta: ${falta.join(', ')}.` };
  }

  if (!confirmado) return { ok: true, valor: pedido };

  ctx.db
    .prepare(
      `UPDATE orders
         SET status = 'confirmado', confirmed_at = datetime('now'),
             updated_at = datetime('now'), delivery_fee_cents = ?
       WHERE id = ? AND status = 'rascunho'`,
    )
    .run(pedido.taxaCentavos, pedido.id);

  const fechado = comTaxa(ctx.db, pedido.id, ctx.catalogo);
  return fechado ? { ok: true, valor: fechado } : { ok: false, motivo: 'Não consegui ler o pedido.' };
}

/** O pedido em texto curto, do jeito que o modelo vai ler de volta ao cliente. */
export function resumirPedido(pedido: Pedido): string {
  if (pedido.itens.length === 0) return 'pedido vazio';

  const itens = pedido.itens
    .map((i) => `${formatarQuantidade(i.quantidade, i.unidade)} de ${i.rotulo} = ${emReais(i.subtotalCentavos)}`)
    .join('; ');

  const entrega = pedido.taxaIndefinida
    ? 'taxa de entrega a confirmar'
    : pedido.taxaCentavos === 0
      ? 'entrega grátis'
      : `entrega ${emReais(pedido.taxaCentavos)}`;

  const desconto = pedido.desconto
    ? `; desconto de ${emReais(pedido.desconto.valorCentavos)} (${pedido.desconto.nome})`
    : '';

  return `${itens}; ${entrega}${desconto}; TOTAL ${emReais(pedido.totalCentavos)}`;
}

function formatarQuantidade(quantidade: number, unidade: string): string {
  const numero = Number.isInteger(quantidade) ? String(quantidade) : quantidade.toFixed(1).replace('.', ',');
  // "2 kg" soa certo; "2 pacote de 1 kg" não. Pluraliza só o que precisa.
  if (unidade.startsWith('pacote')) return `${numero} ${quantidade > 1 ? 'pacotes' : 'pacote'} de 1 kg`;
  if (unidade.startsWith('balde')) return `${numero} ${quantidade > 1 ? 'baldes' : 'balde'} de 2 litros`;
  return `${numero} ${unidade}`;
}

export type { Produto };
