/**
 * Lê as conversas gravadas e mostra o aproveitamento de cada uma.
 *
 * Uso:
 *   npm run conversas -- clinica-sorriso              lista as conversas
 *   npm run conversas -- clinica-sorriso --id 22      transcrito + relatório
 *   npm run conversas -- clinica-sorriso --id 22 --md exporta para logs/conversas/
 *   npm run conversas -- clinica-sorriso --md         exporta todas
 *
 * Não chama a API: lê só o banco, então rodar é grátis.
 *
 * O export vai para `logs/conversas/`, que está no `.gitignore`. O resto de
 * `logs/` é versionado de propósito — mas aquilo é avaliação sintética, e isto
 * aqui é conversa de gente, com nome e telefone. Com cliente real é LGPD, não
 * preferência.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { abrirBanco, type Db } from '../storage/db.js';
import { carregarTenant, configEfetiva } from '../core/tenant/tenant-service.js';
import { mensagensApos, type MensagemGravada } from '../storage/repositories/messages.js';
import {
  auditarConversa,
  type ConversaParaAuditar,
  type RelatorioDeConversa,
} from '../core/conversation/auditoria.js';

function principal(): void {
  const argumentos = process.argv.slice(2);
  const slug = argumentos.find((a, i) => !a.startsWith('--') && argumentos[i - 1] !== '--id');

  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run conversas -- clinica-sorriso');
    process.exit(1);
  }

  const exportar = argumentos.includes('--md');
  const posicaoDoId = argumentos.indexOf('--id');
  const id = posicaoDoId === -1 ? undefined : Number(argumentos[posicaoDoId + 1]);

  if (posicaoDoId !== -1 && (!Number.isInteger(id) || (id ?? 0) <= 0)) {
    console.error('--id precisa ser o número de uma conversa. Veja os números na listagem.');
    process.exit(1);
  }

  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);
    const limiar = configEfetiva(tenant).limiarDeConfianca;
    const conversas = listarConversas(db, tenant.id, id);

    if (conversas.length === 0) {
      console.log(
        id ? `Conversa ${id} não existe neste tenant.` : 'Nenhuma conversa gravada ainda.',
      );
      return;
    }

    const relatorios = conversas.map((c) => auditarConversa(c, mensagensApos(db, c.id, 0), limiar));

    if (id) {
      mostrarTranscrito(db, conversas[0] as ConversaParaAuditar, relatorios[0] as RelatorioDeConversa);
    } else {
      mostrarListagem(relatorios, limiar);
    }

    if (exportar) {
      for (const relatorio of relatorios) {
        const destino = exportarMarkdown(db, slug, relatorio);
        console.log(`  escrito: ${path.relative(config.caminhos.raiz, destino)}`);
      }
    }
  } finally {
    db.close();
  }
}

function listarConversas(db: Db, tenantId: number, id?: number): ConversaParaAuditar[] {
  const linhas = db
    .prepare(
      `SELECT id, contact_id, channel, status FROM conversations
       WHERE tenant_id = ? AND (? IS NULL OR id = ?)
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(tenantId, id ?? null, id ?? null) as {
    id: number;
    contact_id: string;
    channel: string;
    status: string;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    contatoId: l.contact_id,
    canal: l.channel,
    status: l.status,
  }));
}

function mostrarListagem(relatorios: RelatorioDeConversa[], limiar: number): void {
  console.log(`\nlimiar ${limiar} · aproveitamento = turnos sem problema grave / turnos do bot\n`);
  console.log('  id  contato       canal  status    turnos  aprov.  graves  avisos  custo');
  console.log('  ' + '─'.repeat(74));

  for (const r of relatorios) {
    const graves = r.problemas.filter((p) => p.grave).length;
    const avisos = r.problemas.length - graves;
    // Corta o contato para a tabela não desalinhar: os ids gerados pela página
    // têm tamanho fixo, mas os de teste antigos não.
    const contato = r.contatoId.slice(0, 13);

    console.log(
      `  ${String(r.conversaId).padStart(3)}  ${contato.padEnd(13)} ${r.canal.padEnd(6)} ` +
        `${r.status.padEnd(9)} ${String(r.turnos).padStart(6)}  ` +
        `${(r.aproveitamento * 100).toFixed(0).padStart(4)}%  ` +
        `${String(graves).padStart(6)}  ${String(avisos).padStart(6)}  ` +
        `US$ ${r.custoUsd.toFixed(5)}`,
    );
  }

  const pior = [...relatorios].sort((a, b) => a.aproveitamento - b.aproveitamento)[0];
  if (pior && pior.turnos > 0) {
    console.log(`\nPior aproveitamento: conversa ${pior.conversaId}.`);
    console.log(`Detalhe: npm run conversas -- <slug> --id ${pior.conversaId}\n`);
  }
}

function mostrarTranscrito(
  db: Db,
  conversa: ConversaParaAuditar,
  relatorio: RelatorioDeConversa,
): void {
  const mensagens = mensagensApos(db, conversa.id, 0);
  const porTurno = new Map<number, string[]>();

  for (const p of relatorio.problemas) {
    const marca = `${p.grave ? '!!' : ' ~'} ${p.tipo}: ${p.detalhe}`;
    porTurno.set(p.turno, [...(porTurno.get(p.turno) ?? []), marca]);
  }

  console.log(`\nConversa ${conversa.id} · ${conversa.contatoId} · ${conversa.canal} · ${conversa.status}\n`);

  let turno = 0;
  for (const m of mensagens) {
    if (m.papel === 'user') {
      console.log(`  CLIENTE  ${m.conteudo.replace(/\n/g, ' / ')}`);
      continue;
    }

    turno += 1;
    const score = m.fontes.length === 0 ? '—' : Math.max(...m.fontes.map((f) => f.score)).toFixed(3);
    console.log(`  BOT ${String(turno).padStart(2)}   ${m.conteudo.replace(/\n/g, ' / ')}`);
    console.log(`           score ${score} · US$ ${(m.custoUsd ?? 0).toFixed(6)} · ${m.latenciaMs ?? 0}ms`);

    for (const marca of porTurno.get(turno) ?? []) console.log(`           ${marca}`);
  }

  resumir(relatorio);
}

function resumir(r: RelatorioDeConversa): void {
  const graves = r.problemas.filter((p) => p.grave);

  console.log(`\n  Aproveitamento: ${(r.aproveitamento * 100).toFixed(0)}% ` +
    `(${r.turnos - r.turnosComProblemaGrave} de ${r.turnos} turnos sem problema grave)`);
  console.log(`  Custo: US$ ${r.custoUsd.toFixed(6)} · US$ ${r.custoMedioPorRespostaUsd.toFixed(6)} por resposta`);
  console.log(`  Latência: ${r.latenciaMediaMs}ms em média, pior ${r.latenciaPiorMs}ms`);
  console.log(`  Score médio: ${r.scoreMedio === null ? '—' : r.scoreMedio.toFixed(3)}`);

  if (graves.length === 0) {
    console.log('\n  Nenhum problema grave.\n');
    return;
  }

  console.log(`\n  ${graves.length} problema(s) grave(s):`);
  for (const p of graves) console.log(`    turno ${p.turno}: ${p.detalhe}`);
  console.log('\n  Os achados vêm de padrão de texto e podem errar. Confira o trecho citado.\n');
}

/** Escreve o transcrito e o relatório num markdown legível. */
function exportarMarkdown(db: Db, slug: string, r: RelatorioDeConversa): string {
  const pasta = path.join(config.caminhos.raiz, 'logs', 'conversas');
  fs.mkdirSync(pasta, { recursive: true });

  const mensagens = mensagensApos(db, r.conversaId, 0);
  const linhas: string[] = [
    `# Conversa ${r.conversaId} — ${slug}`,
    '',
    `Contato \`${r.contatoId}\` · canal ${r.canal} · status ${r.status}`,
    `De ${r.comecouEm} a ${r.terminouEm}`,
    '',
    `**Aproveitamento: ${(r.aproveitamento * 100).toFixed(0)}%** ` +
      `— ${r.turnos - r.turnosComProblemaGrave} de ${r.turnos} turnos sem problema grave.`,
    '',
    '| | |',
    '|---|---|',
    `| Turnos do bot | ${r.turnos} |`,
    `| Custo | US$ ${r.custoUsd.toFixed(6)} (US$ ${r.custoMedioPorRespostaUsd.toFixed(6)} por resposta) |`,
    `| Latência | ${r.latenciaMediaMs}ms em média, pior ${r.latenciaPiorMs}ms |`,
    `| Score médio | ${r.scoreMedio === null ? '—' : r.scoreMedio.toFixed(3)} |`,
    '',
    '## Transcrito',
    '',
  ];

  const porTurno = new Map<number, typeof r.problemas>();
  for (const p of r.problemas) porTurno.set(p.turno, [...(porTurno.get(p.turno) ?? []), p]);

  let turno = 0;
  for (const m of mensagens) {
    if (m.papel === 'user') {
      linhas.push(`**Cliente:** ${m.conteudo.replace(/\n/g, ' ')}`, '');
      continue;
    }

    turno += 1;
    const score = m.fontes.length === 0 ? '—' : Math.max(...m.fontes.map((f) => f.score)).toFixed(3);
    linhas.push(`**Bot (turno ${turno}):** ${m.conteudo.replace(/\n/g, ' ')}`);
    linhas.push(`<br><sub>score ${score} · US$ ${(m.custoUsd ?? 0).toFixed(6)} · ${m.latenciaMs ?? 0}ms</sub>`);

    for (const p of porTurno.get(turno) ?? []) {
      linhas.push(`<br>${p.grave ? '**GRAVE**' : 'aviso'} — \`${p.tipo}\`: ${p.detalhe}`);
    }

    linhas.push('');
  }

  linhas.push(
    '## Achados',
    '',
    'Detecção por padrão de texto: pode errar. Cada achado cita o turno para conferência.',
    '',
  );

  if (r.problemas.length === 0) {
    linhas.push('Nenhum.', '');
  } else {
    linhas.push('| turno | tipo | gravidade | detalhe |', '|---|---|---|---|');
    for (const p of r.problemas) {
      linhas.push(`| ${p.turno} | \`${p.tipo}\` | ${p.grave ? 'grave' : 'aviso'} | ${p.detalhe} |`);
    }
    linhas.push('');
  }

  const destino = path.join(pasta, `${slug}-${String(r.conversaId).padStart(4, '0')}.md`);
  fs.writeFileSync(destino, linhas.join('\n'), 'utf8');
  return destino;
}

principal();
