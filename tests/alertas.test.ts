/**
 * Testes dos avisos ao responsável.
 *
 * Nasceram de três pedidos da Polpa Santa Helena, que é uma pessoa só fazendo
 * as entregas: avisar quando pedem desconto, confirmar o horário antes de
 * prometer, e sinalizar quando o bot não tem certeza da cobertura.
 *
 * A regra que governa tudo: aviso NÃO é handoff. O bot avisa e continua
 * conversando — se calasse depois de dizer "vou confirmar o horário", o cliente
 * que ainda não deu o endereço ficaria sem como terminar o pedido.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { obterOuCriarConversa } from '../src/storage/repositories/conversations.js';
import { normalizar } from '../src/core/texto.js';
import {
  alertasDaMensagem,
  listarAlertasPendentes,
  marcarAlertaResolvido,
  registrarAlerta,
  type RegraDeAlerta,
} from '../src/core/alertas/alertas.js';
import { executarAviso, FERRAMENTA_DE_AVISO } from '../src/core/alertas/ferramenta.js';

let db: Db;
let tenantId: number;
let conversaId: number;

/**
 * Repare que as palavras são RADICAIS, não palavras inteiras.
 *
 * "descontinho" não contém "desconto" — contém "descont". Configurar a lista
 * com a palavra completa deixaria o diminutivo passar, e é justamente assim
 * que se pede abatimento no WhatsApp.
 */
const REGRA_DESCONTO: RegraDeAlerta = {
  tipo: 'desconto',
  palavras: ['descont', 'atacado', 'mais barato', 'promoc'],
  detalhe: 'Cliente pediu desconto.',
};

beforeEach(() => {
  db = abrirBanco(':memory:');
  tenantId = salvarTenant(db, {
    slug: 'loja',
    nome: 'Loja',
    config: {},
    promptDoSistema: 'p',
  }).id;
  conversaId = obterOuCriarConversa(db, tenantId, 'c1', 'web').id;
});

describe('registrar', () => {
  it('grava o aviso com a mensagem que o disparou', () => {
    // A mensagem citada é o que permite julgar falso positivo sem abrir a conversa.
    registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'Cliente pediu desconto.',
      mensagemDoCliente: 'faz um desconto se eu levar 20kg?',
      origem: 'palavra-chave',
    });

    const pendentes = listarAlertasPendentes(db, tenantId);

    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.tipo).toBe('desconto');
    expect(pendentes[0]?.mensagemDoCliente).toContain('20kg');
    expect(pendentes[0]?.origem).toBe('palavra-chave');
  });

  it('NÃO duplica o mesmo assunto na mesma conversa', () => {
    // Quem escreve "desconto" três vezes gera UM aviso. Índice único parcial,
    // na mesma disciplina do outbox.
    const primeiro = registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'd',
      origem: 'palavra-chave',
    });
    const segundo = registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'd',
      origem: 'ferramenta',
    });

    expect(primeiro).toBeDefined();
    expect(segundo).toBeUndefined();
    expect(listarAlertasPendentes(db, tenantId)).toHaveLength(1);
  });

  it('tipos diferentes convivem na mesma conversa', () => {
    registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'd',
      origem: 'ferramenta',
    });
    registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'confirmar_entrega',
      detalhe: 'h',
      origem: 'ferramenta',
    });

    expect(listarAlertasPendentes(db, tenantId)).toHaveLength(2);
  });

  it('o mesmo assunto volta depois de resolvido', () => {
    // O índice é PARCIAL justamente para isto: numa venda nova o cliente pode
    // pedir desconto outra vez, e o dono precisa saber outra vez.
    const id = registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'd',
      origem: 'ferramenta',
    });
    marcarAlertaResolvido(db, tenantId, id as number);

    expect(
      registrarAlerta(db, {
        tenantId,
        conversaId,
        tipo: 'desconto',
        detalhe: 'd2',
        origem: 'ferramenta',
      }),
    ).toBeDefined();
  });

  it('não resolve aviso de outro cliente', () => {
    const outro = salvarTenant(db, { slug: 'o', nome: 'O', config: {}, promptDoSistema: 'p' }).id;
    const id = registrarAlerta(db, {
      tenantId,
      conversaId,
      tipo: 'desconto',
      detalhe: 'd',
      origem: 'ferramenta',
    });

    expect(marcarAlertaResolvido(db, outro, id as number)).toBe(false);
    expect(listarAlertasPendentes(db, tenantId)).toHaveLength(1);
  });
});

