import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './connection';

export function tempDatabase() {
  const folder = mkdtempSync(join(tmpdir(), 'nexlev-'));
  const path = join(folder, 'test.db');
  const sqlite = openDatabase(path);
  return { folder, path, sqlite, close() { sqlite.close(); rmSync(folder, { recursive: true, force: true }); } };
}
