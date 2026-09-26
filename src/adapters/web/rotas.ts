/**
 * Roteamento HTTP do adaptador web.
 *
 * Esta é a BORDA: o único lugar deste fluxo que sabe o que é HTTP. Traduz
 * requisição em chamada ao núcleo e resposta do núcleo em JSON. Nenhuma decisão
 * de negócio mora aqui — se aparecer um `if` sobre confiança ou handoff neste
 * arquivo, ele está no lugar errado.
 *
 * Separado de `server.ts` para poder ser testado: os testes sobem este servidor
 * numa porta efêmera com dublês de embedder e LLM.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import type { Motor } from '../../core/engine.js';
import { montarPainel } from '../../core/painel/painel-service.js';
import { ultimasMensagens } from '../../storage/repositories/messages.js';
import { encerrarConversa } from '../../core/conversation/conversation-service.js';
import { carregarTenant, configEfetiva } from '../../core/tenant/tenant-service.js';
import {
  caminhoDaAvaliacao,
  lerAvaliacao,
  salvarAvaliacao,
  validarPerguntas,
} from '../../core/avaliacao/arquivo.js';
import { rodarPerguntas } from '../../core/avaliacao/suite.js';
import { novoIdDeExecucao } from '../../core/avaliacao/log.js';
import {
  alterarAgendamento,
  cancelarAgendamento,
  criarAgendamento,
  listarAgendamentos,
} from '../../core/agenda/agenda-service.js';
import { AGENDA_PADRAO, horariosLivres } from '../../core/agenda/disponibilidade.js';
import type { ConfigDaAgenda } from '../../core/types.js';

export const PASTA_PAGINAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'paginas');

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/** Rotas que servem uma página. O resto do GET cai no servidor de arquivos. */
const PAGINAS: Record<string, string> = {
  '/': 'chat.html',
  '/painel': 'painel.html',
  '/testes': 'testes.html',
  '/agenda': 'agenda.html',
};

export interface ContextoWeb {
  motor: Motor;
  db: Db;
  slug: string;
}

export function criarServidor(ctx: ContextoWeb): http.Server {
  return http.createServer((req, res) => {
    tratar(req, res, ctx).catch((erro: unknown) => {
      responderJson(res, 500, { erro: erro instanceof Error ? erro.message : String(erro) });
    });
  });
}

