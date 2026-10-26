# Speech Reader Engine

Librería TypeScript para leer texto en voz alta con la **Web Speech API**, segmentarlo en frases, resaltar la palabra activa en el DOM y evitar las limitaciones habituales de la API nativa (falta de `boundary`, cortes entre oraciones, voces que cargan de forma asíncrona).

`speech-reader` divide el texto en frases delimitadas por puntuación, aplica pausas configurables, sincroniza el marcador con las fronteras reales del motor o con una estimación por tiempo cuando el navegador no las emite, y tokeniza correctamente alfabetos latinos, cirílicos, Hangul e ideogramas Han.

---

## Características

* 🎙 **Sincronización por frases**: agrupa palabras entre signos de puntuación y aplica pausas configurables.
* 🎨 **Marcador visual dinámico**: resaltado personalizable (`color`, `bgColor`, `emphasis`, `highlightClass`) sin reemplazar el texto por HTML.
* ⚡ **`markerVelocity`**: multiplicador independiente para acelerar o ralentizar la animación del marcador respecto de la voz.
* 🌐 **Unicode real**: los ideogramas Han se resaltan carácter a carácter; el resto de alfabetos (`\p{L}`), números y marcas combinadas se agrupan por palabra.
* 🔊 **Fronteras reales primero**: si el navegador emite `boundary`, se usan; si deja de emitirlas, se retoma la estimación por tiempo.
* 🗣 **Selección exacta de voz**: `voiceURI` (o el nombre de la voz) fija una voz concreta sin depender de la heurística idioma/género.
* 🔔 **Eventos tipados**: `start`, `end`, `boundary` y `error`, con soporte de varios listeners y función de baja.
* ⏯ **Control completo**: `prepare()`, `speak()`, `pause()`, `resume()` y `stop()` con una máquina de estados explícita (`idle | speaking | paused`).
* 🧱 **Módulos pequeños y testeables**: tokenizador y renderer puros, separados del motor de síntesis y del DOM.

---

## Estructura del proyecto

```text
speech-reader/
├── src/
│   ├── core/
│   │   ├── reader.ts        # Orquestador y máquina de estados
│   │   └── events.ts        # Emisor de eventos tipado
│   ├── speech/
│   │   └── voice-selector.ts# Carga y selección de voces
│   ├── text/
│   │   ├── tokenizer.ts     # Segmentación de frases/palabras (puro)
│   │   └── renderer.ts      # Renderizado seguro del DOM
│   ├── ui/
│   │   └── highlighter.ts   # Marcador visual
│   ├── types.ts             # Contratos públicos
│   ├── index.ts             # Punto de entrada del paquete
│   ├── main.ts              # Alias de compatibilidad de la API pública
│   └── use-example.ts       # Demo de desarrollo
├── tests/
│   ├── tokenizer.test.mjs   # Pruebas del tokenizador
│   └── reader-smoke.mjs     # Prueba de humo con DOM/voces simulados
├── index.html               # Interfaz de la demo
├── package.json
├── tsconfig.json            # Typecheck estricto (no emite)
├── tsconfig.build.json      # Emisión de declaraciones (.d.ts)
└── vite.config.ts           # Build en modo librería (ESM + CJS)
```

### Decisiones de diseño

* `core/reader.ts` no sabe tokenizar ni construir HTML: delega en módulos con responsabilidades acotadas.
* `session` es un contador incremental que invalida los callbacks de locuciones canceladas. Esto evita la carrera clásica de `speechSynthesis.cancel()`: un `onend` tardío ya no puede avanzar la lectura nueva.
* Todos los temporizadores (`wordTimer` de animación y `phraseTimer` de pausa entre frases) se guardan y se cancelan en `stop()`, `pause()` y `finish()`.
* El DOM se construye con `textContent` y nodos de texto, no con `innerHTML`; se conservan signos de apertura, paréntesis, guiones, emojis y todo el texto original sin riesgo de inyección.
* `prepare()` espera las voces con un timeout de 1,5 s. Si el navegador nunca emite `voiceschanged`, la preparación termina igualmente en lugar de quedarse colgada.

