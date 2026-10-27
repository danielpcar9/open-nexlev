import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { endpointResolution, outlierReference, weeklyGrowth, type ChannelCapture, type CounterPoint, type VideoSample } from '@open-nexlev/niche-engine';
import { isUniqueConstraint } from './constants';

export type Rule = { channelId: string; active: boolean; multiplier: number; accelerationPercent: number; minViews: number; version: number };

export function getRule(sqlite: Database.Database, channelId: string, now = Date.now()): Rule {
  const row = sqlite.prepare(`SELECT * FROM alert_rules WHERE channel_id = ?`).get(channelId) as {
    active: number; outlier_multiplier: number; acceleration_percent: number; acceleration_min_views: number; version: number;
  } | undefined;
  if (!row) return { channelId, active: true, multiplier: 3, accelerationPercent: 100, minViews: 1000, version: 1 };
  return { channelId, active: row.active === 1, multiplier: row.outlier_multiplier, accelerationPercent: row.acceleration_percent, minViews: row.acceleration_min_views, version: row.version };
}

export function saveRule(sqlite: Database.Database, channelId: string, input: { active: boolean; multiplier: number; accelerationPercent: number; minViews: number }, now = Date.now()): Rule {
  const current = sqlite.prepare(`SELECT version FROM alert_rules WHERE channel_id = ?`).get(channelId) as { version: number } | undefined;
  const version = (current?.version ?? 0) + 1;
  sqlite.prepare(`INSERT INTO alert_rules (channel_id, active, outlier_multiplier, acceleration_percent, acceleration_min_views, version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET active = excluded.active, outlier_multiplier = excluded.outlier_multiplier, acceleration_percent = excluded.acceleration_percent,
      acceleration_min_views = excluded.acceleration_min_views, version = excluded.version, updated_at = excluded.updated_at`)
    .run(channelId, input.active ? 1 : 0, input.multiplier, input.accelerationPercent, input.minViews, version, now);
  return getRule(sqlite, channelId, now);
}

