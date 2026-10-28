import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isUniqueConstraint } from './constants';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobRow = {
  id: string;
  type: string;
  payload: string;
  dedupe_key: string | null;
  status: JobStatus;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: number;
  lease_owner: string | null;
  lease_until: number | null;
  lease_token: string | null;
  progress: string | null;
  error: string | null;
  cancel_requested: number;
};

const RETURNING = `id, type, payload, dedupe_key, status, created_at, started_at, finished_at, attempts, max_attempts, next_attempt_at, lease_owner, lease_until, lease_token, progress, error, cancel_requested`;

export const LEASE_MS = 60_000;

export type Ownership = 'owned' | 'lost' | 'cancelled';

export function jobOwnership(sqlite: Database.Database, id: string, token: string | null, now = Date.now()): Ownership {
  const job = getJob(sqlite, id);
  if (!job || !token || job.status !== 'running' || job.lease_token !== token) return 'lost';
  if (job.cancel_requested) return 'cancelled';
  if (job.lease_until == null || job.lease_until <= now) return 'lost';
  return 'owned';
}

export function settleCancelled(sqlite: Database.Database, id: string, token: string, now = Date.now()): boolean {
  const info = sqlite.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, progress = 'cancelado', lease_owner = NULL, lease_until = NULL, lease_token = NULL, error = NULL
    WHERE id = ? AND lease_token = ? AND status = 'running'`).run(now, id, token);
  return info.changes === 1;
}

export function recoverCancelledLeases(sqlite: Database.Database, now = Date.now()): number {
  const info = sqlite.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, progress = 'cancelado', lease_owner = NULL, lease_until = NULL, lease_token = NULL
    WHERE status = 'running' AND cancel_requested = 1 AND (lease_until IS NULL OR lease_until < ?)`).run(now, now);
  return info.changes;
}

export function getJob(sqlite: Database.Database, id: string): JobRow | null {
  return (sqlite.prepare(`SELECT ${RETURNING} FROM jobs WHERE id = ?`).get(id) as JobRow | undefined) ?? null;
}

export function enqueueJob(sqlite: Database.Database, input: { type: string; payload: unknown; dedupeKey?: string | null; now?: number; maxAttempts?: number }): { job: JobRow; created: boolean } {
  const now = input.now ?? Date.now();
  const payload = JSON.stringify(input.payload);
  if (Buffer.byteLength(payload) > 100_000) throw new Error('Payload demasiado grande');
  const id = randomUUID();
  const insert = () => {
    if (input.dedupeKey) {
      const existing = sqlite.prepare(`SELECT ${RETURNING} FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')`).get(input.dedupeKey) as JobRow | undefined;
      if (existing) return { job: existing, created: false };
    }
    sqlite.prepare(`INSERT INTO jobs (id, type, payload, dedupe_key, status, created_at, attempts, max_attempts, next_attempt_at, cancel_requested)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, 0)`).run(id, input.type, payload, input.dedupeKey ?? null, now, input.maxAttempts ?? 3, now);
    return { job: getJob(sqlite, id) as JobRow, created: true };
  };
  try {
    return sqlite.transaction(insert).immediate();
  } catch (error) {
    if (input.dedupeKey && isUniqueConstraint(error)) {
      const existing = sqlite.prepare(`SELECT ${RETURNING} FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')`).get(input.dedupeKey) as JobRow | undefined;
      if (existing) return { job: existing, created: false };
    }
    throw error;
  }
}

