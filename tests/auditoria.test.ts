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

  it('só AVISA quando o cliente ainda não tinha respondido', () => {
    // Insistir num dado que ninguém mandou é chato, não é esquecimento. Tratar
    // os dois como a mesma coisa faria o número perder sentido.
    const r = auditar([
      cliente('quero marcar'),
      bot('Me manda seu nome completo, por favor.'),
      cliente('pode ser amanha?'),
      bot('Me confirma seu nome completo, por favor?'),
    ]);

    expect(tipos(r)).toEqual(['pedido_insistente']);
    expect(r.problemas[0]?.grave).toBe(false);
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
