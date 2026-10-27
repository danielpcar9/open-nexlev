import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Innertube, UniversalCache } from 'youtubei.js';
import { captureInnertube, captureYouTubeDataApi, EngineError, youtubeDataApiEnabled, type ChannelCapture, type ProviderId } from '@open-nexlev/niche-engine';
import { openDatabase } from '../db/connection';
import { executeCaptureJob, type CaptureProvider } from '../services/capture';
import { beat, claimJob, enqueueDueCaptures, type JobRow } from '../services/jobs';
import { executeResearchJob, type ResearchSearcher } from '../services/research';
import { applyRetention } from '../services/retention';
import type Database from 'better-sqlite3';

const LEASE_MS = 60_000;

function concurrency(): number {
  const value = Number(process.env.PROVIDER_CONCURRENCY ?? 2);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 2;
}

export async function runWorker(options: {
  sqlite: Database.Database;
  owner?: string;
  providerFor: (provider: ProviderId) => Promise<CaptureProvider>;
  searcher: ResearchSearcher;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}): Promise<void> {
  const owner = options.owner ?? `worker-${process.pid}`;
  const shouldStop = options.shouldStop ?? (() => false);
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  const inflight: Promise<void>[] = [];
  const limit = concurrency();
  while (!shouldStop()) {
    beat(options.sqlite, owner);
    enqueueDueCaptures(options.sqlite);
    applyRetention(options.sqlite);
    while (inflight.length < limit && !shouldStop()) {
      const job = claimJob(options.sqlite, owner, LEASE_MS);
      if (!job) break;
      let task: Promise<void>;
      task = handle(options.sqlite, job, options.providerFor, options.searcher).finally(() => {
        const index = inflight.indexOf(task);
        if (index >= 0) inflight.splice(index, 1);
      });
      inflight.push(task);
    }
    if (shouldStop()) break;
    await sleep(options.pollMs ?? 1000);
  }
  await Promise.allSettled(inflight);
}

async function handle(sqlite: Database.Database, job: JobRow, providerFor: (provider: ProviderId) => Promise<CaptureProvider>, searcher: ResearchSearcher): Promise<void> {
  try {
    if (job.type === 'capture') {
      const payload = JSON.parse(job.payload) as { channelId: string };
      const tracked = sqlite.prepare(`SELECT provider FROM tracked_channels WHERE channel_id = ?`).get(payload.channelId) as { provider: ProviderId } | undefined;
      const provider = await providerFor(tracked?.provider ?? 'innertube');
      await executeCaptureJob(sqlite, job, provider);
      return;
    }
    if (job.type === 'research_run') {
      await executeResearchJob(sqlite, job, searcher);
      return;
    }
    sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, error = 'Tipo de trabajo desconocido' WHERE id = ?`).run(Date.now(), job.id);
  } catch (error) {
    const code = error instanceof EngineError ? error.code : 'UPSTREAM';
    sqlite.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'running'`).run(Date.now(), code, job.id);
  }
}

let innertube: Innertube | null = null;
async function providerFor(provider: ProviderId): Promise<CaptureProvider> {
  if (provider === 'youtube-data-api') {
    if (!youtubeDataApiEnabled()) throw new EngineError('INVALID', 'YouTube Data API no está activada.');
    return { async capture(channelId: string): Promise<ChannelCapture> {
      const [capture] = await captureYouTubeDataApi([channelId]);
      if (!capture) throw new EngineError('NO_DATA', 'YouTube Data API no devolvió el canal.');
      return capture;
    } };
  }
  innertube ??= await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true, lang: 'en', location: 'US' });
  return { capture: channelId => captureInnertube(innertube as Innertube, channelId) };
}

const searcher: ResearchSearcher = async ({ query, filters, maxResults }) => {
  innertube ??= await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true, lang: 'en', location: 'US' });
  try {
    const search = await innertube.search(query, { type: 'video', upload_date: filters.uploadDate === 'all' ? undefined : filters.uploadDate as 'month' });
    const ids: string[] = [];
    for (const item of search.videos as Array<{ author?: { id?: string } }>) {
      if (item.author?.id && !ids.includes(item.author.id) && ids.length < maxResults) ids.push(item.author.id);
    }
    const channels = [];
    for (const id of ids) {
      try {
        const capture = await captureInnertube(innertube, id);
        channels.push({ channelId: capture.channelId, title: capture.title, subscribers: capture.subscribers.value, videos: capture.videos.map(video => ({ id: video.id, title: video.title, views: video.views.value, contentKind: video.contentKind })) });
      } catch (error) {
        return { ok: false, partial: channels.length > 0, error: error instanceof EngineError ? error.code : 'UPSTREAM', channels };
      }
    }
    return { ok: true, partial: false, channels };
  } catch (error) {
    return { ok: false, partial: false, error: error instanceof EngineError ? error.code : 'UPSTREAM', channels: [] };
  }
};

async function main(): Promise<void> {
  const sqlite = openDatabase();
  let stop = false;
  const shutdown = () => { stop = true; };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log('Open-NexLev worker activo. Las capturas automáticas requieren este proceso.');
  await runWorker({ sqlite, providerFor, searcher, shouldStop: () => stop });
  sqlite.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.name : 'worker');
    process.exitCode = 1;
  });
}
