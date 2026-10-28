import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { EngineError, type ChannelCapture } from '@open-nexlev/niche-engine';
import { evaluateProductAlerts, recordCaptureFailure, resolveCaptureFailures } from './alerts';
import { isUniqueConstraint } from './constants';
import { getJob, holdLease, jobOwnership, LEASE_MS, settleCancelled, type JobRow, type LeaseControl } from './jobs';
import { applyRetention } from './retention';

export type CaptureProvider = { capture(channelId: string, signal?: AbortSignal): Promise<ChannelCapture> };

const HOUR_MS = 60 * 60 * 1000;
const MAX_BACKOFF_MS = 7 * 24 * HOUR_MS;

/** Next automatic capture after a terminal failure. Job retries are a different clock. */
export function nextPeriodicCaptureAt(now: number, intervalHours: number, consecutiveErrors: number, retryAfterMs?: number): number {
  const intervalMs = Math.min(Math.max(intervalHours, 1), 168) * HOUR_MS;
  const steps = Math.max(0, Math.min(consecutiveErrors, 6) - 1);
  const backoff = intervalMs * 2 ** steps;
  return now + Math.min(Math.max(backoff, retryAfterMs ?? 0), MAX_BACKOFF_MS);
}

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
  const token = job.lease_token;
  if (!token) return;
  sqlite.transaction(() => {
    const gate = jobOwnership(sqlite, job.id, token, now);
    if (gate === 'cancelled') { settleCancelled(sqlite, job.id, token, now); return; }
    if (gate !== 'owned') return;
    const current = getJob(sqlite, job.id);
    if (!current) return;
    const tracked = sqlite.prepare(`SELECT interval_hours, consecutive_errors FROM tracked_channels WHERE channel_id = ?`).get(channelId) as { interval_hours: number; consecutive_errors: number } | undefined;
    const consecutive = (tracked?.consecutive_errors ?? 0) + 1;
    const where = `id = ? AND lease_token = ? AND status = 'running' AND cancel_requested = 0 AND lease_until > ?`;
    if (retryable && current.attempts < current.max_attempts) {
      const wait = engine.retryAfterMs ?? Math.min(30_000 * 2 ** Math.max(0, current.attempts - 1), 600_000);
      const info = sqlite.prepare(`UPDATE jobs SET status = 'queued', next_attempt_at = ?, lease_owner = NULL, lease_until = NULL, lease_token = NULL, progress = 'reintento', error = ? WHERE ${where}`).run(now + wait, engine.code, job.id, token, now);
      if (info.changes !== 1) return;
      sqlite.prepare(`UPDATE tracked_channels SET last_attempt_at = ?, consecutive_errors = ?, last_error = ? WHERE channel_id = ?`).run(now, consecutive, engine.code, channelId);
      return;
    }
    const info = sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, lease_owner = NULL, lease_until = NULL, lease_token = NULL, progress = 'fallo', error = ? WHERE ${where}`).run(now, engine.code, job.id, token, now);
    if (info.changes !== 1) return;
    const nextDue = nextPeriodicCaptureAt(now, tracked?.interval_hours ?? 6, consecutive, engine.retryAfterMs);
    sqlite.prepare(`UPDATE tracked_channels SET last_attempt_at = ?, consecutive_errors = ?, last_error = ?, next_due_at = ? WHERE channel_id = ?`).run(now, consecutive, engine.code, nextDue, channelId);
    recordCaptureFailure(sqlite, channelId, consecutive, now);
  }).immediate();
}

export async function executeCaptureJob(sqlite: Database.Database, job: JobRow, provider: CaptureProvider, control: LeaseControl = {}): Promise<void> {
  const now = () => control.now?.() ?? Date.now();
  const token = job.lease_token;
  if (!token) return;
  const payload = JSON.parse(job.payload) as { channelId?: string };
  const channelId = payload.channelId ?? '';
  const abort = new AbortController();
  const stopRenewal = holdLease(sqlite, job.id, token, { ...control, leaseMs: control.leaseMs ?? LEASE_MS }, () => abort.abort());
  const finishCancelled = () => { if (jobOwnership(sqlite, job.id, token, now()) === 'cancelled') settleCancelled(sqlite, job.id, token, now()); };
  try {
    const tracked = sqlite.prepare(`SELECT * FROM tracked_channels WHERE channel_id = ?`).get(channelId) as { active: number; interval_hours: number; provider: string } | undefined;
    if (!tracked || tracked.active !== 1) {
      sqlite.transaction(() => {
        if (jobOwnership(sqlite, job.id, token, now()) !== 'owned') return;
        sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, error = 'El canal ya no se sigue.', progress = 'fallo', lease_owner = NULL, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ? AND status = 'running' AND cancel_requested = 0`).run(now(), job.id, token);
      }).immediate();
      return;
    }
    if (jobOwnership(sqlite, job.id, token, now()) === 'cancelled') { finishCancelled(); return; }
    let capture: ChannelCapture;
    try {
      sqlite.prepare(`UPDATE jobs SET progress = 'consultando' WHERE id = ? AND lease_token = ? AND status = 'running'`).run(job.id, token);
      const pending = provider.capture(channelId, abort.signal);
      capture = await new Promise<ChannelCapture>((resolve, reject) => {
        const fail = () => reject(new Error('aborted'));
        if (abort.signal.aborted) { fail(); return; }
        abort.signal.addEventListener('abort', fail, { once: true });
        pending.then(value => { abort.signal.removeEventListener('abort', fail); resolve(value); }, error => { abort.signal.removeEventListener('abort', fail); reject(error); });
      });
    } catch (error) {
      if (abort.signal.aborted || jobOwnership(sqlite, job.id, token, now()) !== 'owned') { finishCancelled(); return; }
      failJob(sqlite, job, channelId, error, now());
      return;
    }
    if (abort.signal.aborted || jobOwnership(sqlite, job.id, token, now()) !== 'owned') { finishCancelled(); return; }
    if (capture.channelId !== channelId || capture.provider !== tracked.provider) {
      failJob(sqlite, job, channelId, new EngineError('INVALID', 'La captura no corresponde a la serie del canal.'), now());
      return;
    }
    const at = now();
    sqlite.transaction(() => {
      const gate = jobOwnership(sqlite, job.id, token, at);
      if (gate === 'cancelled') { settleCancelled(sqlite, job.id, token, at); return; }
      if (gate !== 'owned') return;
      insertObservation(sqlite, capture);
      sqlite.prepare(`UPDATE tracked_channels SET title = ?, last_success_at = ?, last_attempt_at = ?, consecutive_errors = 0, last_error = NULL, next_due_at = ? WHERE channel_id = ?`)
        .run(capture.title, at, at, at + tracked.interval_hours * HOUR_MS, channelId);
      resolveCaptureFailures(sqlite, channelId, at);
      evaluateProductAlerts(sqlite, capture, at);
      applyRetention(sqlite, at);
      const info = sqlite.prepare(`UPDATE jobs SET status = 'succeeded', finished_at = ?, progress = 'listo', error = NULL, lease_owner = NULL, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ? AND cancel_requested = 0 AND status = 'running' AND lease_until > ?`).run(at, job.id, token, at);
      if (info.changes !== 1) throw new Error('LEASE_LOST');
    }).immediate();
  } catch (error) {
    if (error instanceof Error && error.message === 'LEASE_LOST') return;
    throw error;
  } finally {
    stopRenewal();
  }
}

export function recordAnalysisRun(sqlite: Database.Database, input: { query: string; filters: unknown; status: string; provider: string; error?: string | null; startedAt: number; finishedAt: number }): void {
  sqlite.prepare(`INSERT INTO analysis_runs (id, query, filters, started_at, finished_at, status, provider, algorithm_version, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), input.query.slice(0, 200), JSON.stringify(input.filters), input.startedAt, input.finishedAt, input.status, input.provider, '2026-10-23.e4-v1', input.error ?? null);
}
