/**
 * Configuración de voz y reproducción de audio.
 */
export interface VoiceSettings {
  text: string;
  lang: string;
  voiceType?: 'male' | 'female' | 'default';
  rate: number;          // Velocidad de reproducción de audio (0.1 a 10)
  pitch: number;         // Tono de voz (0 a 2)
  volume: number;        // Volumen de audio (0 a 1)
  phrasePause?: number;   // Pausa en ms tras una coma, punto y coma o punto (por defecto 500ms)
  phraseVelocity?: number; // Tiempo estimado en ms por palabra (por defecto 400ms)
}

/**
 * Configuración visual del marcador/resaltador de texto.
 */
export interface MarkerSettings {
  color?: string;
  bgColor?: string;
  emphasis?: 'bold' | 'italic' | 'underline' | 'none';
  highlightClass?: string;
  markerVelocity?: number; // Multiplicador de velocidad para acelerar o ralentizar el marcador
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
  index: number;
  word: string;
  charIndex: number;
  charLength: number;
}

/**
 * Estructura de una frase delimitada por puntuación (, ; . ，。)
 */
export interface PhraseChunk {
  index: number;
  phraseText: string;
  punctuation: string;
  tokens: WordToken[];
  totalChars: number;
}

/**
 * Callback de evento emitido al cambiar la palabra que se está leyendo.
 */
export type BoundaryCallback = (payload: {
  wordIndex: number;
  word: string;
  charIndex: number;
  charLength: number;
  phraseIndex: number;
}) => void;

/**
 * Clase Reader con soporte para ajuste de velocidad independiente del marcador visual (markerVelocity).
 */
export class Reader {
  private synth: SpeechSynthesis;
  private containerElement: HTMLElement | null = null;

  private wordsTokens: WordToken[] = [];
  private phraseChunks: PhraseChunk[] = [];

  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private currentPhraseIndex: number = 0;
  private wordTimer: number | null = null;

  private voiceSettings: VoiceSettings = {
    text: '',
    lang: 'es-ES',
    voiceType: 'default',
    rate: 1,
    pitch: 1,
    volume: 1,
    phrasePause: 500,
    phraseVelocity: 400,
  };

  private markerSettings: MarkerSettings = {
    color: '#ffffff',
    bgColor: '#ff4757',
    emphasis: 'bold',
    markerVelocity: 1.0,
  };

  private isDebug: boolean = false;
  private onBoundaryCallback: BoundaryCallback | null = null;