export function claimJob(sqlite: Database.Database, owner: string, leaseMs: number, now = Date.now()): JobRow | null {
  const claim = sqlite.transaction(() => {
    recoverCancelledLeases(sqlite, now);
    const row = sqlite.prepare(`SELECT id, status, attempts FROM jobs
      WHERE cancel_requested = 0 AND ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?))
      ORDER BY next_attempt_at, created_at LIMIT 1`).get(now, now) as { id: string; status: JobStatus; attempts: number } | undefined;
    if (!row) return null;
    const attempts = row.status === 'queued' ? row.attempts + 1 : row.attempts;
    const token = randomUUID();
    const info = sqlite.prepare(`UPDATE jobs SET status = 'running', lease_owner = ?, lease_until = ?, lease_token = ?, started_at = COALESCE(started_at, ?), attempts = ?
      WHERE id = ? AND cancel_requested = 0 AND ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?))`).run(owner, now + leaseMs, token, now, attempts, row.id, now, now);
    if (info.changes !== 1) return null;
    return getJob(sqlite, row.id);
  });
  return claim.immediate();
}

export function renewLease(sqlite: Database.Database, id: string, token: string, leaseMs: number, now = Date.now()): boolean {
  const info = sqlite.prepare(`UPDATE jobs SET lease_until = ? WHERE id = ? AND lease_token = ? AND status = 'running' AND cancel_requested = 0 AND lease_until > ?`).run(now + leaseMs, id, token, now);
  return info.changes === 1;
}

export type LeaseControl = {
  leaseMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export function holdLease(sqlite: Database.Database, id: string, token: string, control: LeaseControl, onStop: () => void): () => void {
  const leaseMs = control.leaseMs ?? LEASE_MS;
  const now = control.now ?? (() => Date.now());
  const schedule = control.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clear = control.clearInterval ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
  const handle = schedule(() => {
    const current = getJob(sqlite, id);
    if (!current || current.lease_token !== token || current.status !== 'running' || current.cancel_requested || !renewLease(sqlite, id, token, leaseMs, now())) onStop();
  }, Math.max(5, Math.floor(leaseMs / 3)));
  return () => clear(handle);
}

export function cancelJob(sqlite: Database.Database, id: string, now = Date.now()): JobRow | null {
  const cancel = sqlite.transaction(() => {
    const job = getJob(sqlite, id);
    if (!job) return null;
    if (job.status === 'queued') {
      sqlite.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, cancel_requested = 1 WHERE id = ? AND status = 'queued'`).run(now, id);
    } else if (job.status === 'running') {
      sqlite.prepare(`UPDATE jobs SET cancel_requested = 1 WHERE id = ? AND status = 'running'`).run(id);
    }
    return getJob(sqlite, id);
  });
  return cancel.immediate();
}

export function enqueueDueCaptures(sqlite: Database.Database, now = Date.now()): string[] {
  const due = sqlite.prepare(`SELECT channel_id FROM tracked_channels WHERE active = 1 AND next_due_at <= ? ORDER BY next_due_at`).all(now) as { channel_id: string }[];
  const created: string[] = [];
  for (const row of due) {
    const result = enqueueJob(sqlite, { type: 'capture', payload: { channelId: row.channel_id }, dedupeKey: `capture:${row.channel_id}`, now });
    if (result.created) created.push(result.job.id);
  }
  return created;
}

export function beat(sqlite: Database.Database, id: string, now = Date.now()): void {
  sqlite.prepare(`INSERT INTO worker_heartbeats (id, pid, last_seen_at, status) VALUES (?, ?, ?, 'running')
    ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, last_seen_at = excluded.last_seen_at, status = 'running'`).run(id, process.pid, now);
}

export function workerStatus(sqlite: Database.Database, now = Date.now()): { running: boolean; lastSeenAt: string | null; message: string } {
  const row = sqlite.prepare(`SELECT MAX(last_seen_at) AS seen FROM worker_heartbeats`).get() as { seen: number | null };
  const fresh = row.seen != null && now - row.seen <= 15_000;
  return {
    running: fresh,
    lastSeenAt: row.seen == null ? null : new Date(row.seen).toISOString(),
    message: fresh
      ? 'El worker está en marcha. El seguimiento se detiene si apagas el equipo.'
      : 'Actualización automática detenida. Inicia el worker con npm run worker. No hay seguimiento con la computadora apagada.',
  };
}
