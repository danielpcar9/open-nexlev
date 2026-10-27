import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { EngineError, type ChannelCapture } from '@open-nexlev/niche-engine';
import { evaluateProductAlerts, recordCaptureFailure, resolveCaptureFailures } from './alerts';
import { isUniqueConstraint } from './constants';
import { getJob, type JobRow } from './jobs';
import { applyRetention } from './retention';

export type CaptureProvider = { capture(channelId: string): Promise<ChannelCapture> };

function insertObservation(sqlite: Database.Database, capture: ChannelCapture): void {
  const observedAt = Date.parse(capture.observedAt);
  const fetchedAt = Date.parse(capture.fetchedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(fetchedAt)) throw new EngineError('INVALID', 'La captura no tiene fechas válidas.');
  const write = () => {
    try {
      sqlite.prepare(`INSERT INTO channel_observations (
        id, channel_id, observed_at, fetched_at, provider, from_cache,
        total_views, total_views_precision, total_views_resolution,
        subscribers, subscribers_precision, subscribers_resolution,
        video_count, video_count_precision, video_count_resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), capture.channelId, observedAt, fetchedAt, capture.provider, capture.fromCache ? 1 : 0,
        capture.totalViews.value, capture.totalViews.precision, capture.totalViewsResolution,
        capture.subscribers.value, capture.subscribers.precision, capture.subscribersResolution,
        capture.videoCount.value, capture.videoCount.precision, capture.videoCountResolution,
      );
    } catch (error) { if (!isUniqueConstraint(error)) throw error; }
    for (const video of capture.videos) {
      try {
        sqlite.prepare(`INSERT INTO video_observations (
          id, channel_id, video_id, observed_at, fetched_at, provider, from_cache,
          views, views_precision, views_resolution, published_at, published_text, content_kind, title
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), capture.channelId, video.id, observedAt, fetchedAt, capture.provider, capture.fromCache ? 1 : 0,
          video.views.value, video.views.precision, video.viewsResolution,
          video.publishedAt ? Date.parse(video.publishedAt) : null, video.publishedText, video.contentKind, video.title,
        );
      } catch (error) { if (!isUniqueConstraint(error)) throw error; }
    }
  };
  write();
}

function failJob(sqlite: Database.Database, job: JobRow, channelId: string, error: unknown, now: number): void {
  const engine = error instanceof EngineError ? error : new EngineError('UPSTREAM', 'Fallo de captura.');
  const retryable = engine.code === 'TIMEOUT' || engine.code === 'RATE_LIMIT' || engine.code === 'UPSTREAM';
  sqlite.transaction(() => {
    const row = sqlite.prepare(`SELECT consecutive_errors FROM tracked_channels WHERE channel_id = ?`).get(channelId) as { consecutive_errors: number } | undefined;
    const consecutive = (row?.consecutive_errors ?? 0) + 1;
    sqlite.prepare(`UPDATE tracked_channels SET last_attempt_at = ?, consecutive_errors = ?, last_error = ? WHERE channel_id = ?`).run(now, consecutive, engine.code, channelId);
    if (retryable && job.attempts < job.max_attempts) {
      const wait = engine.retryAfterMs ?? Math.min(30_000 * 2 ** Math.max(0, job.attempts - 1), 600_000);
      sqlite.prepare(`UPDATE jobs SET status = 'queued', next_attempt_at = ?, lease_owner = NULL, lease_until = NULL, progress = 'reintento', error = ? WHERE id = ?`).run(now + wait, engine.code, job.id);
    } else {
      sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, lease_owner = NULL, lease_until = NULL, progress = 'fallo', error = ? WHERE id = ?`).run(now, engine.code, job.id);
      recordCaptureFailure(sqlite, channelId, consecutive, now);
    }
  }).immediate();
}

export async function executeCaptureJob(sqlite: Database.Database, job: JobRow, provider: CaptureProvider, now = Date.now()): Promise<void> {
  const payload = JSON.parse(job.payload) as { channelId?: string };
  const channelId = payload.channelId ?? '';
  const tracked = sqlite.prepare(`SELECT * FROM tracked_channels WHERE channel_id = ?`).get(channelId) as { active: number; interval_hours: number; provider: string } | undefined;
  if (!tracked || tracked.active !== 1) {
    sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, error = 'El canal ya no se sigue.', progress = 'fallo' WHERE id = ?`).run(now, job.id);
    return;
  }
  if (getJob(sqlite, job.id)?.cancel_requested) {
    sqlite.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, progress = 'cancelado' WHERE id = ? AND status = 'running'`).run(now, job.id);
    return;
  }
  let capture: ChannelCapture;
  try {
    sqlite.prepare(`UPDATE jobs SET progress = 'consultando' WHERE id = ?`).run(job.id);
    capture = await provider.capture(channelId);
  } catch (error) {
    failJob(sqlite, job, channelId, error, now);
    return;
  }
  if (capture.channelId !== channelId || capture.provider !== tracked.provider) {
    failJob(sqlite, job, channelId, new EngineError('INVALID', 'La captura no corresponde a la serie del canal.'), now);
    return;
  }
  sqlite.transaction(() => {
    const current = getJob(sqlite, job.id);
    if (!current || current.cancel_requested || current.status !== 'running') {
      if (current && current.status === 'running') sqlite.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, progress = 'cancelado' WHERE id = ?`).run(now, job.id);
      return;
    }
    insertObservation(sqlite, capture);
    sqlite.prepare(`UPDATE tracked_channels SET title = ?, last_success_at = ?, last_attempt_at = ?, consecutive_errors = 0, last_error = NULL, next_due_at = ? WHERE channel_id = ?`)
      .run(capture.title, now, now, now + tracked.interval_hours * 60 * 60 * 1000, channelId);
    resolveCaptureFailures(sqlite, channelId, now);
    evaluateProductAlerts(sqlite, capture, now);
    applyRetention(sqlite, now);
    sqlite.prepare(`UPDATE jobs SET status = 'succeeded', finished_at = ?, progress = 'listo', error = NULL, lease_owner = NULL, lease_until = NULL WHERE id = ? AND cancel_requested = 0 AND status = 'running'`).run(now, job.id);
  }).immediate();
}

export function recordAnalysisRun(sqlite: Database.Database, input: { query: string; filters: unknown; status: string; provider: string; error?: string | null; startedAt: number; finishedAt: number }): void {
  sqlite.prepare(`INSERT INTO analysis_runs (id, query, filters, started_at, finished_at, status, provider, algorithm_version, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), input.query.slice(0, 200), JSON.stringify(input.filters), input.startedAt, input.finishedAt, input.status, input.provider, '2026-10-23.e4-v1', input.error ?? null);
}
