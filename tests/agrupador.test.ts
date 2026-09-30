/**
 * Testes do agrupamento de mensagens.
 *
 * A espera é INJETADA e curta (dezenas de ms). Sem fake timers de propósito: o
 * projeto nunca usou, e eles atrapalham I/O real — o teste do adaptador web
 * sobe um servidor HTTP de verdade.
 *
 * O caso que deu origem a tudo: cliente escreve "quero marcar", "pra sexta",
 * "as 9" em três mensagens, e o bot respondia três vezes.
 */
import { describe, expect, it } from 'vitest';
import {
  AgrupadorDeMensagens,
  juntarMensagens,
} from '../src/core/conversation/agrupador.js';

/** Espera curta: o suficiente para o teste ser rápido e ainda ter folga. */
const ESPERA = 40;
const TETO = 200;

function agrupador(opcoes: { esperaMs?: number; esperaMaximaMs?: number } = {}) {
  return new AgrupadorDeMensagens({
    esperaMs: opcoes.esperaMs ?? ESPERA,
    esperaMaximaMs: opcoes.esperaMaximaMs ?? TETO,
  });
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('juntarMensagens', () => {
  it('junta com quebra de linha', () => {
    // Quebra e não espaço: o modelo enxerga que foram mensagens separadas.
    expect(juntarMensagens(['quero marcar', 'pra sexta', 'as 9'])).toBe(
      'quero marcar\npra sexta\nas 9',
    );
  });

  it('apara cada pedaço e descarta vazio', () => {
    expect(juntarMensagens(['  oi  ', '   ', 'tudo bem?'])).toBe('oi\ntudo bem?');
  });

  it('uma mensagem só continua ela mesma', () => {
    expect(juntarMensagens(['quanto custa?'])).toBe('quanto custa?');
  });
});

describe('agrupar', () => {
  it('junta três mensagens rápidas num turno só', async () => {
    const a = agrupador();
    const chave = AgrupadorDeMensagens.chave('clinica', 'c1');

    const [uma, duas, tres] = await Promise.all([
      a.receber(chave, 'quero marcar'),
      a.receber(chave, 'pra sexta'),
      a.receber(chave, 'as 9'),
    ]);

    // Só a última responde; as anteriores foram absorvidas.
    expect(uma).toBeUndefined();
    expect(duas).toBeUndefined();
    expect(tres).toBe('quero marcar\npra sexta\nas 9');
  });

  it('devolve a mensagem isolada como veio', async () => {
    const a = agrupador();
    expect(await a.receber('k', 'quanto custa a limpeza?')).toBe('quanto custa a limpeza?');
  });

  it('a espera REINICIA a cada mensagem nova', async () => {
    // O ponto do recurso: quem escreve devagar continua sendo um turno só.
    const a = agrupador();
    const chave = 'k';

    const primeira = a.receber(chave, 'quero');
    await dormir(ESPERA * 0.6);
    const segunda = a.receber(chave, 'marcar');
    await dormir(ESPERA * 0.6);
    const terceira = a.receber(chave, 'sexta');

    expect(await primeira).toBeUndefined();
    expect(await segunda).toBeUndefined();
    expect(await terceira).toBe('quero\nmarcar\nsexta');
  });

  it('mensagem depois do silêncio é OUTRO turno', async () => {
    const a = agrupador();
    const chave = 'k';

    expect(await a.receber(chave, 'quanto custa?')).toBe('quanto custa?');
    expect(await a.receber(chave, 'e o implante?')).toBe('e o implante?');
  });

  it('a requisição absorvida responde NA HORA, não no fim do turno', async () => {
    // Do outro lado há uma conexão HTTP aberta. Segurar as três até o turno
    // fechar prenderia conexão à toa.
    const a = agrupador({ esperaMs: 300 });
    const chave = 'k';

    const comecou = Date.now();
    const primeira = a.receber(chave, 'oi');
    a.receber(chave, 'quero marcar');

    expect(await primeira).toBeUndefined();
    expect(Date.now() - comecou).toBeLessThan(150);
  });
});

describe('teto de espera', () => {
  it('fecha o turno mesmo com mensagem chegando sem parar', async () => {
    // Sem o teto, quem digita sem parar nunca receberia resposta: cada
    // mensagem nova empurraria o prazo para frente.
    const a = agrupador({ esperaMs: 40, esperaMaximaMs: 100 });
    const chave = 'k';

    const respostas: Promise<string | undefined>[] = [];
    for (let i = 0; i < 8; i++) {
      respostas.push(a.receber(chave, `m${i}`));
      await dormir(25);
    }

    const resolvidas = await Promise.all(respostas);
    const fechou = resolvidas.filter((r) => r !== undefined);

    // Pelo menos um turno fechou antes de as oito mensagens acabarem.
    expect(fechou.length).toBeGreaterThanOrEqual(1);
    expect(fechou[0]).toContain('m0');
  });
});

describe('isolamento', () => {
  it('contatos diferentes não se misturam', async () => {
    const a = agrupador();

    const [maria, joao] = await Promise.all([
      a.receber(AgrupadorDeMensagens.chave('clinica', 'maria'), 'quero marcar'),
      a.receber(AgrupadorDeMensagens.chave('clinica', 'joao'), 'quero cancelar'),
    ]);

    expect(maria).toBe('quero marcar');
    expect(joao).toBe('quero cancelar');
  });

  it('tenants diferentes com o MESMO contatoId não se misturam', async () => {
    // A chave inclui o tenant justamente para isto. Sem ele, dois clientes
    // com o mesmo id de contato conversariam na mesma caixa.
    const a = agrupador();

    const [clinica, barbearia] = await Promise.all([
      a.receber(AgrupadorDeMensagens.chave('clinica', 'contato-1'), 'da clinica'),
      a.receber(AgrupadorDeMensagens.chave('barbearia', 'contato-1'), 'da barbearia'),
    ]);

    expect(clinica).toBe('da clinica');
    expect(barbearia).toBe('da barbearia');
  });
});

describe('encerrar', () => {
  it('resolve o que estava pendente e não deixa lote aberto', async () => {
    // Sem isto, um timer pendente segura o processo vivo no Ctrl+C.
    const a = agrupador({ esperaMs: 5000 });

    const pendente = a.receber('k', 'oi');
    expect(a.pendentes).toBe(1);

    a.encerrar();

    // undefined, e não o texto: o processo está caindo, e mandar responder
    // agora faria o motor escrever num banco que está fechando.
    expect(await pendente).toBeUndefined();
    expect(a.pendentes).toBe(0);
  });

  it('o lote some depois de fechar sozinho', async () => {
    const a = agrupador();

    await a.receber('k', 'oi');
    expect(a.pendentes).toBe(0);
  });
});
