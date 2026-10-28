import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type ChannelCapture } from '@open-nexlev/niche-engine';
import { tempDatabase } from '../db/test-utils';
import { executeCaptureJob, nextPeriodicCaptureAt } from './capture';
import { claimJob, enqueueDueCaptures, enqueueJob, getJob, jobOwnership, renewLease, type LeaseControl } from './jobs';
import { cancelJob } from './jobs';
import { createProject, executeResearchJob, getProject, patchMember, patchProject, scoreProject } from './research';
import { followChannel, refreshChannel } from './tracking';

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const otherId = 'UCbbbbbbbbbbbbbbbbbbbbbb';

function shot(id = channelId): ChannelCapture {
  return {
    provider: 'innertube', channelId: id, title: 'Fixture', observedAt: '2026-10-23T00:00:00.000Z', fetchedAt: '2026-10-23T00:00:00.000Z', fromCache: false,
    subscribers: { value: 10, precision: 'exact' }, subscribersResolution: 0,
    totalViews: { value: 1000, precision: 'exact' }, totalViewsResolution: 0,
    videoCount: { value: 1, precision: 'exact' }, videoCountResolution: 0,
    videos: [{ id: 'abcdefghijk', title: 'Viejo titulo unico', views: { value: 100, precision: 'exact' }, viewsResolution: 0, publishedAt: null, publishedText: 'hace un día', contentKind: 'long' }],
  };
}

function fakeClock(start = 0) {
  let t = start;
  const timers: { fn: () => void; every: number; next: number }[] = [];
  return {
    now: () => t,
    advance(ms: number) {
      const target = t + ms;
      while (timers.some(timer => timer.next <= target)) {
        const next = timers.filter(timer => timer.next <= target).sort((a, b) => a.next - b.next)[0];
        if (!next) break;
        t = next.next;
        next.next += next.every;
        next.fn();
      }
      t = target;
    },
    control(): LeaseControl {
      return {
        leaseMs: 60_000,
        now: () => t,
        setInterval: (fn, every) => {
          const timer = { fn, every, next: t + every };
          timers.push(timer);
          return timer;
        },
        clearInterval: handle => {
          const index = timers.indexOf(handle as typeof timers[number]);
          if (index >= 0) timers.splice(index, 1);
        },
      };
    },
  };
}

