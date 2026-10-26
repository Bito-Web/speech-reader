/**
 * Reader: orquestador de la Web Speech API, la segmentación y el marcador.
 *
 * La clase se mantiene deliberadamente delgada: el texto se segmenta en
 * `text/tokenizer`, el DOM se construye en `text/renderer`, el marcador vive
 * en `ui/highlighter` y la selección de voces en `speech/voice-selector`.
 *
 * La reproducción se modela como una máquina de estados
 * (`idle -> speaking <-> paused`) con un `session` incremental que invalida
 * los callbacks asíncronos de locuciones canceladas.
 */

import type {
  BoundaryCallback,
  MarkerSettings,
  PhraseChunk,
  ReaderErrorCallback,
  ReaderEventCallback,
  ReaderEventMap,
  ReaderGetters,
  ReaderOptions,
  ReaderSetters,
  ReaderStatus,
  VoiceSettings,
  WordToken,
} from '../types.js';
import { loadVoices, selectVoice } from '../speech/voice-selector.js';
import { renderSegments } from '../text/renderer.js';
import { segmentText } from '../text/tokenizer.js';
import { Highlighter } from '../ui/highlighter.js';
import { EventEmitter } from './events.js';

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  text: '',
  lang: 'es-ES',
  voiceType: 'default',
  rate: 1,
  pitch: 1,
  volume: 1,
  phrasePause: 500,
  phraseVelocity: 400,
};

const DEFAULT_MARKER_SETTINGS: MarkerSettings = {
  color: '#ffffff',
  bgColor: '#ff4757',
  emphasis: 'bold',
  markerVelocity: 1.0,
};

const MIN_WORD_DURATION_MS = 80;
const VOICE_LOAD_TIMEOUT_MS = 1500;

export class Reader {
  private readonly synth: SpeechSynthesis;
  private readonly events = new EventEmitter<ReaderEventMap>();
  private readonly highlighter: Highlighter;

  private containerElement: HTMLElement | null = null;
  private phraseChunks: PhraseChunk[] = [];
  private wordsTokens: WordToken[] = [];

  private voiceSettings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  private markerSettings: MarkerSettings = { ...DEFAULT_MARKER_SETTINGS };

  private status: ReaderStatus = 'idle';
  private currentPhraseIndex = 0;
  private lastEmittedTokenIndex = -1;
  private startNotified = false;
  private isRealBoundaryMode = false;

  /** Identificador de sesión: invalida callbacks de locuciones antiguas. */
  private session = 0;
  private wordTimer: number | null = null;
  private phraseTimer: number | null = null;
  private pendingAdvance = false;

  private isDebug = false;
  private isDirty = true;
  private preparePromise: Promise<boolean> | null = null;

  constructor(options: ReaderOptions = {}) {
    if (
      typeof window === 'undefined' ||
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      throw new Error('Web Speech API no está soportada en este entorno.');
    }

    this.synth = window.speechSynthesis;
    this.highlighter = new Highlighter(this.markerSettings);

    if (options.voice) {
      this.voiceSettings = { ...this.voiceSettings, ...options.voice };
    }
    if (options.marker) {
      this.markerSettings = { ...this.markerSettings, ...options.marker };
      this.highlighter.update(this.markerSettings);
    }
    if (options.debug !== undefined) {
      this.isDebug = options.debug;
    }

    this.log('Reader inicializado.');
  }

  public get(): ReaderGetters {
    return {
      text: () => this.voiceSettings.text,
      language: () => this.voiceSettings.lang,
      voice: () => selectVoice(this.getAvailableVoices(), this.voiceSettings),
      voices: () => this.getAvailableVoices(),
      marker: () => ({ ...this.markerSettings }),
      settings: () => ({ ...this.voiceSettings }),
      phrases: () =>
        this.phraseChunks.map((chunk) => ({
          ...chunk,
          tokens: chunk.tokens.map((token) => ({ ...token })),
        })),
      status: () => this.status,
    };
  }

