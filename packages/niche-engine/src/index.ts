import { fetchVideoTranscript } from './transcript.js';
export { TranscriptError, parseVideoId } from './transcript.js';
import { Innertube, UniversalCache } from 'youtubei.js';
import { parsePublicCounter } from './metrics/parse.js';
import { calculateMedian } from './metrics/median.js';

export { parsePublicCounter, resolutionFor } from './metrics/parse.js';
export { calculateMedian } from './metrics/median.js';
export { EngineError } from './types.js';
export type { MetricValue, Precision, ObservationMeta, ProviderId, ContentKind, EngineErrorCode, WindowMetric, WindowQuality, CounterPoint, ChannelCapture, ChannelCaptureVideo } from './types.js';
export { computeWindow, projectMonthly, describeCounter, compareGrowth, weeklyGrowth, observationInstants, splitByProvider, endpointResolution } from './metrics/windows.js';
export { outlierReference, channelOutlierCounts } from './metrics/outliers.js';
export type { VideoSample, OutlierReference } from './metrics/outliers.js';
export { computeOpportunityScore, assertWeights, averageRankPercentile, DEFAULT_WEIGHTS, SCORE_VERSION } from './metrics/score.js';
export type { ScoreWeights, ProjectFacts, OpportunityScore, ScoreComponent } from './metrics/score.js';
export { buildRevenueScenarios } from './metrics/revenue.js';
export type { RevenueScenario, ViewMix } from './metrics/revenue.js';
export { titlePatterns, suggestLanguage, normalizeTitle } from './metrics/titles.js';
export type { PatternRow } from './metrics/titles.js';
export { captureInnertube, classifyInnertubeVideo } from './providers/innertube.js';
export { captureYouTubeDataApi, youtubeDataApiEnabled, YOUTUBE_API_RETENTION_DAYS } from './providers/youtube-data.js';

export interface NicheFilter {
  query: string;
  maxSubscribers?: number;      // Ej: 50,000 (canales pequeños)
  minOutlierScore?: number;     // Ej: 3.0x (videos que triplican la mediana del canal)
  minMedianViews?: number;      // Ej: 5,000 (que el canal tenga tracción real)
  maxChannelsToAnalyze?: number;
}

export interface OutlierVideo {
  id: string;
  title: string;
  views: number;
  publishedText: string;
  outlierScore: number;
  viewsToSubsRatio: number;
  url: string;
  thumbnailUrl: string;
}

export interface NicheChannelResult {
  channelId: string;
  title: string;
  handle: string;
  subscribers: number;
  medianViews: number;
  subscriberToViewRatio: number;
  estimatedMonthlyRevenueUsd: { low: number; high: number };
  topOutliers: OutlierVideo[];
  channelUrl: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  timestamp: string;
  text: string;
}

export interface VideoTranscriptResult {
  videoId: string;
  title: string;
  cleanText: string;
  wordCount: number;
  segments: TranscriptSegment[];
}

// Utilidad histórica: un texto ausente sigue devolviendo 0 para no cambiar el contrato del explorador.
export function parseMetricText(text?: string): number {
  return parsePublicCounter(text).value ?? 0;
}

