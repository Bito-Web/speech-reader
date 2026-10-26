import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* DOM mínimo                                                          */
/* ------------------------------------------------------------------ */

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }
  setProperty(name, value, priority = '') {
    this.properties.set(name, { value, priority });
  }
  removeProperty(name) {
    this.properties.delete(name);
  }
  getPropertyValue(name) {
    return this.properties.get(name)?.value ?? '';
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    for (const name of names) this.values.add(name);
  }
  remove(...names) {
    for (const name of names) this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeTextNode {
  constructor(text) {
    this.textContent = text;
  }
}

class FakeFragment {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.isFragment = true;
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }
  get textContent() {
    return this.children.map((child) => child.textContent ?? '').join('');
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this._text = '';
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node?.isFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  set textContent(value) {
    this._text = value;
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? '').join('');
  }
  querySelectorAll() {
    return [];
  }
}

const document = {
  createDocumentFragment: () => new FakeFragment(document),
  createTextNode: (text) => new FakeTextNode(text),
  createElement: (tagName) => new FakeElement(tagName, document),
};

/* ------------------------------------------------------------------ */
/* Web Speech API mínima                                               */
/* ------------------------------------------------------------------ */

const voices = [
  { name: 'Voz ES', lang: 'es-ES', voiceURI: 'voz-es' },
  { name: 'English Voice', lang: 'en-US', voiceURI: 'voz-en' },
];

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onboundary = null;
  }
}

class FakeSynth {
  constructor() {
    this.utterances = [];
    this.listeners = new Map();
    this.paused = false;
  }
  getVoices() {
    return voices;
  }
  speak(utterance) {
    this.utterances.push(utterance);
  }
  cancel() {}
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
}

const synth = new FakeSynth();
globalThis.window = { speechSynthesis: synth, setTimeout, clearTimeout };
globalThis.SpeechSynthesisUtterance = FakeUtterance;

const { Reader } = await import('../dist/index.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeReader() {
  const container = new FakeElement('div', document);
  const reader = new Reader();
  reader.set().text('Hola, mundo.').language('es-ES').target(container).voice({ phrasePause: 0 });

  const events = { start: 0, end: 0, errors: [], boundaries: [] };
  reader.onStart(() => {
    events.start += 1;
  });
  reader.onEnd(() => {
    events.end += 1;
  });
  reader.onError((error) => {
    events.errors.push(error);
  });
  reader.onBoundary((payload) => {
    events.boundaries.push(payload);
  });

  return { reader, container, events };
}

/* ------------------------------------------------------------------ */
/* Casos                                                               */
/* ------------------------------------------------------------------ */

{
  const { reader, container, events } = makeReader();
  await reader.prepare();

  assert.equal(container.textContent, 'Hola, mundo.');
  const words = container.children.filter((node) => node.tagName === 'SPAN');
  assert.equal(words.length, 2);
  assert.deepEqual(
    words.map((span) => span.textContent),
    ['Hola', 'mundo'],
  );
  assert.equal(words[0].dataset.readerIndex, '0');
  assert.equal(words[1].dataset.readerIndex, '1');
  assert.equal(reader.get().status(), 'idle');
}

{
  const { reader, container } = makeReader();
  reader.set().text('<b>Hola</b> & mundo.');
  await reader.prepare();

  // El renderer usa textContent: el texto se muestra literal, no como HTML.
  assert.equal(container.textContent, '<b>Hola</b> & mundo.');
  const spans = container.children.filter((node) => node.tagName === 'SPAN');
  assert.deepEqual(
    spans.map((span) => span.textContent),
    ['b', 'Hola', 'b', 'mundo'],
  );
}

