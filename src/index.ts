/**
 * Punto de entrada del paquete.
 *
 * El bundle de Vite y las declaraciones de `tsc` se generan a partir de este
 * archivo. `segmentText` se expone como utilidad pública para que los
 * consumidores puedan previsualizar la segmentación sin instanciar el Reader.
 */

export { Reader } from './core/reader.js';
export { PHRASE_DELIMITERS, segmentText } from './text/tokenizer.js';
export type * from './types.js';
