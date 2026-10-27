import type Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const hasVersion = sqlite.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insert = sqlite.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of MIGRATIONS) {
    const apply = sqlite.transaction(() => {
      if (hasVersion.get(migration.version)) return;
      sqlite.exec(migration.sql);
      insert.run(migration.version, migration.name, Date.now());
    });
    apply.immediate();
  }
}
