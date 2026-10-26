/**
 * Tipos públicos del motor Speech Reader.
 *
 * Se mantienen en un módulo propio para que el resto de la implementación
 * (tokenizador, renderer, lector, selector de voces) dependa de contratos
 * estables y no de la clase `Reader`.
 */

/**
 * Configuración de voz y reproducción de audio.
 */
export interface VoiceSettings {
  text: string;
  lang: string;
  voiceType?: 'male' | 'female' | 'default';
  /** Identificador exacto de voz (voiceURI o, en su defecto, name). */
  voiceURI?: string;
  /** Velocidad de reproducción de audio (0.1 a 10). */
  rate: number;
  /** Tono de voz (0 a 2). */
  pitch: number;
  /** Volumen de audio (0 a 1). */
  volume: number;
  /** Pausa en ms tras una coma, punto y coma o punto (por defecto 500 ms). */
  phrasePause?: number;
  /** Tiempo estimado en ms por palabra (por defecto 400 ms). */
  phraseVelocity?: number;
}

/**
 * Configuración visual del marcador/resaltador de texto.
 */
export interface MarkerSettings {
  color?: string;
  bgColor?: string;
  emphasis?: 'bold' | 'italic' | 'underline' | 'none';
  /** Clase CSS adicional que se aplica a la palabra activa. */
  highlightClass?: string;
  /** Multiplicador de velocidad para acelerar o ralentizar el marcador. */
  markerVelocity?: number;
}

/**
 * Opciones globales de inicialización del Reader.
 */
export interface ReaderOptions {
  voice?: Partial<VoiceSettings>;
  marker?: MarkerSettings;
  debug?: boolean;
}

/**
 * Representación de un token de palabra individual dentro del texto.
 */
export interface WordToken {
  /** Índice global de la palabra en el texto completo. */
  index: number;
  word: string;
  /** Posición absoluta (en unidades UTF-16) dentro del texto completo. */
  charIndex: number;
  charLength: number;
}

/**
 * Estructura de una frase delimitada por puntuación (, ; . ! ? … ，。！？).
 */
export interface PhraseChunk {
  index: number;
  /** Texto que se envía a la síntesis, incluida la puntuación final. */
  phraseText: string;
  punctuation: string;
  tokens: WordToken[];
  totalChars: number;
  /** Posición absoluta de la frase dentro del texto completo. */
  charIndex: number;
}

/**
 * Carga útil del evento de cambio de palabra.
 */
export interface BoundaryPayload {
  wordIndex: number;
  word: string;
  charIndex: number;
  charLength: number;
  phraseIndex: number;
}

/**
 * Callback de evento emitido al cambiar la palabra que se está leyendo.
 */
export type BoundaryCallback = (payload: BoundaryPayload) => void;

/**
 * Callback del ciclo de vida de la lectura (inicio y fin de la locución).
 */
export type ReaderEventCallback = () => void;

/**
 * Callback de error de la síntesis de voz.
 */
export type ReaderErrorCallback = (error: string) => void;

/**
 * Estado actual de la reproducción.
 */
export type ReaderStatus = 'idle' | 'speaking' | 'paused';

/**
 * Mapa de eventos tipados que expone el Reader.
 */
export interface ReaderEventMap {
  start: void;
  end: void;
  boundary: BoundaryPayload;
  error: string;
}

/**
 * Interfaz fluida devuelta por `reader.set()`.
 */
export interface ReaderSetters {
  text(text: string): ReaderSetters;
  language(lang: string): ReaderSetters;
  voice(settings: Partial<VoiceSettings>): ReaderSetters;
  marker(settings: Partial<MarkerSettings>): ReaderSetters;
  target(element: HTMLElement): ReaderSetters;
}

/**
 * Interfaz de consulta devuelta por `reader.get()`.
 */
export interface ReaderGetters {
  text(): string;
  language(): string;
  voice(): SpeechSynthesisVoice | null;
  voices(): SpeechSynthesisVoice[];
  marker(): MarkerSettings;
  settings(): VoiceSettings;
  phrases(): PhraseChunk[];
  status(): ReaderStatus;
}
