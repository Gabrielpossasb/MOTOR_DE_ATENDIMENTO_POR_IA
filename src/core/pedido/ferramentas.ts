/**
 * As ferramentas com que o bot monta o pedido.
 *
 * As mesmas duas regras de segurança da agenda valem aqui, e nenhuma depende do
 * prompt:
 *
 * 1. **`tenantId`, `conversaId` e `contatoId` são injetados pelo servidor**,
 *    nunca lidos dos argumentos. Nenhuma ferramenta os expõe, então um modelo
 *    que alucine um id não alcança o pedido de outra pessoa.
 * 2. **`fechar_pedido` exige `confirmado: true`.** Com `false` devolve o que
 *    aconteceria e não grava nada. E recusa pedido vazio ou com dado faltando,
 *    o que é o contrato por trás de "não peça endereço antes de o cliente
 *    escolher nada".
 *
 * Toda ferramenta devolve o PEDIDO INTEIRO, não só o que mudou. É isso que faz
 * a resposta natural do bot virar "anotei X e Y, total R$ Z" — o conserto da
 * reclamação de não montar o pedido vem da forma do dado, não de uma regra nova
 * de prompt.
 */
import type { Ferramenta } from '../llm/client.js';
import type { Db } from '../../storage/db.js';
import {
  carregarCatalogoDeProdutos,
  emReais,
  nomesDoCatalogo,
  resolverProduto,
  type CatalogoDeProdutos,
  type Produto,
} from './catalogo-de-produtos.js';
import { normalizar } from '../texto.js';
import {
  adicionarItem,
  anotarDados,
  aplicarDesconto,
  comTaxa,
  faltaParaFechar,
  fecharPedido,
  rascunhoDaConversa,
  removerItem,
  resumirPedido,
  type ContextoDoPedido,
  type Pedido,
} from './pedido-service.js';

export const FERRAMENTAS_DO_PEDIDO: Ferramenta[] = [
  {
    nome: 'ver_pedido',
    descricao:
      'Mostra o pedido que está montado nesta conversa, com itens, taxa de entrega e total. ' +
      'Use SEMPRE antes de informar qualquer valor ao cliente e sempre que ele perguntar ' +
      'quanto deu: o total vem daqui, calculado, e nunca de uma soma sua.',
    parametros: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nome: 'adicionar_ao_pedido',
    descricao:
      'Põe um produto no pedido, ou soma na quantidade do que já estava lá. ' +
      'Chame uma vez por produto, assim que o cliente disser o que quer e quanto.',
    parametros: {
      type: 'object',
      properties: {
        produto: {
          type: 'string',
          description:
            'O produto como está no catálogo (ex.: "polpa de acerola com laranja", ' +
            '"pão de queijo"). Se não existir, a ferramenta recusa — nunca troque por um parecido.',
        },
        quantidade: {
          type: 'number',
          description:
            'Quantos quilos, pacotes ou baldes. Se o cliente não disse, PERGUNTE antes ' +
            'de chamar: não suponha 1.',
        },
      },
      required: ['produto', 'quantidade'],
      additionalProperties: false,
    },
  },
  {
    nome: 'remover_do_pedido',
    descricao: 'Tira um produto do pedido. Use quando o cliente mudar de ideia.',
    parametros: {
      type: 'object',
      properties: {
        produto: { type: 'string', description: 'O produto a tirar, como está no pedido.' },
      },
      required: ['produto'],
      additionalProperties: false,
    },
  },
  {
    nome: 'anotar_dados_da_entrega',
    descricao:
      'Guarda os dados de entrega. Chame assim que o cliente disser qualquer um deles, ' +
      'MESMO que você não tenha perguntado — é o que impede você de pedir duas vezes. ' +
      'Todos os campos são opcionais: mande só o que ele informou agora.',
    parametros: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome de quem vai receber.' },
        endereco: { type: 'string', description: 'Endereço completo da entrega.' },
        horario_desejado: {
          type: 'string',
          description:
            'O horário que o cliente PEDIU. Não é um horário confirmado: quem confirma é ' +
            'a responsável, e você nunca promete horário.',
        },
        forma_de_pagamento: { type: 'string', description: 'Pix, dinheiro ou cartão.' },
      },
      additionalProperties: false,
    },
  },
  {
    nome: 'aplicar_desconto',
    descricao:
      'Aplica ao pedido um desconto CADASTRADO. Só existem os descontos da lista; qualquer ' +
      'outro pedido de desconto NÃO se aplica — nesse caso você não promete nada e chama ' +
      '`avisar_responsavel`. A ferramenta também confere a condição do desconto e recusa se ' +
      'ela não estiver cumprida.',
    parametros: {
      type: 'object',
      properties: {
        desconto: {
          type: 'string',
          description:
            'A chave do desconto cadastrado. Chame `ver_pedido` se não souber quais existem.',
        },
      },
      required: ['desconto'],
      additionalProperties: false,
    },
  },
  {
    nome: 'fechar_pedido',
    descricao:
      'Fecha a venda. Chame primeiro com confirmado=false para ler o pedido inteiro de volta ' +
      'ao cliente, e só depois do sim dele chame com confirmado=true. ' +
      'Recusa se faltar item ou qualquer um dos dados de entrega.',
    parametros: {
      type: 'object',
      properties: {
        confirmado: {
          type: 'boolean',
          description: 'false devolve os dados para você conferir com o cliente; true fecha.',
        },
      },
      required: ['confirmado'],
      additionalProperties: false,
    },
  },
];

