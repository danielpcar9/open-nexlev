import { EngineError, type CounterPoint, type ProviderId, type WindowMetric } from '../types.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const WINDOW_TOLERANCE_MS = 3 * HOUR;
export const STALE_AFTER_MS = 12 * HOUR;

function label(days: 1 | 7 | 30): string {
  return days === 1 ? '24 h' : `${days} d`;
}

function hoursText(ms: number): string {
  const hours = Math.round((ms / HOUR) * 10) / 10;
  return Number.isInteger(hours) ? `${hours} h` : `${hours} h`;
}

function empty(requestedDays: 1 | 7 | 30, explanation: string, quality: WindowMetric['quality'] = 'insufficient'): WindowMetric {
  return { requestedDays, delta: null, from: null, to: null, observedDays: null, quality, projected: false, explanation };
}

type Timed = CounterPoint & { t: number };

function prepare(points: CounterPoint[]): { mixed: boolean; rows: Timed[] } {
  const providers = new Set(points.map(point => point.provider));
  const rows = points
    .filter(point => point.value != null && Number.isFinite(point.value))
    .map(point => ({ ...point, t: Date.parse(point.observedAt) }))
    .filter(point => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t || a.provider.localeCompare(b.provider));
  const unique: Timed[] = [];
  for (const row of rows) {
    const previous = unique[unique.length - 1];
    if (previous && previous.t === row.t && previous.provider === row.provider) unique[unique.length - 1] = row;
    else unique.push(row);
  }
  return { mixed: providers.size > 1, rows: unique };
}

export function observationInstants(input: { fromCache: boolean; observedAt: string | null; fetchedAt: string }): { observedAt: string; fetchedAt: string } {
  if (!input.fromCache) return { observedAt: input.fetchedAt, fetchedAt: input.fetchedAt };
  if (!input.observedAt) throw new EngineError('INVALID', 'Una respuesta de caché debe conservar el observedAt original.');
  return { observedAt: input.observedAt, fetchedAt: input.fetchedAt };
}

export function splitByProvider(points: CounterPoint[]): Map<ProviderId, CounterPoint[]> {
  const groups = new Map<ProviderId, CounterPoint[]>();
  for (const point of points) {
    const list = groups.get(point.provider) ?? [];
    list.push(point);
    groups.set(point.provider, list);
  }
  return groups;
}

export function computeWindow(points: CounterPoint[], requestedDays: 1 | 7 | 30, now: Date): WindowMetric {
  const prepared = prepare(points);
  if (prepared.mixed) {
    return empty(requestedDays, 'No se mezclan series de proveedores distintos. Al cambiar de fuente empieza una serie comparable nueva.');
  }
  if (prepared.rows.length === 0) return empty(requestedDays, 'No hay observaciones de este contador.');
  const latest = prepared.rows[prepared.rows.length - 1]!;
  const age = now.getTime() - latest.t;
  const stale = age > STALE_AFTER_MS;
  const target = latest.t - requestedDays * DAY;
  const anchors = prepared.rows
    .filter(point => point.t < latest.t && Math.abs(point.t - target) <= WINDOW_TOLERANCE_MS)
    .sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target) || a.t - b.t);
  const anchor = anchors[0];
  if (!anchor) {
    return empty(
      requestedDays,
      stale
        ? `Cobertura insuficiente para ${label(requestedDays)}. La última observación está desactualizada (${hoursText(age)}). No se reutiliza un intervalo distinto.`
        : `Cobertura insuficiente para ${label(requestedDays)}. No hay una observación dentro de ±3 h del inicio. No se usa un punto de otro plazo.`,
      stale ? 'stale' : 'insufficient',
    );
  }
  const delta = (latest.value as number) - (anchor.value as number);
  const span = latest.t - anchor.t;
  const observedDays = span / DAY;
  const rounded = latest.precision !== 'exact' || anchor.precision !== 'exact';
  const exactSpan = Math.abs(span - requestedDays * DAY) < 1000;
  let quality: WindowMetric['quality'];
  if (delta < 0) quality = 'counter_reset';
  else if (stale) quality = 'stale';
  else if (rounded || !exactSpan) quality = 'approximate';
  else quality = 'observed';
  const spanNote = exactSpan
    ? `Observado: ${hoursText(span)}.`
    : `Aprox. ${label(requestedDays)}; observado: ${hoursText(span)}.`;
  let explanation: string;
  if (quality === 'counter_reset') explanation = `El contador bajó entre ${anchor.observedAt} y ${latest.observedAt}. Es una corrección o reinicio, no crecimiento.`;
  else if (quality === 'stale') explanation = `Serie desactualizada: la última observación tiene ${hoursText(age)} (máximo 12 h para tratarla como actual). ${spanNote}`;
  else if (rounded) explanation = `${spanNote} Hay un contador redondeado, así que el delta es aproximado.`;
  else explanation = `${spanNote} Delta entre dos contadores acumulados.`;
  return {
    requestedDays,
    delta,
    from: anchor.observedAt,
    to: latest.observedAt,
    observedDays,
    quality,
    projected: false,
    explanation,
  };
}

