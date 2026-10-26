import test from 'node:test';
import assert from 'node:assert/strict';

import { PHRASE_DELIMITERS, segmentText } from '../dist/index.js';

test('segmenta frases y conserva posiciones absolutas', () => {
  const text = 'Hola, mundo. ¿Cómo estás?';
  const chunks = segmentText(text);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.phraseText),
    ['Hola,', ' mundo.', ' ¿Cómo estás?'],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.charIndex),
    [0, 5, 12],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.punctuation),
    [',', '.', '?'],
  );
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.tokens.map((token) => token.word)),
    ['Hola', 'mundo', 'Cómo', 'estás'],
  );

  // Cada frase y cada palabra deben apuntar exactamente a su tramo del texto.
  for (const chunk of chunks) {
    assert.equal(
      text.slice(chunk.charIndex, chunk.charIndex + chunk.phraseText.length),
      chunk.phraseText,
    );
    for (const token of chunk.tokens) {
      assert.equal(
        text.slice(token.charIndex, token.charIndex + token.charLength),
        token.word,
      );
    }
  }
});

test('separa ideogramas Han y agrupa alfabetos Unicode', () => {
  const chinese = segmentText('你好，世界。');
  assert.deepEqual(
    chinese.map((chunk) => chunk.tokens.map((token) => token.word)),
    [['你', '好'], ['世', '界']],
  );

  const korean = segmentText('안녕하세요 세계!');
  assert.deepEqual(
    korean[0]?.tokens.map((token) => token.word),
    ['안녕하세요', '세계'],
  );

  const cyrillic = segmentText('Привет, мир!');
  assert.deepEqual(
    cyrillic.flatMap((chunk) => chunk.tokens.map((token) => token.word)),
    ['Привет', 'мир'],
  );
});

test('conserva apóstrofos y acentos en una misma palabra', () => {
  const chunks = segmentText("It's don't l’home.");
  const words = chunks.flatMap((chunk) => chunk.tokens.map((token) => token.word));

  assert.deepEqual(words, ["It's", "don't", 'l’home']);
});

test('los signos de apertura y las comas iniciales no rompen los offsets', () => {
  const text = ',¡Hola... mundo!';
  const chunks = segmentText(text);

  assert.equal(chunks[0]?.charIndex, 1);
  assert.equal(chunks[0]?.phraseText, '¡Hola...');
  assert.equal(chunks[0]?.punctuation, '...');
  assert.equal(chunks[1]?.charIndex, 9);

  for (const chunk of chunks) {
    assert.equal(
      text.slice(chunk.charIndex, chunk.charIndex + chunk.phraseText.length),
      chunk.phraseText,
    );
  }
});

test('los índices globales de palabra son consecutivos', () => {
  const chunks = segmentText('Uno, dos; tres. Cuatro');
  const indexes = chunks.flatMap((chunk) => chunk.tokens.map((token) => token.index));

  assert.deepEqual(indexes, [0, 1, 2, 3]);
});

test('un texto sin palabras no genera frases', () => {
  assert.deepEqual(segmentText('...'), []);
  assert.deepEqual(segmentText('   '), []);
  assert.deepEqual(segmentText(''), []);
});

test('la puntuación configurada incluye cierres de interrogación y exclamación', () => {
  for (const punctuation of [',', ';', '.', '!', '?', '…', '，', '。', '！', '？']) {
    assert.ok(PHRASE_DELIMITERS.includes(punctuation), `Falta "${punctuation}"`);
  }
});
