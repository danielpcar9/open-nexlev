import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function namedPackage(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')).name ?? null; }
  catch { return null; }
}

export function findDashboardRoot(starts: string[]): string {
  for (const start of starts) {
    let dir = resolve(start);
    for (let hop = 0; hop < 16; hop += 1) {
      if (namedPackage(join(dir, 'package.json')) === '@open-nexlev/web-dashboard') return dir;
      if (namedPackage(join(dir, 'packages/web-dashboard/package.json')) === '@open-nexlev/web-dashboard') return join(dir, 'packages/web-dashboard');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('No se encontró la raíz de @open-nexlev/web-dashboard.');
}

export function dashboardRoot(): string {
  return findDashboardRoot([dirname(fileURLToPath(import.meta.url)), process.cwd()]);
}

export function resolveDatabasePath(filename = process.env.DATABASE_URL || './open-nexlev.db'): string {
  if (filename === ':memory:') return filename;
  if (isAbsolute(filename)) return filename;
  return resolve(dashboardRoot(), filename);
}