describe('a rede determinística de palavras', () => {
  const dispara = (m: string) => alertasDaMensagem(m, [REGRA_DESCONTO], normalizar).length > 0;

  it('pega o pedido de desconto em várias formas', () => {
    expect(dispara('tem desconto?')).toBe(true);
    expect(dispara('faz um DESCONTO pra mim')).toBe(true);
    expect(dispara('qual o preço no atacado?')).toBe(true);
    expect(dispara('da pra fazer mais barato?')).toBe(true);
  });

  it('pega diminutivo e acento, porque a lista é de radicais', () => {
    // "descontinho" e "promoção" não podem escapar. Comparar por fronteira de
    // palavra perderia os dois, e perder pedido de desconto é perder venda.
    expect(dispara('faz um descontinho?')).toBe(true);
    expect(dispara('tem promoção essa semana?')).toBe(true);
  });

  it('não dispara em mensagem comum', () => {
    expect(dispara('quanto custa a polpa de açaí?')).toBe(false);
    expect(dispara('bom dia')).toBe(false);
  });

  it('sem regras configuradas, nunca dispara', () => {
    expect(alertasDaMensagem('tem desconto?', [], normalizar)).toEqual([]);
  });
});

describe('a ferramenta do modelo', () => {
  const ctx = () => ({ db, tenantId, conversaId, semPersistir: false });

  it('registra o aviso e manda o bot CONTINUAR', () => {
    // A diferença para o handoff está aqui: a instrução devolvida ao modelo
    // manda seguir atendendo.
    const r = JSON.parse(
      executarAviso(ctx(), { motivo: 'confirmar_entrega', detalhe: 'Confirmar sexta à tarde.' }),
    ) as { ok: boolean; avisado: boolean; instrucao: string };

    expect(r.ok).toBe(true);
    expect(r.avisado).toBe(true);
    expect(r.instrucao).toContain('Continue atendendo');
    expect(listarAlertasPendentes(db, tenantId)).toHaveLength(1);
  });

  it('recusa motivo inventado em vez de gravar lixo', () => {
    const r = JSON.parse(executarAviso(ctx(), { motivo: 'promocao_relampago', detalhe: 'x' })) as {
      ok: boolean;
    };

    expect(r.ok).toBe(false);
    expect(listarAlertasPendentes(db, tenantId)).toEqual([]);
  });

  it('exige detalhe: aviso sem o que decidir não serve para nada', () => {
    const r = JSON.parse(executarAviso(ctx(), { motivo: 'desconto', detalhe: '   ' })) as {
      ok: boolean;
    };

    expect(r.ok).toBe(false);
    expect(listarAlertasPendentes(db, tenantId)).toEqual([]);
  });

  it('NÃO grava em modo de avaliação', () => {
    // Sem isto, rodar a suíte encheria o painel do cliente de aviso de teste.
    const r = JSON.parse(
      executarAviso(
        { db, tenantId, conversaId, semPersistir: true },
        { motivo: 'desconto', detalhe: 'x' },
      ),
    ) as { simulado: boolean };

    expect(r.simulado).toBe(true);
    expect(listarAlertasPendentes(db, tenantId)).toEqual([]);
  });

  it('a assinatura não deixa o modelo escolher o tenant nem o contato', () => {
    // Mesma disciplina das ferramentas de agenda: quem identifica a conversa é
    // o servidor, nunca os argumentos que o modelo escreveu.
    const propriedades = Object.keys(
      (FERRAMENTA_DE_AVISO.parametros as { properties: Record<string, unknown> }).properties,
    );

    expect(propriedades).toEqual(['motivo', 'detalhe']);
  });
});
