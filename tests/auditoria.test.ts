/**
 * Testes da auditoria de conversa.
 *
 * Todo caso aqui saiu de uma conversa REAL na página (conversa 22, 2026-09-29),
 * em que o bot pediu o nome, a data e o convênio várias vezes e afirmou preço
 * com contexto vazio. O comentário de cada teste diz qual era o caso.
 *
 * A auditoria é um lint por padrão de texto, então metade destes testes existe
 * para os FALSOS POSITIVOS: o que ela não pode acusar.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { auditarConversa, type ConversaParaAuditar } from '../src/core/conversation/auditoria.js';
import type { MensagemGravada } from '../src/storage/repositories/messages.js';
import type { Fonte } from '../src/core/types.js';

const LIMIAR = 0.4;

const CONVERSA: ConversaParaAuditar = {
  id: 1,
  contatoId: 'web-teste',
  canal: 'web',
  status: 'open',
};

let proximoId = 0;

function cliente(conteudo: string): MensagemGravada {
  proximoId += 1;
  return {
    id: proximoId,
    conversaId: 1,
    papel: 'user',
    conteudo,
    tokensEntrada: null,
    tokensSaida: null,
    custoUsd: null,
    latenciaMs: null,
    fontes: [],
    usouFerramenta: false,
    criadaEm: '2026-09-29 12:00:00',
  };
}

/**
 * Resposta do bot. `score` vira a fonte citada; `null` = não citou nenhuma.
 * `usouFerramenta` marca a resposta que saiu da agenda, e não dos documentos.
 */
function bot(
  conteudo: string,
  score: number | null = 0.6,
  usouFerramenta = false,
): MensagemGravada {
  proximoId += 1;
  const fontes: Fonte[] = score === null ? [] : [{ arquivo: 'faq.md', score }];

  return {
    id: proximoId,
    conversaId: 1,
    papel: 'assistant',
    conteudo,
    tokensEntrada: 100,
    tokensSaida: 30,
    custoUsd: 0.001,
    latenciaMs: 1500,
    fontes,
    usouFerramenta,
    criadaEm: '2026-09-29 12:00:01',
  };
}

function auditar(mensagens: MensagemGravada[]) {
  proximoId = 0;
  return auditarConversa(CONVERSA, mensagens, LIMIAR);
}

/** Audita como um cliente que VENDE — liga `nao_somou` e `pediu_dado_cedo_demais`. */
function auditarVenda(mensagens: MensagemGravada[]) {
  proximoId = 0;
  return auditarConversa(CONVERSA, mensagens, LIMIAR, { vende: true });
}

function tipos(relatorio: ReturnType<typeof auditar>): string[] {
  return relatorio.problemas.map((p) => p.tipo);
}

