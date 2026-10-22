# Speech Reader Engine

Una librería moderna, ligera y extensible escrita en TypeScript que resuelve las limitaciones nativas de la **Web Speech API** en navegadores (tales como la inconsistencia o falta del evento `onboundary` y cortes bruscos entre oraciones).

`speech-reader` segmenta dinámicamente el texto en frases/oraciones, gestiona pausas de puntuación (`.`, `,`, `;`, `。`, `，`), resalta las palabras en el DOM en tiempo real y soporta un algoritmo de tokenización multilingüe con reconocimiento Unicode (soportando alfabetos latinos y caracteres ideográficos CJK como chino, japonés y coreano).

---

## Características Principales

* 🎙 **Sincronización por Frases**: Narración fluida agrupando palabras entre signos de puntuación con pausas configurables.
* 🎨 **Marcador Visual Dinámico**: Resaltado personalizable en el DOM (`color`, `bgColor`, `emphasis`) sin bloquear el hilo principal.
* ⚡ **`markerVelocity`**: Multiplicador independiente para acelerar o decelerar la animación del resaltador en relación con la voz.
* 🌐 **Soporte Multilingüe y Unicode CJK**: Tokenizador avanzado basado en la propiedad `\p{Script=Han}` para segmentar correctamente ideogramas de chino, japonés y coreano, así como lenguajes occidentales.
* 🎛 **Control Total de Reproducción**: Métodos sencillos para `prepare()`, `speak()`, `pause()`, `resume()` y `stop()`.
* 🔊 **Fronteras reales primero**: si el navegador emite eventos `boundary`, se usan para sincronizar el marcador; si no, se cae en la estimación por tiempo.
* 🗣 **Selección exacta de voz**: `voiceURI` (o el nombre de la voz) permite fijar una voz concreta sin depender de la heurística idioma/género.
* 🔔 **Eventos de ciclo de vida**: `onStart`, `onEnd` y `onError` para saber cuándo empieza, termina o falla la locución.

---

## Estructura del Proyecto

```text
speech-reader/
├── dist/                # Salida de la compilación para distribución
│   ├── index.js         # Bundle ESM (salida del build)
│   └── index.d.ts       # Declaraciones de tipos TypeScript
├── src/
│   ├── main.ts          # Código fuente de la clase Reader e interfaces
│   ├── index.ts         # Punto de entrada (re-export para emitir dist/index.d.ts)
│   └── use-example.ts   # Ejemplo práctico de implementación
├── index.html           # Interfaz demo para desarrollo
├── package.json         # Configuración del paquete
├── tsconfig.json        # Configuración de compilación de TypeScript
├── tsconfig.build.json  # Emisión de declaraciones (.d.ts)
└── vite.config.ts       # Configuración del bundler Vite (Modo Librería)

```

---

## Configuración y Build para Producción

El proyecto está configurado para distribuirse como un módulo ES (`ESM`) reutilizable en aplicaciones Node.js/Web.

### 1. Configuración de `vite.config.ts`

Crea o asegura que tu archivo `vite.config.ts` en la raíz esté configurado para compilar en modo librería:

```typescript
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      name: 'SpeechReader',
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // Nos aseguramos de no empaquetar dependencias externas si las hubiera
      external: [],
    },
  },
});

```

### 2. Configuración del `package.json`

Asegúrate de definir los puntos de entrada para los consumidores del paquete en tu `package.json`:

```json
{
  "name": "speech-reader",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p tsconfig.build.json",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^8.0.0"
  }
}

```

### 3. Ejecutar el Build

Para generar la distribución final, ejecuta:

```bash
npm run build

```

Esto generará la carpeta `dist/` con el código optimizado e higienizado listo para importarse, junto con las declaraciones de tipos (`index.d.ts` y `main.d.ts`) que consume `package.json#types`.

### 4. Publicación local (GitHub Packages)

El token **no se guarda en el repositorio**: `.npmrc` lo lee de la variable de entorno `NODE_AUTH_TOKEN`.

```bash
export NODE_AUTH_TOKEN=ghp_...
npm publish
```

En PowerShell:

```powershell
$env:NODE_AUTH_TOKEN = 'ghp_...'
npm publish
```

En GitHub Actions no hay que configurar nada: el workflow usa `secrets.GITHUB_TOKEN`.

---

## Guía de Uso

### Instalación en un proyecto cliente

```bash
npm install speech-reader

```

### Ejemplo Básico en TypeScript / ES Modules

