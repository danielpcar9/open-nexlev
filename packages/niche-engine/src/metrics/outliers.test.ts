import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlierReference } from './outliers.js';
import type { VideoSample } from './outliers.js';

// Fixtures inventados. No son resultados de YouTube.
function sample(id: string, views: number, contentKind: VideoSample['contentKind'] = 'long'): VideoSample {
  return { id, views, contentKind };
}

test('ALT-02 the candidate is excluded from its own reference', () => {
  const others = Array.from({ length: 10 }, (_, index) => sample(`v${index}`, 100 + index));
  const candidate = sample('candidate', 10_000);
  const reference = outlierReference([...others, candidate], 'candidate', 3);
  assert.equal(reference.candidateExcluded, true);
  assert.equal(reference.sampleIds.includes('candidate'), false);
  assert.equal(reference.median, 104.5);
  assert.equal(reference.isOutlier, true);
  const polluted = [...others.map(item => item.views), candidate.views as number];
  assert.notEqual(reference.median, polluted[Math.floor(polluted.length / 2)]);
});

test('fewer than ten comparable videos is an insufficient base, not zero or infinity', () => {
  const samples = Array.from({ length: 9 }, (_, index) => sample(`v${index}`, 100));
  const reference = outlierReference([...samples, sample('candidate', 1_000_000)], 'candidate');
  assert.equal(reference.ok, false);
  assert.equal(reference.reason, 'sin base suficiente');
  assert.equal(reference.ratio, null);
  assert.equal(reference.isOutlier, false);
});

test('an unknown format is not treated as a Short just because it could be short', () => {
  const samples = [...Array.from({ length: 10 }, (_, index) => sample(`v${index}`, 100)), sample('candidate', 50, 'unknown')];
  const reference = outlierReference(samples, 'candidate');
  assert.equal(reference.reason, 'sin base suficiente');
});
