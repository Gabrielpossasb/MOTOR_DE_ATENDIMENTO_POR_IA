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

export const PASTA_PAGINAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'paginas');

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

  if (req.method === 'GET') {
    const arquivo = rota === '/' ? 'chat.html' : rota === '/painel' ? 'painel.html' : rota.slice(1);
    servirArquivo(res, arquivo);
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