function insertAlert(sqlite: Database.Database, alert: { type: string; channelId: string; videoId?: string | null; evidence: unknown; ruleVersion: number; dedupeKey: string }, now: number): boolean {
  try {
    const info = sqlite.prepare(`INSERT INTO alerts (id, type, channel_id, video_id, created_at, evidence, rule_version, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), alert.type, alert.channelId, alert.videoId ?? null, now, JSON.stringify(alert.evidence), alert.ruleVersion, alert.dedupeKey);
    return info.changes === 1;
  } catch (error) {
    if (isUniqueConstraint(error)) return false;
    throw error;
  }
}

function samplesOf(capture: ChannelCapture): VideoSample[] {
  return capture.videos.map(video => ({ id: video.id, views: video.views.value, contentKind: video.contentKind, precision: video.views.precision }));
}

function previousSamples(sqlite: Database.Database, channelId: string, provider: string, before: number): VideoSample[] {
  const stamp = sqlite.prepare(`SELECT MAX(observed_at) AS observed_at FROM video_observations WHERE channel_id = ? AND provider = ? AND observed_at < ?`).get(channelId, provider, before) as { observed_at: number | null };
  if (stamp.observed_at == null) return [];
  const rows = sqlite.prepare(`SELECT video_id, views, content_kind FROM video_observations WHERE channel_id = ? AND provider = ? AND observed_at = ?`).all(channelId, provider, stamp.observed_at) as { video_id: string; views: number | null; content_kind: VideoSample['contentKind'] }[];
  return rows.map(row => ({ id: row.video_id, views: row.views, contentKind: row.content_kind }));
}

export function evaluateProductAlerts(sqlite: Database.Database, capture: ChannelCapture, now = Date.now()): void {
  const rule = getRule(sqlite, capture.channelId, now);
  const observedAt = Date.parse(capture.observedAt);
  const earlier = sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations WHERE channel_id = ? AND provider = ? AND observed_at < ?`).get(capture.channelId, capture.provider, observedAt) as { count: number };
  const first = earlier.count === 0;
  if (rule.active) {
    const samples = samplesOf(capture);
    const prior = first ? [] : previousSamples(sqlite, capture.channelId, capture.provider, observedAt);
    const previouslyAbove = new Set(prior.filter(sample => outlierReference(prior, sample.id, rule.multiplier).isOutlier).map(sample => sample.id));
    for (const sample of samples) {
      const reference = outlierReference(samples, sample.id, rule.multiplier);
      if (!reference.ok || !reference.isOutlier) continue;
      const rounded = samples.some(item => item.precision === 'rounded');
      const evidence = {
        median: reference.median,
        ratio: reference.ratio,
        multiplier: rule.multiplier,
        sampleIds: reference.sampleIds,
        sampleViews: reference.sampleViews,
        candidateExcluded: reference.candidateExcluded,
        approximate: rounded,
        note: 'Se compara el acumulado de vistas, no cohortes de la misma antigüedad. El candidato no entra en su mediana.',
      };
      if (first) insertAlert(sqlite, { type: 'baseline_outlier', channelId: capture.channelId, videoId: sample.id, evidence, ruleVersion: rule.version, dedupeKey: `baseline:${capture.channelId}:${sample.id}:v${rule.version}` }, now);
      else if (!previouslyAbove.has(sample.id)) insertAlert(sqlite, { type: 'new_outlier', channelId: capture.channelId, videoId: sample.id, evidence, ruleVersion: rule.version, dedupeKey: `cross:${capture.channelId}:${sample.id}:v${rule.version}` }, now);
    }
    const points = (sqlite.prepare(`SELECT observed_at, total_views, total_views_precision, total_views_resolution, provider, from_cache FROM channel_observations WHERE channel_id = ? AND provider = ? ORDER BY observed_at`).all(capture.channelId, capture.provider) as {
      observed_at: number; total_views: number | null; total_views_precision: CounterPoint['precision']; total_views_resolution: number | null; provider: CounterPoint['provider']; from_cache: number;
    }[]).map(row => ({ observedAt: new Date(row.observed_at).toISOString(), value: row.total_views, precision: row.total_views_precision, provider: row.provider, fromCache: row.from_cache === 1, resolution: row.total_views_resolution }));
    const growth = weeklyGrowth(points, new Date(now));
    const current = growth.current;
    const resolution = endpointResolution(points, current);
    const comparable = growth.comparison.comparable && current.delta != null && growth.comparison.percent != null && current.quality !== 'counter_reset' && current.quality !== 'stale' && growth.previous.quality !== 'counter_reset' && growth.previous.quality !== 'stale';
    const belowResolution = current.quality === 'approximate' && (resolution == null || (current.delta ?? 0) <= resolution);
    if (comparable && !belowResolution && (growth.comparison.percent as number) >= rule.accelerationPercent && (current.delta as number) >= rule.minViews && current.from && current.to) {
      insertAlert(sqlite, {
        type: 'acceleration',
        channelId: capture.channelId,
        evidence: { percent: growth.comparison.percent, absolute: current.delta, previous: growth.previous.delta, from: current.from, to: current.to, quality: current.quality, resolution, note: 'Dos ventanas semanales comparables. No es una garantía estadística.' },
        ruleVersion: rule.version,
        dedupeKey: `accel:${capture.channelId}:${current.from}:${current.to}:v${rule.version}`,
      }, now);
    }
  }
}

export function recordCaptureFailure(sqlite: Database.Database, channelId: string, consecutive: number, now = Date.now()): void {
  if (consecutive < 3) return;
  const open = sqlite.prepare(`SELECT id FROM alerts WHERE channel_id = ? AND type = 'capture_failed' AND resolved_at IS NULL`).get(channelId);
  if (open) return;
  const episode = (sqlite.prepare(`SELECT COUNT(*) AS count FROM alerts WHERE channel_id = ? AND type = 'capture_failed'`).get(channelId) as { count: number }).count;
  insertAlert(sqlite, { type: 'capture_failed', channelId, evidence: { consecutive, note: 'Fallo operativo de captura, no un cambio de audiencia.' }, ruleVersion: 1, dedupeKey: `capture-failed:${channelId}:${episode}` }, now);
}

export function resolveCaptureFailures(sqlite: Database.Database, channelId: string, now = Date.now()): void {
  sqlite.prepare(`UPDATE alerts SET resolved_at = ? WHERE channel_id = ? AND type = 'capture_failed' AND resolved_at IS NULL`).run(now, channelId);
}

export function listAlerts(sqlite: Database.Database, filter: { channelId?: string; type?: string; unread?: boolean; limit: number; cursor?: string | null }): { alerts: unknown[]; nextCursor: string | null } {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (filter.channelId) { where.push('channel_id = ?'); params.push(filter.channelId); }
  if (filter.type) { where.push('type = ?'); params.push(filter.type); }
  if (filter.unread) where.push('read_at IS NULL');
  if (filter.cursor) {
    const [created, id] = filter.cursor.split('|');
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    params.push(Number(created), Number(created), id);
  }
  const rows = sqlite.prepare(`SELECT * FROM alerts WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, filter.limit + 1) as Record<string, unknown>[];
  const page = rows.slice(0, filter.limit).map(presentAlert);
  const last = rows.length > filter.limit ? rows[filter.limit - 1] : null;
  return { alerts: page, nextCursor: last ? `${last.created_at}|${last.id}` : null };
}

export function presentAlert(row: Record<string, unknown>) {
  return {
    id: row.id, type: row.type, channelId: row.channel_id, videoId: row.video_id,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    evidence: JSON.parse(String(row.evidence)),
    ruleVersion: row.rule_version,
    readAt: row.read_at == null ? null : new Date(Number(row.read_at)).toISOString(),
    resolvedAt: row.resolved_at == null ? null : new Date(Number(row.resolved_at)).toISOString(),
  };
}

export function markAlert(sqlite: Database.Database, id: string, read: boolean, now = Date.now()) {
  const info = sqlite.prepare(`UPDATE alerts SET read_at = ? WHERE id = ?`).run(read ? now : null, id);
  if (info.changes !== 1) return null;
  return presentAlert(sqlite.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id) as Record<string, unknown>);
}
