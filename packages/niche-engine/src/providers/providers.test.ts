import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureInnertube, classifyInnertubeVideo } from './innertube.js';
import { captureYouTubeDataApi, youtubeDataApiEnabled } from './youtube-data.js';

// Fixtures inventados. No son resultados de YouTube.
test('short duration alone is unknown and an explicit Shorts overlay is short', () => {
  assert.equal(classifyInnertubeVideo({ duration: { text: '0:45' } }), 'unknown');
  assert.equal(classifyInnertubeVideo({ duration: { text: '12:03' } }), 'long');
  assert.equal(classifyInnertubeVideo({ thumbnail_overlays: [{ style: 'SHORTS' }], duration: { text: '0:20' } }), 'short');
});

test('innertube keeps a null channel total instead of summing the sample', async () => {
  const channel = {
    metadata: { title: 'Fixture' },
    header: { subscribers: { text: '1.2K subscribers' } },
    async getAbout() { return { view_count: null, video_count: '10 videos' }; },
    async getVideos() { return { videos: [{ id: 'abcdefghijk', title: { text: 'Uno' }, view_count: { text: '10 views' }, duration: { text: '4:00' }, published: { text: '1 month ago' } }, { id: 'bbcdefghijk', title: { text: 'Dos' }, view_count: { text: '20 views' }, duration: { text: '5:00' } }] }; },
  };
  const capture = await captureInnertube({ getChannel: async () => channel }, 'UCaaaaaaaaaaaaaaaaaaaaaa', new Date('2026-10-23T00:00:00.000Z'));
  assert.equal(capture.totalViews.value, null);
  assert.equal(capture.subscribers.precision, 'rounded');
  assert.equal(capture.videos[0]?.publishedAt, null);
  assert.equal(capture.videos[0]?.contentKind, 'long');
  assert.notEqual(capture.totalViews.value, 30);
});

test('official API stays disabled until storage retention is acknowledged', async () => {
  assert.equal(youtubeDataApiEnabled({ YOUTUBE_API_KEY: 'secret', YOUTUBE_API_STORAGE_ACK: '' }), false);
  await assert.rejects(() => captureYouTubeDataApi(['UCaaaaaaaaaaaaaaaaaaaaaa'], fetch, { YOUTUBE_API_KEY: 'secret' }), /desactivada/);
});

test('official API groups channel ids and does not leak the key in errors', async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.get('id') ?? url.searchParams.get('playlistId')}`);
    assert.equal(url.searchParams.get('key'), 'secret-key');
    if (url.pathname.endsWith('/channels')) {
      return new Response(JSON.stringify({ items: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', snippet: { title: 'A' }, statistics: { viewCount: '10', subscriberCount: '2', videoCount: '1' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }, { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', snippet: { title: 'B' }, statistics: { hiddenSubscriberCount: true, viewCount: '4', videoCount: '1' }, contentDetails: { relatedPlaylists: {} } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;
  const captures = await captureYouTubeDataApi(['UCaaaaaaaaaaaaaaaaaaaaaa', 'UCbbbbbbbbbbbbbbbbbbbbbb'], fetcher, { YOUTUBE_API_KEY: 'secret-key', YOUTUBE_API_STORAGE_ACK: '30-days' });
  assert.equal(calls[0], '/youtube/v3/channels?UCaaaaaaaaaaaaaaaaaaaaaa,UCbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(captures[0]?.totalViews.precision, 'exact');
  assert.equal(captures[1]?.subscribers.value, null);
  const limited = (async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403, headers: { 'retry-after': '9' } })) as typeof fetch;
  await assert.rejects(() => captureYouTubeDataApi(['UCaaaaaaaaaaaaaaaaaaaaaa'], limited, { YOUTUBE_API_KEY: 'secret-key', YOUTUBE_API_STORAGE_ACK: '30-days' }), (error: unknown) => {
    const engine = error as { code?: string; retryAfterMs?: number; message?: string };
    return engine.code === 'RATE_LIMIT' && engine.retryAfterMs === 9000 && !engine.message?.includes('secret-key');
  });
});