  constructor(options?: ReaderOptions) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('Web Speech API no está soportada en este entorno.');
    }
    this.synth = window.speechSynthesis;

    if (options) {
      if (options.voice) this.set().voice(options.voice);
      if (options.marker) this.set().marker(options.marker);
      if (options.debug !== undefined) this.isDebug = options.debug;
    }
  }

  public get() {
    return {
      text: () => this.voiceSettings.text,
      language: () => this.voiceSettings.lang,
      voice: () => this.getSelectedVoice(),
      voices: () => this.getAvailableVoices(),
      marker: () => ({ ...this.markerSettings }),
      settings: () => ({ ...this.voiceSettings }),
      phrases: () => [ ...this.phraseChunks ],
    };
  }

  public set() {
    const setters = {
      text: (text: string) => {
        this.voiceSettings.text = text;
        this.log('Texto actualizado:', text);
        return setters;
      },
      language: (lang: string) => {
        this.voiceSettings.lang = lang;
        this.log('Idioma actualizado:', lang);
        return setters;
      },
      voice: (settings: Partial<VoiceSettings>) => {
        this.voiceSettings = { ...this.voiceSettings, ...settings };
        this.log('Configuración de voz actualizada:', this.voiceSettings);
        return setters;
      },
      marker: (settings: Partial<MarkerSettings>) => {
        this.markerSettings = { ...this.markerSettings, ...settings };
        this.log('Configuración del marcador actualizada:', this.markerSettings);
        return setters;
      },
      target: (element: HTMLElement) => {
        this.containerElement = element;
        this.log('Elemento objetivo DOM configurado.');
        return setters;
      },
    };
    return setters;
  }

  public onBoundary(callback: BoundaryCallback) {
    this.onBoundaryCallback = callback;
  }

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices();
  }

  public async prepare(targetElement?: HTMLElement): Promise<boolean> {
    if (targetElement) {
      this.containerElement = targetElement;
    }

    const prepareText = new Promise<string>((resolve, reject) => {
      if (!this.voiceSettings.text) return reject('No se ha definido texto.');
      resolve(this.voiceSettings.text);
    });

    const prepareVoices = new Promise<SpeechSynthesisVoice | null>((resolve) => {
      const checkVoices = () => {
        const voice = this.getSelectedVoice();
        resolve(voice || this.getAvailableVoices()[0] || null);
      };

      if (this.getAvailableVoices().length > 0) {
        checkVoices();
      } else {
        this.synth.onvoiceschanged = () => checkVoices();
      }
    });

    const prepareDom = new Promise<HTMLElement>((resolve, reject) => {
      if (!this.containerElement) {
        return reject('No se ha definido un contenedor DOM objetivo.');
      }
      resolve(this.containerElement);
    });

    const [text, voice, domContainer] = await Promise.all([prepareText, prepareVoices, prepareDom]);

    this.log('Recursos sincronizados:', { text, voice: voice?.name, domContainer });

    this.buildSegmentedPhrases(domContainer);
    return true;
  }

  private buildSegmentedPhrases(container: HTMLElement): void {
    const text = this.voiceSettings.text;
    this.wordsTokens = [];
    this.phraseChunks = [];

    const phraseRegex = /([^,;.，。]+)([,;.，。]?)/gu;
    let match: RegExpExecArray | null;
    let globalWordIndex = 0;
    let phraseCount = 0;
    let htmlBuilder = '';

    while ((match = phraseRegex.exec(text)) !== null) {
      const rawPhraseText = match[1];
      const punctuation = match[2] || '';

      if (!rawPhraseText.trim()) continue;

      const wordRegex = /[\wáéíóúÁÉÍÓÚñÑ]+|\p{Script=Han}/gu;
      let wordMatch: RegExpExecArray | null;
      const currentPhraseTokens: WordToken[] = [];
      let totalPhraseChars = 0;

      while ((wordMatch = wordRegex.exec(rawPhraseText)) !== null) {
        const word = wordMatch[0];
        const absoluteCharIndex = match.index + wordMatch.index;

        const token: WordToken = {
          index: globalWordIndex,
          word,
          charIndex: absoluteCharIndex,
          charLength: word.length,
        };

        this.wordsTokens.push(token);
        currentPhraseTokens.push(token);
        totalPhraseChars += word.length;

        htmlBuilder += `<span data-reader-index="${globalWordIndex}" class="reader-word">${word}</span>`;
        globalWordIndex++;

        const nextChar = rawPhraseText[wordMatch.index + word.length];
        if (nextChar === ' ') {
          htmlBuilder += ' ';
        }
      }

      if (punctuation) {
        htmlBuilder += `<span class="reader-punctuation">${punctuation}</span> `;
      } else {
        htmlBuilder += ' ';
      }

      this.phraseChunks.push({
        index: phraseCount,
        phraseText: rawPhraseText + punctuation,
        punctuation,
        tokens: currentPhraseTokens,
        totalChars: totalPhraseChars,
      });

      phraseCount++;
    }

    container.innerHTML = htmlBuilder;
  }

  private getSelectedVoice(): SpeechSynthesisVoice | null {
    const voices = this.getAvailableVoices();
    if (!voices.length) return null;

    const langVoices = voices.filter((v) =>
      v.lang.toLowerCase().startsWith(this.voiceSettings.lang.slice(0, 2).toLowerCase())
    );

    const pool = langVoices.length > 0 ? langVoices : voices;

    if (this.voiceSettings.voiceType === 'female') {
      const female = pool.find((v) => /female|zira|helena|sabina|monica|lucia/i.test(v.name));
      if (female) return female;
    } else if (this.voiceSettings.voiceType === 'male') {
      const male = pool.find((v) => /male|david|pablo|raul|jorge/i.test(v.name));
      if (male) return male;
    }

    return pool[0] || null;
  }

  public highlightWordIndex(index: number): void {
    if (!this.containerElement) return;

    const previousHighlights = this.containerElement.querySelectorAll('.reader-word-active');
    previousHighlights.forEach((el) => {
      const node = el as HTMLElement;
      node.classList.remove('reader-word-active');
      node.style.cssText = '';
    });

    const activeNode = this.containerElement.querySelector(`[data-reader-index="${index}"]`) as HTMLElement;
    if (activeNode) {
      activeNode.classList.add('reader-word-active');

      const styles = [
        'display: inline-block;',
        'border-radius: 4px;',
        'padding: 0 4px;',
        'transition: all 0.05s ease;',
        this.markerSettings.bgColor ? `background-color: ${this.markerSettings.bgColor} !important;` : '',
        this.markerSettings.color ? `color: ${this.markerSettings.color} !important;` : '',
        this.markerSettings.emphasis === 'bold' ? 'font-weight: bold;' : '',
        this.markerSettings.emphasis === 'italic' ? 'font-style: italic;' : '',
        this.markerSettings.emphasis === 'underline' ? 'text-decoration: underline;' : '',
      ].filter(Boolean).join(' ');

      activeNode.style.cssText = styles;
    }
  }

  public async speak(): Promise<void> {
    if (!this.phraseChunks.length || !this.containerElement) {
      await this.prepare();
    }

    this.stop();
    this.isSpeaking = true;
    this.isPaused = false;
    this.currentPhraseIndex = 0;

    this.playPhraseSequence();
  }

  private playPhraseSequence = (): void => {
    if (!this.isSpeaking || this.currentPhraseIndex >= this.phraseChunks.length) {
      this.isSpeaking = false;
      this.clearHighlighting();
      this.log('Lectura de frases finalizada.');
      return;
    }

    if (this.isPaused) return;

    const currentChunk = this.phraseChunks[this.currentPhraseIndex];
    this.log(`Iniciando frase ${currentChunk.index}: "${currentChunk.phraseText}"`);

    const utterance = new SpeechSynthesisUtterance(currentChunk.phraseText);
    utterance.lang = this.voiceSettings.lang;
    utterance.rate = this.voiceSettings.rate;
    utterance.pitch = this.voiceSettings.pitch;
    utterance.volume = this.voiceSettings.volume;

    const voice = this.getSelectedVoice();
    if (voice) utterance.voice = voice;

    const phraseVelocity = this.voiceSettings.phraseVelocity || 400;
    const totalPhraseDuration = (currentChunk.tokens.length * phraseVelocity) / this.voiceSettings.rate;

    this.animatePhraseTokens(currentChunk, 0, totalPhraseDuration);

    utterance.onend = () => {
      this.clearTimer();
      const pauseDuration = currentChunk.punctuation ? (this.voiceSettings.phrasePause ?? 500) : 0;

      this.currentPhraseIndex++;

      if (pauseDuration > 0) {
        this.log(`Pausa de ${pauseDuration}ms activada por signo '${currentChunk.punctuation}'`);
        setTimeout(() => {
          this.playPhraseSequence();
        }, pauseDuration);
      } else {
        this.playPhraseSequence();
      }
    };

    utterance.onerror = (err) => {
      console.error('[Reader Engine] Error en la narración de frase:', err);
      this.stop();
    };

    this.synth.speak(utterance);
  };

  private animatePhraseTokens(chunk: PhraseChunk, tokenIndex: number, totalDuration: number): void {
    if (!this.isSpeaking || tokenIndex >= chunk.tokens.length || this.isPaused) return;

    const currentToken = chunk.tokens[tokenIndex];
    this.highlightWordIndex(currentToken.index);

    if (this.onBoundaryCallback) {
      this.onBoundaryCallback({
        wordIndex: currentToken.index,
        word: currentToken.word,
        charIndex: currentToken.charIndex,
        charLength: currentToken.charLength,
        phraseIndex: this.currentPhraseIndex,
      });
    }

    const charWeight = chunk.totalChars > 0 ? (currentToken.charLength / chunk.totalChars) : (1 / chunk.tokens.length);
    const velocityMultiplier = this.markerSettings.markerVelocity ?? 1.0;
    const wordDuration = Math.max(80, (totalDuration * charWeight) * velocityMultiplier);

    this.wordTimer = window.setTimeout(() => {
      this.animatePhraseTokens(chunk, tokenIndex + 1, totalDuration);
    }, wordDuration);
  }

  private clearTimer(): void {
    if (this.wordTimer !== null) {
      clearTimeout(this.wordTimer);
      this.wordTimer = null;
    }
  }

  private clearHighlighting(): void {
    if (!this.containerElement) return;
    const activeNodes = this.containerElement.querySelectorAll('.reader-word-active');
    activeNodes.forEach((node) => {
      node.classList.remove('reader-word-active');
      (node as HTMLElement).style.cssText = '';
    });
  }

  public pause(): void {
    if (this.isSpeaking && !this.isPaused) {
      this.isPaused = true;
      this.clearTimer();
      this.synth.pause();
      this.log('Lectura pausada.');
    }
  }

  public resume(): void {
    if (this.isSpeaking && this.isPaused) {
      this.isPaused = false;
      this.synth.resume();
      this.log('Reanudando lectura.');
      this.playPhraseSequence();
    }
  }

  public stop(): void {
    this.isSpeaking = false;
    this.isPaused = false;
    this.currentPhraseIndex = 0;
    this.clearTimer();
    this.synth.cancel();
    this.clearHighlighting();
    this.log('Lectura detenida.');
  }

  public debug(enable?: boolean): void {
    if (enable !== undefined) {
      this.isDebug = enable;
    } else {
      console.debug({
        synth: this.synth,
        settings: this.voiceSettings,
        marker: this.markerSettings,
        phrases: this.phraseChunks,
        currentPhraseIndex: this.currentPhraseIndex,
      });
    }
  }

  private log(...args: unknown[]): void {
    if (this.isDebug) {
      console.log('[Reader Debug]:', ...args);
    }
  }
}