export interface ContextoDasFerramentasDoPedido {
  db: Db;
  tenantId: number;
  tenantSlug: string;
  contatoId: string;
  conversaId?: number;
  /** Modo seco: a avaliação não pode gravar pedido no banco do cliente. */
  semPersistir: boolean;
  /**
   * O que o cliente escreveu neste turno.
   *
   * Entra aqui só para a checagem de unidade: quando ele conta em PACOTES um
   * produto vendido por QUILO, a ferramenta recusa em vez de somar. Ver
   * `unidadeIncompativel`.
   */
  mensagemDoCliente?: string;
}

/**
 * O cliente contou em pacotes/unidades um produto vendido por QUILO?
 *
 * É o mal-entendido mais caro deste negócio, tirado de uma conversa real: o
 * cliente pediu *"05 polpas de acerola, 05 de maracujá"* querendo cinco pacotes
 * de 100 g de cada. Lido como 5 kg de cada, viram R$ 300 em vez de uns R$ 30 —
 * e nem é vendável, porque só sai quilo fechado. Na conversa real quem pegou
 * foi a dona, perguntando *"seria 5kg de cada?"*; o cliente respondeu *"não, 5
 * kg é muito"* e refez o pedido.
 *
 * A checagem exige que a mensagem conte em pacotes E **não** mencione quilo
 * nenhum. Sem essa segunda metade, "1 kg de acerola e 2 pacotes de pão de
 * queijo" faria a acerola ser recusada por causa do pão de queijo — e pedido
 * com duas unidades diferentes na mesma frase é comum.
 *
 * Produto cuja unidade JÁ É o pacote (o pão de queijo vem em pacote de 1 kg)
 * não entra nisto: ali "2 pacotes" é exatamente o que o cliente quis dizer.
 */
/**
 * O aviso de unidade que vai no prompt, antes de o modelo responder.
 *
 * É a SEGUNDA rede, e ela existe porque a primeira é probabilística. Medido em
 * 5 rodadas da suíte paga: com a regra só no prompt e nos documentos, "quero 5
 * polpas de acerola e 5 de maracujá" foi respondido como 5 kg de cada — R$
 * 300,00 — em 1 de cada 5 execuções. A recusa de `adicionar_ao_pedido` cobre o
 * caminho do pedido, mas não cobre o cliente que só pergunta o preço: ali o
 * modelo responde sem chamar ferramenta nenhuma, e não há contrato no meio.
 *
 * Então o aviso é injetado por código, a partir do texto do cliente, da mesma
 * forma que a rede de palavra-chave dos alertas — que também nasceu de o modelo
 * esquecer de chamar a ferramenta.
 *
 * Procura o produto citado para não avisar errado: o pão de queijo vem em
 * pacote de 1 kg, então ali "2 pacotes" são 2 quilos e não há nada a corrigir.
 */