  public set(): ReaderSetters {
    const setters: ReaderSetters = {
      text: (text: string) => {
        if (this.status !== 'idle') this.stop();
        this.voiceSettings.text = text;
        this.isDirty = true;
        this.log('Texto actualizado:', text);
        return setters;
      },
      language: (lang: string) => {
        this.voiceSettings.lang = lang;
        this.log('Idioma actualizado:', lang);
        return setters;
      },
      voice: (settings: Partial<VoiceSettings>) => {
        // `text` también forma parte de VoiceSettings por compatibilidad;
        // si cambia hay que volver a segmentar y renderizar.
        if (settings.text !== undefined && settings.text !== this.voiceSettings.text) {
          if (this.status !== 'idle') this.stop();
          this.isDirty = true;
        }
        this.voiceSettings = { ...this.voiceSettings, ...settings };
        this.log('Configuración de voz actualizada:', this.voiceSettings);
        return setters;
      },
      marker: (settings: Partial<MarkerSettings>) => {
        this.markerSettings = { ...this.markerSettings, ...settings };
        this.highlighter.update(this.markerSettings);
        this.log('Configuración del marcador actualizada:', this.markerSettings);
        return setters;
      },
      target: (element: HTMLElement) => {
        if (this.status !== 'idle') this.stop();
        this.containerElement = element;
        this.isDirty = true;
        this.log('Elemento objetivo DOM configurado.');
        return setters;
      },
    };

    return setters;
  }

  public onBoundary(callback: BoundaryCallback): () => void {
    return this.events.on('boundary', callback);
  }

  public onStart(callback: ReaderEventCallback): () => void {
    return this.events.on('start', callback);
  }

  public onEnd(callback: ReaderEventCallback): () => void {
    return this.events.on('end', callback);
  }

  public onError(callback: ReaderErrorCallback): () => void {
    return this.events.on('error', callback);
  }

  /**
   * Suscripción genérica a los eventos tipados (`start`, `end`, `boundary`,
   * `error`). Devuelve la función para darse de baja.
   */
  public on<K extends keyof ReaderEventMap>(
    event: K,
    callback: (payload: ReaderEventMap[K]) => void,
  ): () => void {
    return this.events.on(event, callback);
  }