export async function tratar(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ContextoWeb,
): Promise<void> {
  // A base é irrelevante: só queremos separar caminho de query string.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rota = url.pathname;

  if (req.method === 'POST' && rota === '/api/mensagem') {
    const corpo = await lerCorpo(req);
    const contatoId = typeof corpo.contatoId === 'string' ? corpo.contatoId : '';
    const texto = typeof corpo.texto === 'string' ? corpo.texto : '';

    if (contatoId.length === 0 || texto.trim().length === 0) {
      responderJson(res, 400, { erro: 'Informe contatoId e texto.' });
      return;
    }

    responderJson(res, 200, await ctx.motor.responder(ctx.slug, contatoId, texto, { canal: 'web' }));
    return;
  }

  if (req.method === 'POST' && rota === '/api/conversa/reiniciar') {
    const corpo = await lerCorpo(req);
    const contatoId = typeof corpo.contatoId === 'string' ? corpo.contatoId : '';

    if (contatoId.length === 0) {
      responderJson(res, 400, { erro: 'Informe contatoId.' });
      return;
    }

    const tenant = carregarTenant(ctx.db, ctx.slug);
    const encerrada = encerrarConversa(ctx.db, tenant.id, contatoId);

    responderJson(res, 200, { encerrada: encerrada ?? null });
    return;
  }

  // --- Agenda -----------------------------------------------------------
  // A recepção mexe na agenda por aqui. Sem `contatoId` nas operações: quem
  // está do outro lado desta tela é a clínica, não o cliente, e precisa poder
  // corrigir o agendamento de qualquer um.

  if (req.method === 'GET' && rota === '/api/agenda') {
    const tenant = carregarTenant(ctx.db, ctx.slug);
    const agenda = agendaDoTenant(tenant.config.agenda);
    const data = url.searchParams.get('data');

    responderJson(res, 200, {
      agendamentos: listarAgendamentos(ctx.db, tenant.id, { incluirCancelados: true }),
      duracaoMin: agenda.duracaoMin,
      ...(data ? { livres: horariosLivres(ctx.db, tenant.id, agenda, data) } : {}),
    });
    return;
  }

  if (req.method === 'POST' && rota === '/api/agenda') {
    const corpo = await lerCorpo(req);
    const tenant = carregarTenant(ctx.db, ctx.slug);

    responderResultado(
      res,
      criarAgendamento(ctx.db, tenant.id, agendaDoTenant(tenant.config.agenda), {
        contatoId: texto(corpo.contatoId) || 'recepcao',
        inicio: texto(corpo.inicio),
        nome: texto(corpo.nome),
        ...(texto(corpo.servico) ? { servico: texto(corpo.servico) } : {}),
        ...(texto(corpo.telefone) ? { telefone: texto(corpo.telefone) } : {}),
        ...(texto(corpo.convenio) ? { convenio: texto(corpo.convenio) } : {}),
        ...(texto(corpo.observacoes) ? { observacoes: texto(corpo.observacoes) } : {}),
      }),
    );
    return;
  }

  if (req.method === 'PUT' && rota === '/api/agenda') {
    const corpo = await lerCorpo(req);
    const id = Number(corpo.id);

    if (!Number.isInteger(id) || id <= 0) {
      responderJson(res, 400, { erro: 'Informe o id do agendamento.' });
      return;
    }

    const tenant = carregarTenant(ctx.db, ctx.slug);
    responderResultado(
      res,
      alterarAgendamento(
        ctx.db,
        tenant.id,
        agendaDoTenant(tenant.config.agenda),
        id,
        texto(corpo.inicio),
      ),
    );
    return;
  }

  if (req.method === 'DELETE' && rota === '/api/agenda') {
    const id = Number(url.searchParams.get('id'));

    if (!Number.isInteger(id) || id <= 0) {
      responderJson(res, 400, { erro: 'Informe o id do agendamento.' });
      return;
    }

    const tenant = carregarTenant(ctx.db, ctx.slug);
    responderResultado(res, cancelarAgendamento(ctx.db, tenant.id, id));
    return;
  }

  if (req.method === 'GET' && rota === '/api/painel') {
    responderJson(res, 200, montarPainel(ctx.db, ctx.slug));
    return;
  }

  if (req.method === 'GET' && rota === '/api/conversa') {
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      responderJson(res, 400, { erro: 'Informe um id de conversa válido.' });
      return;
    }
    responderJson(res, 200, { mensagens: ultimasMensagens(ctx.db, id, 200) });
    return;
  }

  // --- Bateria de testes ------------------------------------------------
  // Ver e personalizar as perguntas de `avaliacao.json`, e rodar uma, um grupo
  // ou todas contra a API real.

  if (req.method === 'GET' && rota === '/api/testes') {
    const tenant = carregarTenant(ctx.db, ctx.slug);
    const arquivo = lerAvaliacao(ctx.slug);

    responderJson(res, 200, {
      tenant: { slug: tenant.slug, nome: tenant.nome },
      modelo: config.llm.modelo,
      limiar: configEfetiva(tenant).limiarDeConfianca,
      custoEstimadoPorPerguntaUsd: config.avaliacao.custoEstimadoPorPerguntaUsd,
      arquivo: path.relative(config.caminhos.raiz, caminhoDaAvaliacao(ctx.slug)),
      existe: arquivo.existe,
      descricao: arquivo.descricao ?? '',
      perguntas: arquivo.perguntas,
    });
    return;
  }

  if (req.method === 'PUT' && rota === '/api/testes') {
    const corpo = await lerCorpo(req);
    const validacao = validarPerguntas(corpo.perguntas);

    if (validacao.erros.length > 0) {
      responderJson(res, 400, { erros: validacao.erros });
      return;
    }

    salvarAvaliacao(ctx.slug, {
      ...(typeof corpo.descricao === 'string' && corpo.descricao.trim().length > 0
        ? { descricao: corpo.descricao.trim() }
        : {}),
      perguntas: validacao.perguntas,
    });

    responderJson(res, 200, {
      salvas: validacao.perguntas.length,
      avisos: validacao.avisos,
      arquivo: path.relative(config.caminhos.raiz, caminhoDaAvaliacao(ctx.slug)),
    });
    return;
  }

  if (req.method === 'POST' && rota === '/api/testes/rodar') {
    const corpo = await lerCorpo(req);

    // Valida antes de gastar: rodar com um campo escrito errado custaria
    // dinheiro para produzir um "passou" que não checou nada.
    const validacao = validarPerguntas(corpo.perguntas);
    if (validacao.erros.length > 0) {
      responderJson(res, 400, { erros: validacao.erros });
      return;
    }

    const tenant = carregarTenant(ctx.db, ctx.slug);

    const resultados = await rodarPerguntas(
      {
        motor: ctx.motor,
        db: ctx.db,
        slug: ctx.slug,
        tenantId: tenant.id,
        limiar: configEfetiva(tenant).limiarDeConfianca,
        // Prefixo `web-` para qualquer registro que saia daqui ser reconhecível.
        execucao: `web-${novoIdDeExecucao()}`,
      },
      validacao.perguntas,
    );

    // De propósito, NÃO grava em logs/historico.jsonl. Uma rodada parcial de 3
    // perguntas registrada como execução faria o `relatorio` comparar 3 contra
    // as 24 da suíte, e a seção de regressões — a mais importante dos logs —
    // acusaria 21 falhas inventadas. Quem registra é o `npm run avaliar`.
    responderJson(res, 200, { resultados, avisos: validacao.avisos });
    return;
  }

  if (req.method === 'GET') {
    servirArquivo(res, PAGINAS[rota] ?? rota.slice(1));
    return;
  }

  responderJson(res, 404, { erro: 'Rota não encontrada.' });
}

