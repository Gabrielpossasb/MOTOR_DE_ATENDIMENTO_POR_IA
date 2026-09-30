/**
 * Gera e "envia" os lembretes do dia.
 *
 * Uso:
 *   npm run lembretes -- clinica-sorriso                  gera os de hoje e lista a fila
 *   npm run lembretes -- clinica-sorriso --data 2026-10-05 outro dia
 *   npm run lembretes -- clinica-sorriso --enviar          marca a fila como enviada
 *
 * Não chama a API: nem modelo nem embedding entram aqui, então rodar é grátis.
 *
 * `--enviar` marca `sent_at` e imprime o que sairia. Nesta fase não existe
 * WhatsApp, e o comando é o dublê do canal: o dia em que a Cloud API entrar,
 * ela drena a mesma fila e nada disto muda de lugar.
 *
 * Diferença de propósito: aqui `--enviar` marca a fila INTEIRA do dia pedido,
 * porque quem roda escolheu o dia e quer ver o resultado na hora que rodou. O
 * adaptador de verdade não vai escolher dia nenhum — ele usa
 * `lembretesAEnviar`, que respeita o `scheduled_for`.
 */
import { abrirBanco } from '../storage/db.js';
import { carregarTenant } from '../core/tenant/tenant-service.js';
import { dataLocal } from '../core/agenda/disponibilidade.js';
import { gerarLembretes, listarLembretes, marcarEnviados } from '../core/agenda/lembretes.js';

function principal(): void {
  const argumentos = process.argv.slice(2);
  // O slug é o primeiro argumento solto, e "solto" exclui o valor de `--data`:
  // sem isso, `npm run lembretes -- --data 2026-10-05 clinica` tomaria a data
  // como slug e reclamaria de um tenant chamado "2026-10-05".
  const slug = argumentos.find(
    (a, i) => !a.startsWith('--') && argumentos[i - 1] !== '--data',
  );

  if (!slug) {
    console.error('Informe o slug do tenant. Exemplo: npm run lembretes -- clinica-sorriso');
    process.exit(1);
  }

  const enviar = argumentos.includes('--enviar');
  const data = valorDe(argumentos, '--data') ?? dataLocal();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    console.error(`--data precisa ser YYYY-MM-DD. Recebi: ${data}`);
    process.exit(1);
  }

  const db = abrirBanco();

  try {
    const tenant = carregarTenant(db, slug);

    const geracao = gerarLembretes(db, tenant.id, tenant.nome, { data });

    console.log(`\n${tenant.nome} — lembretes de ${data}\n`);
    console.log(`  gerados agora: ${geracao.criados.length}`);
    console.log(`  já existiam:   ${geracao.jaTinham}`);
    if (geracao.tardeDemais > 0) {
      console.log(`  tarde demais:  ${geracao.tardeDemais} (consulta já começou)`);
    }

    const pendentes = listarLembretes(db, tenant.id, { data });

    if (pendentes.length === 0) {
      console.log('\nNada na fila para este dia.\n');
      return;
    }

    console.log(`\nFila (${pendentes.length}):\n`);
    for (const lembrete of pendentes) {
      console.log(`  [${lembrete.previstoPara}] ${lembrete.contatoId}`);
      console.log(`  ${lembrete.corpo}\n`);
    }

    if (!enviar) {
      console.log(`Nada foi enviado. Para marcar como enviado: npm run lembretes -- ${slug} --data ${data} --enviar\n`);
      return;
    }

    const marcados = marcarEnviados(
      db,
      tenant.id,
      pendentes.map((l) => l.id),
    );
    console.log(`\nMarcados como enviados: ${marcados}.`);
    console.log('Rodar de novo não duplica nada: quem segura é o índice único do outbox.\n');
  } finally {
    db.close();
  }
}

/** Valor de uma opção `--nome valor`. Outra opção no lugar do valor não conta. */
function valorDe(argumentos: string[], nome: string): string | undefined {
  const posicao = argumentos.indexOf(nome);
  if (posicao === -1) return undefined;

  const valor = argumentos[posicao + 1];
  return valor && !valor.startsWith('--') ? valor : undefined;
}

principal();
