import { drizzle } from 'drizzle-orm/better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import type { NicheChannelResult } from '@open-nexlev/niche-engine';
import { openDatabase } from './connection';
import { savedChannels } from './schema';

export function openStore(filename?: string) {
  const sqlite = openDatabase(filename);
  const db = drizzle(sqlite);
  return {
    sqlite,
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

export type Store = ReturnType<typeof openStore>;
let store: Store | undefined;
export function getStore() { return store ??= openStore(); }
export function resetStoreForTests() {
  store?.close();
  store = undefined;
}
export function databaseHandle(): Database.Database { return getStore().sqlite; }
