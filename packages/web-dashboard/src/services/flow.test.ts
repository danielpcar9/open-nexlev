import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type ChannelCapture } from '@open-nexlev/niche-engine';
import { tempDatabase } from '../db/test-utils';
import { evaluateProductAlerts } from './alerts';
import { executeCaptureJob } from './capture';
import { claimJob, enqueueJob } from './jobs';
import { applyRetention } from './retention';
import { executeResearchJob, patchMember, scoreProject } from './research';
import { channelHistory, followChannel } from './tracking';

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';

function capture(observedAt: string, views = 1000): ChannelCapture {
  return {
    provider: 'innertube', channelId, title: 'Fixture', observedAt, fetchedAt: observedAt, fromCache: false,
    subscribers: { value: 10, precision: 'exact' }, subscribersResolution: 0,
    totalViews: { value: views, precision: 'exact' }, totalViewsResolution: 0,
    videoCount: { value: 12, precision: 'exact' }, videoCountResolution: 0,
    videos: Array.from({ length: 12 }, (_, index) => ({
      id: `${index === 0 ? 'b' : 'a'}${String(index).padStart(10, '0')}`,
      title: index === 0 ? 'Ritual secreto' : `Video ${index}`,
      views: { value: index === 0 ? 10_000 : 100, precision: 'exact' },
      viewsResolution: 0, publishedAt: null, publishedText: 'hace un mes', contentKind: 'long',
    })),
  };
}

test('ALT-01 five evaluations of the same outlier create one alert', async () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId });
    const shot = capture('2026-10-23T00:00:00.000Z');
    enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}` });
    const claimed = claimJob(db.sqlite, 'test', 60_000);
    assert.ok(claimed);
    await executeCaptureJob(db.sqlite, claimed, { capture: async () => shot });
    for (let attempt = 0; attempt < 5; attempt += 1) evaluateProductAlerts(db.sqlite, shot);
    const alerts = db.sqlite.prepare(`SELECT type FROM alerts`).all() as { type: string }[];
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.type, 'baseline_outlier');
    const evidence = JSON.parse((db.sqlite.prepare(`SELECT evidence FROM alerts`).get() as { evidence: string }).evidence);
    assert.equal(evidence.sampleIds.includes(shot.videos[0]?.id), false);
  } finally { db.close(); }
});

test('a failed capture is not stored as zero and repeated failures alert once', async () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId });
    const job = enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, maxAttempts: 1 });
    const claimed = claimJob(db.sqlite, 'test', 60_000);
    assert.ok(claimed);
    assert.equal(claimed.id, job.job.id);
    await executeCaptureJob(db.sqlite, claimed, { capture: async () => { throw new EngineError('RESTRICTED', 'El canal no está disponible públicamente.'); } });
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 0);
    db.sqlite.prepare(`UPDATE tracked_channels SET consecutive_errors = 3`).run();
    const { recordCaptureFailure } = await import('./alerts');
    recordCaptureFailure(db.sqlite, channelId, 3);
    recordCaptureFailure(db.sqlite, channelId, 5);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM alerts WHERE type = 'capture_failed'`).get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test('history without points is insufficient and retention covers paused channels', () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId }, Date.parse('2026-10-23T00:00:00.000Z'));
    const history = channelHistory(db.sqlite, channelId, '1');
    assert.equal(history.window.quality === 'insufficient' || history.window.quality === 'stale', true);
    assert.equal(history.window.delta, null);
    const old = Date.parse('2026-01-01T00:00:00.000Z');
    db.sqlite.prepare(`UPDATE tracked_channels SET active = 0 WHERE channel_id = ?`).run(channelId);
    db.sqlite.prepare(`INSERT INTO channel_observations (id, channel_id, observed_at, fetched_at, provider, from_cache, total_views, total_views_precision, subscribers, subscribers_precision, video_count, video_count_precision) VALUES ('old', ?, ?, ?, 'innertube', 0, 10, 'exact', 1, 'exact', 1, 'exact')`).run(channelId, old, old);
    applyRetention(db.sqlite, Date.parse('2026-10-23T00:00:00.000Z'));
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 0);
  } finally { db.close(); }
});

test('RES-01 a failed competition search stays unknown after restart', async () => {
  const db = tempDatabase();
  try {
    const { createProject } = await import('./research');
    const project = createProject(db.sqlite, { name: 'Fixture', referenceQueries: ['referentes de prueba'], competitionQueries: ['competencia de prueba'] });
    const job = enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    const claimed = claimJob(db.sqlite, 'test', 60_000);
    assert.ok(claimed);
    await executeResearchJob(db.sqlite, claimed, async input => input.query.includes('competencia')
      ? { ok: false, partial: false, error: 'UPSTREAM', channels: [] }
      : { ok: true, partial: false, channels: [{ channelId, title: 'Referente', subscribers: 10, videos: [] }] });
    const score = scoreProject(db.sqlite, project.id);
    assert.equal(score.components.competition.status, 'unknown');
    assert.equal(score.components.competition.absolute, null);
    assert.match(score.components.competition.detail, /desconocido|incompleta|ausencia/);
    db.sqlite.close();
    const reopened = (await import('../db/connection')).openDatabase(db.path);
    const stored = JSON.parse((reopened.prepare(`SELECT last_score FROM research_projects`).get() as { last_score: string }).last_score);
    assert.equal(stored.components.competition.absolute, null);
    const patched = patchMember(reopened, project.id, channelId, { role: 'indirect_competitor', notes: 'nota manual' });
    assert.equal(patched.members[0]?.role, 'indirect_competitor');
    reopened.close();
    const again = (await import('../db/connection')).openDatabase(db.path);
    assert.equal((again.prepare(`SELECT role, notes FROM research_members`).get() as { role: string; notes: string }).role, 'indirect_competitor');
    again.close();
  } finally { db.folder && true; }
});
