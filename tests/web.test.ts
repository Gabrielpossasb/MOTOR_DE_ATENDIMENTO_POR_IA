/**
 * Testes do adaptador web.
 *
 * Sobem o servidor de verdade numa porta efêmera, com dublês de embedder e LLM.
 * É HTTP real (fetch, status, JSON), mas offline e grátis.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { inserirChunks } from '../src/storage/repositories/chunks.js';
import { Motor } from '../src/core/engine.js';
import { criarServidor } from '../src/adapters/web/rotas.js';
import type { RespostaDoBot } from '../src/core/types.js';
import type { PainelDoTenant } from '../src/core/painel/painel-service.js';
import type { MensagemGravada } from '../src/storage/repositories/messages.js';
import type { RegistroDeAvaliacao } from '../src/core/avaliacao/log.js';
import { EmbedderFake, vetorDeTexto } from './helpers/fake-embedder.js';
import { LlmFake } from './helpers/fake-llm.js';

const SLUG = 'clinica';
const TEXTO = 'A clínica abre de segunda a sexta das oito às dezoito horas.';
const PERGUNTA_BOA = 'clínica abre segunda sexta horas';
const PERGUNTA_RUIM = 'vocês vendem pizza calabresa congelada';

let db: Db;
let servidor: Server;
let base: string;

function semear(): void {
  const tenant = salvarTenant(db, {
    slug: SLUG,
    nome: 'Clínica de Teste',
    config: {},
    promptDoSistema: 'p',
  });

  const documentId = salvarDocumento(db, tenant.id, 'faq.md', TEXTO);
  inserirChunks(db, [
    {
      documentId,
      tenantId: tenant.id,
      indice: 0,
      texto: TEXTO,
      embedding: vetorDeTexto(TEXTO),
      metadados: { secao: 'Horários' },
    },
  ]);
}

/** Lê o corpo já tipado: `Response.json()` devolve `unknown` neste tsconfig. */
async function corpo<T>(resposta: Response): Promise<T> {
  return (await resposta.json()) as T;
}

function mandar(texto: string, contatoId = 'contato-1'): Promise<Response> {
  return fetch(`${base}/api/mensagem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contatoId, texto }),
  });
}

beforeEach(async () => {
  db = abrirBanco(':memory:');
  semear();

  const motor = new Motor({ db, embedder: new EmbedderFake(), llm: new LlmFake() });
  servidor = criarServidor({ motor, db, slug: SLUG });

  // Porta 0: o sistema escolhe uma livre, então os testes não brigam entre si
  // nem com um servidor que você tenha deixado rodando.
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  db.close();
});

describe('POST /api/mensagem', () => {
  it('responde com o texto e as fontes', async () => {
    const resposta = await mandar(PERGUNTA_BOA);
    const dados = await corpo<RespostaDoBot>(resposta);

    expect(resposta.status).toBe(200);
    expect(dados.texto).toBe('Abrimos de segunda a sexta, das 8h às 18h.');
    expect(dados.fontes[0]?.arquivo).toBe('faq.md');
    expect(dados.precisaDeHumano).toBe(false);
  });

  it('marca o canal como web na conversa criada', async () => {
    await mandar(PERGUNTA_BOA);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.listaDeConversas[0]?.canal).toBe('web');
  });

  it('preserva acentuação no caminho de ida e volta', async () => {
    // Se o corpo não for lido como UTF-8, "crianças" chega quebrado ao
    // embedding e a busca degrada silenciosamente.
    const comAcento = 'vocês atendem crianças? é urgente';
    await mandar(comAcento, 'contato-utf8');

    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));
    const conversa = painel.listaDeConversas.find((c) => c.contatoId === 'contato-utf8');

    expect(conversa).toBeDefined();
    expect(painel.perguntasSemResposta.some((u) => u.pergunta === comAcento)).toBe(true);
  });

  it('recusa corpo sem contatoId ou sem texto', async () => {
    const semTexto = await mandar('   ');
    expect(semTexto.status).toBe(400);

    const semContato = await mandar(PERGUNTA_BOA, '');
    expect(semContato.status).toBe(400);
  });

  it('recusa corpo que não é JSON', async () => {
    const resposta = await fetch(`${base}/api/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'isto não é json',
    });

    expect(resposta.status).toBe(500);
    expect((await corpo<{ erro: string }>(resposta)).erro).toMatch(/JSON/);
  });

  it('sinaliza aguardandoHumano depois do handoff, em vez de responder', async () => {
    await mandar(PERGUNTA_RUIM, 'contato-handoff');
    const depois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-handoff'));

    expect(depois.aguardandoHumano).toBe(true);
    expect(depois.texto).toBe('');
  });
});