describe('pedido repetido', () => {
  it('ACUSA pedir o nome que o cliente já mandou', () => {
    // O caso que o usuário reclamou: mandou o nome e o bot pediu de novo.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo, por favor.'),
      cliente('gabriel abraao possas borges'),
      bot('Me confirma seu nome completo, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
    expect(r.problemas[0]?.grave).toBe(true);
    expect(r.problemas[0]?.turno).toBe(2);
    expect(r.problemas[0]?.detalhe).toContain('o nome');
  });

  it('ACUSA pedir a data que o BOT mesmo já disse', () => {
    // Medido: o bot ofereceu "próxima sexta (02/10)" e depois pediu "a data
    // exata" três vezes. A conversa tinha a data — dita por ele.
    const r = auditar([
      cliente('tem horario essa semana?'),
      bot('Na próxima sexta (02/10) tenho 09:00 e 10:00.'),
      cliente('as 9'),
      bot('Preciso da data exata para seguir.'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
    expect(r.problemas[0]?.detalhe).toContain('a data');
  });

  it('ACUSA pedir o telefone depois de receber dígitos', () => {
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu telefone, por favor.'),
      cliente('67999359933'),
      bot('Qual o seu telefone?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
  });

  it('insistir num dado que ninguém mandou é outro TIPO, e pesa igual', () => {
    // Insistir não é esquecimento — é pressa —, então o tipo continua separado.
    // Mas os dois são graves desde 2026-10-03: a conversa 37 tirou 100%
    // carregando doze `pedido_insistente`, com o bot pedindo nome, endereço e
    // pagamento em sete turnos seguidos enquanto o cliente ainda escolhia.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo, por favor.'),
      cliente('pode ser amanha?'),
      bot('Me confirma seu nome completo, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_insistente']);
    expect(r.problemas[0]?.grave).toBe(true);
    expect(r.aproveitamento).toBe(0.5);
  });

  it('ESTREITAR a lista não é insistir', () => {
    // Medido na conversa 38, na fase de fechamento: o cliente entrega um dado
    // por mensagem e o bot responde "falta só o horário e a forma de pagamento",
    // depois "falta só o horário". Pedir MENOS a cada volta é progresso, e
    // acusar isso marcaria como defeito a única forma honesta de o bot dizer
    // onde a conversa está.
    const r = auditarVenda([
      cliente('so isso'),
      bot(
        'Me passa o nome de quem recebe, o endereço completo, o horário que fica melhor e a ' +
          'forma de pagamento.',
        0.5,
        true,
      ),
      cliente('Rua antonio, 384'),
      bot(
        'Anotei o endereço. Falta o nome de quem recebe, o horário que fica melhor e a forma ' +
          'de pagamento.',
        0.5,
        true,
      ),
      cliente('Pedro'),
      bot('Anotei o nome. Falta o horário que fica melhor e a forma de pagamento.', 0.5, true),
      cliente('pix'),
      bot('Anotei o Pix. Falta o horário que fica melhor.', 0.5, true),
    ]);

    expect(tipos(r).filter((t) => t === 'pedido_insistente')).toEqual([]);
  });

  it('mas repetir o MESMO conjunto continua sendo insistência', () => {
    // É a conversa 37: os mesmos quatro campos, turno após turno, enquanto o
    // cliente ainda escolhia os itens. Onze achados.
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('Me passa o nome de quem recebe, o endereço e a forma de pagamento.', 0.5, true),
      cliente('e 1 kg de goiaba'),
      bot('Me passa o nome de quem recebe, o endereço e a forma de pagamento.', 0.5, true),
    ]);

    expect(tipos(r).filter((t) => t === 'pedido_insistente')).toHaveLength(3);
  });

  it('NÃO acusa o primeiro pedido', () => {
    const r = auditar([cliente('quero marcar'), bot('Me manda seu nome completo, por favor.')]);

    expect(r.problemas).toEqual([]);
    expect(r.aproveitamento).toBe(1);
  });
});

describe('o que a auditoria NÃO pode acusar', () => {
  it('reconhecimento não conta como pedido', () => {
    // "Recebi seu telefone, obrigado. Me confirma a data" pede a DATA. Sem
    // separar as frases, isto viraria "pediu o telefone de novo".
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu telefone.'),
      cliente('67999359933'),
      bot('Recebi seu telefone, obrigado. Me confirma a data, por favor?'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('o emoji separa o reconhecimento do pedido', () => {
    // Achado rodando contra a conversa real: "Já recebi, sim 😊 Me confirma seu
    // nome completo" não tem ponto no meio. Como uma frase só, o "recebi" fazia
    // tudo passar por reconhecimento e o pedido de nome — que é o defeito —
    // escapava do relatório.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo.'),
      cliente('gabriel abraao possas borges'),
      bot('Já recebi, sim 😊 Me confirma seu nome completo, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
    expect(r.problemas[0]?.grave).toBe(true);
  });

  it('comentar um dado não é pedir', () => {
    // "já posso agendar com seu nome e telefone" fala de nome e telefone sem
    // pedir nada. Contar como pedido inventaria dois defeitos por resposta.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo e telefone.'),
      cliente('gabriel abraao possas borges'),
      bot('Se quiser, já posso agendar com seu nome e telefone.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('frase curta do cliente não é nome', () => {
    // "ta certo", "ja te mandei" e "nao tenho convenio" têm forma de nome: só
    // letras, duas palavras. Se qualquer uma passasse, o relatório acusaria um
    // esquecimento que não houve.
    for (const frase of ['ta certo', 'ja te mandei', 'nao tenho convenio', 'como funciona']) {
      const r = auditar([
        cliente('quero marcar'),
        bot('Me manda seu nome completo, por favor.'),
        cliente(frase),
        bot('Me confirma seu nome completo, por favor?'),
      ]);

      expect(tipos(r), `"${frase}" não deveria contar como nome`).toEqual(['pedido_insistente']);
    }
  });

  it('frase curta ANTES de pedir o nome não é o nome', () => {
    // Achado na conversa 23: "boa boa" abriu a conversa, tem duas palavras e só
    // letras — forma de nome. Foi contado como o nome do cliente, e os dois
    // pedidos seguintes viraram "pediu o nome, que a conversa já tinha".
    //
    // Nome não tem formato que o separe de uma frase curta qualquer. O que o
    // separa é vir DEPOIS de alguém perguntar.
    const r = auditar([
      cliente('boa boa'),
      bot('Oi! Como posso te ajudar?', 0.3),
      cliente('quero marcar'),
      bot('Me manda seu nome completo, por favor.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('telefone e data valem mesmo sem ninguém ter pedido', () => {
    // A trava acima é só do nome: telefone e data têm formato próprio, e o
    // cliente pode dar de mão beijada. Se a trava valesse para todos, "quero
    // dia 8" seguido de "qual dia?" deixaria de ser acusado.
    const r = auditar([
      cliente('quero marcar na proxima sexta, meu fone e 67999359933'),
      bot('Qual o seu telefone? Me confirma a data exata também.'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido', 'pedido_repetido']);
  });

  it('pedir de novo o que foi RECUSADO não é esquecimento', () => {
    // Medido com a API real: o cliente mandou as três mensagens juntas, o
    // horário pedido estava ocupado, e o bot respondeu corretamente "às 09:00
    // não tenho horário livre... me diga qual prefere". O relatório acusou
    // "pediu o horário, que a conversa já tinha" e deu 0% para a MELHOR das
    // duas conversas comparadas.
    const r = auditar([
      cliente(['quero marcar', 'pra proxima sexta', 'as 9 da manha'].join('\n')),
      bot(
        'Às 09:00 não tenho horário livre. Tenho 08:00 e 10:00. Me diga qual horário prefere.',
        0.482,
        true,
      ),
    ]);

    expect(tipos(r)).toEqual([]);
    expect(r.aproveitamento).toBe(1);
  });

  it('mas continua acusando quando NÃO houve recusa', () => {
    // A trava acima não pode virar desculpa geral: sem recusa na resposta, o
    // pedido repetido continua sendo defeito.
    const r = auditar([
      cliente('quero marcar as 9 da manha'),
      bot('Certo! Me diga qual horário você prefere.', 0.48, true),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
  });

  it('hora não conta como telefone', () => {
    // "as 9" tem dígito. Se contasse como telefone, pedir o telefone depois
    // viraria esquecimento.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu telefone.'),
      cliente('as 9'),
      bot('Qual o seu telefone?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_insistente']);
  });
});

describe('contexto fraco', () => {
  it('ACUSA afirmar preço com o melhor score abaixo do limiar', () => {
    // Medido: "como funciona" recebeu formas de pagamento (R$ 100,00, 6x) com
    // score 0.281. O assunto não era pagamento e o contexto estava vazio.
    const r = auditar([
      cliente('como funciona'),
      bot('Parcelamos em até 6x sem juros, com mínimo de R$ 100,00 por parcela.', 0.281),
    ]);

    expect(tipos(r)).toEqual(['afirmou_com_contexto_fraco']);
    expect(r.problemas[0]?.detalhe).toContain('0.281');
  });

  it('NÃO acusa resposta sem dado, mesmo com score baixo', () => {
    // "Me confirma seu nome" com score 0.31 não afirma nada. Acusar aqui
    // encheria o relatório de ruído e esconderia o caso que importa.
    const r = auditar([cliente('gabriel abraao possas borges'), bot('Perfeito, Gabriel.', 0.31)]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa resposta que veio da FERRAMENTA', () => {
    // Achado na conversa 23: "tenho horários às 08:00, 09:00..." saiu da agenda,
    // com autoridade total, e o melhor chunk recuperado marcava 0.391. O
    // relatório acusou três vezes, e nas três o dado estava certo. O score da
    // busca não se aplica quando quem respondeu foi a ferramenta.
    const r = auditar([
      cliente('quero na proxima quinta'),
      bot('Na próxima quinta (08/10) tenho 08:00, 09:00 e 10:00.', 0.391, true),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa afirmação com contexto firme', () => {
    const r = auditar([cliente('quanto custa a limpeza?'), bot('A limpeza custa R$ 180,00.', 0.62)]);

    expect(tipos(r)).toEqual([]);
  });
});

describe('sem fonte e handoff', () => {
  it('NÃO acusa turno social sem fonte', () => {
    // Saudação não passa pela busca de propósito: não citar fonte é o certo.
    const r = auditar([cliente('oiee'), bot('Oiee! Como posso te ajudar?', null)]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa a confirmação do botão de retomada', () => {
    // Achado rodando contra o banco real: "Voltei! Pode continuar, estou aqui."
    // é resposta a um BOTÃO, não a uma pergunta. Sem esta exceção, toda volta de
    // handoff levava um `sem_fonte` inventado.
    const r = auditar([
      cliente('vocês vendem pizza?'),
      bot('Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.', null),
      bot(config.resposta.fraseDeRetomada, null),
    ]);

    expect(tipos(r)).toEqual(['handoff']);
  });

  it('ACUSA responder sem fonte a uma pergunta de verdade', () => {
    const r = auditar([cliente('quanto custa a limpeza?'), bot('Custa R$ 180,00.', null)]);

    expect(tipos(r)).toEqual(['sem_fonte']);
  });

  it('ACUSA o handoff pela frase, não pela tabela', () => {
    // A mesma detecção do motor: o modelo parafraseia a primeira oração e só a
    // promessa de escalar é estável.
    const r = auditar([
      cliente('qual o cnpj?'),
      bot('Não tenho essa informação aqui. Vou chamar alguém da equipe para te ajudar.', 0.59),
    ]);

    expect(tipos(r)).toEqual(['handoff']);
    expect(r.aproveitamento).toBe(0);
  });
});

/**
 * Os achados abaixo nasceram da conversa 33 da Polpa Santa Helena (2026-10-01),
 * que tirou 100% de aproveitamento contendo o pior defeito desta fase: o
 * cliente pediu o total e o bot mandou ele mandar os itens de novo.
 */
describe('não somou o pedido', () => {
  it('ACUSA pedir o total e não vir valor nenhum', () => {
    // O turno 9 da conversa 33. O bot tinha o pedido, escalou uma SOMA para a
    // dona do negócio e pediu os itens de volta.
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('2 kg de açaí dá R$ 70,00.'),
      cliente('qual o valor de tudo?'),
      bot('Vou confirmar o total certinho com a responsável. Me manda de novo os itens.', 0.519),
    ]);

    expect(tipos(r)).toContain('nao_somou');
    expect(r.problemas.find((p) => p.tipo === 'nao_somou')?.grave).toBe(true);
  });

  it('NÃO acusa quando o total vem junto', () => {
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('2 kg de açaí dá R$ 70,00.'),
      cliente('qual o valor de tudo?'),
      bot('Fica R$ 70,00 no total, com entrega grátis.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa em cliente que não vende', () => {
    // Numa clínica "no total" aparece em outros contextos e não existe pedido
    // para somar. O achado é opt-in por isso.
    const r = auditar([
      cliente('qual o valor de tudo?'),
      bot('Depende do que você precisa fazer.', 0.5),
    ]);

    expect(tipos(r)).toEqual([]);
  });
});

describe('o dado que o cliente deu e o bot não gravou', () => {
  it('ACUSA responder sem chamar ferramenta depois de o cliente dar um dado', () => {
    // Conversa 41: o cliente disse "pix", o bot respondeu "falta só o horário"
    // com `used_tool = 0` — deduziu o que faltava da sua própria mensagem
    // anterior. Dois turnos depois a ferramenta informou que o pix nunca tinha
    // sido gravado, e para o cliente o bot pareceu esquecer.
    const r = auditarVenda([
      cliente('so isso'),
      bot('Falta o horário que fica melhor e a forma de pagamento.', 0.5, true),
      cliente('pix'),
      bot('Perfeito. Falta só me dizer o horário que fica melhor.', 0.4, false),
    ]);

    const achado = r.problemas.find((p) => p.tipo === 'nao_gravou_o_dado');
    expect(achado?.grave).toBe(true);
    expect(achado?.detalhe).toContain('forma de pagamento');
  });

  it('NÃO acusa quando a ferramenta foi chamada', () => {
    const r = auditarVenda([
      cliente('so isso'),
      bot('Falta o horário que fica melhor e a forma de pagamento.', 0.5, true),
      cliente('pix'),
      bot('Anotei o Pix. Falta só o horário que fica melhor.', 0.4, true),
    ]);

    expect(tipos(r).filter((t) => t === 'nao_gravou_o_dado')).toEqual([]);
  });

  it('NÃO acusa quando o cliente REPETE um dado que já estava gravado', () => {
    // Repetir não exige gravar de novo. Só dado novo precisa de ferramenta.
    const r = auditarVenda([
      cliente('pago no pix'),
      bot('Anotei o Pix.', 0.4, true),
      cliente('pode ser no pix mesmo'),
      bot('Perfeito, segue no Pix então.', 0.4, false),
    ]);

    expect(tipos(r).filter((t) => t === 'nao_gravou_o_dado')).toEqual([]);
  });

  it('NÃO acusa na clínica, que grava tudo de uma vez no agendamento', () => {
    const r = auditar([
      cliente('meu telefone e 67999359933'),
      bot('Perfeito. Qual horário você prefere?', 0.5, false),
    ]);

    expect(tipos(r).filter((t) => t === 'nao_gravou_o_dado')).toEqual([]);
  });
});

describe('disse que anotou e não anotou', () => {
  it('ACUSA "já anotei" sem chamada de ferramenta', () => {
    // Conversa 38: o cliente mandou "Pedro", o bot respondeu "Perfeito, já
    // anotei o nome" com `used_tool = 0`, e nada foi gravado. Dois turnos
    // depois a ferramenta disse que o nome faltava e ele pediu de novo a quem
    // tinha acabado de dar. É o pior tipo de defeito: o texto tranquiliza e o
    // estado está errado.
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('Até agora são 2 kg de açaí, R$ 70,00. Quer mais alguma coisa?', 0.6, true),
      cliente('Pedro'),
      bot('Perfeito, já anotei o nome.', 0.38, false),
    ]);

    expect(tipos(r)).toContain('afirmou_ter_anotado');
    expect(r.problemas.find((p) => p.tipo === 'afirmou_ter_anotado')?.grave).toBe(true);
  });

  it('NÃO acusa quando a ferramenta foi chamada', () => {
    const r = auditarVenda([
      cliente('Pedro, rua das flores 120'),
      bot('Perfeito, já anotei o nome e o endereço.', 0.4, true),
    ]);

    expect(tipos(r).filter((t) => t === 'afirmou_ter_anotado')).toEqual([]);
  });

  it('NÃO acusa na clínica, onde "anotei" é jeito de falar', () => {
    // Lá o bot coleta nome e telefone na conversa e grava tudo de uma vez no
    // `criar_agendamento`. Não existe ferramenta cujo trabalho seja anotar.
    const r = auditar([
      cliente('gabriel abraao possas borges'),
      bot('Perfeito, já anotei. Qual horário você prefere?', 0.5, false),
    ]);

    expect(tipos(r).filter((t) => t === 'afirmou_ter_anotado')).toEqual([]);
  });
});

describe('pediu dado de fechamento cedo demais', () => {
  it('ACUSA pedir endereço e pagamento antes de o cliente escolher nada', () => {
    // O turno 2 da conversa 33, a SEGUNDA mensagem do atendimento. O cliente só
    // tinha dito "gostaria de encomendar algumas polpas para amanhã".
    const r = auditarVenda([
      cliente('Gostaria de encomendar algumas polpas para amanhã'),
      bot(
        'Claro! Me passa o nome de quem recebe, endereço completo, horário que fica melhor ' +
          'amanhã e a forma de pagamento.',
        0.475,
      ),
    ]);

    const achados = r.problemas.filter((p) => p.tipo === 'pediu_dado_cedo_demais');
    expect(achados).toHaveLength(2);
    expect(achados.map((p) => p.detalhe).join(' ')).toMatch(/endereço/);
    expect(achados.map((p) => p.detalhe).join(' ')).toMatch(/pagamento/);
  });

  it('NÃO acusa depois de existir quantidade na conversa', () => {
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('2 kg de açaí dá R$ 70,00. Me passa o endereço e a forma de pagamento.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa pedir o NOME antes do pedido', () => {
    // Decisão do dono do negócio: perguntar o nome no começo é educação, não
    // pressa. Quem assusta é endereço e pagamento.
    const r = auditarVenda([cliente('bom dia, queria encomendar'), bot('Claro! Qual o seu nome?')]);

    expect(tipos(r)).toEqual([]);
  });

  it('entende "2kg" grudado como quantidade', () => {
    // O cliente escreve "2kg", o bot escreve "2 kg". Se a quantidade não fosse
    // reconhecida nas duas formas, todo pedido legítimo viraria "cedo demais".
    const r = auditarVenda([
      cliente('quanto sai 2kg de morango?'),
      bot('2 kg de morango = R$ 70,00. Me passa o endereço da entrega.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });
});

describe('endereço e pagamento', () => {
  it('ACUSA pedir o endereço que a conversa já tinha', () => {
    // Conversa 32, turnos 10, 11 e 13: o cliente deu nome e endereço e o bot
    // pediu os dois de novo, cinco vezes somando os dois campos. A lista de
    // dados era vocabulário de clínica e nada disso era visível.
    const r = auditar([
      cliente('quero comprar'),
      bot('Me passa o endereço completo e a forma de pagamento.'),
      cliente('maria souza, rua das flores 120 jardim aero rancho'),
      bot('Perfeito. Me confirma o endereço completo, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
    expect(r.problemas[0]?.detalhe).toContain('o endereço');
  });

  it('ACUSA pedir a forma de pagamento que o cliente já escolheu', () => {
    const r = auditar([
      cliente('quero comprar'),
      bot('Qual a forma de pagamento?'),
      cliente('pago no pix'),
      bot('Me confirma a forma de pagamento, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_repetido']);
  });

  it('a POLÍTICA de cobertura dita pelo bot não é o endereço do cliente', () => {
    // "Entregamos em toda Campo Grande, em qualquer bairro" casa com o padrão de
    // endereço por causa de "bairro". Se contasse como endereço recebido, o
    // pedido legítimo seguinte viraria defeito.
    const r = auditar([
      cliente('vocês entregam em qualquer lugar?'),
      bot('Entregamos em toda Campo Grande, em qualquer bairro, e também em Terenos.'),
      cliente('quero comprar'),
      bot('Me passa o endereço completo da entrega.'),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('a LISTA de formas de pagamento não é a escolha do cliente', () => {
    const r = auditar([
      cliente('como posso pagar?'),
      bot('Aceitamos Pix, dinheiro e cartão, na entrega.'),
      cliente('quero comprar'),
      bot('Qual a forma de pagamento?'),
    ]);

    expect(tipos(r)).toEqual([]);
  });
});

describe('repetiu informação', () => {
  it('ACUSA repetir o aviso de embalagem sem ninguém ter perguntado', () => {
    // A reclamação literal: "ele está citando demais que vem 10 pacotes em 1kg".
    // Turnos 4 e 5 da conversa 33, seguidos. As duas frases não são iguais — o
    // que elas compartilham é a janela "10 pacotes de 100".
    const r = auditarVenda([
      cliente('eu ja quero 2 pacotes de pao de queijo'),
      bot('Pão de queijo congelado: R$ 25,00 o quilo. Cada quilo vem com 10 pacotes de 100 g.'),
      cliente('quero 1 kg de polpa de acerola com laranja'),
      bot('Polpa de acerola com laranja: R$ 25,00 o quilo.\n1 kg = 10 pacotes de 100 g.'),
    ]);

    const achado = r.problemas.find((p) => p.tipo === 'repetiu_informacao');
    expect(achado?.grave).toBe(true);
    expect(achado?.detalhe).toContain('10 pacotes de 100');
    expect(achado?.turno).toBe(2);
  });

  it('NÃO acusa confirmar o número que o cliente escolheu', () => {
    // Conversa 23 da clínica: o bot listou dez horários, o cliente disse "quero
    // as 8" e ele respondeu "Tem 08:00 na próxima quinta (08/10)". Resposta
    // certa. "as 8" e "08:00" são o mesmo horário escrito de dois jeitos.
    const r = auditar([
      cliente('tem horario na proxima quinta?'),
      bot('Na próxima quinta (08/10) tenho 08:00, 09:00 e 10:00.', 0.391, true),
      cliente('quero as 8'),
      bot('Tem 08:00 na próxima quinta (08/10).', 0.34, true),
    ]);

    expect(tipos(r)).toEqual([]);
  });

  it('NÃO acusa o recapitulativo de fechamento', () => {
    // Conversa 32, turno 14. É a guarda mais importante: o recapitulativo do
    // pedido é o comportamento que queremos CRIAR, e acusá-lo faria a auditoria
    // punir o conserto.
    const r = auditarVenda([
      cliente('2kg de acai e 1 de cupuacu'),
      bot('2 kg de açaí + 1 kg de cupuaçu = R$ 95,00. Entrega grátis, porque passou de 2 kg.'),
      cliente('maria souza, rua das flores 120'),
      bot('Anotei, Maria Souza. Falta o dia e a forma de pagamento.'),
      cliente('amanha a tarde, pago no pix'),
      bot('Entrega amanhã à tarde e pagamento no Pix.\nPedido: 2 kg de açaí + 1 kg de cupuaçu. Total: R$ 95,00.'),
    ]);

    expect(tipos(r).filter((t) => t === 'repetiu_informacao')).toEqual([]);
  });

  it('NÃO acusa repetir o preço de um item que o cliente pediu de novo', () => {
    // O cliente nomeou a acerola outra vez: repetir o preço dela é responder.
    const r = auditarVenda([
      cliente('quanto custa a acerola?'),
      bot('Acerola: R$ 25,00 o quilo.'),
      cliente('1 kg de acerola e 1 kg de maracuja'),
      bot('Acerola: R$ 25,00 o quilo. Maracujá: R$ 35,00 o quilo. Total: R$ 60,00.'),
    ]);

    expect(tipos(r).filter((t) => t === 'repetiu_informacao')).toEqual([]);
  });

  it('NÃO acusa quando o cliente pediu o total', () => {
    // Medido no replay da conversa 33: "qual o valor de tudo?" levou o pedido
    // inteiro de volta — que é exatamente o comportamento pedido — e foi
    // acusado de repetição. Resumo repete por definição.
    const r = auditarVenda([
      cliente('quero 2 kg de acai'),
      bot('Até agora são 2 kg de açaí, R$ 70,00.'),
      cliente('e 1 kg de goiaba'),
      bot('Até agora são 2 kg de açaí e 1 kg de goiaba, R$ 95,00.'),
      cliente('qual o valor de tudo?'),
      bot('Até agora são 2 kg de açaí e 1 kg de goiaba, total R$ 95,00.'),
    ]);

    expect(tipos(r).filter((t) => t === 'repetiu_informacao')).toEqual([]);
  });

  it('NÃO acusa o recapitulativo que veio da FERRAMENTA', () => {
    // Medido na conversa 36, a primeira venda fechada de ponta a ponta: os três
    // achados graves eram o "Até agora são..." repetido a cada item novo — ou
    // seja, exatamente o recapitulativo de pedido que esta frente existe para
    // criar. Número que sai da ferramenta é o ESTADO do pedido, não um aviso de
    // prateleira. Mesmo raciocínio que já vale para `afirmou_com_contexto_fraco`.
    const r = auditarVenda([
      cliente('2 pacotes de pao de queijo'),
      bot('Até agora são 2 pacotes de pão de queijo, R$ 50,00.', 0.58, true),
      cliente('a entrega sera cobrada?'),
      bot('Não, com 2 kg a entrega é grátis. Até agora são 2 pacotes de pão de queijo, R$ 50,00.', 0.59, true),
    ]);

    expect(tipos(r).filter((t) => t === 'repetiu_informacao')).toEqual([]);
  });

  it('mas o aviso de catálogo SEM ferramenta continua acusado', () => {
    // A guarda acima não pode virar desculpa geral. O caso da conversa 33 saiu
    // dos documentos, com `used_tool = 0`, e tem de continuar aparecendo.
    const r = auditarVenda([
      cliente('2 pacotes de pao de queijo'),
      bot('Pão de queijo: R$ 25,00 o quilo. Cada quilo vem com 10 pacotes de 100 g.', 0.53, false),
      cliente('quero 1 kg de acerola com laranja'),
      bot('Acerola com laranja: R$ 25,00 o quilo.\n1 kg = 10 pacotes de 100 g.', 0.6, false),
    ]);

    expect(tipos(r)).toContain('repetiu_informacao');
  });

  it('não acusa duas vezes no mesmo turno', () => {
    // Uma repetição por turno. O denominador do aproveitamento é turno, e três
    // janelas repetidas na mesma resposta não são três defeitos.
    const r = auditarVenda([
      cliente('o que vem em 1 kg?'),
      bot('Cada quilo vem com 10 pacotes de 100 g, e dá 10 copos de suco.'),
      cliente('e o pao de queijo?'),
      bot('Pão de queijo: R$ 25,00.\nCada quilo vem com 10 pacotes de 100 g.\nDá 10 copos de suco.'),
    ]);

    expect(tipos(r).filter((t) => t === 'repetiu_informacao')).toHaveLength(1);
  });
});

describe('aproveitamento e números', () => {
  it('conta TURNO com problema, não problema', () => {
    // Dois defeitos na mesma resposta não podem derrubar o aproveitamento duas
    // vezes: o denominador é turno.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo e seu telefone.'),
      cliente('gabriel abraao possas borges'),
      cliente('67999359933'),
      bot('Me confirma seu nome completo e o seu telefone, por favor?'),
    ]);

    expect(r.problemas).toHaveLength(2);
    expect(r.turnosComProblemaGrave).toBe(1);
    expect(r.aproveitamento).toBe(0.5);
  });

  it('soma custo e latência só das respostas', () => {
    const r = auditar([cliente('oi'), bot('Olá!', null), cliente('tchau'), bot('Até!', null)]);

    expect(r.turnos).toBe(2);
    expect(r.mensagens).toBe(4);
    expect(r.custoUsd).toBeCloseTo(0.002, 6);
    expect(r.custoMedioPorRespostaUsd).toBeCloseTo(0.001, 6);
    expect(r.latenciaMediaMs).toBe(1500);
    expect(r.latenciaPiorMs).toBe(1500);
  });

  it('score médio ignora resposta que não citou fonte', () => {
    const r = auditar([
      cliente('oi'),
      bot('Olá!', null),
      cliente('quanto custa a limpeza?'),
      bot('R$ 180,00.', 0.6),
    ]);

    expect(r.scoreMedio).toBeCloseTo(0.6, 6);
  });

  it('conversa vazia não vira divisão por zero', () => {
    const r = auditar([]);

    expect(r.turnos).toBe(0);
    expect(r.aproveitamento).toBe(1);
    expect(r.scoreMedio).toBeNull();
    expect(r.custoMedioPorRespostaUsd).toBe(0);
  });
});
