import { EngineError, type ChannelCapture, type ContentKind } from '../types.js';
import { parsePublicCounter, resolutionFor } from '../metrics/parse.js';
import { observationInstants } from '../metrics/windows.js';

export const YOUTUBE_API_RETENTION_DAYS = 30;
const CHANNEL_ID = /^UC[\w-]{22}$/;

export function youtubeDataApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.YOUTUBE_API_KEY) && env.YOUTUBE_API_STORAGE_ACK === '30-days';
}

type FetchLike = typeof fetch;

function exact(text: string | null | undefined): { metric: { value: number | null; precision: 'exact' | 'unknown' }; resolution: number | null } {
  if (text == null || text.trim() === '') return { metric: { value: null, precision: 'unknown' }, resolution: null };
  if (!/^\d+$/.test(text)) {
    const parsed = parsePublicCounter(text);
    return { metric: { value: parsed.value, precision: parsed.precision === 'exact' ? 'exact' : 'unknown' }, resolution: resolutionFor(text, parsed) };
  }
  return { metric: { value: Number(text), precision: 'exact' }, resolution: 0 };
}

function isoDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(value);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function kindOf(item: { snippet?: { liveBroadcastContent?: string }; contentDetails?: { duration?: string } }): ContentKind {
  if (item.snippet?.liveBroadcastContent === 'live') return 'live';
  const seconds = isoDurationSeconds(item.contentDetails?.duration);
  if (seconds != null && seconds > 60 && item.snippet?.liveBroadcastContent !== 'live') return 'long';
  return 'unknown';
}

async function apiGet(fetcher: FetchLike, url: URL, key: string): Promise<any> {
  url.searchParams.set('key', key);
  let response: Response;
  try { response = await fetcher(url); }
  catch { throw new EngineError('UPSTREAM', 'No se pudo conectar con YouTube Data API.'); }
  const retryAfter = response.headers.get('retry-after');
  const retryMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
  const body = await response.json().catch(() => null);
  if (response.status === 400) throw new EngineError('INVALID', 'YouTube Data API rechazó el identificador.');
  if (response.status === 403 || response.status === 429) {
    const reason = body?.error?.errors?.[0]?.reason ?? '';
    if (/quota|rate/i.test(reason)) throw new EngineError('RATE_LIMIT', 'Cuota o límite de YouTube Data API.', retryMs);
    throw new EngineError('RESTRICTED', 'YouTube Data API denegó la consulta.', retryMs);
  }
  if (!response.ok) throw new EngineError('UPSTREAM', 'YouTube Data API devolvió un error.', retryMs);
  return body;
}

export async function captureYouTubeDataApi(channelIds: string[], fetcher: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<ChannelCapture[]> {
  if (!youtubeDataApiEnabled(env)) throw new EngineError('INVALID', 'YouTube Data API sigue desactivada. Confirma la política de almacenamiento vigente y define YOUTUBE_API_STORAGE_ACK=30-days junto con la clave.');
  const key = env.YOUTUBE_API_KEY as string;
  const ids = [...new Set(channelIds)];
  if (!ids.length || ids.some(id => !CHANNEL_ID.test(id))) throw new EngineError('INVALID', 'ID de canal inválido.');
  if (ids.length > 50) throw new EngineError('INVALID', 'Agrupa como máximo 50 canales por consulta.');
  const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelsUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
  channelsUrl.searchParams.set('id', ids.join(','));
  const channels = await apiGet(fetcher, channelsUrl, key);
  const items = Array.isArray(channels?.items) ? channels.items : [];
  if (!items.length) throw new EngineError('NO_DATA', 'YouTube Data API no devolvió esos canales.');
  const captures: ChannelCapture[] = [];
  for (const item of items) {
    const channelId = String(item.id ?? '');
    const uploads = item.contentDetails?.relatedPlaylists?.uploads as string | undefined;
    const statistics = item.statistics ?? {};
    const subscribers = statistics.hiddenSubscriberCount ? { metric: { value: null, precision: 'unknown' as const }, resolution: null } : exact(statistics.subscriberCount);
    const totalViews = exact(statistics.viewCount);
    const videoCount = exact(statistics.videoCount);
    const videoItems: ChannelCapture['videos'] = [];
    if (uploads) {
      const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      playlistUrl.searchParams.set('part', 'contentDetails');
      playlistUrl.searchParams.set('playlistId', uploads);
      playlistUrl.searchParams.set('maxResults', '25');
      const playlist = await apiGet(fetcher, playlistUrl, key);
      const videoIds = (playlist?.items ?? []).map((entry: any) => entry.contentDetails?.videoId).filter((id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id));
      for (let offset = 0; offset < videoIds.length; offset += 50) {
        const group = videoIds.slice(offset, offset + 50);
        const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
        videosUrl.searchParams.set('id', group.join(','));
        const videos = await apiGet(fetcher, videosUrl, key);
        for (const video of videos?.items ?? []) {
          const views = exact(video.statistics?.viewCount);
          const publishedAt = typeof video.snippet?.publishedAt === 'string' ? video.snippet.publishedAt : null;
          videoItems.push({
            id: video.id,
            title: video.snippet?.title || 'Sin título',
            views: views.metric,
            viewsResolution: views.resolution,
            publishedAt,
            publishedText: null,
            contentKind: kindOf(video),
          });
        }
      }
    }
    const fetchedAt = now.toISOString();
    captures.push({
      provider: 'youtube-data-api',
      channelId,
      title: item.snippet?.title || channelId,
      ...observationInstants({ fromCache: false, observedAt: null, fetchedAt }),
      fromCache: false,
      subscribers: subscribers.metric,
      subscribersResolution: subscribers.resolution,
      totalViews: totalViews.metric,
      totalViewsResolution: totalViews.resolution,
      videoCount: videoCount.metric,
      videoCountResolution: videoCount.resolution,
      videos: videoItems,
    });
  }
  return captures;
}
