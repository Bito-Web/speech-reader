/**
 * Selección y carga de voces de la Web Speech API.
 *
 * La carga de voces es asíncrona en varios navegadores (la primera llamada a
 * `getVoices()` suele devolver un array vacío). Se resuelve con un timeout
 * para que `prepare()` nunca quede colgado si el navegador no emite
 * `voiceschanged`.
 */

import type { VoiceSettings } from '../types.js';

const FEMALE_VOICE_PATTERN =
  /female|mujer|zira|helena|sabina|monica|lucia|paulina|marisol|samantha|victoria|karen|moira|tessa|amelie|audrey/i;

const MALE_VOICE_PATTERN = /\bmale\b|hombre|david|pablo|raul|jorge|diego|enrique|alex|daniel|fred/i;

export type VoiceSelectionSettings = Pick<VoiceSettings, 'lang' | 'voiceType' | 'voiceURI'>;

/**
 * Elige la voz más adecuada según `voiceURI`, idioma y tipo.
 *
 * Si no hay ninguna voz para el idioma pedido se usa el catálogo completo
 * (mejor una voz que ninguna), igual que hacía la implementación anterior.
 */
export function selectVoice(
  voices: readonly SpeechSynthesisVoice[],
  settings: VoiceSelectionSettings,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  if (settings.voiceURI) {
    const requested = settings.voiceURI;
    const exact =
      voices.find((voice) => voice.voiceURI === requested) ??
      voices.find((voice) => voice.name === requested);
    if (exact) return exact;
  }

  const languagePrefix = settings.lang.slice(0, 2).toLowerCase();
  const languageVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(languagePrefix),
  );
  const pool = languageVoices.length > 0 ? languageVoices : voices;

  if (settings.voiceType === 'female') {
    const female = pool.find((voice) => FEMALE_VOICE_PATTERN.test(voice.name));
    if (female) return female;
  } else if (settings.voiceType === 'male') {
    const male = pool.find((voice) => MALE_VOICE_PATTERN.test(voice.name));
    if (male) return male;
  }

  return pool[0] ?? null;
}

/**
 * Devuelve las voces disponibles, esperando a `voiceschanged` si aún no hay
 * ninguna. Resuelve siempre (posiblemente con un array vacío) al agotar el
 * timeout.
 */
export function loadVoices(synth: SpeechSynthesis, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const available = synth.getVoices();
  if (available.length > 0) return Promise.resolve(available);

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    let timer: number | null = null;

    const finish = (): void => {
      if (settled) return;
      settled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      resolve(synth.getVoices());
    };

    const handleVoicesChanged = (): void => {
      if (synth.getVoices().length > 0) finish();
    };

    timer = window.setTimeout(finish, timeoutMs);
    synth.addEventListener('voiceschanged', handleVoicesChanged);
  });
}
