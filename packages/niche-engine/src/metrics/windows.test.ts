import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGrowth, computeWindow, describeCounter, observationInstants, projectMonthly, weeklyGrowth } from './windows.js';
import { parsePublicCounter } from './parse.js';
import type { CounterPoint, WindowMetric } from '../types.js';

const DAY = 24 * 60 * 60 * 1000;
// Fixtures inventados. No son resultados de YouTube.
const at = (ms: number) => new Date(ms).toISOString();
function point(ms: number, value: number | null, extra: Partial<CounterPoint> = {}): CounterPoint {
  return { observedAt: at(ms), value, precision: 'exact', provider: 'innertube', resolution: 0, ...extra };
}

test('MET-01 a 7 day gap is not a 24 hour observation', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const window = computeWindow([point(end - 7 * DAY, 1000), point(end, 8000)], 1, new Date(end));
  assert.equal(window.quality, 'insufficient');
  assert.equal(window.delta, null);
  assert.match(window.explanation, /insuficiente/i);
  assert.equal(JSON.stringify(window).includes('7000'), false);
});

test('MET-02 one observed day projects 30000 but does not measure a month', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const described = describeCounter([point(end - DAY, 5000), point(end, 6000)], new Date(end));
  assert.equal(described.d1.delta, 1000);
  assert.equal(described.d1.quality, 'observed');
  assert.equal(described.d30.quality, 'insufficient');
  assert.ok(described.projection);
  assert.equal(described.projection?.delta, 30000);
  assert.equal(described.projection?.projected, true);
  assert.match(described.projection?.explanation ?? '', /Proyección, no medición mensual/);
});

test('MET-03 missing, rounded and cached observations keep their status', () => {
  assert.deepEqual(parsePublicCounter(null), { value: null, precision: 'unknown' });
  assert.deepEqual(parsePublicCounter('no disponible'), { value: null, precision: 'unknown' });
  assert.deepEqual(parsePublicCounter('0'), { value: 0, precision: 'exact' });
  assert.deepEqual(parsePublicCounter('1.2M views'), { value: 1_200_000, precision: 'rounded' });
  const cached = observationInstants({ fromCache: true, observedAt: '2026-10-01T00:00:00.000Z', fetchedAt: '2026-10-23T00:00:00.000Z' });
  assert.equal(cached.observedAt, '2026-10-01T00:00:00.000Z');
  assert.notEqual(cached.observedAt, cached.fetchedAt);
  assert.throws(() => observationInstants({ fromCache: true, observedAt: null, fetchedAt: '2026-10-23T00:00:00.000Z' }));
});

test('MET-04 a falling counter is a reset and stays negative', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const window = computeWindow([point(end - DAY, 5000), point(end, 4500)], 1, new Date(end));
  assert.equal(window.quality, 'counter_reset');
  assert.equal(window.delta, -500);
  assert.match(window.explanation, /corrección o reinicio/);
});

test('MET-05 a zero previous week has no percentage', () => {
  const current: WindowMetric = { requestedDays: 7, delta: 1500, from: '2026-10-16T00:00:00.000Z', to: '2026-10-23T00:00:00.000Z', observedDays: 7, quality: 'observed', projected: false, explanation: '' };
  const previous: WindowMetric = { ...current, delta: 0, from: '2026-10-09T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z' };
  const comparison = compareGrowth(current, previous);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.absolute, 1500);
  assert.equal(comparison.percent, null);
  assert.match(comparison.explanation, /base porcentual/);
});

test('MET-06 providers are not merged', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const window = computeWindow([
    point(end - DAY, 1000, { provider: 'innertube' }),
    point(end, 8000, { provider: 'youtube-data-api' }),
  ], 1, new Date(end));
  assert.equal(window.delta, null);
  assert.match(window.explanation, /No se mezclan series/);
});

test('MET-07 a sample older than 12 hours is stale', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z');
  const latest = now - 13 * 60 * 60 * 1000;
  const window = computeWindow([point(latest - DAY, 1000), point(latest, 2000)], 1, new Date(now));
  assert.equal(window.quality, 'stale');
  assert.equal(window.delta, 1000);
  assert.match(window.explanation, /desactualizada/);
});

test('a 25 hour span is labeled approximate rather than an exact day', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const window = computeWindow([point(end - 25 * 60 * 60 * 1000, 1000), point(end, 2000)], 1, new Date(end));
  assert.equal(window.quality, 'approximate');
  assert.match(window.explanation, /Aprox\. 24 h/);
  assert.match(window.explanation, /25 h/);
});

test('weekly growth uses the previous distinct interval', () => {
  const end = Date.parse('2026-10-23T00:00:00.000Z');
  const points = [0, 7, 14].map((day, index) => point(end - (14 - day) * DAY, index * 1000));
  const growth = weeklyGrowth(points, new Date(end));
  assert.equal(growth.current.delta, 1000);
  assert.equal(growth.previous.delta, 1000);
  assert.equal(growth.comparison.percent, 0);
});

test('projectMonthly refuses resets and sub-day coverage', () => {
  const reset: WindowMetric = { requestedDays: 1, delta: -1, from: null, to: null, observedDays: 1, quality: 'counter_reset', projected: false, explanation: '' };
  assert.equal(projectMonthly(reset), null);
});
