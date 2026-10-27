export type Precision = 'exact' | 'rounded' | 'unknown';

export type MetricValue = {
  value: number | null;
  precision: Precision;
};

export type ProviderId = 'innertube' | 'youtube-data-api';

export type ObservationMeta = {
  provider: ProviderId;
  observedAt: string;
  fetchedAt: string;
  fromCache: boolean;
};

export type ContentKind = 'long' | 'short' | 'live' | 'unknown';

export type EngineErrorCode = 'INVALID' | 'NO_DATA' | 'RESTRICTED' | 'TIMEOUT' | 'RATE_LIMIT' | 'UPSTREAM';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly retryAfterMs?: number;
  constructor(code: EngineErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export type WindowQuality = 'observed' | 'approximate' | 'insufficient' | 'stale' | 'counter_reset';

export type WindowMetric = {
  requestedDays: 1 | 7 | 30;
  delta: number | null;
  from: string | null;
  to: string | null;
  observedDays: number | null;
  quality: WindowQuality;
  projected: boolean;
  explanation: string;
};

export type CounterPoint = {
  observedAt: string;
  value: number | null;
  precision: Precision;
  provider: ProviderId;
  fromCache?: boolean;
  resolution?: number | null;
};

export type ChannelCaptureVideo = {
  id: string;
  title: string;
  views: MetricValue;
  viewsResolution: number | null;
  publishedAt: string | null;
  publishedText: string | null;
  contentKind: ContentKind;
};

export type ChannelCapture = ObservationMeta & {
  channelId: string;
  title: string;
  subscribers: MetricValue;
  subscribersResolution: number | null;
  totalViews: MetricValue;
  totalViewsResolution: number | null;
  videoCount: MetricValue;
  videoCountResolution: number | null;
  videos: ChannelCaptureVideo[];
};
