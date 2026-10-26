/**
 * Segmentación y tokenización de texto, sin dependencias del DOM.
 *
 * Se separa del `Reader` para poder probar (y reutilizar) la lógica de frases
 * y palabras de forma pura.
 */

import type { PhraseChunk, WordToken } from '../types.js';

/**
 * Signos que cierran una frase y provocan una pausa.
 *
 * La puntuación de apertura (¿, ¡) y los separadores internos (:, -) quedan
 * fuera a propósito.
 */
export const PHRASE_DELIMITERS = ',;.!?…，。！？';

const PHRASE_REGEX = new RegExp(`([^${PHRASE_DELIMITERS}]+)([${PHRASE_DELIMITERS}]*)`, 'gu');

/**
 * Los ideogramas Han se separan carácter a carácter (marcador más preciso);
 * el resto de alfabetos Unicode se agrupan por palabra, incluyendo letras
 * acentuadas, alfabetos no latinos, números y marcas combinadas.
 */
const WORD_REGEX = /\p{Script=Han}|[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Divide un texto en frases delimitadas por `PHRASE_DELIMITERS` y tokeniza
 * las palabras de cada frase.
 *
 * Los `charIndex` son absolutos respecto al texto original, de modo que el
 * renderer y los eventos `boundary` compartan el mismo sistema de coordenadas.
 */
export function segmentText(text: string): PhraseChunk[] {
  const chunks: PhraseChunk[] = [];
  if (!text) return chunks;

  let globalWordIndex = 0;
  PHRASE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PHRASE_REGEX.exec(text)) !== null) {
    const rawPhraseText = match[1] ?? '';
    const punctuation = match[2] ?? '';

    // Tramos que son sólo espacios o signos no generan locución, pero el
    // renderer los conserva como nodos de texto.
    if (!rawPhraseText.trim()) continue;

    const tokens = tokenizePhrase(rawPhraseText, match.index, globalWordIndex);
    if (tokens.length === 0) continue;

    globalWordIndex += tokens.length;

    const totalChars = tokens.reduce((total, token) => total + token.charLength, 0);

    chunks.push({
      index: chunks.length,
      phraseText: rawPhraseText + punctuation,
      punctuation,
      tokens,
      totalChars,
      charIndex: match.index,
    });
  }

  return chunks;
}

/**
 * Tokeniza una frase concreta. `offset` es la posición absoluta del inicio de
 * la frase y `startIndex` el índice global de su primera palabra.
 */
function tokenizePhrase(rawPhraseText: string, offset: number, startIndex: number): WordToken[] {
  const tokens: WordToken[] = [];

  WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_REGEX.exec(rawPhraseText)) !== null) {
    const word = match[0];
    tokens.push({
      index: startIndex + tokens.length,
      word,
      charIndex: offset + match.index,
      charLength: word.length,
    });
  }

  return tokens;
}