describe('GET /api/painel', () => {
  it('devolve os números do tenant', async () => {
    await mandar(PERGUNTA_BOA);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.tenant.slug).toBe(SLUG);
    expect(painel.ajustes.limiarDeConfianca).toBeGreaterThan(0);
    expect(painel.conversas.total).toBe(1);
    expect(painel.custo.acumuladoUsd).toBeGreaterThan(0);
  });

  it('lista a pergunta sem resposta depois de um handoff', async () => {
    await mandar(PERGUNTA_RUIM);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.perguntasSemResposta).toHaveLength(1);
    expect(painel.taxaDeResolucao).toBe(0);
  });
});

describe('GET /api/conversa', () => {
  it('devolve as mensagens da conversa', async () => {
    const primeira = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA));
    const dados = await corpo<{ mensagens: MensagemGravada[] }>(
      await fetch(`${base}/api/conversa?id=${primeira.conversaId}`),
    );

    expect(dados.mensagens).toHaveLength(2);
    expect(dados.mensagens[0]?.papel).toBe('user');
  });

  it('recusa id inválido', async () => {
    expect((await fetch(`${base}/api/conversa?id=abc`)).status).toBe(400);
    expect((await fetch(`${base}/api/conversa`)).status).toBe(400);
  });
});

describe('POST /api/conversa/reiniciar', () => {
  function reiniciar(contatoId: string): Promise<Response> {
    return fetch(`${base}/api/conversa/reiniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contatoId }),
    });
  }

  it('encerra a conversa em andamento e a próxima mensagem começa outra', async () => {
    const primeira = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-r'));
    await reiniciar('contato-r');
    const segunda = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-r'));

    expect(segunda.conversaId).not.toBe(primeira.conversaId);
  });

  it('DESTRAVA uma conversa presa em handoff', async () => {
    // A razão de existir do botão. Depois de um handoff o bot fica mudo de
    // propósito; sem uma forma de encerrar, o único jeito de voltar a
    // conversar era trocar de contato.
    await mandar(PERGUNTA_RUIM, 'contato-preso');
    const mudo = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-preso'));
    expect(mudo.aguardandoHumano).toBe(true);

    await reiniciar('contato-preso');
    const depois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-preso'));

    expect(depois.aguardandoHumano).toBe(false);
    expect(depois.texto.length).toBeGreaterThan(0);
  });

  it('não apaga o histórico, que é o que alimenta o painel', async () => {
    // Testar de novo não pode jogar fora o que o teste anterior produziu.
    await mandar(PERGUNTA_BOA, 'contato-h');
    await reiniciar('contato-h');

    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));
    expect(painel.mensagens.total).toBe(2);
    expect(painel.conversas.fechadas).toBe(1);
  });

  it('não zera o histórico de outro contato', async () => {
    await mandar(PERGUNTA_BOA, 'contato-a');
    const doB = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-b'));

    await reiniciar('contato-a');
    const bDepois = await corpo<RespostaDoBot>(await mandar(PERGUNTA_BOA, 'contato-b'));

    expect(bDepois.conversaId).toBe(doB.conversaId);
  });

  it('responde sem erro quando não há conversa para encerrar', async () => {
    const resposta = await reiniciar('contato-que-nunca-falou');

    expect(resposta.status).toBe(200);
    expect((await corpo<{ encerrada: number | null }>(resposta)).encerrada).toBeNull();
  });

  it('recusa corpo sem contatoId', async () => {
    expect((await reiniciar('')).status).toBe(400);
  });
});

describe('bateria de testes', () => {
  function rodarTestes(perguntas: unknown): Promise<Response> {
    return fetch(`${base}/api/testes/rodar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perguntas }),
    });
  }

  it('GET devolve o modelo e o limiar em vigor', async () => {
    const dados = await corpo<{
      tenant: { slug: string };
      modelo: string;
      limiar: number;
      existe: boolean;
      perguntas: unknown[];
    }>(await fetch(`${base}/api/testes`));

    expect(dados.tenant.slug).toBe(SLUG);
    expect(dados.modelo.length).toBeGreaterThan(0);
    expect(dados.limiar).toBeGreaterThan(0);
    // O tenant deste teste não tem pasta em data/tenants, então não há arquivo.
    expect(dados.existe).toBe(false);
    expect(dados.perguntas).toEqual([]);
  });

  it('roda uma pergunta e devolve o veredito com as métricas', async () => {
    const resposta = await rodarTestes([
      { id: 'fora-do-dominio', pergunta: PERGUNTA_RUIM, esperaHandoff: true },
    ]);
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(resposta);
    const resultado = dados.resultados[0];

    expect(resposta.status).toBe(200);
    expect(resultado?.id).toBe('fora-do-dominio');
    expect(resultado?.passou).toBe(true);
    expect(resultado?.houveHandoff).toBe(true);
    expect(resultado?.latenciaMs).toBeGreaterThanOrEqual(0);
  });

  it('aplica a regra global de número inventado, igual ao npm run avaliar', async () => {
    // O dublê responde "das 8h às 18h" enquanto o chunk diz "das oito às
    // dezoito horas": os horários da resposta não têm origem documental. Se a
    // página julgasse com outro código que o da suíte, isto passaria aqui e
    // falharia lá — e nenhum dos dois serviria para calibrar.
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(
      await rodarTestes([{ id: 'horario', pergunta: PERGUNTA_BOA, esperaHandoff: false }]),
    );
    const resultado = dados.resultados[0];

    expect(resultado?.passou).toBe(false);
    expect(resultado?.falhas.map((f) => f.regra)).toContain('numeroInventado');
  });

  it('roda um grupo inteiro numa chamada, preservando a ordem', async () => {
    const dados = await corpo<{ resultados: RegistroDeAvaliacao[] }>(
      await rodarTestes([
        { id: 'primeira', pergunta: PERGUNTA_RUIM, esperaHandoff: true },
        { id: 'segunda', pergunta: PERGUNTA_BOA, esperaHandoff: false },
      ]),
    );

    expect(dados.resultados.map((r) => r.id)).toEqual(['primeira', 'segunda']);
  });

  it('NÃO cria conversa nem handoff ao rodar', async () => {
    // A suíte roda com semPersistir. Sem isso, calibrar pela página encheria o
    // painel de conversas que nunca existiram e a fila da equipe de handoffs
    // que nenhum cliente pediu.
    await rodarTestes([{ id: 'fora', pergunta: PERGUNTA_RUIM, esperaHandoff: true }]);
    const painel = await corpo<PainelDoTenant>(await fetch(`${base}/api/painel`));

    expect(painel.conversas.total).toBe(0);
    expect(painel.perguntasSemResposta).toEqual([]);
  });

  it('recusa rodar com campo desconhecido, antes de gastar', async () => {
    // Rodar assim custaria dinheiro para produzir um "passou" que não checou
    // nada: `deveConterr` com dois r não é regra nenhuma.
    const resposta = await rodarTestes([
      { id: 'a', pergunta: 'quanto custa?', deveConterr: ['180'] },
    ]);

    expect(resposta.status).toBe(400);
    expect((await corpo<{ erros: string[] }>(resposta)).erros.join(' ')).toContain('deveConterr');
  });

  it('recusa rodar lista vazia ou ausente', async () => {
    expect((await rodarTestes([])).status).toBe(400);
    expect((await rodarTestes(undefined)).status).toBe(400);
  });

  it('PUT recusa suíte inválida sem escrever nada', async () => {
    const resposta = await fetch(`${base}/api/testes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        perguntas: [
          { id: 'mesmo', pergunta: 'primeira?' },
          { id: 'mesmo', pergunta: 'segunda?' },
        ],
      }),
    });

    expect(resposta.status).toBe(400);
    expect((await corpo<{ erros: string[] }>(resposta)).erros.join(' ')).toContain('repetido');
  });
});

describe('arquivos estáticos', () => {
  it('serve a página de conversa na raiz', async () => {
    const resposta = await fetch(`${base}/`);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('text/html');
    expect(await resposta.text()).toContain('<title>Simulador de atendimento</title>');
  });

  it('serve o painel', async () => {
    expect((await fetch(`${base}/painel`)).status).toBe(200);
  });

  it('serve a bateria de testes', async () => {
    const resposta = await fetch(`${base}/testes`);

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain('<title>Bateria de testes</title>');
  });

  it('serve o CSS com o tipo certo', async () => {
    const resposta = await fetch(`${base}/estilo.css`);
    expect(resposta.headers.get('content-type')).toContain('text/css');
  });

  it('devolve 404 para arquivo que não existe', async () => {
    expect((await fetch(`${base}/nao-existe.html`)).status).toBe(404);
  });

  it('NÃO serve arquivo de fora da pasta de páginas', async () => {
    // Sem esta barreira, "../../../.env" entregaria a chave da OpenAI a
    // qualquer um que soubesse pedir.
    const tentativas = [
      '/%2e%2e%2f%2e%2e%2f%2e%2e%2f.env',
      '/..%2f..%2f..%2f.env',
      '/%2e%2e/%2e%2e/%2e%2e/package.json',
    ];

    for (const caminho of tentativas) {
      const resposta = await fetch(`${base}${caminho}`);
      expect([403, 404]).toContain(resposta.status);

      const corpo = await resposta.text();
      expect(corpo).not.toContain('OPENAI_API_KEY');
      expect(corpo).not.toContain('"dependencies"');
    }
  });
});
