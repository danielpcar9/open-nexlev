import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store';
import type { NicheChannelResult } from '@open-nexlev/niche-engine';
const channel: NicheChannelResult = { channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',title:'Saved',handle:'@test',subscribers:1200,medianViews:8000,subscriberToViewRatio:6.67,estimatedMonthlyRevenueUsd:{low:100,high:200},channelUrl:'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa',topOutliers:[{id:'abcdefghijk',title:'Test video',views:24000,publishedText:'1 day ago',outlierScore:3,viewsToSubsRatio:20,url:'https://www.youtube.com/watch?v=abcdefghijk',thumbnailUrl:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}] };
test('SQLite survives reopen, imports idempotently, updates snapshots and deletes', () => {
 const folder=mkdtempSync(join(tmpdir(),'nexlev-db-'));const path=join(folder,'test.db');let store=openStore(path);
 try {
  store.save(channel);store.close();store=openStore(path);
  assert.deepEqual(store.list(),[channel]);
  store.import([{...channel,title:'Old browser snapshot'},channel]);assert.equal(store.list()[0].title,'Saved');
  store.save({...channel,title:'Updated',topOutliers:[]});assert.equal(store.list().length,1);assert.equal(store.list()[0].title,'Updated');assert.deepEqual(store.list()[0].topOutliers,[]);
  store.remove(channel.channelId);store.close();store=openStore(path);assert.deepEqual(store.list(),[]);
 } finally {store.close();rmSync(folder,{recursive:true,force:true});}
});
