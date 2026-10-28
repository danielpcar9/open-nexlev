import { EngineError, type ChannelCapture, type ContentKind, type MetricValue } from '../types.js';
import { parsePublicCounter, resolutionFor } from '../metrics/parse.js';
import { observationInstants } from '../metrics/windows.js';

const CHANNEL_ID = /^UC[\w-]{22}$/;
type TextLike = { text?: string } | string | null | undefined;

function textOf(value: TextLike): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const text = value?.text?.trim();
  return text || null;
}

function metric(text: string | null): { metric: MetricValue; resolution: number | null } {
  const parsed = parsePublicCounter(text);
  return { metric: parsed, resolution: resolutionFor(text, parsed) };
}

export function mapUpstreamError(error: unknown): EngineError {
  const message = error instanceof Error ? error.message : '';
  if (error instanceof EngineError) return error;
  if (/timeout|aborted|timed out/i.test(message)) return new EngineError('TIMEOUT', 'YouTube no respondió a tiempo.');
  if (/\b429\b|rate.?limit|too many/i.test(message)) return new EngineError('RATE_LIMIT', 'YouTube limitó las solicitudes.');
  if (/unavailable|private|terminated|not found|404/i.test(message)) return new EngineError('RESTRICTED', 'El canal no está disponible públicamente.');
  return new EngineError('UPSTREAM', 'Fallo al consultar YouTube.');
}

function durationSeconds(text: string | null): number | null {
  if (!text || !/^\d{1,2}(:\d{2}){1,2}$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function classifyInnertubeVideo(video: { thumbnail_overlays?: unknown; badges?: unknown; duration?: TextLike; is_live?: boolean }): ContentKind {
  const blob = JSON.stringify({ overlays: video.thumbnail_overlays ?? null, badges: video.badges ?? null });
  const upper = blob.toUpperCase();
  if (upper.includes('SHORTS')) return 'short';
  if (video.is_live || upper.includes('LIVE NOW') || upper.includes('BADGE_STYLE_TYPE_LIVE_NOW')) return 'live';
  const embedded = blob.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? null;
  const seconds = durationSeconds(textOf(video.duration) ?? embedded);
  if (seconds != null && seconds > 60) return 'long';
  return 'unknown';
}

function publishedInstant(video: { published?: { text?: string; timestamp?: number | string } | string }): { publishedAt: string | null; publishedText: string | null } {
  const published = video.published;
  if (typeof published === 'string') return { publishedAt: null, publishedText: published };
  const relative = published?.text ?? null;
  const timestamp = published?.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return { publishedAt: new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000).toISOString(), publishedText: relative };
  if (typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp))) return { publishedAt: new Date(timestamp).toISOString(), publishedText: relative };
  return { publishedAt: null, publishedText: relative };
}

type CounterSource = { view_count?: unknown; video_count?: unknown; metadata?: CounterSource | null };

function counterText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && 'text' in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  }
  return null;
}

/** AboutChannel keeps counters on metadata; ChannelAboutFullMetadata keeps them on the node. */
export function readAboutCounters(about: unknown): { views: string | null; videos: string | null } {
  if (!about || typeof about !== 'object') return { views: null, videos: null };
  const node = about as CounterSource;
  const source = node.metadata && typeof node.metadata === 'object' ? node.metadata : node;
  return { views: counterText(source.view_count), videos: counterText(source.video_count) };
}

type InnertubeLike = { getChannel(id: string): Promise<any> };

export async function captureInnertube(yt: InnertubeLike, channelId: string, now = new Date()): Promise<ChannelCapture> {
  if (!CHANNEL_ID.test(channelId)) throw new EngineError('INVALID', 'ID de canal inválido.');
  let channel: any;
  try { channel = await yt.getChannel(channelId); }
  catch (error) { throw mapUpstreamError(error); }
  if (!channel) throw new EngineError('NO_DATA', 'YouTube no devolvió el canal.');
  const header = channel.header ?? {};
  const subscriberText = textOf(header.subscribers) || textOf(header.content?.metadata?.metadata_rows?.[1]?.metadata_parts?.[0]?.text) || null;
  const subscribers = metric(subscriberText);
  let total = metric(null);
  let videosCount = metric(null);
  try {
    const about = await channel.getAbout?.();
    const counters = readAboutCounters(about);
    if (counters.views) total = metric(counters.views);
    if (counters.videos) videosCount = metric(counters.videos);
  } catch (error) {
    if (error instanceof EngineError && error.code === 'TIMEOUT') throw error;
  }
  let rawVideos: any[] = [];
  try {
    const tab = await channel.getVideos?.();
    rawVideos = (tab?.videos ?? []) as any[];
  } catch (error) {
    if (error instanceof EngineError && (error.code === 'TIMEOUT' || error.code === 'RATE_LIMIT')) throw error;
  }
  const fetchedAt = now.toISOString();
  const instants = observationInstants({ fromCache: false, observedAt: null, fetchedAt });
  const videos = rawVideos.slice(0, 25).flatMap(video => {
    const parts = (video.metadata?.metadata?.metadata_rows ?? []).flatMap((row: any) => row.metadata_parts ?? []).map((part: any) => part.text?.text ?? '');
    const id = String(video.id || video.content_id || '');
    if (!/^[\w-]{11}$/.test(id)) return [];
    const viewText = textOf(video.view_count) || textOf(video.short_view_count) || parts.find((text: string) => /views|vistas/i.test(text)) || null;
    const views = metric(viewText);
    const published = publishedInstant(video);
    if (!published.publishedText) published.publishedText = parts.find((text: string) => /ago|hace/i.test(text)) ?? null;
    return [{
      id,
      title: textOf(video.title) || textOf(video.metadata?.title) || 'Sin título',
      views: views.metric,
      viewsResolution: views.resolution,
      publishedAt: published.publishedAt,
      publishedText: published.publishedText,
      contentKind: classifyInnertubeVideo(video),
    }];
  });
  return {
    provider: 'innertube',
    channelId,
    title: channel.metadata?.title || header.author?.name || channelId,
    ...instants,
    fromCache: false,
    subscribers: subscribers.metric,
    subscribersResolution: subscribers.resolution,
    totalViews: total.metric,
    totalViewsResolution: total.resolution,
    videoCount: videosCount.metric,
    videoCountResolution: videosCount.resolution,
    videos,
  };
}