export function projectMonthly(source: WindowMetric): WindowMetric | null {
  if (source.projected || source.requestedDays === 30) return null;
  if (source.delta == null || source.observedDays == null || source.observedDays < 1) return null;
  if (source.quality === 'insufficient' || source.quality === 'counter_reset') return null;
  const delta = source.delta / source.observedDays * 30;
  const stale = source.quality === 'stale' ? ' La fuente está desactualizada.' : '';
  return {
    requestedDays: 30,
    delta,
    from: source.from,
    to: source.to,
    observedDays: source.observedDays,
    quality: 'approximate',
    projected: true,
    explanation: `Proyección, no medición mensual: ${source.delta} vistas en ${source.observedDays} días observados × 30. Periodo fuente: ${source.from} → ${source.to}.${stale}`,
  };
}

export function describeCounter(points: CounterPoint[], now: Date): { d1: WindowMetric; d7: WindowMetric; d30: WindowMetric; projection: WindowMetric | null } {
  const d1 = computeWindow(points, 1, now);
  const d7 = computeWindow(points, 7, now);
  const d30 = computeWindow(points, 30, now);
  const source = [d1, d7].find(window => window.delta != null && window.observedDays != null && window.observedDays >= 1 && window.quality !== 'counter_reset' && window.quality !== 'insufficient');
  const projection = d30.quality === 'insufficient' || d30.delta == null ? (source ? projectMonthly(source) : null) : null;
  return { d1, d7, d30, projection };
}

export type GrowthComparison = { absolute: number | null; percent: number | null; comparable: boolean; explanation: string };

export function compareGrowth(current: WindowMetric, previous: WindowMetric): GrowthComparison {
  const unusable = (window: WindowMetric) => window.delta == null || window.observedDays == null || window.projected || window.quality === 'insufficient' || window.quality === 'counter_reset';
  if (unusable(current) || unusable(previous)) return { absolute: null, percent: null, comparable: false, explanation: 'No hay dos ventanas de crecimiento comparables.' };
  if (Math.abs((current.observedDays as number) - (previous.observedDays as number)) > 0.25) {
    return { absolute: null, percent: null, comparable: false, explanation: 'Las ventanas no tienen duración comparable.' };
  }
  const absolute = (current.delta as number) - (previous.delta as number);
  if (previous.delta === 0) return { absolute, percent: null, comparable: true, explanation: `Sin base porcentual. Cambio absoluto: ${absolute}.` };
  const percent = absolute / (previous.delta as number) * 100;
  return { absolute, percent, comparable: true, explanation: `Cambio absoluto ${absolute}. Porcentaje ${percent} entre intervalos comparables.` };
}

export function weeklyGrowth(points: CounterPoint[], now: Date): { current: WindowMetric; previous: WindowMetric; comparison: GrowthComparison } {
  const current = computeWindow(points, 7, now);
  if (!current.from) {
    return { current, previous: empty(7, 'No hay una ventana semanal previa.'), comparison: { absolute: null, percent: null, comparable: false, explanation: 'No hay dos ventanas de crecimiento comparables.' } };
  }
  const cut = Date.parse(current.from);
  const previous = computeWindow(points.filter(point => Date.parse(point.observedAt) <= cut), 7, new Date(cut));
  return { current, previous, comparison: compareGrowth(current, previous) };
}

export function endpointResolution(points: CounterPoint[], window: WindowMetric): number | null {
  if (!window.from || !window.to) return null;
  const from = points.find(point => point.observedAt === window.from);
  const to = points.find(point => point.observedAt === window.to);
  if (!from || !to) return null;
  if (from.resolution == null || to.resolution == null) return null;
  return from.resolution + to.resolution;
}