/** Serve um arquivo da pasta de páginas, barrando qualquer tentativa de sair dela. */
export function servirArquivo(res: http.ServerResponse, nome: string): void {
  // decodeURIComponent porque "%2e%2e%2f" é a forma codificada de "../";
  // sem decodificar, a checagem de prefixo abaixo não veria a fuga.
  let destino: string;
  try {
    destino = path.resolve(PASTA_PAGINAS, decodeURIComponent(nome));
  } catch {
    responderJson(res, 400, { erro: 'Caminho inválido.' });
    return;
  }

  // Sem esta checagem, "../../.env" serviria a chave da OpenAI a quem pedisse.
  if (destino !== PASTA_PAGINAS && !destino.startsWith(PASTA_PAGINAS + path.sep)) {
    responderJson(res, 403, { erro: 'Acesso negado.' });
    return;
  }

  if (!fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
    responderJson(res, 404, { erro: 'Não encontrado.' });
    return;
  }

  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(destino));
}

/** Campo de texto do corpo, já aparado. Ausente vira string vazia. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** A agenda do tenant, ou os padrões para quem ainda não configurou. */
function agendaDoTenant(agenda: ConfigDaAgenda | undefined): ConfigDaAgenda {
  return agenda ?? AGENDA_PADRAO;
}

/**
 * Traduz o resultado tipado da agenda para HTTP.
 *
 * O `motivo` vira 409 em conflito e 400 no resto: conflito não é erro de quem
 * pediu — o horário estava livre quando a tela foi carregada e outra pessoa
 * pegou. A página precisa distinguir para pedir que recarregue, em vez de
 * acusar o usuário de ter errado.
 */
function responderResultado(
  res: http.ServerResponse,
  resultado: { ok: true; agendamento: unknown } | { ok: false; motivo: string; detalhe: string },
): void {
  if (resultado.ok) {
    responderJson(res, 200, { agendamento: resultado.agendamento });
    return;
  }

  responderJson(res, resultado.motivo === 'conflito' ? 409 : 400, {
    erro: resultado.detalhe,
    motivo: resultado.motivo,
  });
}

export function responderJson(res: http.ServerResponse, status: number, dados: unknown): void {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

export async function lerCorpo(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const pedacos: Buffer[] = [];
  let tamanho = 0;

  for await (const pedaco of req) {
    tamanho += (pedaco as Buffer).length;
    // Uma mensagem de atendimento não tem megabytes. O limite existe para um
    // corpo gigante não derrubar o processo.
    if (tamanho > config.web.tamanhoMaximoDoCorpo) {
      throw new Error('Corpo da requisição grande demais.');
    }
    pedacos.push(pedaco as Buffer);
  }

  const texto = Buffer.concat(pedacos).toString('utf8');
  if (texto.trim().length === 0) return {};

  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    throw new Error('Corpo da requisição não é JSON válido.');
  }
}
