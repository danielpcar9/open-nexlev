import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store';
import type { NicheChannelResult } from '@open-nexlev/niche-engine';

const channel: NicheChannelResult = { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Saved', handle: '@test', subscribers: 1200, medianViews: 8000, subscriberToViewRatio: 6.67, estimatedMonthlyRevenueUsd: { low: 100, high: 200 }, channelUrl: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', topOutliers: [] };

function legacyDatabase(): { folder: string; path: string } {
  const folder = mkdtempSync(join(tmpdir(), 'nexlev-old-'));
  const path = join(folder, 'old.db');
  const sqlite = new Database(path);
  sqlite.exec(`CREATE TABLE saved_channels (id TEXT PRIMARY KEY NOT NULL, snapshot TEXT NOT NULL, saved_at INTEGER NOT NULL)`);
  sqlite.prepare('INSERT INTO saved_channels (id, snapshot, saved_at) VALUES (?, ?, ?)').run(channel.channelId, JSON.stringify(channel), 111);
  sqlite.close();
  return { folder, path };
}

test('DB-01 an old Swipe File survives migration and a second migration', () => {
  const { folder, path } = legacyDatabase();
  try {
    let store = openStore(path);
    assert.equal(store.list()[0]?.title, 'Saved');
    assert.equal(store.list()[0]?.channelId, channel.channelId);
    store.close();
    const raw = new Database(path, { readonly: true });
    assert.equal((raw.prepare('SELECT saved_at FROM saved_channels').get() as { saved_at: number }).saved_at, 111);
    assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 6);
    raw.close();
    store = openStore(path);
    assert.equal(store.list()[0]?.title, 'Saved');
    store.close();
    const again = new Database(path, { readonly: true });
    assert.equal((again.prepare('SELECT saved_at FROM saved_channels').get() as { saved_at: number }).saved_at, 111);
    assert.equal((again.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 6);
    again.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('DB-02 two processes migrate once without duplicating versions', async () => {
  const { folder, path } = legacyDatabase();
  const tsx = join(process.cwd(), '../../node_modules/.bin/tsx');
  const run = () => new Promise<void>((resolve, reject) => {
    const child = spawn(tsx, ['src/db/migrate-cli.ts', path], { cwd: process.cwd() });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `migrate ${code}`)));
  });
  try {
    await Promise.all([run(), run()]);
    const raw = new Database(path, { readonly: true });
    assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 6);
    assert.equal((raw.prepare('SELECT saved_at FROM saved_channels').get() as { saved_at: number }).saved_at, 111);
    raw.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('DB-03 saved channels remain after close and reopen', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexlev-reopen-'));
  const path = join(folder, 'test.db');
  try {
    let store = openStore(path);
    store.save(channel);
    store.close();
    store = openStore(path);
    assert.equal(store.list()[0]?.title, 'Saved');
    const mode = (store.sqlite.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    const foreignKeys = (store.sqlite.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
    assert.equal(mode, 'wal');
    assert.equal(foreignKeys, 1);
    store.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
