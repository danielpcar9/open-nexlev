import type Database from 'better-sqlite3';
import { describeCounter, youtubeDataApiEnabled, type CounterPoint, type ProviderId, type WindowMetric } from '@open-nexlev/niche-engine';
import { CHANNEL_ID } from './constants';
import { enqueueJob } from './jobs';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Tracked = {
  channel_id: string; title: string; active: number; interval_hours: number; provider: ProviderId;
  next_due_at: number; last_success_at: number | null; last_attempt_at: number | null; consecutive_errors: number; last_error: string | null; created_at: number;
};

function getTracked(sqlite: Database.Database, channelId: string): Tracked | null {
  return (sqlite.prepare(`SELECT * FROM tracked_channels WHERE channel_id = ?`).get(channelId) as Tracked | undefined) ?? null;
}

function points(sqlite: Database.Database, channelId: string, provider: string): CounterPoint[] {
  return (sqlite.prepare(`SELECT observed_at, total_views, total_views_precision, total_views_resolution, from_cache FROM channel_observations WHERE channel_id = ? AND provider = ? ORDER BY observed_at`).all(channelId, provider) as {
    observed_at: number; total_views: number | null; total_views_precision: CounterPoint['precision']; total_views_resolution: number | null; from_cache: number;
  }[]).map(row => ({ observedAt: new Date(row.observed_at).toISOString(), value: row.total_views, precision: row.total_views_precision, provider: provider as ProviderId, fromCache: row.from_cache === 1, resolution: row.total_views_resolution }));
}

function summarize(window: WindowMetric | null): string {
  if (!window) return 'sin serie';
  if (window.quality === 'insufficient') return 'cobertura insuficiente';
  if (window.quality === 'stale') return 'desactualizado';
  if (window.quality === 'counter_reset') return 'corrección de contador';
  if (window.projected) return 'proyección';
  return window.quality === 'observed' ? 'observado' : 'aproximado';
}

export function presentTracked(sqlite: Database.Database, row: Tracked, now = Date.now()) {
  const series = points(sqlite, row.channel_id, row.provider);
  const described = describeCounter(series, new Date(now));
  const knownTotal = series.some(point => point.value != null);
  return {
    channelId: row.channel_id,
    title: row.title,
    active: row.active === 1,
    intervalHours: row.interval_hours,
    provider: row.provider,
    nextDueAt: new Date(row.next_due_at).toISOString(),
    lastSuccessAt: row.last_success_at == null ? null : new Date(row.last_success_at).toISOString(),
    lastAttemptAt: row.last_attempt_at == null ? null : new Date(row.last_attempt_at).toISOString(),
    consecutiveErrors: row.consecutive_errors,
    lastError: row.last_error,
    quality: knownTotal ? summarize(described.d7.quality === 'insufficient' ? described.d1 : described.d7) : 'sin total de canal',
    windows: { h24: described.d1, d7: described.d7, d30: described.d30, projection: described.projection },
  };
}

export function listTracked(sqlite: Database.Database, now = Date.now()) {
  const rows = sqlite.prepare(`SELECT * FROM tracked_channels ORDER BY created_at DESC`).all() as Tracked[];
  return rows.map(row => presentTracked(sqlite, row, now));
}

export function followChannel(sqlite: Database.Database, input: { channelId: string; intervalHours?: number; title?: string; provider?: ProviderId }, now = Date.now()) {
  if (!CHANNEL_ID.test(input.channelId)) throw new HttpError(400, 'ID de canal inválido');
  const provider = input.provider ?? 'innertube';
  if (provider === 'youtube-data-api' && !youtubeDataApiEnabled()) throw new HttpError(400, 'YouTube Data API no está activada. Hace falta la clave y confirmar la retención de 30 días.');
  const interval = input.intervalHours ?? 6;
  if (!Number.isInteger(interval) || interval < 1 || interval > 168) throw new HttpError(400, 'El intervalo debe ser un entero entre 1 y 168 horas');
  const existing = getTracked(sqlite, input.channelId);
  if (!existing) {
    sqlite.prepare(`INSERT INTO tracked_channels (channel_id, title, active, interval_hours, provider, next_due_at, consecutive_errors, created_at)
      VALUES (?, ?, 1, ?, ?, ?, 0, ?)`).run(input.channelId, input.title?.slice(0, 200) || input.channelId, interval, provider, now, now);
  } else {
    sqlite.prepare(`UPDATE tracked_channels SET active = 1, interval_hours = ?, provider = ?, title = COALESCE(?, title), next_due_at = CASE WHEN provider != ? THEN ? ELSE next_due_at END WHERE channel_id = ?`)
      .run(interval, provider, input.title?.slice(0, 200) ?? null, provider, now, input.channelId);
  }
  return presentTracked(sqlite, getTracked(sqlite, input.channelId) as Tracked, now);
}

export function unfollowChannel(sqlite: Database.Database, channelId: string, now = Date.now()) {
  if (!CHANNEL_ID.test(channelId)) throw new HttpError(400, 'ID de canal inválido');
  const existing = getTracked(sqlite, channelId);
  if (!existing) throw new HttpError(404, 'Ese canal no se está siguiendo');
  sqlite.prepare(`UPDATE tracked_channels SET active = 0 WHERE channel_id = ?`).run(channelId);
  return presentTracked(sqlite, getTracked(sqlite, channelId) as Tracked, now);
}

export function refreshChannel(sqlite: Database.Database, channelId: string, now = Date.now()) {
  if (!CHANNEL_ID.test(channelId)) throw new HttpError(400, 'ID de canal inválido');
  const existing = getTracked(sqlite, channelId);
  if (!existing || existing.active !== 1) throw new HttpError(404, 'Sigue el canal antes de actualizarlo');
  const job = enqueueJob(sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, now });
  return { jobId: job.job.id, created: job.created, status: job.job.status };
}

export function channelHistory(sqlite: Database.Database, channelId: string, requested: '1' | '7' | '30' = '7', now = Date.now()) {
  if (!CHANNEL_ID.test(channelId)) throw new HttpError(400, 'ID de canal inválido');
  const tracked = getTracked(sqlite, channelId);
  const provider = tracked?.provider ?? 'innertube';
  const series = points(sqlite, channelId, provider);
  const described = describeCounter(series, new Date(now));
  const selected = requested === '1' ? described.d1 : requested === '30' ? described.d30 : described.d7;
  const videos = sqlite.prepare(`SELECT video_id, title, views, views_precision, observed_at, content_kind, published_text, published_at FROM video_observations WHERE channel_id = ? AND provider = ? ORDER BY observed_at DESC LIMIT 50`).all(channelId, provider);
  return {
    channelId,
    provider,
    points: series,
    window: selected,
    windows: { h24: described.d1, d7: described.d7, d30: described.d30, projection: described.projection },
    videos,
    note: series.every(point => point.value == null)
      ? 'Sin un total de canal fiable. No se usa la suma de los videos inspeccionados como vistas del canal. El seguimiento de videos observados sigue disponible.'
      : 'Las ventanas comparan observaciones del mismo proveedor. Un total ausente permanece ausente.',
  };
}

export function deleteHistory(sqlite: Database.Database, channelId: string) {
  if (!CHANNEL_ID.test(channelId)) throw new HttpError(400, 'ID de canal inválido');
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM channel_observations WHERE channel_id = ?`).run(channelId);
    sqlite.prepare(`DELETE FROM video_observations WHERE channel_id = ?`).run(channelId);
  });
  tx.immediate();
}
