/**
 * Testes da busca por similaridade, com banco em memória e embedder falso —
 * sem rede, sem chave de API, sem custo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, type Db } from '../src/storage/db.js';
import { salvarTenant } from '../src/storage/repositories/tenants.js';
import { salvarDocumento } from '../src/storage/repositories/documents.js';
import { contarChunks, inserirChunks } from '../src/storage/repositories/chunks.js';
import { BuscaPorCossenoEmMemoria } from '../src/core/rag/retriever.js';
import { vetorDeTexto } from './helpers/fake-embedder.js';

let db: Db;

/** Cria um tenant com um documento e seus chunks já vetorizados. */
function semear(slug: string, arquivo: string, textos: string[]): number {
  const tenant = salvarTenant(db, {
    slug,
    nome: slug,
    config: {},
    promptDoSistema: 'prompt de teste',
  });

  const documentId = salvarDocumento(db, tenant.id, arquivo, textos.join('\n\n'));

  inserirChunks(
    db,
    textos.map((texto, i) => ({
      documentId,
      tenantId: tenant.id,
      indice: i,
      texto,
      embedding: vetorDeTexto(texto),
      metadados: { secao: `Seção ${i}` },
    })),
  );

  return tenant.id;
}

beforeEach(() => {
  db = abrirBanco(':memory:');
});

describe('BuscaPorCossenoEmMemoria', () => {
  it('traz primeiro o chunk mais parecido com a pergunta', () => {
    const tenantId = semear('clinica', 'faq.md', [
      'A clínica abre de segunda a sexta das oito às dezoito horas.',
      'Aceitamos os convênios Amil Dental e Odontoprev.',
      'O clareamento caseiro com moldeira custa setecentos reais.',
    ]);

    const busca = new BuscaPorCossenoEmMemoria(db);
    const resultados = busca.buscar(tenantId, vetorDeTexto('quais convênios vocês aceitam'), 3);

    expect(resultados[0]?.chunk.texto).toContain('convênios');
  });

  it('devolve os resultados em ordem decrescente de score', () => {
    const tenantId = semear('clinica', 'faq.md', [
      'horário de funcionamento da clínica',
      'formas de pagamento aceitas',
      'convênios odontológicos atendidos',
      'endereço e estacionamento',
    ]);

    const busca = new BuscaPorCossenoEmMemoria(db);
    const resultados = busca.buscar(tenantId, vetorDeTexto('horário funcionamento'), 4);

    const scores = resultados.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('respeita o topK', () => {
    const tenantId = semear('clinica', 'faq.md', ['um', 'dois', 'três', 'quatro', 'cinco']);
    const busca = new BuscaPorCossenoEmMemoria(db);

    expect(busca.buscar(tenantId, vetorDeTexto('um'), 2)).toHaveLength(2);
    expect(busca.buscar(tenantId, vetorDeTexto('um'), 99)).toHaveLength(5);
  });

  it('devolve lista vazia quando topK é zero ou negativo', () => {
    const tenantId = semear('clinica', 'faq.md', ['alguma coisa']);
    const busca = new BuscaPorCossenoEmMemoria(db);

    expect(busca.buscar(tenantId, vetorDeTexto('alguma'), 0)).toEqual([]);
    expect(busca.buscar(tenantId, vetorDeTexto('alguma'), -1)).toEqual([]);
  });

  it('NUNCA devolve chunk de outro tenant', () => {
    // Esta é a garantia central do multi-tenant: vazamento aqui é vazamento
    // de dado de cliente.
    const clinica = semear('clinica', 'faq.md', ['O clareamento custa setecentos reais.']);
    const loja = semear('loja', 'politicas.md', ['O clareamento custa novecentos reais.']);

    const busca = new BuscaPorCossenoEmMemoria(db);

    const daClinica = busca.buscar(clinica, vetorDeTexto('quanto custa o clareamento'), 10);
    expect(daClinica).toHaveLength(1);
    expect(daClinica[0]?.chunk.texto).toContain('setecentos');
    expect(daClinica.every((r) => r.chunk.tenantId === clinica)).toBe(true);

    const daLoja = busca.buscar(loja, vetorDeTexto('quanto custa o clareamento'), 10);
    expect(daLoja[0]?.chunk.texto).toContain('novecentos');
  });

  it('devolve lista vazia para tenant sem nenhum chunk', () => {
    const tenant = salvarTenant(db, { slug: 'vazio', nome: 'Vazio', config: {}, promptDoSistema: 'p' });
    const busca = new BuscaPorCossenoEmMemoria(db);

    expect(busca.buscar(tenant.id, vetorDeTexto('qualquer coisa'), 5)).toEqual([]);
  });

  it('informa o arquivo e a seção de origem de cada resultado', () => {
    const tenantId = semear('clinica', 'horarios.txt', ['Abrimos às oito horas da manhã.']);
    const busca = new BuscaPorCossenoEmMemoria(db);

    const [resultado] = busca.buscar(tenantId, vetorDeTexto('abrimos horas manhã'), 1);

    expect(resultado?.arquivo).toBe('horarios.txt');
    expect(resultado?.chunk.metadados.secao).toBe('Seção 0');
  });
});

describe('reingestão', () => {
  it('apaga os chunks antigos ao regravar o mesmo arquivo', () => {
    // Sem isso, cada ingestão duplicaria o conteúdo e envenenaria a busca.
    const tenant = salvarTenant(db, { slug: 'clinica', nome: 'Clínica', config: {}, promptDoSistema: 'p' });

    const primeiroId = salvarDocumento(db, tenant.id, 'faq.md', 'versão antiga');
    inserirChunks(db, [
      { documentId: primeiroId, tenantId: tenant.id, indice: 0, texto: 'versão antiga', embedding: vetorDeTexto('versão antiga'), metadados: {} },
    ]);
    expect(contarChunks(db, tenant.id)).toBe(1);

    const segundoId = salvarDocumento(db, tenant.id, 'faq.md', 'versão nova');
    inserirChunks(db, [
      { documentId: segundoId, tenantId: tenant.id, indice: 0, texto: 'versão nova', embedding: vetorDeTexto('versão nova'), metadados: {} },
    ]);

    expect(contarChunks(db, tenant.id)).toBe(1);

    const busca = new BuscaPorCossenoEmMemoria(db);
    const resultados = busca.buscar(tenant.id, vetorDeTexto('versão'), 10);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]?.chunk.texto).toBe('versão nova');
  });
});
