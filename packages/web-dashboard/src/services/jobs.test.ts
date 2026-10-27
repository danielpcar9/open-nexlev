import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tempDatabase } from '../db/test-utils';
import { claimJob, enqueueDueCaptures, enqueueJob } from './jobs';
import { followChannel, refreshChannel } from './tracking';

const channelA = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const channelB = 'UCbbbbbbbbbbbbbbbbbbbbbb';

test('JOB-01 two workers cannot own the same job', async () => {
  const db = tempDatabase();
  try {
    const job = enqueueJob(db.sqlite, { type: 'capture', payload: { channelId: channelA }, dedupeKey: `capture:${channelA}` });
    const tsx = join(process.cwd(), '../../node_modules/.bin/tsx');
    const claim = (owner: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(tsx, ['src/worker/claim-once.ts', db.path, owner], { cwd: process.cwd() });
      let out = '';
      let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    });
    const results = await Promise.all([claim('a'), claim('b')]);
    assert.deepEqual(results.filter(result => result === job.job.id).length, 1);
    assert.equal(results.includes('NONE'), true);
  } finally { db.close(); }
});

test('JOB-02 an expired lease can be recovered without a second observation', () => {
  const db = tempDatabase();
  try {
    const job = enqueueJob(db.sqlite, { type: 'capture', payload: { channelId: channelA }, dedupeKey: `capture:${channelA}`, now: 1_000 });
    const first = claimJob(db.sqlite, 'dead', 1, 1_000);
    assert.equal(first?.id, job.job.id);
    assert.equal(first?.attempts, 1);
    db.sqlite.prepare(`UPDATE jobs SET lease_until = 0 WHERE id = ?`).run(job.job.id);
    const second = claimJob(db.sqlite, 'live', 60_000, 5_000);
    assert.equal(second?.id, job.job.id);
    assert.equal(second?.attempts, 1);
    assert.equal(second?.lease_owner, 'live');
  } finally { db.close(); }
});

test('JOB-03 a fresh channel does not block an overdue one', () => {
  const db = tempDatabase();
  try {
    const now = Date.parse('2026-10-23T00:00:00.000Z');
    followChannel(db.sqlite, { channelId: channelA }, now);
    followChannel(db.sqlite, { channelId: channelB }, now);
    db.sqlite.prepare(`UPDATE tracked_channels SET next_due_at = ? WHERE channel_id = ?`).run(now + 86_400_000, channelA);
    db.sqlite.prepare(`UPDATE tracked_channels SET next_due_at = ? WHERE channel_id = ?`).run(now - 1000, channelB);
    const created = enqueueDueCaptures(db.sqlite, now);
    assert.equal(created.length, 1);
    const queued = db.sqlite.prepare(`SELECT payload FROM jobs WHERE status = 'queued'`).all() as { payload: string }[];
    assert.equal(queued.length, 1);
    assert.match(queued[0]!.payload, new RegExp(channelB));
  } finally { db.close(); }
});

test('JOB-04 a second refresh returns the active job', () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId: channelA });
    const first = refreshChannel(db.sqlite, channelA);
    const second = refreshChannel(db.sqlite, channelA);
    assert.equal(first.jobId, second.jobId);
    assert.equal(second.created, false);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM jobs`).get() as { count: number }).count, 1);
  } finally { db.close(); }
});
