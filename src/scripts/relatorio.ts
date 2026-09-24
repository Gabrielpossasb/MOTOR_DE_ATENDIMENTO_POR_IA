/**
 * Lê o histórico de avaliações e mostra a trajetória ao longo do tempo.
 *
 * Uso:
 *   npm run relatorio                      resumo de todas as execuções
 *   npm run relatorio -- desconto          trajetória de uma pergunta
 *   npm run relatorio -- --instaveis       perguntas que oscilam entre passar e falhar
 *
 * Não chama a API: lê apenas logs/historico.jsonl.
 */
import { config } from '../config.js';
import { lerHistorico, type RegistroDeAvaliacao } from '../core/avaliacao/log.js';

function principal(): void {
  const historico = lerHistorico(config.caminhos.raiz);

  if (historico.length === 0) {
    console.log('Nenhuma avaliação registrada ainda. Rode: npm run avaliar -- <slug>');
    return;
  }

  const argumento = process.argv[2];

  if (argumento === '--instaveis') {
    mostrarInstaveis(historico);
  } else if (argumento) {
    mostrarPergunta(historico, argumento);
  } else {
    mostrarExecucoes(historico);
  }
}

/** Uma linha por execução: o panorama de como o projeto evoluiu. */
function mostrarExecucoes(historico: RegistroDeAvaliacao[]): void {
  const execucoes = [...new Set(historico.map((r) => r.execucao))].sort();

  console.log('execução           acurácia      custo      latência   modelo / limiar');
  console.log('─'.repeat(78));

  for (const execucao of execucoes) {
    const registros = historico.filter((r) => r.execucao === execucao);
    const passaram = registros.filter((r) => r.passou).length;
    const custo = registros.reduce((s, r) => s + r.custoUsd, 0);
    const latencia = Math.round(registros.reduce((s, r) => s + r.latenciaMs, 0) / registros.length);
    const acuracia = ((passaram / registros.length) * 100).toFixed(1);
    const primeiro = registros[0];

    console.log(
      `${execucao}  ${acuracia.padStart(5)}% ${String(`(${passaram}/${registros.length})`).padStart(8)}  ` +
        `US$ ${custo.toFixed(5)}  ${String(latencia).padStart(5)}ms   ` +
        `${primeiro?.modelo ?? '?'} / ${primeiro?.limiar ?? '?'}`,
    );
  }

  console.log('\nDetalhe de uma pergunta: npm run relatorio -- <id>');
}

/** Trajetória de uma pergunta: é o que mostra se algo é regressão ou oscilação. */
function mostrarPergunta(historico: RegistroDeAvaliacao[], id: string): void {
  const registros = historico.filter((r) => r.id === id).sort((a, b) => a.execucao.localeCompare(b.execucao));

  if (registros.length === 0) {
    const ids = [...new Set(historico.map((r) => r.id))].sort();
    console.log(`Pergunta "${id}" não encontrada. Disponíveis:\n  ${ids.join('\n  ')}`);
    return;
  }

  console.log(`Pergunta: ${registros[0]?.pergunta}\n`);

  for (const r of registros) {
    console.log(`${r.execucao}  ${r.passou ? 'ok    ' : 'FALHOU'}  score ${r.melhorScore.toFixed(3)}  ${r.latenciaMs}ms  ${r.modelo}`);
    console.log(`  resposta: ${r.resposta || '(vazia)'}`);
    if (!r.passou) {
      for (const f of r.falhas) console.log(`  falha: ${f.regra} — ${f.detalhe}`);
    }
    console.log('');
  }

  const passaram = registros.filter((r) => r.passou).length;
  console.log(`Passou em ${passaram} de ${registros.length} execuções.`);
}

/**
 * Perguntas que já passaram e já falharam.
 *
 * São as mais informativas do log: não são bug nem acerto, são a fronteira em
 * que o modelo oscila. É nelas que mexer no prompt ou nos documentos rende.
 */
function mostrarInstaveis(historico: RegistroDeAvaliacao[]): void {
  const porId = new Map<string, RegistroDeAvaliacao[]>();
  for (const r of historico) {
    porId.set(r.id, [...(porId.get(r.id) ?? []), r]);
  }

  const instaveis = [...porId.entries()].filter(
    ([, rs]) => rs.some((r) => r.passou) && rs.some((r) => !r.passou),
  );

  if (instaveis.length === 0) {
    console.log('Nenhuma pergunta oscilou entre passar e falhar.');
    return;
  }

  console.log('Perguntas instáveis (já passaram e já falharam):\n');
  for (const [id, rs] of instaveis) {
    const passaram = rs.filter((r) => r.passou).length;
    console.log(`  ${id.padEnd(30)} passou em ${passaram}/${rs.length}`);
  }
  console.log('\nDetalhe: npm run relatorio -- <id>');
}

principal();
