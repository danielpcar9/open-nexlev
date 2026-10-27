import { test } from 'node:test';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { EngineError, type ChannelCapture } from '@open-nexlev/niche-engine';
import { openDatabase } from '../db/connection';
import { tempDatabase } from '../db/test-utils';
import { followChannel } from '../services/tracking';
import { runWorker } from '../worker/index';

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const observedAt = '2026-10-23T00:00:00.000Z';
const capture: ChannelCapture = {
  provider: 'innertube', channelId, title: 'Fixture', observedAt, fetchedAt: observedAt, fromCache: false,
  subscribers: { value: 10, precision: 'exact' }, subscribersResolution: 0,
  totalViews: { value: 1000, precision: 'exact' }, totalViewsResolution: 0,
  videoCount: { value: 1, precision: 'exact' }, videoCountResolution: 0,
  videos: [{ id: 'abcdefghijk', title: 'Fixture', views: { value: 100, precision: 'exact' }, viewsResolution: 0, publishedAt: null, publishedText: 'hace un día', contentKind: 'long' }],
};

test('restarting the worker keeps the queue and does not duplicate the observation', async () => {
  const db = tempDatabase();
  try {
    followChannel(db.sqlite, { channelId }, Date.now() - 1000);
    let calls = 0;
    let stop = false;
    const running = runWorker({
      sqlite: db.sqlite,
      providerFor: async () => ({ capture: async () => {
        calls += 1;
        if (calls === 1) throw new EngineError('TIMEOUT', 'YouTube no respondió a tiempo.', 30);
        return capture;
      } }),
      searcher: async () => ({ ok: false, partial: false, error: 'no usado', channels: [] }),
      shouldStop: () => stop,
      pollMs: 20,
    });
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const job = db.sqlite.prepare(`SELECT status FROM jobs LIMIT 1`).get() as { status: string } | undefined;
      if (job?.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    stop = true;
    await running;
    assert.equal((db.sqlite.prepare(`SELECT status FROM jobs`).get() as { status: string }).status, 'succeeded');
    db.sqlite.close();
    const reopened = openDatabase(db.path);
    assert.equal((reopened.prepare(`SELECT COUNT(*) AS count FROM channel_observations`).get() as { count: number }).count, 1);
    assert.equal((reopened.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'succeeded'`).get() as { count: number }).count, 1);
    reopened.close();
  } finally {
    rmSync(db.folder, { recursive: true, force: true });
  }
});

