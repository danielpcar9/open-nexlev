import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMedian, parseMetricText, formatMsToTimestamp } from './index.js';

test('metrics handle English and Spanish units and thousands separators', () => {
  for (const [text, expected] of [['1.2M views', 1200000], ['45K subscribers',45000], ['12 mil vistas',12000], ['1,5 M vistas',1500000], ['1,234 views',1234], ['1.234 vistas',1234], ['No views',0]] as const) assert.equal(parseMetricText(text), expected);
});
test('median resists outliers and does not mutate input', () => {
  const values = [100000, 10, 20];
  assert.equal(calculateMedian(values),20);
  assert.deepEqual(values,[100000,10,20]);
  assert.equal(calculateMedian([10,20]),15);
  assert.equal(calculateMedian([]),0);
});
test('timestamps retain minutes beyond one hour', () => {
  assert.equal(formatMsToTimestamp(65000),'01:05');
  assert.equal(formatMsToTimestamp(3600000),'60:00');
});