{
  const { reader, container, events } = makeReader();
  synth.utterances.length = 0;
  await reader.speak();

  assert.equal(reader.get().status(), 'speaking');
  assert.equal(synth.utterances.length, 1);
  const first = synth.utterances[0];
  assert.equal(first.text, 'Hola,');
  assert.equal(first.lang, 'es-ES');
  assert.equal(first.voice?.name, 'Voz ES');

  first.onstart();
  first.onboundary({ charIndex: 0 });
  first.onend();

  // phrasePause = 0: la segunda frase se encola de inmediato.
  assert.equal(synth.utterances.length, 2);
  const second = synth.utterances[1];
  assert.equal(second.text, ' mundo.');

  second.onstart();
  second.onboundary({ charIndex: 1 }); // absoluto 5 + 1 = 6 -> "mundo"
  second.onend();

  assert.equal(events.start, 1);
  assert.equal(events.end, 1);
  assert.equal(reader.get().status(), 'idle');
  assert.ok(events.boundaries.some((event) => event.word === 'mundo' && event.wordIndex === 1));
  assert.equal(container.children.filter((node) => node.tagName === 'SPAN')[1].style.getPropertyValue('background-color'), '');
}

{
  const { reader, container, events } = makeReader();
  synth.utterances.length = 0;
  await reader.speak();
  const oldUtterance = synth.utterances[0];

  // speak() reinicia: la locución antigua no debe avanzar la sesión nueva.
  await reader.speak();
  assert.equal(synth.utterances.length, 2);
  oldUtterance.onstart();
  oldUtterance.onend();
  assert.equal(synth.utterances.length, 2, 'la sesión cancelada no debe encolar frases');
  assert.equal(events.end, 0);

  const current = synth.utterances[1];
  current.onstart();
  current.onend();
  const second = synth.utterances[2];
  second?.onstart();
  second?.onend();
  assert.equal(events.end, 1);

  // Cambiar el texto fuerza un rebuild del DOM en el siguiente speak().
  reader.set().text('Nuevo texto.');
  synth.utterances.length = 0;
  await reader.speak();
  assert.equal(container.textContent, 'Nuevo texto.');
  assert.equal(synth.utterances[0].text, 'Nuevo texto.');
}

{
  const { reader, events } = makeReader();
  reader.set().text('Uno. Dos.').voice({ phrasePause: 80 });
  synth.utterances.length = 0;
  await reader.speak();

  const first = synth.utterances[0];
  first.onstart();
  first.onend();

  // Pausa entre frases: el timer queda pendiente y pause() debe cancelarlo.
  reader.pause();
  assert.equal(reader.get().status(), 'paused');
  const countWhilePaused = synth.utterances.length;
  await sleep(140);
  assert.equal(synth.utterances.length, countWhilePaused, 'no debe avanzar en pausa');
  assert.equal(events.end, 0);

  reader.resume();
  assert.equal(reader.get().status(), 'speaking');
  assert.equal(synth.utterances.length, countWhilePaused + 1, 'resume debe continuar la frase siguiente');
  const second = synth.utterances.at(-1);
  second.onstart();
  second.onend();
  assert.equal(events.end, 1);
}

{
  const { reader, events } = makeReader();
  reader.set().text('Uno dos tres.').voice({ phrasePause: 0 });
  synth.utterances.length = 0;
  await reader.speak();

  const utterance = synth.utterances[0];
  utterance.onstart();
  reader.pause();
  reader.resume();
  utterance.onboundary({ charIndex: 0 });
  utterance.onend();
  assert.equal(events.end, 1);
}

{
  const reader = new Reader();
  await assert.rejects(() => reader.prepare(), /No se ha definido texto/);

  const container = new FakeElement('div', document);
  reader.set().target(container);
  await assert.rejects(() => reader.prepare(), /No se ha definido texto/);

  const readerWithoutTarget = new Reader();
  readerWithoutTarget.set().text('Hola.');
  await assert.rejects(() => readerWithoutTarget.prepare(), /contenedor DOM/);

  const previousWindow = globalThis.window;
  globalThis.window = {};
  assert.throws(() => new Reader(), /Web Speech API/);
  globalThis.window = previousWindow;
}

console.log('Reader smoke tests: OK');