export function avisoDeUnidade(
  catalogo: CatalogoDeProdutos,
  mensagemDoCliente: string,
): string | undefined {
  const citados = catalogo.produtos.filter((p) =>
    [p.nome, ...p.termos].some((termo) => contemTermo(mensagemDoCliente, termo)),
  );

  const porQuilo = citados.filter((p) => unidadeIncompativel(p, mensagemDoCliente));
  if (porQuilo.length === 0) return undefined;

  const nomes = porQuilo.map((p) => p.nome).join(', ');

  return [
    'ATENÇÃO — UNIDADE:',
    `O cliente contou em pacotes/unidades, e isto é vendido por QUILO fechado: ${nomes}.`,
    'Ele quase certamente NÃO quer esse número em quilos: 1 quilo tem 10 pacotes de 100 g, ' +
      'então o que ele pediu é dez vezes menos. Somar como quilo multiplica o pedido por dez.',
    'NÃO dê preço e NÃO monte pedido com esse número. Explique o quilo fechado e PERGUNTE ' +
      'quantos quilos ele quer.',
  ].join('\n');
}

/** O termo aparece na mensagem como palavra inteira. */
function contemTermo(mensagem: string, termo: string): boolean {
  const t = normalizar(termo);
  if (t.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(
    normalizar(mensagem),
  );
}

export function unidadeIncompativel(produto: Produto, mensagemDoCliente: string): boolean {
  if (!produto.unidade.startsWith('kg')) return false;

  const contaEmPacotes =
    /\d+\s*(pacote|pacotes|unidade|unidades|sach[êe]|sach[êe]s|saquinho|saquinhos|polpa|polpas|pote|potes)\b/i.test(
      mensagemDoCliente,
    );
  const mencionaQuilo = /\d+\s*(kg|quilo|quilos|kilo|kilos|k\b)/i.test(mensagemDoCliente);

  return contaEmPacotes && !mencionaQuilo;
}

/** Executa uma ferramenta de pedido. Nunca lança: erro vira texto para o modelo. */
export function executarFerramentaDoPedido(
  ctx: ContextoDasFerramentasDoPedido,
  nome: string,
  argumentos: Record<string, unknown>,
): string {
  // Sem conversa não há carrinho — e é o caso da suíte de avaliação, que roda
  // com `semPersistir` e sem conversa. Recusar aqui é melhor que criar um
  // pedido órfão só para a avaliação poder medir.
  if (ctx.conversaId === undefined || ctx.semPersistir) {
    return JSON.stringify({
      ok: false,
      erro:
        'O pedido só existe dentro de uma conversa. Responda sobre preços pelos documentos, ' +
        'sem montar pedido.',
    });
  }

  const catalogo = carregarCatalogoDeProdutos(ctx.tenantSlug);
  const contexto: ContextoDoPedido = {
    db: ctx.db,
    tenantId: ctx.tenantId,
    conversaId: ctx.conversaId,
    contatoId: ctx.contatoId,
    catalogo,
  };

  switch (nome) {
    case 'ver_pedido': {
      const atual = rascunhoDaConversa(ctx.db, ctx.conversaId);
      if (!atual) {
        return JSON.stringify({
          ok: true,
          pedido: 'vazio',
          instrucao:
            'Nenhum item escolhido ainda. Pergunte o que o cliente quer e quantos quilos. ' +
            `O catálogo é: ${nomesDoCatalogo(catalogo).join(', ')}.`,
        });
      }

      const pedido = comTaxa(ctx.db, atual.id, catalogo);
      if (!pedido) return JSON.stringify({ ok: false, erro: 'pedido ilegível' });

      // Os descontos cadastrados vão junto: e assim que o modelo descobre as
      // chaves que `aplicar_desconto` aceita, sem precisar adivinhar.
      const comDescontos = {
        ...JSON.parse(respostaDoPedido(pedido, 'conferindo')),
        descontos_cadastrados: catalogo.descontos.map((d) => ({
          chave: d.chave,
          nome: d.nome,
          valor: emReais(d.valorCentavos),
          condicao: d.condicao ?? '',
        })),
      };

      return JSON.stringify(comDescontos);
    }

    case 'adicionar_ao_pedido': {
      const produto = texto(argumentos.produto);
      const quantidade = Number(argumentos.quantidade);

      if (produto.length === 0) {
        return JSON.stringify({ ok: false, erro: 'produto é obrigatório.' });
      }

      // A unidade e conferida ANTES de somar, porque somar errado aqui e o erro
      // mais caro que este negocio comete.
      const resolvido = resolverProduto(catalogo, produto);
      if (
        resolvido.tipo === 'achado' &&
        ctx.mensagemDoCliente !== undefined &&
        unidadeIncompativel(resolvido.produto, ctx.mensagemDoCliente)
      ) {
        return JSON.stringify({
          ok: false,
          erro:
            `O cliente contou em pacotes, mas ${resolvido.produto.nome} é vendida por QUILO ` +
            `fechado — 1 kg tem 10 pacotes de 100 g, e não vendemos pacote avulso. ` +
            `NÃO suponha a quantidade: explique isso e PERGUNTE quantos quilos ele quer. ` +
            `Cuidado, a diferença é grande: 5 pacotes são meio quilo, 5 quilos são 50 pacotes.`,
        });
      }

      const r = adicionarItem(contexto, produto, quantidade);
      return r.ok
        ? respostaDoPedido(r.valor, 'escolhendo')
        : JSON.stringify({ ok: false, erro: r.motivo });
    }

    case 'remover_do_pedido': {
      const r = removerItem(contexto, texto(argumentos.produto));
      return r.ok
        ? respostaDoPedido(r.valor, 'escolhendo')
        : JSON.stringify({ ok: false, erro: r.motivo });
    }

    case 'anotar_dados_da_entrega': {
      const r = anotarDados(contexto, {
        ...(texto(argumentos.nome) ? { nome: texto(argumentos.nome) } : {}),
        ...(texto(argumentos.endereco) ? { endereco: texto(argumentos.endereco) } : {}),
        ...(texto(argumentos.horario_desejado)
          ? { horarioDesejado: texto(argumentos.horario_desejado) }
          : {}),
        ...(texto(argumentos.forma_de_pagamento)
          ? { formaDePagamento: texto(argumentos.forma_de_pagamento) }
          : {}),
      });

      // O cliente acabou de ENTREGAR um dado de entrega: ele está fechando, e
      // aí pedir o que ainda falta é a coisa certa.
      return r.ok
        ? respostaDoPedido(r.valor, 'fechando')
        : JSON.stringify({ ok: false, erro: r.motivo });
    }

    case 'aplicar_desconto': {
      const r = aplicarDesconto(contexto, texto(argumentos.desconto));
      return r.ok
        ? respostaDoPedido(r.valor, 'conferindo')
        : JSON.stringify({ ok: false, erro: r.motivo });
    }

    case 'fechar_pedido': {
      const confirmado = argumentos.confirmado === true;
      const r = fecharPedido(contexto, confirmado);

      if (!r.ok) return JSON.stringify({ ok: false, erro: r.motivo });

      const pedido = r.valor;
      const comum = {
        ok: true,
        pedido: resumirPedido(pedido),
        dados: pedido.dados,
      };

      if (!confirmado) {
        return JSON.stringify({
          ...comum,
          simulado: true,
          instrucao:
            'NADA foi fechado ainda. Leia o pedido inteiro de volta ao cliente — itens, total, ' +
            'endereço, horário pedido e forma de pagamento — e espere ele confirmar. Diga que o ' +
            'HORÁRIO ainda vai ser confirmado pela responsável.',
        });
      }

      return JSON.stringify({
        ...comum,
        fechado: true,
        pedidoId: pedido.id,
        instrucao:
          'Pedido registrado. Confirme ao cliente e lembre que a responsável vai confirmar o ' +
          'HORÁRIO da entrega. Não prometa horário.',
      });
    }

    default:
      return JSON.stringify({ ok: false, erro: `Ferramenta desconhecida: ${nome}` });
  }
}

/**
 * Em que momento do atendimento esta chamada aconteceu.
 *
 * Não é adivinhação de intenção: QUAL ferramenta o modelo chamou já diz o que o
 * cliente acabou de fazer. Quem acabou de adicionar um item está escolhendo;
 * quem entregou um dado de entrega está fechando.
 */
type Momento = 'escolhendo' | 'conferindo' | 'fechando';

/**
 * O pedido como o modelo vai ler.
 *
 * O NOME do campo que lista o que falta muda com o momento, e isso não é
 * estética — é a correção de um defeito medido. Até 2026-10-03 todo resultado
 * trazia `ainda_falta` junto com "não peça de novo nada que esteja em
 * `ja_anotado`". Lido por um modelo, isso é uma lista de pendências entregue na
 * mão a cada item adicionado, mais uma autorização implícita para pedir todo o
 * resto. Na conversa 37 ele pediu nome, endereço e pagamento em SETE turnos
 * seguidos enquanto o cliente ainda escolhia — doze achados de
 * `pedido_insistente`.
 *
 * E o prompt mandava o contrário: a etapa 3 dizia "enquanto ele estiver somando
 * itens, pergunte se quer mais alguma coisa". A regra perdeu porque **dado
 * concreto na mão do modelo ganha de regra abstrata no prompt**. Então o
 * conserto é no dado.
 */
function respostaDoPedido(pedido: Pedido, momento: Momento): string {
  const falta = faltaParaFechar(pedido);

  const comum = {
    ok: true,
    itens: pedido.itens.map((i) => ({
      produto: i.rotulo,
      quantidade: i.quantidade,
      unidade: i.unidade,
      preco_unitario: emReais(i.precoUnitarioCentavos),
      subtotal: emReais(i.subtotalCentavos),
    })),
    soma_dos_itens: emReais(pedido.itensCentavos),
    peso_kg: pedido.pesoKg,
    taxa_de_entrega: pedido.taxaIndefinida
      ? 'a confirmar com a responsável'
      : emReais(pedido.taxaCentavos),
    ...(pedido.desconto
      ? {
          desconto_aplicado: {
            chave: pedido.desconto.chave,
            nome: pedido.desconto.nome,
            valor: emReais(pedido.desconto.valorCentavos),
          },
        }
      : {}),
    total: emReais(pedido.totalCentavos),
    ja_anotado: pedido.dados,
  };

  const valores = pedido.taxaIndefinida
    ? 'O pedido tem item vendido por volume, e a taxa de entrega é por peso: NÃO afirme a ' +
      'taxa. Avise que vai confirmar e chame `avisar_responsavel`. O TOTAL acima é sem taxa.'
    : 'Use estes valores exatamente como estão e não recalcule.';

  if (momento === 'fechando') {
    return JSON.stringify({
      ...comum,
      ainda_falta: falta,
      instrucao:
        `${valores} ` +
        'Agora é hora de fechar: peça de uma vez só o que está em `ainda_falta`, e nada além ' +
        'disso. Se você já pediu e o cliente não respondeu, NÃO repita o pedido — siga o ' +
        'atendimento e volte a isso depois.',
    });
  }

  // `falta_quando_fechar` em vez de `ainda_falta`: o mesmo dado, com um nome que
  // se lê como informação e não como tarefa. O modelo precisa SABER o que falta
  // (é o que impede ele de pedir o que já tem) sem ser empurrado a pedir agora.
  return JSON.stringify({
    ...comum,
    falta_quando_fechar: falta,
    instrucao:
      momento === 'escolhendo'
        ? `${valores} ` +
          'O cliente acabou de mexer no pedido, ou seja, ainda está escolhendo. Confirme o que ' +
          'entrou e pergunte se ele quer mais alguma coisa. NÃO peça nome, endereço nem forma ' +
          'de pagamento agora: você já avisou no começo o que vai precisar, e pedir a cada item ' +
          'deixa a conversa repetitiva e apressada.'
        : `${valores} ` +
          'Responda o que o cliente perguntou. Se ele não pediu para fechar, NÃO peça os dados ' +
          'de entrega nesta mensagem.',
  });
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
