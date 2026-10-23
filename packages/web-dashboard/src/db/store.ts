import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { NicheChannelResult } from '@open-nexlev/niche-engine';
import { savedChannels } from './schema';

export function openStore(filename = process.env.DATABASE_URL || './open-nexlev.db') {
  const path = filename === ':memory:' ? filename : resolve(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  // Additive, idempotent initialization; existing scaffold tables are untouched.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS saved_channels (
    id TEXT PRIMARY KEY NOT NULL,
    snapshot TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  )`);
  const db = drizzle(sqlite);
  return {
    list: () => db.select().from(savedChannels).orderBy(desc(savedChannels.savedAt)).all().map(row => row.snapshot),
    save(channel: NicheChannelResult) {
      db.insert(savedChannels).values({ id: channel.channelId, snapshot: channel, savedAt: Date.now() })
        .onConflictDoUpdate({ target: savedChannels.id, set: { snapshot: channel } }).run();
    },
    import(channels: NicheChannelResult[]) {
      db.transaction(tx => {
        for (const channel of channels) tx.insert(savedChannels)
          .values({ id: channel.channelId, snapshot: channel, savedAt: Date.now() })
          .onConflictDoNothing().run();
      });
    },
    remove: (id: string) => db.delete(savedChannels).where(eq(savedChannels.id, id)).run(),
    close: () => sqlite.close(),
  };
}
let store: ReturnType<typeof openStore> | undefined;
export function getStore() { return store ??= openStore(); }