```typescript
import { Reader } from 'speech-reader';

// Contenedor HTML donde se procesará el texto en spans resaltables
const container = document.getElementById('text-container') as HTMLElement;

// Instanciar el lector
const reader = new Reader({ debug: false });

// Configurar parámetros de voz y marcador
reader
  .set()
  .text('Hola, esta es una prueba de lectura fluida con resaltado en tiempo real.')
  .language('es-ES')
  .target(container)
  .voice({
    rate: 1,           // Velocidad de audio
    phraseVelocity: 400,// Duración estimada base por palabra (ms)
    phrasePause: 500,   // Pausa en signos de puntuación (ms)
  })
  .marker({
    color: '#ffffff',
    bgColor: '#ff4757',
    emphasis: 'bold',
    markerVelocity: 0.8, // 0.8 = el resaltador va 20% más rápido que el tiempo estimado
  });

// Escuchar cambios de palabra
reader.onBoundary(({ word, wordIndex, phraseIndex }) => {
  console.log(`Lectura en frase ${phraseIndex}, palabra ${wordIndex}: "${word}"`);
});

// Preparar el DOM y las voces del sistema
await reader.prepare();

// Iniciar la reproducción
reader.speak();

```

### Voz exacta y eventos de ciclo de vida

```typescript
const reader = new Reader();

reader
  .set()
  .text('Hola, ¿cómo estás?')
  .language('es-ES')
  .target(container)
  .voice({ voiceURI: 'Microsoft Sabina - Spanish (Spain)', rate: 1 });

reader.onStart(() => console.log('Empieza la lectura'));
reader.onEnd(() => console.log('Terminó la lectura'));
reader.onError((error) => console.error('Falló la síntesis:', error));

await reader.prepare();
reader.speak();

```

---

## Referencia de la API

### `ReaderOptions`

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `voice` | `Partial<VoiceSettings>` | Configuración inicial de voz y tiempos. |
| `marker` | `MarkerSettings` | Estilos y multiplicador de velocidad del resaltador. |
| `debug` | `boolean` | Muestra logs detallados de la ejecución en consola. |

### `VoiceSettings`

| Propiedad | Tipo | Predeterminado | Descripción |
| --- | --- | --- | --- |
| `text` | `string` | `''` | Texto a ser procesado y leído. |
| `lang` | `string` | `'es-ES'` | Código BCP 47 del idioma (ej: `es-ES`, `en-US`, `zh-CN`). |
| `voiceType` | `'male' | 'female' | 'default'` | `'default'` | Preferencia del tipo de voz. |
| `voiceURI` | `string` | — | Identificador exacto de la voz (`voiceURI` del navegador o, en su defecto, su `name`). |
| `rate` | `number` | `1` | Velocidad de la síntesis de voz (0.1 a 10). |
| `pitch` | `number` | `1` | Tono de la voz (0 a 2). |
| `volume` | `number` | `1` | Volumen de audio (0 a 1). |
| `phrasePause` | `number` | `500` | Tiempo de pausa (ms) tras comas o puntos. |
| `phraseVelocity` | `number` | `400` | Tiempo estimado base (ms) asignado por palabra. |

### `MarkerSettings`

| Propiedad | Tipo | Predeterminado | Descripción |
| --- | --- | --- | --- |
| `color` | `string` | `'#ffffff'` | Color del texto de la palabra activa. |
| `bgColor` | `string` | `'#ff4757'` | Color de fondo del resaltador. |
| `emphasis` | `'bold' | 'italic' | 'underline' | 'none'` | `'bold'` | Énfasis estilístico para la palabra activa. |
| `markerVelocity` | `number` | `1.0` | Factor de velocidad del indicador (< 1.0 acelera, > 1.0 ralentiza). |

---

## Métodos de Control

* `onStart(callback)`, `onEnd(callback)`, `onError(callback)`
Registran callbacks de inicio, fin y error de la locución.
* `prepare(targetElement?: HTMLElement): Promise<boolean>`
Sincroniza las voces de la Web Speech API con el texto, segmenta el contenido en frases/palabras e inyecta la estructura HTML en el contenedor.
* `speak(): Promise<void>`
Inicia o reinicia la narración continua con animación visual.
* `pause(): void`
Pausa la síntesis de voz y detiene los temporizadores del indicador.
* `resume(): void`
Reanuda la narración y la animación desde el punto exacto donde se pausó.
* `stop(): void`
Detiene la lectura completamente, limpia los temporizadores y remueve los resaltados del DOM.