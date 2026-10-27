import { calculateMedian } from './median.js';
import type { ContentKind } from '../types.js';

export type VideoSample = {
  id: string;
  views: number | null;
  contentKind: ContentKind;
  precision?: 'exact' | 'rounded' | 'unknown';
};

export type OutlierReference = {
  ok: boolean;
  reason: 'sin base suficiente' | null;
  median: number | null;
  ratio: number | null;
  isOutlier: boolean;
  sampleIds: string[];
  sampleViews: number[];
  candidateExcluded: boolean;
};

function comparable(sample: VideoSample): boolean {
  return sample.views != null && sample.views > 0 && (sample.contentKind === 'long' || sample.contentKind === 'short');
}

export function outlierReference(samples: VideoSample[], candidateId: string, multiplier = 3): OutlierReference {
  const candidate = samples.find(sample => sample.id === candidateId);
  const base = samples.filter(sample => sample.id !== candidateId && comparable(sample));
  const sampleIds = base.map(sample => sample.id);
  const sampleViews = base.map(sample => sample.views as number);
  const candidateExcluded = !sampleIds.includes(candidateId);
  const candidateKnown = !!candidate && candidate.views != null && (candidate.contentKind === 'long' || candidate.contentKind === 'short');
  if (!candidateKnown || base.length < 10) {
    return { ok: false, reason: 'sin base suficiente', median: null, ratio: null, isOutlier: false, sampleIds, sampleViews, candidateExcluded };
  }
  const median = calculateMedian(sampleViews);
  if (!(median > 0)) return { ok: false, reason: 'sin base suficiente', median, ratio: null, isOutlier: false, sampleIds, sampleViews, candidateExcluded };
  const ratio = (candidate!.views as number) / median;
  return { ok: true, reason: null, median, ratio, isOutlier: ratio >= multiplier, sampleIds, sampleViews, candidateExcluded };
}

export function channelOutlierCounts(samples: VideoSample[], multiplier = 3): { comparable: number; outliers: number; channelsEligible: boolean } {
  let comparableVideos = 0;
  let outliers = 0;
  for (const sample of samples) {
    const reference = outlierReference(samples, sample.id, multiplier);
    if (!reference.ok) continue;
    comparableVideos += 1;
    if (reference.isOutlier) outliers += 1;
  }
  return { comparable: comparableVideos, outliers, channelsEligible: comparableVideos > 0 };
}