test('a previous owner cannot finish a job stolen after the lease expires', async () => {
  const db = tempDatabase();
  const clock = fakeClock(0);
  try {
    followChannel(db.sqlite, { channelId }, 0);
    const queued = enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, now: 0 });
    const first = claimJob(db.sqlite, 'worker', 60_000, 0);
    assert.equal(first?.id, queued.job.id);
    clock.advance(60_001);
    const second = claimJob(db.sqlite, 'worker', 60_000, clock.now());
    assert.equal(second?.id, first?.id);
    assert.notEqual(second?.lease_token, first?.lease_token);
    await executeCaptureJob(db.sqlite, first!, { capture: async () => shot() }, clock.control());
    const job = getJob(db.sqlite, first!.id);
    assert.equal(job?.status, 'running');
    assert.equal(job?.lease_token, second?.lease_token);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 0);
    await executeCaptureJob(db.sqlite, second!, { capture: async () => shot() }, clock.control());
    assert.equal(getJob(db.sqlite, first!.id)?.status, 'succeeded');
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test('renewing the claim token keeps one owner through a task longer than 60s', async () => {
  const db = tempDatabase();
  const clock = fakeClock(0);
  try {
    followChannel(db.sqlite, { channelId }, 0);
    enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, now: 0 });
    const first = claimJob(db.sqlite, 'worker', 60_000, 0);
    assert.ok(first);
    let stolen: string | null = 'unset';
    await executeCaptureJob(db.sqlite, first, { capture: async () => {
      clock.advance(70_000);
      stolen = claimJob(db.sqlite, 'worker', 60_000, clock.now())?.id ?? null;
      return shot();
    } }, clock.control());
    assert.equal(stolen, null);
    assert.equal(getJob(db.sqlite, first.id)?.status, 'succeeded');
    assert.equal(getJob(db.sqlite, first.id)?.lease_owner, null);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test('a terminal failure does not enqueue another capture on the next ticks', async () => {
  const db = tempDatabase();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  try {
    followChannel(db.sqlite, { channelId }, now);
    assert.equal(enqueueDueCaptures(db.sqlite, now).length, 1);
    const claimed = claimJob(db.sqlite, 'worker', 60_000, now);
    assert.ok(claimed);
    await executeCaptureJob(db.sqlite, claimed, { capture: async () => { throw new EngineError('RESTRICTED', 'no'); } }, { now: () => now, leaseMs: 60_000 });
    assert.equal(getJob(db.sqlite, claimed.id)?.status, 'failed');
    for (let tick = 0; tick < 5; tick += 1) assert.equal(enqueueDueCaptures(db.sqlite, now + tick).length, 0);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM jobs`).get() as { count: number }).count, 1);
    const due = (db.sqlite.prepare(`SELECT next_due_at FROM tracked_channels`).get() as { next_due_at: number }).next_due_at;
    assert.ok(due > now + 60 * 60 * 1000);
    const manual = refreshChannel(db.sqlite, channelId, now + 1);
    assert.equal(manual.created, true);
    assert.notEqual(manual.jobId, claimed.id);
  } finally { db.close(); }
});

test('the third transient failure waits for the next periodic capture', async () => {
  const db = tempDatabase();
  let cursor = Date.parse('2026-10-23T00:00:00.000Z');
  try {
    followChannel(db.sqlite, { channelId }, cursor);
    assert.equal(enqueueDueCaptures(db.sqlite, cursor).length, 1);
    let jobId = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = claimJob(db.sqlite, 'worker', 60_000, cursor);
      assert.ok(claimed);
      jobId = claimed.id;
      await executeCaptureJob(db.sqlite, claimed, { capture: async () => { throw new EngineError('TIMEOUT', 'tarde', 1_000); } }, { now: () => cursor, leaseMs: 60_000 });
      const row = getJob(db.sqlite, jobId);
      if (attempt < 2) {
        assert.equal(row?.status, 'queued');
        assert.equal(enqueueDueCaptures(db.sqlite, cursor).length, 0);
        cursor = row!.next_attempt_at;
      }
    }
    assert.equal(getJob(db.sqlite, jobId)?.status, 'failed');
    assert.equal(enqueueDueCaptures(db.sqlite, cursor).length, 0);
    const due = (db.sqlite.prepare(`SELECT next_due_at FROM tracked_channels`).get() as { next_due_at: number }).next_due_at;
    assert.equal(enqueueDueCaptures(db.sqlite, due).length, 1);
  } finally { db.close(); }
});

test('cancel plus timeout, success, or a dead worker ends cancelled and a later refresh is new', async () => {
  const db = tempDatabase();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  try {
    followChannel(db.sqlite, { channelId }, now);
    const timeoutJob = enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, now }).job;
    const timeoutClaim = claimJob(db.sqlite, 'worker', 60_000, now);
    assert.ok(timeoutClaim);
    await executeCaptureJob(db.sqlite, timeoutClaim, { capture: async () => { cancelJob(db.sqlite, timeoutClaim.id, now); throw new EngineError('TIMEOUT', 'tarde', 30_000); } }, { now: () => now, leaseMs: 60_000 });
    assert.equal(getJob(db.sqlite, timeoutJob.id)?.status, 'cancelled');
    const again = refreshChannel(db.sqlite, channelId, now + 1);
    assert.equal(again.created, true);
    const successClaim = claimJob(db.sqlite, 'worker', 60_000, now + 1);
    assert.ok(successClaim);
    await executeCaptureJob(db.sqlite, successClaim, { capture: async () => { cancelJob(db.sqlite, successClaim.id, now + 1); return shot(); } }, { now: () => now + 1, leaseMs: 60_000 });
    assert.equal(getJob(db.sqlite, successClaim.id)?.status, 'cancelled');
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 0);
    const dead = refreshChannel(db.sqlite, channelId, now + 2);
    const deadClaim = claimJob(db.sqlite, 'worker', 60_000, now + 2);
    assert.equal(deadClaim?.id, dead.jobId);
    cancelJob(db.sqlite, deadClaim!.id, now + 2);
    db.sqlite.prepare(`UPDATE jobs SET lease_until = 0 WHERE id = ?`).run(deadClaim!.id);
    assert.equal(claimJob(db.sqlite, 'worker', 60_000, now + 3), null);
    assert.equal(getJob(db.sqlite, deadClaim!.id)?.status, 'cancelled');
    assert.equal(getJob(db.sqlite, deadClaim!.id)?.lease_token, null);
    const restarted = refreshChannel(db.sqlite, channelId, now + 4);
    assert.equal(restarted.created, true);
    assert.notEqual(restarted.jobId, deadClaim!.id);
  } finally { db.close(); }
});

test('a completed empty research run drops the previous sample and keeps manual notes', async () => {
  const db = tempDatabase();
  try {
    const project = createProject(db.sqlite, { name: 'Fixture', referenceQueries: ['old'], competitionQueries: [] });
    const first = enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    const claimed = claimJob(db.sqlite, 'worker', 60_000);
    assert.ok(claimed);
    await executeResearchJob(db.sqlite, claimed, async () => ({ ok: true, partial: false, channels: [{ channelId, title: 'Viejo', subscribers: 10, videos: [{ id: 'abcdefghijk', title: 'Viejo titulo unico', views: 100, contentKind: 'long' }] }] }));
    patchMember(db.sqlite, project.id, channelId, { role: 'indirect_competitor', notes: 'nota manual', tags: ['guardar'] });
    const edited = patchProject(db.sqlite, project.id, { queries: [{ role: 'reference', query: 'new' }] });
    assert.equal(edited.sample, 'stale');
    assert.equal(edited.members.length, 0);
    assert.equal(edited.score, null);
    assert.equal(edited.retained[0]?.notes, 'nota manual');
    assert.equal(edited.patterns.length, 0);
    const second = enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    assert.notEqual(second.job.id, first.job.id);
    const rerun = claimJob(db.sqlite, 'worker', 60_000);
    assert.ok(rerun);
    await executeResearchJob(db.sqlite, rerun, async () => ({ ok: true, partial: false, channels: [] }));
    const done = getProject(db.sqlite, project.id);
    assert.equal(done.sample, 'current');
    assert.equal(done.members.length, 0);
    assert.equal(done.patterns.length, 0);
    const stored = db.sqlite.prepare(`SELECT notes, role, in_sample, tags FROM research_members WHERE channel_id = ?`).get(channelId) as { notes: string; role: string; in_sample: number; tags: string };
    assert.equal(stored.notes, 'nota manual');
    assert.equal(stored.role, 'indirect_competitor');
    assert.equal(stored.in_sample, 0);
    assert.equal(stored.tags, '["guardar"]');
    const score = scoreProject(db.sqlite, project.id);
    assert.equal(score.components.traction.absolute, null);
    assert.equal(done.queries[0]?.query, 'new');
    assert.equal(done.queries[0]?.status, 'complete');
  } finally { db.close(); }
});

test('a partial research run stays labeled partial', async () => {
  const db = tempDatabase();
  try {
    const project = createProject(db.sqlite, { name: 'Fixture', referenceQueries: ['referentes'], competitionQueries: ['competencia'] });
    enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    const claimed = claimJob(db.sqlite, 'worker', 60_000);
    assert.ok(claimed);
    await executeResearchJob(db.sqlite, claimed, async input => input.query.includes('competencia')
      ? { ok: false, partial: false, error: 'UPSTREAM', channels: [] }
      : { ok: true, partial: false, channels: [{ channelId: otherId, title: 'Nuevo', subscribers: 4, videos: [] }] });
    const viewed = getProject(db.sqlite, project.id);
    assert.equal(viewed.sample, 'partial');
    assert.match(viewed.note, /parcial/i);
    assert.equal(viewed.members.length, 1);
    assert.equal(viewed.queries.find(query => query.query === 'competencia')?.status, 'failed');
  } finally { db.close(); }
});

test('a clock jump past the lease cannot renew the same token', () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId }, 0);
    enqueueJob(db.sqlite, { type: 'capture', payload: { channelId }, dedupeKey: `capture:${channelId}`, now: 0 });
    const first = claimJob(db.sqlite, 'worker', 60_000, 0);
    assert.ok(first?.lease_token);
    assert.equal(jobOwnership(db.sqlite, first.id, first.lease_token, 60_001), 'lost');
    assert.equal(renewLease(db.sqlite, first.id, first.lease_token, 60_000, 60_001), false);
    assert.equal(jobOwnership(db.sqlite, first.id, first.lease_token, 60_001), 'lost');
    const second = claimJob(db.sqlite, 'worker', 60_000, 60_001);
    assert.equal(second?.id, first.id);
    assert.notEqual(second?.lease_token, first.lease_token);
    assert.equal(renewLease(db.sqlite, first.id, first.lease_token!, 60_000, 60_001), false);
  } finally { db.close(); }
});

test('Retry-After longer than seven days is not clipped by the local cap', () => {
  const day = 86_400_000;
  assert.equal(nextPeriodicCaptureAt(0, 6, 3, 10 * day), 10 * day);
  assert.equal(nextPeriodicCaptureAt(0, 6, 1, 60_000), 6 * 3_600_000);
  assert.equal(nextPeriodicCaptureAt(0, 1, 1, 2 * day), 2 * day);
});

test('a search that finishes after the queries change does not republish its channels', async () => {
  const db = tempDatabase();
  try {
    const project = createProject(db.sqlite, { name: 'Fixture', referenceQueries: ['old'], competitionQueries: [] });
    enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    const first = claimJob(db.sqlite, 'worker', 60_000);
    assert.ok(first);
    await executeResearchJob(db.sqlite, first, async () => ({ ok: true, partial: false, channels: [{ channelId, title: 'OLD', subscribers: 10, videos: [{ id: 'abcdefghijk', title: 'Viejo titulo unico', views: 100, contentKind: 'long' }] }] }));
    patchMember(db.sqlite, project.id, channelId, { notes: 'nota manual', tags: ['guardar'] });
    enqueueJob(db.sqlite, { type: 'research_run', payload: { projectId: project.id }, dedupeKey: `research:${project.id}` });
    const second = claimJob(db.sqlite, 'worker', 60_000);
    assert.ok(second);
    await executeResearchJob(db.sqlite, second, async () => {
      patchProject(db.sqlite, project.id, { queries: [{ role: 'reference', query: 'new' }] });
      return { ok: true, partial: false, channels: [{ channelId, title: 'OLD', subscribers: 10, videos: [{ id: 'abcdefghijk', title: 'Viejo titulo unico', views: 100, contentKind: 'long' }] }] };
    });
    const viewed = getProject(db.sqlite, project.id);
    assert.equal(viewed.queries[0]?.query, 'new');
    assert.equal(viewed.members.length, 0);
    assert.equal(viewed.score, null);
    assert.equal(getJob(db.sqlite, second.id)?.status, 'cancelled');
    const stored = db.sqlite.prepare(`SELECT notes, tags, in_sample FROM research_members WHERE channel_id = ?`).get(channelId) as { notes: string; tags: string; in_sample: number };
    assert.equal(stored.notes, 'nota manual');
    assert.equal(stored.tags, '["guardar"]');
    assert.equal(stored.in_sample, 0);
  } finally { db.close(); }
});
