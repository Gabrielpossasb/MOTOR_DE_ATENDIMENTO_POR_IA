/**
 * Testes da classificação de turno social.
 *
 * O caso que deu origem a tudo isto está logo no primeiro teste: um "boa
 * tarde" real tirou 0.370 na busca, caiu no limiar e o bot chamou um atendente
 * para responder a um cumprimento — e ficou mudo pelo resto da conversa.
 *
 * O risco desta função é assimétrico. Deixar passar uma saudação (falso
 * negativo) devolve o bug antigo, que é ruim. Tratar uma PERGUNTA como
 * saudação (falso positivo) é pior: o cliente pergunta o preço e leva um
 * "oi, tudo bem?" de volta. Por isso metade dos testes aqui é sobre o que
 * NÃO pode ser confundido com turno social.
 */
import { describe, expect, it } from 'vitest';
import { classificarTurnoSocial } from '../src/core/conversation/turno-social.js';

describe('reconhece turno social', () => {
  it('trata "boa tarde" como saudação — o caso que motivou a mudança', () => {
    expect(classificarTurnoSocial('boa tarde')).toBe('saudacao');
  });

  it.each([
    'oi',
    'Oi',
    'OI',
    'olá',
    'ola',
    'bom dia',
    'boa noite',
    'e aí',
    'opa',
    'alô',
    'tudo bem?',
    'oi, tudo bem?',
    'bom dia, tudo bem?',
  ])('reconhece a saudação %j', (texto) => {
    expect(classificarTurnoSocial(texto)).toBe('saudacao');
  });

  it.each(['obrigado', 'obrigada', 'muito obrigado', 'valeu', 'vlw', 'obg', 'brigado'])(
    'reconhece o agradecimento %j',
    (texto) => {
      expect(classificarTurnoSocial(texto)).toBe('agradecimento');
    },
  );

  it.each(['tchau', 'até logo', 'até mais', 'falou', 'flw', 'abraço', 'bom fim de semana'])(
    'reconhece a despedida %j',
    (texto) => {
      expect(classificarTurnoSocial(texto)).toBe('despedida');
    },
  );

  it.each(['ok', 'beleza', 'entendi', 'certo', 'perfeito', 'blz', 'tá bom'])(
    'reconhece a confirmação %j',
    (texto) => {
      expect(classificarTurnoSocial(texto)).toBe('confirmacao');
    },
  );

  it('ignora pontuação e emoji ao redor', () => {
    expect(classificarTurnoSocial('oi!!!')).toBe('saudacao');
    expect(classificarTurnoSocial('oi 😊')).toBe('saudacao');
    expect(classificarTurnoSocial('... tchau!')).toBe('despedida');
  });

  it('ignora ruído de cortesia', () => {
    expect(classificarTurnoSocial('oi, por favor')).toBe('saudacao');
    expect(classificarTurnoSocial('bom dia senhora')).toBe('saudacao');
  });

  it('fica com a ÚLTIMA intenção quando há mais de uma', () => {
    // Em "obrigado, tchau" o que governa a resposta é a despedida.
    expect(classificarTurnoSocial('obrigado, tchau')).toBe('despedida');
    expect(classificarTurnoSocial('oi, obrigado')).toBe('agradecimento');
  });
});

describe('NÃO confunde pergunta com turno social', () => {
  it('deixa passar a saudação grudada numa pergunta de verdade', () => {
    // O caso mais comum no WhatsApp. Se isto virasse turno social, o cliente
    // perguntaria o preço e receberia "oi, tudo bem?" de volta.
    expect(classificarTurnoSocial('oi, quanto custa a limpeza?')).toBeUndefined();
    expect(classificarTurnoSocial('boa tarde, vocês abrem sábado?')).toBeUndefined();
    expect(classificarTurnoSocial('bom dia! tem estacionamento?')).toBeUndefined();
  });

  it.each([
    'quanto custa o implante?',
    'vocês abrem domingo?',
    'qual o endereço?',
    'preciso remarcar minha consulta',
    'aceita convênio?',
  ])('deixa passar a pergunta %j', (texto) => {
    expect(classificarTurnoSocial(texto)).toBeUndefined();
  });

  it('não casa expressão social escondida dentro de outra palavra', () => {
    // Sem a checagem de palavra inteira, "oito" viraria "oi" + "to" e
    // "bolacha" conteria "ola". O cliente pediria preço e levaria um "olá".
    expect(classificarTurnoSocial('oito reais?')).toBeUndefined();
    expect(classificarTurnoSocial('vocês vendem bolacha?')).toBeUndefined();
    expect(classificarTurnoSocial('qual o valor do okay?')).toBeUndefined();
  });

  it('não trata "até que horas" como despedida', () => {
    // Por isso "até" sozinho ficou de fora da lista: só as formas compostas
    // ("até logo", "até mais") entraram.
    expect(classificarTurnoSocial('até que horas vocês abrem?')).toBeUndefined();
    expect(classificarTurnoSocial('atendem até as 18h?')).toBeUndefined();
  });

  it('não trata um pedido de ajuda como saudação', () => {
    expect(classificarTurnoSocial('oi, preciso de ajuda')).toBeUndefined();
  });

  it('devolve undefined para texto vazio', () => {
    expect(classificarTurnoSocial('')).toBeUndefined();
    expect(classificarTurnoSocial('   ')).toBeUndefined();
  });

  it('devolve undefined para mensagem só de números', () => {
    expect(classificarTurnoSocial('123')).toBeUndefined();
  });
});