---

## Instalación

El paquete se publica en GitHub Packages bajo el scope `@bito-web`. El registro y el token se configuran en `.npmrc`:

```ini
@bito-web:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
export NODE_AUTH_TOKEN=ghp_...
npm install @bito-web/speech-reader-engine
```

En PowerShell:

```powershell
$env:NODE_AUTH_TOKEN = 'ghp_...'
npm install @bito-web/speech-reader-engine
```

---

## Uso básico

```typescript
import { Reader } from '@bito-web/speech-reader-engine';

const container = document.getElementById('text-container');
if (!container) throw new Error('Falta el contenedor');

const reader = new Reader({ debug: false });

reader
  .set()
  .text('Hola, esta es una prueba de lectura fluida con resaltado en tiempo real.')
  .language('es-ES')
  .target(container)
  .voice({
    rate: 1,            // Velocidad de audio
    phraseVelocity: 400,// Estimación base por palabra (ms)
    phrasePause: 500,   // Pausa tras signos de puntuación (ms)
  })
  .marker({
    color: '#ffffff',
    bgColor: '#ff4757',
    emphasis: 'bold',
    markerVelocity: 0.8,
  });

// Varios listeners y baja explícita
const unsubscribe = reader.onBoundary(({ word, wordIndex, phraseIndex }) => {
  console.log(`Frase ${phraseIndex}, palabra ${wordIndex}: "${word}"`);
});
reader.onStart(() => console.log('Empieza la lectura'));
reader.onEnd(() => console.log('Terminó la lectura'));
reader.onError((error) => console.error('Falló la síntesis:', error));

await reader.prepare();
await reader.speak(); // Resuelve al encolar la locución, no al terminar

// Más adelante
unsubscribe();
```

### Pausa, reanudación y estado

```typescript
reader.pause();
console.log(reader.get().status()); // 'paused'

reader.resume();
console.log(reader.get().status()); // 'speaking'

reader.stop();
console.log(reader.get().status()); // 'idle'
```

`pause()` funciona tanto durante una locución como durante la pausa entre frases; en el segundo caso `resume()` continúa con la frase siguiente.

### Eventos genéricos

Además de `onStart`, `onEnd`, `onBoundary` y `onError`, existe una API tipada:

```typescript
const handler = (payload: { word: string }) => console.log(payload.word);

reader.on('boundary', handler);
reader.off('boundary', handler);
```

### Utilidad de segmentación

```typescript
import { PHRASE_DELIMITERS, segmentText } from '@bito-web/speech-reader-engine';

console.log(PHRASE_DELIMITERS); // ,;.!?…，。！？
const chunks = segmentText('Hola, mundo.');
console.log(chunks[0]?.phraseText); // "Hola,"
```

---

## Referencia de la API

### `ReaderOptions`

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `voice` | `Partial<VoiceSettings>` | Configuración inicial de voz y tiempos. |
| `marker` | `MarkerSettings` | Estilos y multiplicador de velocidad del marcador. |
| `debug` | `boolean` | Muestra logs detallados en consola. |

### `VoiceSettings`

| Propiedad | Tipo | Predeterminado | Descripción |
| --- | --- | --- | --- |
| `text` | `string` | `''` | Texto a procesar y leer. |
| `lang` | `string` | `'es-ES'` | Código BCP 47 (`es-ES`, `en-US`, `zh-CN`). |
| `voiceType` | `'male' | 'female' | 'default'` | `'default'` | Preferencia del tipo de voz. |
| `voiceURI` | `string` | — | `voiceURI` exacto o nombre de la voz. |
| `rate` | `number` | `1` | Velocidad de síntesis (0.1 a 10). |
| `pitch` | `number` | `1` | Tono (0 a 2). |
| `volume` | `number` | `1` | Volumen (0 a 1). |
| `phrasePause` | `number` | `500` | Pausa en ms tras un signo de puntuación. |
| `phraseVelocity` | `number` | `400` | Tiempo estimado base en ms por palabra. |

