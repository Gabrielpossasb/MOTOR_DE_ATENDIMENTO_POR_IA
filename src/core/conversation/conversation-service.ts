/**
 * Janela de contexto da conversa.
 *
 * Mandar a conversa inteira ao modelo é caro e piora a qualidade: quanto mais
 * texto antigo, menos peso as regras do prompt e os chunks recuperados têm.
 * Por isso só as últimas N mensagens vão junto.
 */
import { config } from '../../config.js';
import type { Db } from '../../storage/db.js';
import { ultimasMensagens } from '../../storage/repositories/messages.js';
import type { TurnoDaConversa } from '../types.js';

/**
 * Monta a janela de contexto a ser enviada ao modelo.
 *
 * Mensagens de handoff ficam de fora: repetir "vou chamar alguém da equipe" no
 * histórico ensina o modelo a repetir a frase, que é o oposto do que queremos.
 */
export function janelaDeContexto(db: Db, conversaId: number, limite?: number): TurnoDaConversa[] {
  const maximo = limite ?? config.conversa.mensagensNaJanela;

  return ultimasMensagens(db, conversaId, maximo)
    .filter((m) => m.papel === 'user' || m.papel === 'assistant')
    .filter((m) => !ehFraseDeHandoff(m.conteudo))
    .map((m) => ({
      papel: m.papel as 'user' | 'assistant',
      conteudo: m.conteudo,
    }));
}

function ehFraseDeHandoff(texto: string): boolean {
  return texto.trim() === config.resposta.fraseDeHandoff;
}
