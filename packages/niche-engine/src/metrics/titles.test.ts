import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLanguage, titlePatterns } from './titles.js';

// Fixtures inventados. No son resultados de YouTube.
test('a phrase is counted once per video and links back to the examples', () => {
  const outliers = Array.from({ length: 20 }, (_, index) => ({ videoId: `out${index.toString().padStart(2, '0')}`, title: index < 8 ? 'Ritual medieval secreto ritual' : 'Otra historia', outlier: true }));
  const base = Array.from({ length: 6 }, (_, index) => ({ videoId: `base${index}`, title: 'Diario de archivo', outlier: false }));
  const rows = titlePatterns([...outliers, ...base], 'es');
  const ritual = rows.find(row => row.phrase === 'ritual');
  assert.ok(ritual);
  assert.equal(ritual?.count, 8);
  assert.equal(ritual?.outlierCount, 8);
  assert.equal(ritual?.outlierDenominator, 20);
  assert.match(ritual?.statement ?? '', /aparece en 8 de 20 outliers/);
  assert.match(ritual?.statement ?? '', /no causalidad/);
  assert.equal(ritual?.examples.length, 5);
  assert.equal(ritual?.examples[0]?.videoId, 'out00');
});

test('duplicate video ids found by several queries are not double counted', () => {
  const rows = titlePatterns([
    { videoId: 'aaaaaaaaaaa', title: 'alpha signal alpha', outlier: false },
    { videoId: 'aaaaaaaaaaa', title: 'alpha signal alpha', outlier: true },
  ], 'en');
  assert.equal(rows.find(row => row.phrase === 'alpha')?.count, 1);
  assert.equal(rows[0]?.denominator, 1);
});

test('language suggestions require title evidence and never a country', () => {
  const spanish = suggestLanguage(['el día de la memoria', 'la casa del tiempo', 'los archivos de la ciudad']);
  assert.equal(spanish.language, 'es');
  assert.match(spanish.evidence, /país/);
  assert.equal(suggestLanguage([]).confidence, 'unknown');
});