### `MarkerSettings`

| Propiedad | Tipo | Predeterminado | Descripción |
| --- | --- | --- | --- |
| `color` | `string` | `'#ffffff'` | Color del texto de la palabra activa. |
| `bgColor` | `string` | `'#ff4757'` | Color de fondo del resaltador. |
| `emphasis` | `'bold' | 'italic' | 'underline' | 'none'` | `'bold'` | Énfasis de la palabra activa. |
| `highlightClass` | `string` | — | Clase CSS adicional para la palabra activa. |
| `markerVelocity` | `number` | `1.0` | Factor visual (< 1 acelera, > 1 ralentiza). |

### Métodos

* `prepare(targetElement?: HTMLElement): Promise<boolean>`
  Carga las voces, segmenta el texto y renderiza el DOM. Si se llama durante una lectura, la detiene. Deduplica llamadas concurrentes.
* `speak(): Promise<void>`
  Inicia o reinicia la lectura desde la primera frase. La promesa resuelve cuando la primera locución fue encolada.
* `pause(): void` / `resume(): void`
  Pausa y reanuda la síntesis y el marcador, incluyendo la pausa entre frases.
* `stop(): void`
  Cancela la síntesis, invalida la sesión y limpia temporizadores y resaltados.
* `get(): ReaderGetters`
  Devuelve `text()`, `language()`, `voice()`, `voices()`, `marker()`, `settings()`, `phrases()` y `status()`.
* `set(): ReaderSetters`
  Interfaz fluida con `text()`, `language()`, `voice()`, `marker()` y `target()`.
  Cambiar `text` o `target` durante la lectura detiene la reproducción; el nuevo contenido se aplica en el siguiente `prepare()`/`speak()`.
* `onStart(cb)`, `onEnd(cb)`, `onBoundary(cb)`, `onError(cb)`
  Suscripciones de conveniencia. Devuelven una función para darse de baja.
* `on(event, cb)` / `off(event, cb)`
  Suscripción genérica tipada a `start`, `end`, `boundary` y `error`.
* `getAvailableVoices(): SpeechSynthesisVoice[]`
  Voces del sistema en ese momento.
* `highlightWordIndex(index: number): void`
  Fuerza el resaltado de una palabra por su índice global.
* `debug(enable?: boolean): void`
  Activa/desactiva logs o imprime un snapshot del estado.

### Puntuación

Las frases se cierran con `, ; . ! ? … ， 。 ！ ？`. Los signos de apertura (`¿`, `¡`) y separadores como `:` o `-` se conservan en el DOM pero no cortan la frase. Después de cualquier signo de cierre se aplica `phrasePause`.

---

## Desarrollo

Requisitos: Node.js 20.19+ o 22.12+ (Vite 8) y npm.

```bash
npm ci
npm run dev        # Demo en Vite
npm run typecheck  # TypeScript estricto, sin emitir
npm test           # Build + pruebas de tokenizador y smoke test
npm run test:smoke # Sólo la prueba de humo (requiere dist construido)
npm run build      # dist/index.js, dist/index.cjs y declaraciones .d.ts
```

El orden del build es importante: **primero Vite y después `tsc`**. Vite limpia `dist/`, y `tsc -p tsconfig.build.json` es quien emite las declaraciones que consume `package.json#types`.

### Publicación

```bash
export NODE_AUTH_TOKEN=ghp_...
npm publish
```

En PowerShell, asigna `$env:NODE_AUTH_TOKEN` antes de publicar. En GitHub Actions el workflow usa `secrets.GITHUB_TOKEN`; `prepublishOnly` ejecuta el build antes de publicar.
