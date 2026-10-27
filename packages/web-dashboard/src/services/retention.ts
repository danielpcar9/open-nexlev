import type Database from 'better-sqlite3';
import { YOUTUBE_API_RETENTION_DAYS } from '@open-nexlev/niche-engine';
import { DAY_MS } from './constants';

export function retentionDays(provider: string): number {
  if (provider === 'youtube-data-api') return YOUTUBE_API_RETENTION_DAYS;
  const configured = Number(process.env.OBSERVATION_RETENTION_DAYS ?? 35);
  return Number.isFinite(configured) && configured >= 1 && configured <= 3650 ? configured : 35;
}

export function applyRetention(sqlite: Database.Database, now = Date.now()): void {
  for (const provider of ['innertube', 'youtube-data-api']) {
    const cutoff = now - retentionDays(provider) * DAY_MS;
    sqlite.prepare(`DELETE FROM channel_observations WHERE provider = ? AND observed_at < ?`).run(provider, cutoff);
    sqlite.prepare(`DELETE FROM video_observations WHERE provider = ? AND observed_at < ?`).run(provider, cutoff);
  }
}