  public off<K extends keyof ReaderEventMap>(
    event: K,
    callback: (payload: ReaderEventMap[K]) => void,
  ): void {
    this.events.off(event, callback);
  }

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices();
  }

  /**
   * Carga las voces, segmenta el texto y renderiza el DOM.
   *
   * Deduplica llamadas concurrentes: si ya hay una preparación en curso
   * devuelve la misma promesa. Si se llama durante una lectura, la detiene
   * antes de reemplazar el DOM.
   */
  public async prepare(targetElement?: HTMLElement): Promise<boolean> {
    if (targetElement) {
      this.containerElement = targetElement;
      this.isDirty = true;
    }

    if (this.status !== 'idle') {
      this.stop();
    }

    if (this.preparePromise) {
      return this.preparePromise;
    }

    const operation = this.doPrepare();
    this.preparePromise = operation;

    try {
      return await operation;
    } finally {
      this.preparePromise = null;
    }
  }

  private async doPrepare(): Promise<boolean> {
    const initialText = this.voiceSettings.text;
    if (!initialText.trim()) {
      throw new Error('No se ha definido texto para leer.');
    }
    if (!this.containerElement) {
      throw new Error('No se ha definido un contenedor DOM objetivo.');
    }

    await loadVoices(this.synth, VOICE_LOAD_TIMEOUT_MS);

    // El texto o el contenedor pueden haber cambiado mientras se cargaban
    // las voces; se usan los valores más recientes.
    const text = this.voiceSettings.text;
    const container = this.containerElement;

    if (!text.trim()) {
      throw new Error('No se ha definido texto para leer.');
    }
    if (!container) {
      throw new Error('No se ha definido un contenedor DOM objetivo.');
    }

    this.phraseChunks = segmentText(text);
    this.wordsTokens = this.phraseChunks.flatMap((chunk) => chunk.tokens);

    const nodes = renderSegments(container, text, this.phraseChunks);
    this.highlighter.bind(nodes);
    this.highlighter.update(this.markerSettings);

    this.isDirty = false;
    this.log('Recursos preparados:', {
      phrases: this.phraseChunks.length,
      words: this.wordsTokens.length,
      container,
    });

    return true;
  }

  public highlightWordIndex(index: number): void {
    this.highlighter.highlight(index);
  }

  /**
   * Inicia (o reinicia) la lectura desde la primera frase.
   *
   * La promesa se resuelve cuando la locución ya fue encolada, no cuando
   * termina; el final se notifica con `onEnd`/`on('end')`.
   */
  public async speak(): Promise<void> {
    if (this.isDirty || !this.containerElement) {
      await this.prepare();
    }

    // stop() invalida callbacks de la sesión anterior y limpia timers.
    this.stop();

    const session = this.session;
    this.status = 'speaking';
    this.currentPhraseIndex = 0;
    this.lastEmittedTokenIndex = -1;
    this.startNotified = false;
    this.isRealBoundaryMode = false;
    this.pendingAdvance = false;

    this.log('Iniciando lectura.');
    this.playPhraseSequence(session);
  }

  private playPhraseSequence(session: number): void {
    if (session !== this.session || this.status !== 'speaking') return;

    if (this.currentPhraseIndex >= this.phraseChunks.length) {
      this.finish();
      return;
    }

    const chunk = this.phraseChunks[this.currentPhraseIndex];
    if (!chunk) {
      this.finish();
      return;
    }

    this.isRealBoundaryMode = false;
    this.lastEmittedTokenIndex = -1;

    this.log(`Iniciando frase ${chunk.index}: "${chunk.phraseText}"`);

    const utterance = new SpeechSynthesisUtterance(chunk.phraseText);
    const rate = this.getSafeRate();

    utterance.lang = this.voiceSettings.lang;
    utterance.rate = rate;
    utterance.pitch = this.voiceSettings.pitch;
    utterance.volume = this.voiceSettings.volume;

    const voice = selectVoice(this.getAvailableVoices(), this.voiceSettings);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      if (session !== this.session || this.status === 'idle') return;
      if (this.startNotified) return;

      this.startNotified = true;
      this.events.emit('start', undefined);
    };

    // Si el navegador entrega fronteras reales, ellas mandan sobre la
    // estimación por tiempo.
    utterance.onboundary = (event) => {
      if (session !== this.session || this.status !== 'speaking') return;
      this.handleBoundaryEvent(chunk, event, session);
    };

    utterance.onend = () => {
      if (session !== this.session) return;
      this.handlePhraseEnd(chunk, session);
    };

    utterance.onerror = (event) => {
      if (session !== this.session) return;

      const code = event.error || 'unknown';
      // 'interrupted' y 'canceled' son normales al detener o cambiar de frase.
      if (code === 'interrupted' || code === 'canceled' || this.status === 'idle') {
        return;
      }

      this.log('Error en la narración de frase:', event);
      this.resetState();
      this.highlighter.clear();
      this.events.emit('error', code);
    };

    const totalDuration = (chunk.tokens.length * this.getPhraseVelocity()) / rate;

    try {
      this.synth.speak(utterance);
    } catch (error) {
      this.log('No se pudo encolar la locución:', error);
      this.resetState();
      this.highlighter.clear();
      this.events.emit('error', error instanceof Error ? error.message : String(error));
      return;
    }

    // Un motor podría disparar `end` de forma síncrona; no se debe animar una
    // frase que ya terminó.
    if (
      session !== this.session ||
      this.status !== 'speaking' ||
      this.currentPhraseIndex !== chunk.index
    ) {
      return;
    }

    this.animatePhraseTokens(chunk, 0, totalDuration, chunk.totalChars, session);
  }

  private handlePhraseEnd(chunk: PhraseChunk, session: number): void {
    if (session !== this.session) return;

    this.clearWordTimer();
    this.currentPhraseIndex = chunk.index + 1;

    // Si se pausó justo mientras terminaba la frase, se continúa al reanudar.
    if (this.status === 'paused') {
      this.pendingAdvance = true;
      return;
    }

    if (this.currentPhraseIndex >= this.phraseChunks.length) {
      this.finish();
      return;
    }

    const pauseDuration = chunk.punctuation ? this.getPhrasePause() : 0;

    if (pauseDuration > 0) {
      this.log(
        `Pausa de ${pauseDuration} ms activada por el signo "${chunk.punctuation}".`,
      );
      this.phraseTimer = window.setTimeout(() => {
        this.phraseTimer = null;
        if (session !== this.session || this.status !== 'speaking') return;
        this.playPhraseSequence(session);
      }, pauseDuration);
    } else {
      this.playPhraseSequence(session);
    }
  }

  private animatePhraseTokens(
    chunk: PhraseChunk,
    tokenIndex: number,
    totalDuration: number,
    remainingChars: number,
    session: number,
  ): void {
    if (session !== this.session || this.status !== 'speaking' || this.isRealBoundaryMode) {
      return;
    }
    if (tokenIndex >= chunk.tokens.length) return;

    const token = chunk.tokens[tokenIndex];
    if (!token) return;

    this.emitToken(chunk, tokenIndex);

    const remainingTokens = chunk.tokens.length - tokenIndex;
    const fraction =
      remainingChars > 0 ? token.charLength / remainingChars : 1 / remainingTokens;
    const markerVelocity = this.getSafeMarkerVelocity();
    const wordDuration = Math.max(
      MIN_WORD_DURATION_MS,
      totalDuration * fraction * markerVelocity,
    );
    // El tiempo real de la voz no se ve afectado por markerVelocity: sólo se
    // acelera o ralentiza la animación visual.
    const voiceDuration = wordDuration / markerVelocity;

    this.wordTimer = window.setTimeout(() => {
      this.wordTimer = null;
      this.animatePhraseTokens(
        chunk,
        tokenIndex + 1,
        Math.max(0, totalDuration - voiceDuration),
        Math.max(0, remainingChars - token.charLength),
        session,
      );
    }, wordDuration);
  }

  private emitToken(chunk: PhraseChunk, tokenIndex: number): void {
    const token = chunk.tokens[tokenIndex];
    if (!token) return;

    this.lastEmittedTokenIndex = tokenIndex;
    this.highlighter.highlight(token.index);

    this.events.emit('boundary', {
      wordIndex: token.index,
      word: token.word,
      charIndex: token.charIndex,
      charLength: token.charLength,
      phraseIndex: chunk.index,
    });
  }

  /**
   * Frontera real entregada por el motor de síntesis. El `charIndex` del
   * evento es relativo a la frase (utterance), por eso se desplaza con
   * `chunk.charIndex`.
   */
  private handleBoundaryEvent(
    chunk: PhraseChunk,
    event: SpeechSynthesisEvent,
    session: number,
  ): void {
    const eventCharIndex = Number.isFinite(event.charIndex) ? event.charIndex : 0;
    const absoluteIndex = chunk.charIndex + eventCharIndex;

    let tokenIndex = -1;
    for (let i = 0; i < chunk.tokens.length; i++) {
      const token = chunk.tokens[i];
      if (!token) break;
      if (token.charIndex <= absoluteIndex) tokenIndex = i;
      else break;
    }

    if (tokenIndex === -1) return;

    this.isRealBoundaryMode = true;
    this.clearWordTimer();

    // Algunos motores repiten la misma frontera; no se emite dos veces.
    if (tokenIndex !== this.lastEmittedTokenIndex) {
      this.emitToken(chunk, tokenIndex);
    }

    const rate = this.getSafeRate();
    const phraseVelocity = this.getPhraseVelocity();
    const remainingTokens = Math.max(0, chunk.tokens.length - tokenIndex - 1);
    const remainingDuration = (remainingTokens * phraseVelocity) / rate;
    const remainingChars = chunk.tokens
      .slice(tokenIndex + 1)
      .reduce((total, token) => total + token.charLength, 0);
    const fallbackDelay = Math.max(600, phraseVelocity * 2) / rate;

    // Algunos motores emiten sólo la primera frontera: si dejan de llegar
    // eventos, se retoma la estimación por tiempo desde la palabra siguiente.
    this.wordTimer = window.setTimeout(() => {
      this.wordTimer = null;
      if (session !== this.session || this.status !== 'speaking') return;
      if (this.currentPhraseIndex !== chunk.index) return;

      this.isRealBoundaryMode = false;
      this.animatePhraseTokens(
        chunk,
        tokenIndex + 1,
        remainingDuration,
        remainingChars,
        session,
      );
    }, fallbackDelay);
  }

  private finish(): void {
    // Invalida cualquier callback pendiente de esta sesión.
    this.resetState();
    this.highlighter.clear();

    this.log('Lectura finalizada.');
    this.events.emit('end', undefined);
  }

  public pause(): void {
    if (this.status !== 'speaking') return;

    this.status = 'paused';
    this.clearWordTimer();

    // Pausa entre frases: se cancela el timer y se recuerda continuar.
    if (this.phraseTimer !== null) {
      this.clearPhraseTimer();
      this.pendingAdvance = true;
    }

    this.synth.pause();
    this.log('Lectura pausada.');
  }

  public resume(): void {
    if (this.status !== 'paused') return;

    this.status = 'speaking';
    this.synth.resume();

    // `resume()` también podría disparar eventos de forma síncrona.
    if (this.status !== 'speaking') return;

    if (this.pendingAdvance) {
      this.pendingAdvance = false;
      this.playPhraseSequence(this.session);
      return;
    }

    const chunk = this.phraseChunks[this.currentPhraseIndex];
    if (!chunk) {
      this.finish();
      return;
    }

    // Se retoma el marcador desde la última palabra emitida. No se vuelve a
    // encolar la frase: la locución pausada sigue viva en la cola del motor.
    this.isRealBoundaryMode = false;
    const nextToken = Math.max(0, this.lastEmittedTokenIndex + 1);
    const remaining = chunk.tokens.slice(nextToken);
    const remainingDuration =
      (remaining.length * this.getPhraseVelocity()) / this.getSafeRate();
    const remainingChars = remaining.reduce((total, token) => total + token.charLength, 0);

    this.animatePhraseTokens(
      chunk,
      nextToken,
      remainingDuration,
      remainingChars,
      this.session,
    );

    this.log('Reanudando lectura.');
  }

  public stop(): void {
    // Se incrementa antes de cancelar para que los eventos asíncronos que
    // dispare `cancel()` pertenezcan a una sesión ya inválida.
    this.resetState();
    this.synth.cancel();
    this.highlighter.clear();

    this.log('Lectura detenida.');
  }

  /**
   * Estado común de reposo: invalida la sesión, limpia timers y vuelve a
   * `idle`. No toca la síntesis ni el DOM; cada llamador decide.
   */
  private resetState(): void {
    this.session++;
    this.status = 'idle';
    this.currentPhraseIndex = 0;
    this.lastEmittedTokenIndex = -1;
    this.startNotified = false;
    this.isRealBoundaryMode = false;
    this.pendingAdvance = false;

    this.clearWordTimer();
    this.clearPhraseTimer();
  }

  public debug(enable?: boolean): void {
    if (enable !== undefined) {
      this.isDebug = enable;
      return;
    }

    console.debug({
      synth: this.synth,
      status: this.status,
      settings: this.voiceSettings,
      marker: this.markerSettings,
      phrases: this.phraseChunks,
      words: this.wordsTokens.length,
      currentPhraseIndex: this.currentPhraseIndex,
      session: this.session,
    });
  }

  private getPhraseVelocity(): number {
    const velocity = this.voiceSettings.phraseVelocity ?? 400;
    return Number.isFinite(velocity) ? Math.max(0, velocity) : 400;
  }

  private getPhrasePause(): number {
    return Math.max(0, this.voiceSettings.phrasePause ?? 500);
  }

  private getSafeRate(): number {
    const rate = this.voiceSettings.rate;
    if (!Number.isFinite(rate) || rate <= 0) return 1;
    return Math.min(10, Math.max(0.1, rate));
  }

  private getSafeMarkerVelocity(): number {
    const velocity = this.markerSettings.markerVelocity;
    if (velocity === undefined || !Number.isFinite(velocity) || velocity <= 0) return 1;
    return Math.min(10, Math.max(0.1, velocity));
  }

  private clearWordTimer(): void {
    if (this.wordTimer !== null) {
      window.clearTimeout(this.wordTimer);
      this.wordTimer = null;
    }
  }

  private clearPhraseTimer(): void {
    if (this.phraseTimer !== null) {
      window.clearTimeout(this.phraseTimer);
      this.phraseTimer = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.isDebug) {
      console.log('[Reader Debug]:', ...args);
    }
  }
}
