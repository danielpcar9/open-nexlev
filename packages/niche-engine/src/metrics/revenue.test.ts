import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenueScenarios } from './revenue.js';

// Fixtures inventados. No son resultados de YouTube.
test('mixed catalogs do not receive an automatic long-form RPM', () => {
  const scenarios = buildRevenueScenarios({ medianViews: 8000, monthlyPosts: 8, observedViews: 7000, observedDays: 7, projectedViews: 30000, projectionObservedDays: 1, rpm: 5, mix: 'mixed_unknown' });
  assert.equal(scenarios.every(scenario => scenario.disabled && scenario.usd == null), true);
  assert.match(scenarios[0]!.hypothesis, /No se aplica un RPM/);
});

test('named scenarios keep the hypothesis visible', () => {
  const scenarios = buildRevenueScenarios({ medianViews: 8000, monthlyPosts: 8, observedViews: 7000, observedDays: 7, projectedViews: 30000, projectionObservedDays: 1, rpm: 5, mix: 'long_only' });
  assert.deepEqual(scenarios.map(scenario => scenario.label), ['Por publicación', 'Por vistas observadas', 'Proyección mensual']);
  assert.equal(scenarios[0]?.usd, Math.round(8000 * 8 / 1000 * 5));
  assert.equal(scenarios[2]?.projected, true);
  assert.match(scenarios[2]?.hypothesis ?? '', /no medición/i);
});

test('a declared mix is shown beside the result', () => {
  const scenarios = buildRevenueScenarios({ medianViews: 1000, monthlyPosts: 4, observedViews: null, observedDays: null, projectedViews: null, projectionObservedDays: null, rpm: 2, mix: 'declared', declaredMix: '70% largos, supuesto del usuario' });
  assert.match(scenarios[0]?.hypothesis ?? '', /70% largos/);
  assert.equal(scenarios[1]?.disabled, true);
});
