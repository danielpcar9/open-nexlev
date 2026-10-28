import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate';
import { resolveDatabasePath } from './path';

function busyTimeoutMs(value: number | undefined): number {
  if (value == null) return 5_000;
  if (!Number.isInteger(value) || value < 0 || value > 60_000) throw new Error('busy_timeout inválido');
  return value;
}

function isBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_'));
}

function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withBusyRetry<T>(timeoutMs: number, fn: () => T): T {
  const started = Date.now();
  let pause = 15;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!isBusy(error) || Date.now() - started >= timeoutMs) throw error;
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw error;
      waitMs(Math.min(pause, remaining));
      pause = Math.min(pause * 2, 200);
    }
  }
}

function enableWal(sqlite: Database.Database): void {
  const mode = sqlite.pragma('journal_mode = WAL', { simple: true });
  if (mode === 'wal') return;
  const error = new Error('database is locked') as Error & { code: string };
  error.code = 'SQLITE_BUSY';
  throw error;
}

export function openDatabase(filename?: string, options?: { busyTimeoutMs?: number }): Database.Database {
  const path = resolveDatabasePath(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const timeout = busyTimeoutMs(options?.busyTimeoutMs);
  const sqlite = new Database(path, { timeout });
  try {
    sqlite.pragma(`busy_timeout = ${timeout}`);
    if (path !== ':memory:') withBusyRetry(timeout, () => enableWal(sqlite));
    sqlite.pragma('foreign_keys = ON');
    withBusyRetry(timeout, () => migrate(sqlite));
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
