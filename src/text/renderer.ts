/**
 * Renderer del texto segmentado.
 *
 * Se construye el DOM con `textContent` y nodos de texto en lugar de
 * `innerHTML`: así se conservan todos los caracteres originales (signos de
 * apertura, paréntesis, guiones, emojis…) y el texto del usuario nunca se
 * interpreta como HTML.
 */

import type { PhraseChunk } from '../types.js';

/**
 * Sustituye el contenido del contenedor por el texto segmentado y devuelve el
 * mapa `índice global de palabra -> span`, que usa el highlighter.
 */
export function renderSegments(
  container: HTMLElement,
  text: string,
  chunks: readonly PhraseChunk[],
): Map<number, HTMLElement> {
  const document = container.ownerDocument;
  if (!document) {
    throw new Error('El contenedor no pertenece a un documento DOM válido.');
  }

  const fragment = document.createDocumentFragment();
  const nodes = new Map<number, HTMLElement>();
  let cursor = 0;

  const appendText = (value: string): void => {
    if (value) fragment.append(document.createTextNode(value));
  };

  for (const chunk of chunks) {
    const chunkStart = chunk.charIndex;
    if (chunkStart > cursor) appendText(text.slice(cursor, chunkStart));

    let phraseCursor = chunkStart;

    for (const token of chunk.tokens) {
      if (token.charIndex > phraseCursor) {
        appendText(text.slice(phraseCursor, token.charIndex));
      }

      const span = document.createElement('span');
      span.className = 'reader-word';
      span.dataset.readerIndex = String(token.index);
      span.textContent = text.slice(token.charIndex, token.charIndex + token.charLength);
      fragment.append(span);
      nodes.set(token.index, span);

      phraseCursor = token.charIndex + token.charLength;
    }

    const chunkEnd = chunkStart + chunk.phraseText.length;
    if (chunkEnd > phraseCursor) {
      appendText(text.slice(phraseCursor, chunkEnd));
    }
    if (chunkEnd > cursor) cursor = chunkEnd;
  }

  if (cursor < text.length) appendText(text.slice(cursor));

  container.replaceChildren(fragment);
  return nodes;
}
