export type ScoreWeights = { traction: number; outliers: number; growth: number; competition: number };

export const SCORE_VERSION = 'v1';
export const DEFAULT_WEIGHTS: ScoreWeights = { traction: 30, outliers: 25, growth: 25, competition: 20 };

export type ProjectFacts = {
  id: string;
  complete: boolean;
  comparisonKey: string;
  referenceCount: number;
  referenceMedian: number | null;
  outlierRatio: number | null;
  outlierVideos: number;
  outlierChannels: number;
  weeklyGrowth: number | null;
  growthChannels: number;
  competitorsAbove: number | null;
  competitionFailed: boolean;
};

export type ScoreComponent = {
  status: 'known' | 'unknown';
  absolute: number | null;
  percentile: number | null;
  weight: number;
  detail: string;
};

export type OpportunityScore = {
  version: typeof SCORE_VERSION;
  rankingAvailable: boolean;
  certainty: 'complete' | 'partial' | 'insufficient' | 'unavailable';
  coverage: number | null;
  score: number | null;
  message: string;
  components: Record<keyof ScoreWeights, ScoreComponent>;
  weights: ScoreWeights;
};

export function assertWeights(weights: ScoreWeights): void {
  const values = [weights.traction, weights.outliers, weights.growth, weights.competition];
  if (values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Los pesos deben ser enteros no negativos.');
  if (values.reduce((sum, value) => sum + value, 0) !== 100) throw new Error('Los pesos deben sumar 100.');
}

/** Average 1-based rank for ties, then (rank - 1) / (n - 1). Documented in OPERACION.md. */
export function averageRankPercentile(values: number[], value: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const ranks = sorted.flatMap((item, index) => item === value ? [index + 1] : []);
  if (!ranks.length || sorted.length < 2) throw new Error('Percentil sin muestra comparable.');
  const average = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
  return (average - 1) / (sorted.length - 1) * 100;
}

function component(weight: number, known: boolean, absolute: number | null, detail: string): ScoreComponent {
  return { status: known ? 'known' : 'unknown', absolute: known ? absolute : null, percentile: null, weight, detail };
}

export function computeOpportunityScore(projects: ProjectFacts[], targetId: string, weights: ScoreWeights = DEFAULT_WEIGHTS): OpportunityScore {
  assertWeights(weights);
  const ordered = [...projects].sort((a, b) => a.id.localeCompare(b.id));
  const target = ordered.find(project => project.id === targetId);
  if (!target) throw new Error('Proyecto de investigación no encontrado.');
  const tractionKnown = target.referenceCount >= 5 && target.referenceMedian != null;
  const outliersKnown = target.outlierChannels >= 5 && target.outlierVideos >= 30 && target.outlierRatio != null;
  const growthKnown = target.growthChannels >= 3 && target.weeklyGrowth != null;
  const competitionKnown = target.complete && !target.competitionFailed && target.competitorsAbove != null;
  const components: OpportunityScore['components'] = {
    traction: component(weights.traction, tractionKnown, target.referenceMedian, tractionKnown ? `Mediana de medianas de ${target.referenceCount} referentes.` : 'Se necesitan al menos 5 referentes válidos. No se asigna cero.'),
    outliers: component(weights.outliers, outliersKnown, target.outlierRatio, outliersKnown ? `${target.outlierVideos} videos comparables en ${target.outlierChannels} canales.` : 'Se necesitan al menos 30 videos comparables de 5 canales. No se asigna cero.'),
    growth: component(weights.growth, growthKnown, target.weeklyGrowth, growthKnown ? `Crecimiento semanal comparable en ${target.growthChannels} canales.` : 'Se necesitan al menos 3 canales con dos ventanas válidas. No se asigna cero.'),
    competition: component(
      weights.competition,
      competitionKnown,
      competitionKnown ? target.competitorsAbove : null,
      target.competitionFailed
        ? 'La búsqueda de competencia falló o quedó incompleta. El componente es desconocido, no competencia cero.'
        : competitionKnown ? `${target.competitorsAbove} competidores superan el umbral de tracción.` : 'Sin una búsqueda de competencia completa. No se trata la falta de datos como ausencia de competencia.',
    ),
  };
  const peers = ordered.filter(project => project.complete && project.comparisonKey === target.comparisonKey);
  const rankingAvailable = target.complete && peers.length >= 5 && peers.some(project => project.id === target.id);
  if (rankingAvailable) {
    const apply = (key: keyof ScoreWeights, values: number[], value: number, inverse = false) => {
      if (components[key].status !== 'known') return;
      const percentile = averageRankPercentile(values, value);
      components[key].percentile = inverse ? 100 - percentile : percentile;
    };
    const tractionValues = peers.filter(project => project.referenceCount >= 5 && project.referenceMedian != null).map(project => project.referenceMedian as number);
    const outlierValues = peers.filter(project => project.outlierChannels >= 5 && project.outlierVideos >= 30 && project.outlierRatio != null).map(project => project.outlierRatio as number);
    const growthValues = peers.filter(project => project.growthChannels >= 3 && project.weeklyGrowth != null).map(project => project.weeklyGrowth as number);
    const competitionValues = peers.filter(project => !project.competitionFailed && project.competitorsAbove != null).map(project => project.competitorsAbove as number);
    if (tractionKnown && tractionValues.length >= 5) apply('traction', tractionValues, target.referenceMedian as number);
    else components.traction.percentile = null;
    if (outliersKnown && outlierValues.length >= 5) apply('outliers', outlierValues, target.outlierRatio as number);
    if (growthKnown && growthValues.length >= 5) apply('growth', growthValues, target.weeklyGrowth as number);
    if (competitionKnown && competitionValues.length >= 5) apply('competition', competitionValues, target.competitorsAbove as number, true);
  }
  const keys = ['traction', 'outliers', 'growth', 'competition'] as const;
  const weightTotal = keys.reduce((sum, key) => sum + weights[key], 0);
  const usable = keys.filter(key => components[key].percentile != null);
  const availableWeight = usable.reduce((sum, key) => sum + weights[key], 0);
  const coverage = weightTotal === 0 ? 0 : availableWeight / weightTotal;
  if (!rankingAvailable) {
    return {
      version: SCORE_VERSION, rankingAvailable: false, certainty: 'unavailable', coverage: null, score: null, weights,
      message: 'Ranking aún no disponible. Se muestran componentes absolutos, no percentiles. Hacen falta al menos 5 investigaciones comparables y completas.',
      components,
    };
  }
  if (coverage < 0.7) {
    return {
      version: SCORE_VERSION, rankingAvailable: true, certainty: 'insufficient', coverage, score: null, weights,
      message: 'Datos insuficientes. La cobertura de pesos con percentil es inferior al 70%. Un fallo de búsqueda no sube la oportunidad.',
      components,
    };
  }
  const score = usable.reduce((sum, key) => sum + (components[key].percentile as number) * weights[key], 0) / availableWeight;
  const complete = coverage === 1;
  return {
    version: SCORE_VERSION,
    rankingAvailable: true,
    certainty: complete ? 'complete' : 'partial',
    coverage,
    score,
    weights,
    message: complete
      ? 'Heurística v1 con cobertura completa. No es probabilidad de éxito, ingreso ni recomendación.'
      : `Score parcial normalizado sobre los pesos disponibles. Cobertura ${Math.round(coverage * 100)}%. No es una medición de mercado.`,
    components,
  };
}
