import { Reader } from './index.js';

function getRequiredElement<T extends HTMLElement>(
  id: string,
  guard: (element: HTMLElement) => element is T,
): T {
  const element = document.getElementById(id);
  if (!element || !guard(element)) {
    throw new Error(`No se encontró el elemento #${id} esperado por la demo.`);
  }
  return element;
}

const container = getRequiredElement('app', (element): element is HTMLElement => element instanceof HTMLElement);
const playBtn = getRequiredElement('play-btn', (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const pauseBtn = getRequiredElement('pause-btn', (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const stopBtn = getRequiredElement('stop-btn', (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const langSelect = getRequiredElement('lang-select', (element): element is HTMLSelectElement => element instanceof HTMLSelectElement);

const translations: Record<string, string> = {
  'es-ES':
    'Hola, esta es una prueba de la librería Reader con resaltado dinámico. Como puedes ver, ahora la narración se divide en frases fluidas y respeta las pausas.',
  'en-US':
    'Hello, this is a test of the Reader library with dynamic highlighting. As you can see, the narration is now divided into fluent phrases and respects pauses.',
  'zh-CN':
    '你好，这是具有动态突出显示功能的 Reader 库的测试。正如您所看到的，现在叙述被分为流畅的短语并尊重停顿。',
};

const reader = new Reader({ debug: true });

async function setupReader(lang: string): Promise<void> {
  // Cambiar el atributo lang en el tag HTML global
  document.documentElement.lang = lang;

  const text = translations[lang] ?? translations['es-ES'] ?? '';

  reader
    .set()
    .text(text)
    .language(lang)
    .target(container)
    .voice({
      rate: 1,
      phraseVelocity: lang.startsWith('zh') ? 250 : 400, // Ajustar velocidad para ideogramas
      phrasePause: 500,
    })
    .marker({
      color: '#ffffff',
      bgColor: '#ff4757',
      emphasis: 'bold',
      markerVelocity: 0.8,
    });

  await reader.prepare();
  console.log(`[Reader] Configurado y listo para el idioma: ${lang}`);
}

reader.onBoundary(({ word, wordIndex, phraseIndex }) => {
  console.log(`[Frase: ${phraseIndex} | Palabra ${wordIndex}] -> "${word}"`);
});

reader.onStart(() => {
  pauseBtn.textContent = 'Pausar';
});

reader.onEnd(() => {
  pauseBtn.textContent = 'Pausar';
  console.log('[Reader] Lectura finalizada.');
});

reader.onError((error) => {
  pauseBtn.textContent = 'Pausar';
  console.error('[Reader] Error de síntesis:', error);
});

playBtn.addEventListener('click', () => {
  pauseBtn.textContent = 'Pausar';
  void reader.speak().catch((error: unknown) => {
    console.error('[Reader] No se pudo iniciar la lectura:', error);
  });
});

pauseBtn.addEventListener('click', () => {
  const status = reader.get().status();

  if (status === 'paused') {
    reader.resume();
    pauseBtn.textContent = 'Pausar';
  } else if (status === 'speaking') {
    reader.pause();
    pauseBtn.textContent = 'Reanudar';
  }
});

stopBtn.addEventListener('click', () => {
  reader.stop();
  pauseBtn.textContent = 'Pausar';
});

// Usar evento 'change' en lugar de 'onchange'
langSelect.addEventListener('change', () => {
  reader.stop();
  pauseBtn.textContent = 'Pausar';
  void setupReader(langSelect.value).catch((error: unknown) => {
    console.error('[Reader] No se pudo configurar el idioma:', error);
  });
});

// Inicialización
void setupReader('es-ES').catch((error: unknown) => {
  console.error('[Reader] No se pudo inicializar la demo:', error);
});
