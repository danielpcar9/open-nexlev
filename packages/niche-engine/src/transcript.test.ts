import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVideoTranscript, parseVideoId, parseJson3, TranscriptError } from './transcript.js';

test('accepts video IDs and supported YouTube URLs, rejects foreign hosts and partial IDs', () => {
  for (const input of ['dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=10', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=test', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ']) assert.equal(parseVideoId(input), 'dQw4w9WgXcQ');
  for (const input of ['https://evil.com/watch?v=dQw4w9WgXcQ','dQw4w9WgXcQextra','hello','https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ']) assert.throws(() => parseVideoId(input), TranscriptError);
});
test('JSON3 preserves Unicode, timing and word boundaries; ignores window events', () => {
  assert.deepEqual(parseJson3({ events: [{ tStartMs: 0 }, { tStartMs: 65000, dDurationMs: 2000, segs: [{utf8:'Hola '}, {utf8:'mundo\nqué tal'}] }] }), [{ startMs: 65000, endMs: 67000, timestamp: '01:05', text: 'Hola mundo qué tal' }]);
});
const player = { playabilityStatus: { status: 'OK' }, videoDetails: {title:'Fixture'}, captions: {playerCaptionsTracklistRenderer: {captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ',languageCode:'en'}]}} };
function fake(responses: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify(responses.shift()), {status:200})) as typeof fetch;
}
test('fetches metadata and captions without parsing unrelated YouTube UI', async () => {
  const result = await fetchVideoTranscript('dQw4w9WgXcQ',fake([player,{events:[{tStartMs:0,dDurationMs:1200,segs:[{utf8:'A test transcript'}]}]}]));
  assert.equal(result.wordCount,3); assert.equal(result.segments[0].endMs,1200);
});
test('distinguishes no captions, unavailable video, empty response and HTTP failures', async () => {
  for(const [fetcher,code] of [
    [fake([{playabilityStatus:{status:'OK'}}]),'NO_CAPTIONS'],
    [fake([{playabilityStatus:{status:'LOGIN_REQUIRED'}}]),'VIDEO_UNAVAILABLE'],
    [fake([player,{events:[]}]),'UPSTREAM_ERROR'],
    [(async()=>new Response('',{status:429})) as typeof fetch,'UPSTREAM_ERROR'],
  ] as const) await assert.rejects(fetchVideoTranscript('dQw4w9WgXcQ',fetcher), (err: unknown) => err instanceof TranscriptError && err.code===code);
});
test('never fetches arbitrary caption hosts', async () => {
  let calls=0;
  const fetcher = (async()=>{calls++;return new Response(JSON.stringify({...player,captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'http://127.0.0.1/private'}]}}}));}) as typeof fetch;
  await assert.rejects(fetchVideoTranscript('dQw4w9WgXcQ',fetcher),TranscriptError);assert.equal(calls,1);
});
