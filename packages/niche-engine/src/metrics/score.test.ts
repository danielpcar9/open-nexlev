import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertWeights, averageRankPercentile, computeOpportunityScore, type ProjectFacts } from './score.js';

// Fixtures inventados. No son resultados de YouTube.
function project(id: string, patch: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    id, complete: true, comparisonKey: 'same', referenceCount: 5, referenceMedian: 1000, outlierRatio: 0.2,
    outlierVideos: 40, outlierChannels: 5, weeklyGrowth: 10, growthChannels: 3, competitorsAbove: 2, competitionFailed: false, ...patch,
  };
}

test('RES-01 a failed competition search is unknown, not zero competitors', () => {
  const projects = [project('a', { competitionFailed: true, competitorsAbove: 0 }), ...['b', 'c', 'd', 'e'].map(id => project(id))];
  const score = computeOpportunityScore(projects, 'a');
  assert.equal(score.components.competition.status, 'unknown');
  assert.equal(score.components.competition.absolute, null);
  assert.equal(score.components.competition.percentile, null);
  assert.match(score.components.competition.detail, /desconocido/);
  const healthy = computeOpportunityScore(projects.map(item => item.id === 'a' ? project('a', { competitorsAbove: 0 }) : item), 'a');
  assert.equal(healthy.components.competition.status, 'known');
  assert.equal(healthy.components.competition.absolute, 0);
  assert.notEqual(healthy.components.competition.percentile, score.components.competition.percentile);
});

test('RES-02 ties are deterministic, invalid weights are rejected and a small sample is insufficient', () => {
  assert.equal(averageRankPercentile([10, 10, 30, 40, 50], 10), 12.5);
  assert.equal(averageRankPercentile([10, 10, 30, 40, 50], 10), averageRankPercentile([50, 10, 40, 10, 30], 10));
  assert.throws(() => assertWeights({ traction: -1, outliers: 25, growth: 25, competition: 51 }));
  assert.throws(() => assertWeights({ traction: 10, outliers: 10, growth: 10, competition: 10 }));
  const only = computeOpportunityScore([project('solo', { complete: false, competitionFailed: true, competitorsAbove: 0 })], 'solo');
  assert.equal(only.rankingAvailable, false);
  assert.equal(only.score, null);
  assert.match(only.message, /Ranking aún no disponible/);
  assert.equal(only.components.competition.absolute, null);
});

test('partial coverage is normalized and a failed component is not scored as 100', () => {
  const projects = [project('a', { competitionFailed: true, competitorsAbove: 0 }), ...['b', 'c', 'd', 'e'].map(id => project(id, { competitorsAbove: 4 }))];
  const score = computeOpportunityScore(projects, 'a');
  assert.equal(score.certainty, 'partial');
  assert.ok((score.coverage ?? 0) >= 0.7);
  assert.ok(score.score != null && score.score < 100);
  assert.equal(score.components.competition.percentile, null);
});

test('less than 70 percent coverage does not invent a score', () => {
  const projects = ['a', 'b', 'c', 'd', 'e'].map(id => project(id, { outlierRatio: null, outlierVideos: 0, outlierChannels: 0, weeklyGrowth: null, growthChannels: 0, competitionFailed: true, competitorsAbove: null }));
  const score = computeOpportunityScore(projects, 'a');
  assert.equal(score.score, null);
  assert.equal(score.certainty, 'insufficient');
  assert.match(score.message, /insuficientes/i);
});
