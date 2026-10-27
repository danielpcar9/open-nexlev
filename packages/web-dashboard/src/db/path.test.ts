import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardRoot, findDashboardRoot, resolveDatabasePath } from './path';

test('DB-04 dashboard and worker paths ignore the launch directory', () => {
  const root = dashboardRoot();
  const fromRepo = findDashboardRoot([join(root, '../..')]);
  assert.equal(fromRepo, root);
  assert.equal(resolveDatabasePath('./open-nexlev.db'), join(root, 'open-nexlev.db'));
  const tsx = join(root, '../../node_modules/.bin/tsx');
  const script = join(root, 'src/db/print-path.ts');
  const launched = [
    spawnSync(tsx, [script, './open-nexlev.db'], { cwd: root, encoding: 'utf8' }),
    spawnSync(tsx, [script, './open-nexlev.db'], { cwd: '/tmp', encoding: 'utf8' }),
  ];
  for (const result of launched) assert.equal(result.status, 0, result.stderr);
  assert.equal(launched[0]?.stdout.trim(), launched[1]?.stdout.trim());
  assert.equal(launched[0]?.stdout.trim(), join(root, 'open-nexlev.db'));
  assert.equal(dirnameOf(fileURLToPath(import.meta.url)).length > 0, true);
});

function dirnameOf(path: string): string { return path; }
