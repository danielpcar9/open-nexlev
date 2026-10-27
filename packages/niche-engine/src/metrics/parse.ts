import type { MetricValue } from '../types.js';

/** Public counters such as "1.2M" stay rounded after parsing. Missing text is unknown, not zero. */
export function parsePublicCounter(text?: string | null): MetricValue {
  if (text == null) return { value: null, precision: 'unknown' };
  const trimmed = text.trim();
  if (!trimmed) return { value: null, precision: 'unknown' };
  const match = trimmed.toUpperCase().match(/([\d.,]+)\s*(MIL|K|M|B)?/);
  if (!match) return { value: null, precision: 'unknown' };
  const unit = match[2];
  const raw = unit ? match[1]!.replace(',', '.') : match[1]!.replace(/[.,]/g, '');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { value: null, precision: 'unknown' };
  let scaled = parsed;
  if (unit === 'K' || unit === 'MIL') scaled *= 1_000;
  if (unit === 'M') scaled *= 1_000_000;
  if (unit === 'B') scaled *= 1_000_000_000;
  return { value: Math.round(scaled), precision: unit ? 'rounded' : 'exact' };
}

/** Smallest step implied by an abbreviated counter. Exact counters resolve to 0. Unknown abbreviation returns null. */
export function resolutionFor(text: string | null | undefined, metric: MetricValue): number | null {
  if (metric.value == null || metric.precision === 'unknown') return null;
  if (metric.precision === 'exact') return 0;
  if (!text) return null;
  const match = text.trim().toUpperCase().match(/([\d.,]+)\s*(MIL|K|M|B)/);
  if (!match) return null;
  const unit = match[2];
  const step = unit === 'K' || unit === 'MIL' ? 1_000 : unit === 'M' ? 1_000_000 : 1_000_000_000;
  const fraction = match[1]!.split(/[.,]/)[1];
  const decimals = fraction ? fraction.length : 0;
  return decimals > 0 ? step / 10 ** decimals : step;
}
