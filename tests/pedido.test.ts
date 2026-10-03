/**
 * Testes do pedido estruturado.
 *
 * O caso que motivou tudo está na conversa 34 (2026-10-02): com o prompt
 * consertado, o bot passou a montar o pedido e passou a ERRAR o total — listou
 * três itens e informou o preço de dois, R$ 60,00 onde a soma era R$ 110,00.
 * Ele disse um preço errado a um cliente. A aritmética dele está certa em cada
 * conta isolada; o que ele não consegue é manter uma lista ao longo da conversa.
 *
 * Então os testes aqui cobrem duas coisas: a CONTA (que agora é código) e o
 * CONTRATO (pedido vazio não fecha, produto inexistente é recusa, dado anotado
 * não é pedido de novo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { obterOuCriarConversa } from '../src/storage/repositories/conversations.js';
import { config } from '../src/config.js';
import {
  carregarCatalogoDeProdutos,
  limparCacheDeProdutos,
  resolverProduto,
  type CatalogoDeProdutos,
} from '../src/core/pedido/catalogo-de-produtos.js';
import {
  adicionarItem,
  anotarDados,
  comTaxa,
  faltaParaFechar,
  fecharPedido,
  rascunhoDaConversa,
  removerItem,
  resumirPedido,
  pedidosConfirmados,
  type ContextoDoPedido,
} from '../src/core/pedido/pedido-service.js';
import {
  FERRAMENTAS_DO_PEDIDO,
  executarFerramentaDoPedido,
} from '../src/core/pedido/ferramentas.js';
import { montarPainel } from '../src/core/painel/painel-service.js';

const SLUG = 'polpa-santa-helena';

let db: Db;
let ctx: ContextoDoPedido;
let catalogo: CatalogoDeProdutos;
let conversaId: number;
let tenantId: number;

beforeEach(() => {
  db = abrirBanco(':memory:');
  limparCacheDeProdutos();

  const tenant = salvarTenant(db, {
    slug: SLUG,
    nome: 'Polpa Santa Helena',
    config: { vende: true },
    promptDoSistema: 'Você vende polpa.',
  });
  tenantId = tenant.id;

  const conversa = obterOuCriarConversa(db, tenant.id, 'contato-1', 'teste');
  conversaId = conversa.id;

  // O catálogo REAL do tenant, não um dublê: se o produtos.json quebrar, estes
  // testes têm de quebrar junto.
  catalogo = carregarCatalogoDeProdutos(SLUG);
  ctx = { db, tenantId: tenant.id, conversaId, contatoId: 'contato-1', catalogo };
});

describe('o carrinho ACUMULA', () => {
  it('três itens somam, e o total é a soma dos três', () => {
    // O defeito exato da conversa 34: o bot "substituía" o pedido a cada item
    // novo. 2 pacotes de pão de queijo (R$ 50) + 1 kg de acerola com laranja
    // (R$ 25) + 1 kg de maracujá (R$ 35) = R$ 110,00. Ele disse R$ 60,00.
    expect(adicionarItem(ctx, 'pão de queijo', 2).ok).toBe(true);
    expect(adicionarItem(ctx, 'acerola com laranja', 1).ok).toBe(true);

    const r = adicionarItem(ctx, 'polpa de maracujá', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.valor.itens).toHaveLength(3);
    expect(r.valor.itensCentavos).toBe(11000);
    // 4 kg passa do mínimo, então a entrega é grátis e o total não muda.
    expect(r.valor.taxaCentavos).toBe(0);
    expect(r.valor.totalCentavos).toBe(11000);
  });

  it('pedir o mesmo produto duas vezes soma a quantidade, não duplica a linha', () => {
    adicionarItem(ctx, 'polpa de açaí', 2);
    const r = adicionarItem(ctx, 'polpa de açaí', 1);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.itens).toHaveLength(1);
    expect(r.valor.itens[0]?.quantidade).toBe(3);
    expect(r.valor.itensCentavos).toBe(10500);
  });

  it('o carrinho sobrevive a qualquer janela de contexto', () => {
    // É o ponto da Parte 2: o pedido está no banco, então não depende de o
    // histórico ainda estar visível nem de o resumo ter preservado o número.
    adicionarItem(ctx, 'polpa de goiaba', 1);

    const lido = rascunhoDaConversa(db, conversaId);
    expect(lido?.itens[0]?.rotulo).toBe('polpa de goiaba');
  });

  it('um rascunho por conversa, garantido pelo banco', () => {
    adicionarItem(ctx, 'polpa de caju', 1);
    adicionarItem(ctx, 'polpa de uva', 1);

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM orders WHERE conversation_id = ?`)
      .get(conversaId) as { n: number };

    expect(total.n).toBe(1);
  });

  it('remover tira o item e refaz a conta', () => {
    adicionarItem(ctx, 'polpa de açaí', 2);
    adicionarItem(ctx, 'polpa de goiaba', 1);

    const r = removerItem(ctx, 'polpa de açaí');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.valor.itens).toHaveLength(1);
    expect(r.valor.itensCentavos).toBe(2500);
    // 1 kg só: volta a ter taxa.
    expect(r.valor.taxaCentavos).toBe(500);
    expect(r.valor.totalCentavos).toBe(3000);
  });
});

describe('a taxa de entrega', () => {
  it('1 kg paga R$ 5,00', () => {
    const r = adicionarItem(ctx, 'polpa de limão', 1);
    expect(r.ok && r.valor.taxaCentavos).toBe(500);
    expect(r.ok && r.valor.totalCentavos).toBe(3000);
  });

  it('2 kg não paga', () => {
    const r = adicionarItem(ctx, 'polpa de limão', 2);
    expect(r.ok && r.valor.taxaCentavos).toBe(0);
    expect(r.ok && r.valor.totalCentavos).toBe(5000);
  });

  it('item vendido por VOLUME deixa a taxa indefinida em vez de chutar', () => {
    // O balde de açaí é de 2 litros e a taxa é por PESO. Ninguém disse se os 2
    // litros contam para os 2 kg de entrega grátis, e chutar seria inventar —
    // exatamente o que este projeto não faz. A ferramenta avisa e o bot
    // confirma com a responsável.
    const r = adicionarItem(ctx, 'balde de açaí', 1);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.taxaIndefinida).toBe(true);
    expect(r.valor.taxaCentavos).toBe(0);
    expect(resumirPedido(r.valor)).toContain('taxa de entrega a confirmar');
  });

  it('mas com 2 kg de outra coisa a dúvida desaparece', () => {
    // Já é grátis pelo peso conhecido: o item sem peso não muda nada, então
    // não há o que confirmar.
    adicionarItem(ctx, 'balde de açaí', 1);
    const r = adicionarItem(ctx, 'polpa de goiaba', 2);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.taxaIndefinida).toBe(false);
    expect(r.valor.taxaCentavos).toBe(0);
  });
});

describe('produto que não existe é RECUSA, nunca o vizinho', () => {
  it('recusa manga e manda não oferecer parecido', () => {
    // É a regra 4 do prompt ("item PARECIDO não é resposta") virando contrato.
    const r = adicionarItem(ctx, 'manga', 1);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('Não trabalhamos com "manga"');
    expect(r.motivo).toContain('Não ofereça um produto parecido');
  });

  it('açaí é AMBÍGUO e manda perguntar', () => {
    // Polpa de açaí custa R$ 35,00 o quilo; o balde pronto custa R$ 43,00. É o
    // único termo do catálogo em que adivinhar muda o preço — e o próprio
    // documento avisa "não confundir".
    const r = adicionarItem(ctx, 'açaí', 1);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('PERGUNTE');
    expect(r.motivo).toContain('R$ 35,00');
    expect(r.motivo).toContain('R$ 43,00');
  });

  it('morango NÃO é ambíguo: polpa e fruta congelada custam o mesmo', () => {
    const r = resolverProduto(catalogo, 'morango');
    expect(r.tipo).toBe('achado');
    if (r.tipo !== 'achado') return;
    expect(r.produto.precoCentavos).toBe(3500);
  });

  it('quantidade zero ou negativa é recusada', () => {
    expect(adicionarItem(ctx, 'polpa de goiaba', 0).ok).toBe(false);
    expect(adicionarItem(ctx, 'polpa de goiaba', -2).ok).toBe(false);
  });

  it('reconhece o produto escrito de várias formas', () => {
    for (const termo of ['acerola', 'polpa de acerola', 'Acerola', 'ACEROLA']) {
      const r = resolverProduto(catalogo, termo);
      expect(r.tipo, `"${termo}" deveria achar`).toBe('achado');
      if (r.tipo === 'achado') expect(r.produto.chave).toBe('polpa-acerola');
    }
  });

  it('acerola e acerola com laranja são produtos diferentes', () => {
    const a = resolverProduto(catalogo, 'acerola');
    const b = resolverProduto(catalogo, 'acerola com laranja');

    expect(a.tipo === 'achado' && a.produto.chave).toBe('polpa-acerola');
    expect(b.tipo === 'achado' && b.produto.chave).toBe('polpa-acerola-laranja');
  });
});

describe('dados de entrega', () => {
  it('anota parcial e acumula, sem apagar o que já havia', () => {
    // É o conserto do defeito mais reclamado: o cliente manda o nome e o
    // endereço juntos, depois o pagamento, e nada se perde no caminho.
    anotarDados(ctx, { nome: 'Maria Souza', endereco: 'Rua das Flores, 120' });
    const r = anotarDados(ctx, { formaDePagamento: 'Pix' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.dados).toEqual({
      nome: 'Maria Souza',
      endereco: 'Rua das Flores, 120',
      formaDePagamento: 'Pix',
    });
  });

  it('diz o que ainda falta, para o bot não perguntar o que já tem', () => {
    adicionarItem(ctx, 'polpa de goiaba', 2);
    const r = anotarDados(ctx, { nome: 'Maria', endereco: 'Rua A, 1' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const falta = faltaParaFechar(r.valor);
    expect(falta).toContain('o horário que fica melhor');
    expect(falta).toContain('a forma de pagamento');
    expect(falta).not.toContain('o nome de quem recebe');
    expect(falta).not.toContain('o endereço completo');
  });

  it('anotar nada é recusado', () => {
    expect(anotarDados(ctx, {}).ok).toBe(false);
    expect(anotarDados(ctx, { nome: '   ' }).ok).toBe(false);
  });
});

describe('fechar o pedido', () => {
  function completo(): void {
    adicionarItem(ctx, 'polpa de açaí', 2);
    anotarDados(ctx, {
      nome: 'Maria Souza',
      endereco: 'Rua das Flores, 120',
      horarioDesejado: 'amanhã de manhã',
      formaDePagamento: 'Pix',
    });
  }

  it('pedido VAZIO não fecha, mesmo com todos os dados', () => {
    // O contrato por trás de "não peça endereço antes de o cliente escolher
    // nada": mesmo que o modelo desobedeça a ordem das etapas, não existe venda
    // registrada sem item.
    anotarDados(ctx, {
      nome: 'Maria',
      endereco: 'Rua A, 1',
      horarioDesejado: 'de manhã',
      formaDePagamento: 'Pix',
    });

    const r = fecharPedido(ctx, true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('não tem nenhum item');
  });

  it('dado faltando não fecha, e o motivo diz qual', () => {
    adicionarItem(ctx, 'polpa de açaí', 2);
    anotarDados(ctx, { nome: 'Maria' });

    const r = fecharPedido(ctx, true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('o endereço completo');
    expect(r.motivo).toContain('a forma de pagamento');
  });

  it('confirmado=false NÃO grava', () => {
    completo();

    const r = fecharPedido(ctx, false);
    expect(r.ok).toBe(true);
    expect(rascunhoDaConversa(db, conversaId)?.status).toBe('rascunho');
    expect(pedidosConfirmados(db, tenantId)).toHaveLength(0);
  });

  it('confirmado=true fecha, e o rascunho deixa de existir', () => {
    completo();

    const r = fecharPedido(ctx, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.valor.status).toBe('confirmado');
    expect(rascunhoDaConversa(db, conversaId)).toBeUndefined();

    const confirmados = pedidosConfirmados(db, tenantId);
    expect(confirmados).toHaveLength(1);
    expect(confirmados[0]?.dados.nome).toBe('Maria Souza');
    expect(confirmados[0]?.totalCentavos).toBe(7000);
  });

  it('a taxa cobrada CONGELA no fechamento', () => {
    // Mesma razão pela qual o preço do item é copiado: o pedido é registro
    // histórico. Se o mínimo de entrega grátis mudar de 2 para 3 kg, um pedido
    // fechado no mês passado não pode passar a mostrar outro total no painel.
    adicionarItem(ctx, 'polpa de limão', 1);
    anotarDados(ctx, {
      nome: 'Maria',
      endereco: 'Rua A, 1',
      horarioDesejado: 'de manhã',
      formaDePagamento: 'Pix',
    });

    const r = fecharPedido(ctx, true);
    expect(r.ok && r.valor.taxaCentavos).toBe(500);

    // A tabela muda: agora 1 kg também seria grátis.
    const outro: ContextoDoPedido = {
      ...ctx,
      catalogo: { ...catalogo, taxaDeEntrega: { pesoMinimoGratisKg: 1, taxaCentavos: 0 } },
    };
    const relido = comTaxa(db, (r.ok && r.valor.id) as number, outro.catalogo);

    expect(relido?.taxaCentavos).toBe(500);
    expect(relido?.totalCentavos).toBe(3000);
  });

  it('o horário gravado é o DESEJADO, nunca um horário confirmado', () => {
    // A garantia está no nome da coluna, não no prompt: `preferred_time`. Quem
    // entrega é a responsável, e só ela confirma.
    completo();
    fecharPedido(ctx, true);

    const colunas = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
    const nomes = colunas.map((c) => c.name);

    expect(nomes).toContain('preferred_time');
    expect(nomes).not.toContain('delivery_time');
    expect(nomes).not.toContain('confirmed_time');
  });
});

describe('as ferramentas', () => {
  function chamar(nome: string, argumentos: Record<string, unknown> = {}): Record<string, unknown> {
    return JSON.parse(
      executarFerramentaDoPedido(
        { db, tenantId, tenantSlug: SLUG, contatoId: 'contato-1', conversaId, semPersistir: false },
        nome,
        argumentos,
      ),
    );
  }

  it('devolvem o pedido INTEIRO, não só o que mudou', () => {
    // É o que faz a resposta natural do bot virar "anotei X e Y, total R$ Z".
    chamar('adicionar_ao_pedido', { produto: 'pão de queijo', quantidade: 2 });
    const r = chamar('adicionar_ao_pedido', { produto: 'polpa de goiaba', quantidade: 1 });

    expect(r.ok).toBe(true);
    expect(r.itens).toHaveLength(2);
    expect(r.total).toBe('R$ 75,00');
    expect(r.ainda_falta).toContain('o nome de quem recebe');
  });

  it('`ver_pedido` com carrinho vazio manda perguntar, e cita o catálogo', () => {
    const r = chamar('ver_pedido');
    expect(r.pedido).toBe('vazio');
    expect(String(r.instrucao)).toContain('pão de queijo');
  });

  it('`semPersistir` não grava pedido nenhum', () => {
    // A avaliação roda centenas de perguntas; um pedido de teste no banco do
    // cliente é poluição que alguém vai separar e entregar.
    const cru = executarFerramentaDoPedido(
      { db, tenantId, tenantSlug: SLUG, contatoId: 'c', conversaId, semPersistir: true },
      'adicionar_ao_pedido',
      { produto: 'polpa de goiaba', quantidade: 1 },
    );

    expect(JSON.parse(cru).ok).toBe(false);
    expect(rascunhoDaConversa(db, conversaId)).toBeUndefined();
  });

  it('sem conversa não há carrinho', () => {
    const cru = executarFerramentaDoPedido(
      { db, tenantId, tenantSlug: SLUG, contatoId: 'c', semPersistir: false },
      'ver_pedido',
      {},
    );

    expect(JSON.parse(cru).ok).toBe(false);
  });

  it('ferramenta desconhecida não lança, devolve erro em texto', () => {
    expect(chamar('deletar_tudo').ok).toBe(false);
  });

  it('nenhuma ferramenta tem PARÂMETRO de tenant, conversa ou contato', () => {
    // Mesma disciplina da agenda: os ids vêm do servidor. Um modelo que
    // alucine um id não alcança o pedido de outra pessoa, porque o id que ele
    // escrever simplesmente não é lido.
    //
    // A checagem é nos NOMES dos parâmetros, não na prosa da descrição: a
    // descrição fala "nesta conversa" de propósito, para o modelo entender o
    // escopo, e isso não expõe nada.
    const parametros = FERRAMENTAS_DO_PEDIDO.flatMap((f) =>
      Object.keys((f.parametros as { properties?: Record<string, unknown> }).properties ?? {}),
    );

    for (const nome of parametros) {
      expect(nome).not.toMatch(/tenant|conversa|contato|contact/i);
    }

    expect(parametros).toEqual([
      'produto',
      'quantidade',
      'produto',
      'nome',
      'endereco',
      'horario_desejado',
      'forma_de_pagamento',
      'confirmado',
    ]);
  });
});

describe('o painel', () => {
  it('mostra os pedidos fechados, com o horário marcado como a confirmar', () => {
    // Pedido que existe só no banco é meia funcionalidade: ninguém vai abrir o
    // SQLite antes de sair para entregar.
    adicionarItem(ctx, 'polpa de açaí', 2);
    anotarDados(ctx, {
      nome: 'Maria Souza',
      endereco: 'Rua das Flores, 120',
      horarioDesejado: 'amanhã de manhã',
      formaDePagamento: 'Pix',
    });
    fecharPedido(ctx, true);

    const painel = montarPainel(db, SLUG);

    expect(painel.pedidosConfirmados).toHaveLength(1);
    expect(painel.pedidosConfirmados[0]?.dados.nome).toBe('Maria Souza');
    expect(painel.pedidosConfirmados[0]?.totalCentavos).toBe(7000);
    // O horário é o DESEJADO. O painel o rotula como "a confirmar".
    expect(painel.pedidosConfirmados[0]?.dados.horarioDesejado).toBe('amanhã de manhã');
  });

  it('não mostra rascunho: pedido em montagem não é pedido para entregar', () => {
    adicionarItem(ctx, 'polpa de açaí', 2);
    expect(montarPainel(db, SLUG).pedidosConfirmados).toHaveLength(0);
  });

  it('fica vazio em cliente que não vende', () => {
    const outro = abrirBanco(':memory:');
    salvarTenant(outro, {
      slug: 'clinica',
      nome: 'Clínica',
      config: {},
      promptDoSistema: 'p',
    });

    expect(montarPainel(outro, 'clinica').pedidosConfirmados).toEqual([]);
    outro.close();
  });
});

describe('o produtos.json não divergiu dos documentos', () => {
  it('todo preço da tabela aparece nos documentos ingeridos', () => {
    // O preço existe em dois lugares: no .json para a conta e no .md para a
    // resposta em prosa. É dívida real, e este teste é o que impede que ela
    // custe caro — mexer num e esquecer o outro faz o bot citar um preço na
    // conversa e somar outro no pedido.
    const pasta = config.caminhos.documentosTenant(SLUG);
    const documentos = fs
      .readdirSync(pasta)
      .filter((n) => (n.endsWith('.md') || n.endsWith('.txt')) && !n.startsWith('_'))
      .map((n) => fs.readFileSync(path.join(pasta, n), 'utf8'))
      .join('\n');

    const faltando: string[] = [];

    for (const produto of catalogo.produtos) {
      const reais = `R$ ${(produto.precoCentavos / 100).toFixed(2).replace('.', ',')}`;
      if (!documentos.includes(reais)) faltando.push(`${produto.nome} (${reais})`);
    }

    expect(faltando, 'preços na tabela que nenhum documento menciona').toEqual([]);
  });

  it('a taxa de entrega da tabela aparece nos documentos', () => {
    const pasta = config.caminhos.documentosTenant(SLUG);
    const entrega = fs.readFileSync(path.join(pasta, 'entrega-e-pagamento.md'), 'utf8');

    expect(entrega).toContain('R$ 5,00');
    expect(entrega).toContain('2 quilos');
  });
});
