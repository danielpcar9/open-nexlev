export type ViewMix = 'long_only' | 'short_only' | 'mixed_unknown' | 'declared';

export type RevenueScenario = {
  id: 'per_publication' | 'observed_views' | 'monthly_projection';
  label: string;
  usd: number | null;
  disabled: boolean;
  projected: boolean;
  hypothesis: string;
};

function money(views: number, rpm: number): number {
  return Math.round(views / 1000 * rpm);
}

export function buildRevenueScenarios(input: {
  medianViews: number | null;
  monthlyPosts: number;
  observedViews: number | null;
  observedDays: number | null;
  projectedViews: number | null;
  projectionObservedDays: number | null;
  rpm: number;
  mix: ViewMix;
  declaredMix?: string | null;
}): RevenueScenario[] {
  const rpm = input.rpm;
  const validRpm = Number.isFinite(rpm) && rpm >= 0 && rpm <= 1000;
  const declared = input.declaredMix?.trim() || null;
  const blocked = input.mix === 'mixed_unknown' && !declared;
  const mixText = blocked
    ? 'El catálogo mezcla formatos o el reparto de vistas es desconocido. No se aplica un RPM de videos largos al total.'
    : input.mix === 'declared' || declared
      ? `Hipótesis de mezcla declarada por el usuario: ${declared ?? 'sin texto'}.`
      : input.mix === 'short_only' ? 'Hipótesis: el escenario usa solo Shorts.' : 'Hipótesis: el escenario usa solo videos largos.';
  const base = `RPM supuesto ${validRpm ? rpm : 'inválido'} USD. No es un RPM medido ni derivado de vistas públicas. ${mixText}`;
  const disableAll = blocked || !validRpm;
  const posts = Number.isFinite(input.monthlyPosts) && input.monthlyPosts > 0 ? input.monthlyPosts : null;
  const publicationViews = input.medianViews != null && posts != null ? input.medianViews * posts : null;
  return [
    {
      id: 'per_publication',
      label: 'Por publicación',
      usd: !disableAll && publicationViews != null ? money(publicationViews, rpm) : null,
      disabled: disableAll || publicationViews == null,
      projected: false,
      hypothesis: `${base} Mediana × ${posts ?? 'publicaciones mensuales no declaradas'} × RPM / 1000.`,
    },
    {
      id: 'observed_views',
      label: 'Por vistas observadas',
      usd: !disableAll && input.observedViews != null ? money(input.observedViews, rpm) : null,
      disabled: disableAll || input.observedViews == null,
      projected: false,
      hypothesis: `${base} Vistas del intervalo compatible${input.observedDays != null ? ` (${input.observedDays} días observados)` : ''} × RPM / 1000.`,
    },
    {
      id: 'monthly_projection',
      label: 'Proyección mensual',
      usd: !disableAll && input.projectedViews != null ? money(input.projectedViews, rpm) : null,
      disabled: disableAll || input.projectedViews == null,
      projected: true,
      hypothesis: `${base} Proyección, no medición: vistas proyectadas × RPM / 1000. Días de observación de la fuente: ${input.projectionObservedDays ?? 'desconocidos'}.`,
    },
  ];
}
