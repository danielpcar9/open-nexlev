const STOPWORDS: Record<'es' | 'en', Set<string>> = {
  es: new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'o', 'en', 'un', 'una', 'que', 'por', 'con', 'para', 'al', 'es', 'su', 'se', 'lo', 'como', 'mas', 'the', 'unos', 'unas']),
  en: new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'with', 'from', 'by', 'at', 'is', 'it', 'this', 'that', 'you', 'your', 'how', 'what', 'why', 'vs']),
};

export function normalizeTitle(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type PatternExample = { videoId: string; title: string };
export type PatternRow = {
  phrase: string;
  kind: 'word' | 'bigram';
  count: number;
  denominator: number;
  examples: PatternExample[];
  outlierCount: number | null;
  outlierDenominator: number | null;
  baseCount: number | null;
  baseDenominator: number | null;
  statement: string;
};

type VideoTitle = { videoId: string; title: string; outlier: boolean };

export function titlePatterns(videos: VideoTitle[], language: 'es' | 'en'): PatternRow[] {
  const unique: VideoTitle[] = [];
  const seen = new Set<string>();
  for (const video of videos) {
    if (seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    unique.push(video);
  }
  const stop = STOPWORDS[language];
  const denominator = unique.length;
  const outliers = unique.filter(video => video.outlier);
  const base = unique.filter(video => !video.outlier);
  const comparable = outliers.length >= 5 && base.length >= 5;
  type Bucket = { count: number; examples: PatternExample[]; outlierCount: number; baseCount: number; kind: 'word' | 'bigram' };
  const buckets = new Map<string, Bucket>();
  for (const video of unique) {
    const tokens = normalizeTitle(video.title).split(' ').filter(token => token.length >= 3 && !stop.has(token));
    const phrases = [...new Set([...tokens, ...tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`)])];
    for (const phrase of phrases) {
      const bucket = buckets.get(phrase) ?? { count: 0, examples: [], outlierCount: 0, baseCount: 0, kind: phrase.includes(' ') ? 'bigram' : 'word' };
      bucket.count += 1;
      if (video.outlier) bucket.outlierCount += 1;
      else bucket.baseCount += 1;
      if (bucket.examples.length < 5) bucket.examples.push({ videoId: video.videoId, title: video.title });
      buckets.set(phrase, bucket);
    }
  }
  return [...buckets.entries()]
    .map(([phrase, bucket]) => {
      const statement = comparable
        ? `aparece en ${bucket.outlierCount} de ${outliers.length} outliers y en ${bucket.baseCount} de ${base.length} de la muestra base. Asociación observada, no causalidad.`
        : `aparece en ${bucket.count} de ${denominator} videos. Muestra insuficiente para comparar outliers y base.`;
      return {
        phrase,
        kind: bucket.kind,
        count: bucket.count,
        denominator,
        examples: bucket.examples,
        outlierCount: comparable ? bucket.outlierCount : null,
        outlierDenominator: comparable ? outliers.length : null,
        baseCount: comparable ? bucket.baseCount : null,
        baseDenominator: comparable ? base.length : null,
        statement,
      };
    })
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, 40);
}

export function suggestLanguage(titles: string[]): { language: 'es' | 'en' | null; confidence: 'low' | 'unknown'; evidence: string } {
  if (!titles.length) return { language: null, confidence: 'unknown', evidence: 'Sin títulos para contrastar. No se infiere el idioma por el país del canal.' };
  let spanish = 0;
  let english = 0;
  for (const title of titles) {
    for (const token of normalizeTitle(title).split(' ')) {
      if (STOPWORDS.es.has(token) && !STOPWORDS.en.has(token)) spanish += 1;
      if (STOPWORDS.en.has(token) && !STOPWORDS.es.has(token)) english += 1;
    }
  }
  const evidence = `Stopwords en títulos: es=${spanish}, en=${english}. No se usa el país del canal.`;
  if (spanish >= english * 2 && spanish >= 3) return { language: 'es', confidence: 'low', evidence: `${evidence} Sugerencia explicable, no una clasificación cerrada.` };
  if (english >= spanish * 2 && english >= 3) return { language: 'en', confidence: 'low', evidence: `${evidence} Sugerencia explicable, no una clasificación cerrada.` };
  return { language: null, confidence: 'unknown', evidence: `${evidence} Evidencia insuficiente o ambigua.` };
}