export function formatMsToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class NicheFinderEngine {
  private yt: Innertube | null = null;

  async init() {
    if (!this.yt) {
      this.yt = await Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true,
        lang: 'en',
        location: 'US',
      });
    }
  }

  /**
   * Analiza un canal específico y devuelve sus métricas de nicho + videos outliers
   */
  async analyzeChannel(channelId: string, minOutlierScore = 2.5, rpmRange: [number, number] = [3, 8]): Promise<NicheChannelResult | null> {
    await this.init();
    try {
      const channel = await this.yt!.getChannel(channelId);
      const header = channel.header as any;

      const title = channel.metadata?.title || 'Unknown';
      const handle =
        header?.channel_handle?.text ||
        header?.content?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text?.text ||
        '';
      const subText =
        header?.subscribers?.text ||
        header?.content?.metadata?.metadata_rows?.[1]?.metadata_parts?.[0]?.text?.text ||
        '0';
      const subscribers = parseMetricText(subText);
      if (subscribers <= 0) return null; // Unknown subscriber counts cannot pass the small-channel filter.

      // Obtener pestaña de videos del canal
      const videosTab = await channel.getVideos();
      const rawVideos = videosTab.videos as any[];

      if (!rawVideos || rawVideos.length < 3) return null;

      // Extraer vistas de los últimos 25 videos
      const parsedVideos = rawVideos
        .slice(0, 25)
        .map((v) => {
          const parts = (v.metadata?.metadata?.metadata_rows ?? []).flatMap((row: any) => row.metadata_parts ?? []).map((part: any) => part.text?.text ?? '');
          const views = parseMetricText(v.view_count?.text || v.short_view_count?.text || parts.find((text: string) => /views/i.test(text)));
          const videoId = v.id || v.content_id || '';
          return {
            id: videoId,
            title: v.title?.text || v.metadata?.title?.text || 'Untitled',
            views,
            publishedText: v.published?.text || parts.find((text: string) => /ago/i.test(text)) || '',
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          };
        })
        .filter((v) => v.views > 0 && v.id);

      const viewCounts = parsedVideos.map((v) => v.views);
      const medianViews = calculateMedian(viewCounts);
      if (medianViews === 0) return null;

      // Estimar ingresos mensuales aproximados asumiendo ~8 videos al mes con la mediana actual
      const estimatedMonthlyViews = medianViews * 8;
      const estimatedMonthlyRevenueUsd = {
        low: Math.round((estimatedMonthlyViews / 1000) * rpmRange[0]),
        high: Math.round((estimatedMonthlyViews / 1000) * rpmRange[1]),
      };

      // Detectar Outliers comparando contra la mediana del propio canal
      const topOutliers: OutlierVideo[] = parsedVideos
        .map((v) => {
          const outlierScore = Number((v.views / medianViews).toFixed(2));
          const viewsToSubsRatio = subscribers > 0 ? Number((v.views / subscribers).toFixed(2)) : 0;
          return {
            ...v,
            outlierScore,
            viewsToSubsRatio,
            url: `https://www.youtube.com/watch?v=${v.id}`,
          };
        })
        .filter((v) => v.outlierScore >= minOutlierScore)
        .sort((a, b) => b.outlierScore - a.outlierScore);

      return {
        channelId,
        title,
        handle,
        subscribers,
        medianViews: Math.round(medianViews),
        subscriberToViewRatio: subscribers > 0 ? Number((medianViews / subscribers).toFixed(2)) : 0,
        estimatedMonthlyRevenueUsd,
        topOutliers,
        channelUrl: `https://www.youtube.com/channel/${channelId}`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Buscador de Nichos: Busca una keyword, extrae los canales únicos y filtra las minas de oro
   */
  async discoverNicheChannels(filter: NicheFilter): Promise<NicheChannelResult[]> {
    await this.init();
    const {
      query,
      maxSubscribers = 100_000,
      minOutlierScore = 3.0,
      minMedianViews = 2_000,
      maxChannelsToAnalyze = 12,
    } = filter;

    const search = await this.yt!.search(query, {
      type: 'video',
      upload_date: 'month',
      prioritize: 'popularity',
    });

    const channelIds = new Set<string>();
    for (const item of search.videos as any[]) {
      if (item.author?.id && channelIds.size < maxChannelsToAnalyze) {
        channelIds.add(item.author.id);
      }
    }

    const results: NicheChannelResult[] = [];
    const idsArray = Array.from(channelIds);

    for (const channelId of idsArray) {
      const analysis = await this.analyzeChannel(channelId, minOutlierScore);
      if (!analysis) continue;

      const passesSubFilter = analysis.subscribers <= maxSubscribers;
      const passesViewFilter = analysis.medianViews >= minMedianViews;
      const hasOutliers = analysis.topOutliers.length > 0;

      if (passesSubFilter && passesViewFilter && hasOutliers) {
        results.push(analysis);
      }
    }

    return results.sort((a, b) => b.subscriberToViewRatio - a.subscriberToViewRatio);
  }

  /**
   * Extractor de Transcripción / Guion Limpio (Sin API Key)
   * Acepta un ID de video (ej. "dQw4w9WgXcQ") o una URL completa de YouTube
   */
  async getVideoTranscript(videoIdOrUrl: string): Promise<VideoTranscriptResult> {
    return fetchVideoTranscript(videoIdOrUrl);
  }
}
