/**
 * Punto de entrada del paquete.
 *
 * Existe para que `tsc` emita `dist/index.d.ts`, que es lo que declara
 * `package.json#types` (el bundle de Vite ya se genera a partir de este archivo).
 */
export * from './main';
