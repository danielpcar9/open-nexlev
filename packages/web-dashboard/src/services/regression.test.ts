import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDatabase } from '../db/test-utils';
import { openStore } from '../db/store';
import type { NicheChannelResult } from '@open-nexlev/niche-engine';

const channel: NicheChannelResult = {
  channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Saved',
  handle: '@test',
  subscribers: 1200,
  medianViews: 8000,
  subscriberToViewRatio: 6.67,
  estimatedMonthlyRevenueUsd: { low: 100, high: 200 },
  channelUrl: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa',
  topOutliers: [],
};

test('REG-01 a Swipe File save does not follow the channel or enqueue a capture', () => {
  const db = tempDatabase();
  try {
    const store = openStore(db.path);
    store.save(channel);
    assert.equal(store.list()[0]?.title, 'Saved');
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM tracked_channels`).get() as { count: number }).count, 0);
    assert.equal((db.sqlite.prepare(`SELECT COUNT(*) AS count FROM jobs`).get() as { count: number }).count, 0);
    store.close();
  } finally { db.close(); }
});
