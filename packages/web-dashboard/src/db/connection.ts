import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate';
import { resolveDatabasePath } from './path';

export function openDatabase(filename?: string): Database.Database {
  const path = resolveDatabasePath(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  migrate(sqlite);
  return sqlite;
}
