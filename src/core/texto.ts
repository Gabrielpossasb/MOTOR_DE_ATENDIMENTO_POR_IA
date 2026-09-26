/**
 * Normalização de texto livre, compartilhada por quem precisa comparar frases.
 *
 * Mora sozinha aqui porque três lugares precisavam da mesma coisa — a detecção
 * de handoff, as regras da avaliação e a classificação de turno social — e três
 * cópias da mesma função é três chances de uma divergir das outras em silêncio.
 */

/** Minúsculas, sem acento e com espaços colapsados. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
