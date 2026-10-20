import { Reader } from './main';

const container = document.getElementById('app') as HTMLElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;

const translations: Record<string, string> = {
  'es-ES': 'Hola, esta es una prueba de la librería Reader con resaltado dinámico. Como puedes ver, ahora la narración se divide en frases fluidas y respeta las pausas.',
  'en-US': 'Hello, this is a test of the Reader library with dynamic highlighting. As you can see, the narration is now divided into fluent phrases and respects pauses.',
  'zh-CN': '你好，这是具有动态突出显示功能的 Reader 库的测试。正如您所看到的，现在叙述被分为流畅的短语并尊重停顿。',
};

const reader = new Reader({ debug: true });

async function setupReader(lang: string) {
  // Cambiar el atributo lang en el tag HTML global
  document.documentElement.lang = lang;

  const text = translations[lang] || translations['es-ES'];

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

// Inicialización
setupReader('es-ES');

// Usar evento 'change' en lugar de 'onchange'
langSelect?.addEventListener('change', () => {
  reader.stop();
  setupReader(langSelect.value);
});

playBtn?.addEventListener('click', () => {
  reader.speak();
});