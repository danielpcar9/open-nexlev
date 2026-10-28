import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { assertWeights, calculateMedian, channelOutlierCounts, computeOpportunityScore, DEFAULT_WEIGHTS, outlierReference, suggestLanguage, titlePatterns, weeklyGrowth, type ContentKind, type CounterPoint, type ProjectFacts, type ScoreWeights } from '@open-nexlev/niche-engine';
import { HttpError } from './tracking';
import { enqueueJob, holdLease, jobOwnership, LEASE_MS, settleCancelled, type JobRow, type LeaseControl } from './jobs';

export type ResearchChannel = {
  channelId: string;
  title: string;
  subscribers: number | null;
  videos: { id: string; title: string; views: number | null; contentKind: ContentKind }[];
};
export type ResearchSearch = { ok: true; partial: boolean; channels: ResearchChannel[] } | { ok: false; partial: boolean; error: string; channels: ResearchChannel[] };
export type ResearchSearcher = (input: { query: string; filters: { uploadDate: string }; maxResults: number }) => Promise<ResearchSearch>;

type ProjectRow = { id: string; name: string; description: string; market: string | null; language: string | null; score_config: string; created_at: number; updated_at: number; last_score: string | null };
type QueryRow = { id: string; project_id: string; role: string; query: string; filters: string; max_results: number; status: string; error: string | null; started_at: number | null; finished_at: number | null };
type MemberRow = {
  project_id: string; channel_id: string; title: string; role: string; role_manual: number; language: string | null; language_confidence: string | null;
  language_evidence: string | null; language_manual: number; notes: string; tags: string; found_by: string; subscribers: number | null; median_views: number | null;
  comparable_videos: number; outlier_videos: number; weekly_growth: number | null; growth_ready: number; updated_at: number; in_sample: number;
};

export type ScoreConfig = { version: 'v1'; weights: ScoreWeights; competitorMedianThreshold: number; uploadDate: string; maxResults: number };

function configOf(row: ProjectRow): ScoreConfig {
  const parsed = JSON.parse(row.score_config) as ScoreConfig;
  assertWeights(parsed.weights);
  return parsed;
}

function comparisonKey(queries: QueryRow[]): string {
  return queries.map(query => `${query.role}\n${query.query.trim().toLowerCase()}\n${query.filters}\n${query.max_results}`).sort().join('\n---\n');
}

function refreshGrowth(sqlite: Database.Database, members: MemberRow[], now: number): MemberRow[] {
  return members.map(member => {
    if (member.role !== 'reference') return member;
    const rows = sqlite.prepare(`SELECT observed_at, total_views, total_views_precision, total_views_resolution, provider, from_cache FROM channel_observations WHERE channel_id = ? ORDER BY observed_at`).all(member.channel_id) as { observed_at: number; total_views: number | null; total_views_precision: CounterPoint['precision']; total_views_resolution: number | null; provider: CounterPoint['provider']; from_cache: number }[];
    const providers = [...new Set(rows.map(row => row.provider))];
    let best: { percent: number } | null = null;
    for (const provider of providers) {
      const series: CounterPoint[] = rows.filter(row => row.provider === provider).map(row => ({ observedAt: new Date(row.observed_at).toISOString(), value: row.total_views, precision: row.total_views_precision, provider, fromCache: row.from_cache === 1, resolution: row.total_views_resolution }));
      const growth = weeklyGrowth(series, new Date(now));
      if (growth.comparison.comparable && growth.comparison.percent != null && growth.current.quality !== 'counter_reset' && growth.current.quality !== 'stale') best = { percent: growth.comparison.percent };
    }
    if (!best) return member;
    sqlite.prepare(`UPDATE research_members SET weekly_growth = ?, growth_ready = 1 WHERE project_id = ? AND channel_id = ?`).run(best.percent, member.project_id, member.channel_id);
    return { ...member, weekly_growth: best.percent, growth_ready: 1 };
  });
}
function factsFor(sqlite: Database.Database, project: ProjectRow, queries: QueryRow[], members: MemberRow[], now = Date.now()): ProjectFacts {
  members = refreshGrowth(sqlite, members, now);
  const references = members.filter(member => member.role === 'reference');
  const medians = references.map(member => member.median_views).filter((value): value is number => value != null);
  const outlierChannels = references.filter(member => member.comparable_videos > 0);
  const outlierVideos = outlierChannels.reduce((sum, member) => sum + member.comparable_videos, 0);
  const outlierHits = outlierChannels.reduce((sum, member) => sum + member.outlier_videos, 0);
  const growth = references.filter(member => member.growth_ready === 1 && member.weekly_growth != null).map(member => member.weekly_growth as number);
  const competitionQueries = queries.filter(query => query.role === 'competition');
  const competitionFailed = competitionQueries.length === 0 || competitionQueries.some(query => query.status !== 'complete');
  const threshold = configOf(project).competitorMedianThreshold;
  const competitors = members.filter(member => (member.role === 'direct_competitor' || member.role === 'indirect_competitor') && member.median_views != null && member.median_views >= threshold);
  const complete = queries.length > 0 && queries.every(query => query.status === 'complete');
  return {
    id: project.id,
    complete,
    comparisonKey: comparisonKey(queries),
    referenceCount: medians.length,
    referenceMedian: medians.length >= 5 ? calculateMedian(medians) : null,
    outlierChannels: outlierChannels.length,
    outlierVideos,
    outlierRatio: outlierChannels.length >= 5 && outlierVideos >= 30 ? outlierHits / outlierVideos : null,
    growthChannels: growth.length,
    weeklyGrowth: growth.length >= 3 ? calculateMedian(growth) : null,
    competitionFailed,
    competitorsAbove: competitionFailed ? null : competitors.length,
  };
}

export function scoreProject(sqlite: Database.Database, projectId: string) {
  const projects = sqlite.prepare(`SELECT * FROM research_projects`).all() as ProjectRow[];
  const target = projects.find(project => project.id === projectId);
  if (!target) throw new HttpError(404, 'Investigación no encontrada');
  const allFacts = projects.map(project => factsFor(sqlite, project, sqlite.prepare(`SELECT * FROM research_queries WHERE project_id = ?`).all(project.id) as QueryRow[], sqlite.prepare(`SELECT * FROM research_members WHERE project_id = ? AND in_sample = 1`).all(project.id) as MemberRow[]));
  const score = computeOpportunityScore(allFacts, projectId, configOf(target).weights);
  sqlite.prepare(`UPDATE research_projects SET last_score = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(score), Date.now(), projectId);
  return score;
}

function presentProject(sqlite: Database.Database, project: ProjectRow) {
  const queries = sqlite.prepare(`SELECT * FROM research_queries WHERE project_id = ? ORDER BY role, query`).all(project.id) as QueryRow[];
  const members = sqlite.prepare(`SELECT * FROM research_members WHERE project_id = ? AND in_sample = 1 ORDER BY role, title`).all(project.id) as MemberRow[];
  const retained = sqlite.prepare(`SELECT * FROM research_members WHERE project_id = ? AND in_sample = 0 AND (notes != '' OR tags != '[]' OR role_manual = 1 OR language_manual = 1) ORDER BY title`).all(project.id) as MemberRow[];
  const videos = sqlite.prepare(`SELECT video_id, channel_id, title, outlier FROM research_videos WHERE project_id = ? AND in_sample = 1`).all(project.id) as { video_id: string; channel_id: string; title: string; outlier: number }[];
  const language = project.language === 'en' || project.language === 'es' ? project.language : 'es';
  const sample = queries.some(query => query.status === 'pending' || query.status === 'running')
    ? 'stale'
    : queries.some(query => query.status !== 'complete') ? 'partial' : 'current';
  const presentMember = (member: MemberRow) => ({ ...member, tags: JSON.parse(member.tags), foundBy: JSON.parse(member.found_by), roleManual: member.role_manual === 1, languageManual: member.language_manual === 1, inSample: member.in_sample === 1 });
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    market: project.market,
    language: project.language,
    config: configOf(project),
    sample,
    queries: queries.map(query => ({ ...query, filters: JSON.parse(query.filters) })),
    members: members.map(presentMember),
    retained: retained.map(presentMember),
    patterns: titlePatterns(videos.map(video => ({ videoId: video.video_id, title: video.title, outlier: video.outlier === 1 })), language),
    score: project.last_score ? JSON.parse(project.last_score) : null,
    note: sample === 'partial'
      ? 'Ejecución parcial: la muestra no corresponde a una búsqueda completa de las consultas actuales.'
      : sample === 'stale'
        ? 'No hay una muestra vigente para estas consultas. Una puntuación anterior no se reutiliza.'
        : 'La lista es la muestra de las consultas vigentes, no todo el mercado. Una búsqueda completa y vacía se conserva vacía.',
  };
}

export function listProjects(sqlite: Database.Database) {
  return (sqlite.prepare(`SELECT * FROM research_projects ORDER BY updated_at DESC`).all() as ProjectRow[]).map(project => ({ id: project.id, name: project.name, updatedAt: new Date(project.updated_at).toISOString(), score: project.last_score ? JSON.parse(project.last_score) : null }));
}

export function getProject(sqlite: Database.Database, id: string) {
  const project = sqlite.prepare(`SELECT * FROM research_projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  if (!project) throw new HttpError(404, 'Investigación no encontrada');
  return presentProject(sqlite, project);
}

export function createProject(sqlite: Database.Database, input: {
  name: string; description?: string; market?: string; language?: string; referenceQueries: string[]; competitionQueries: string[];
  weights?: ScoreWeights; competitorMedianThreshold?: number; maxResults?: number; uploadDate?: string;
}, now = Date.now()) {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  assertWeights(weights);
  const maxResults = input.maxResults ?? 12;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) throw new HttpError(400, 'Usa entre 1 y 20 resultados por consulta');
  const uploadDate = input.uploadDate ?? 'month';
  if (!['month', 'year', 'all'].includes(uploadDate)) throw new HttpError(400, 'Frescura de búsqueda inválida');
  const id = randomUUID();
  const config: ScoreConfig = { version: 'v1', weights, competitorMedianThreshold: input.competitorMedianThreshold ?? 10_000, uploadDate, maxResults };
  const queries = [
    ...input.referenceQueries.map(query => ({ role: 'reference', query })),
    ...input.competitionQueries.map(query => ({ role: 'competition', query })),
  ];
  if (!queries.length || queries.length > 20) throw new HttpError(400, 'Añade entre 1 y 20 consultas visibles');
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO research_projects (id, name, description, market, language, score_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.name.trim(), input.description?.trim() ?? '', input.market?.trim() ?? null, input.language?.trim() ?? null, JSON.stringify(config), now, now);
    for (const query of queries) {
      sqlite.prepare(`INSERT INTO research_queries (id, project_id, role, query, filters, max_results, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
        .run(randomUUID(), id, query.role, query.query.trim(), JSON.stringify({ uploadDate }), maxResults);
    }
  }).immediate();
  return getProject(sqlite, id);
}

export function patchProject(sqlite: Database.Database, id: string, input: { name?: string; description?: string; market?: string | null; language?: string | null; weights?: ScoreWeights; competitorMedianThreshold?: number; queries?: { id?: string; role: 'reference' | 'competition'; query: string }[] }) {
  const project = sqlite.prepare(`SELECT * FROM research_projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  if (!project) throw new HttpError(404, 'Investigación no encontrada');
  const config = configOf(project);
  if (input.weights) { assertWeights(input.weights); config.weights = input.weights; }
  if (input.competitorMedianThreshold != null) {
    if (!Number.isFinite(input.competitorMedianThreshold) || input.competitorMedianThreshold < 0) throw new HttpError(400, 'Umbral de tracción inválido');
    config.competitorMedianThreshold = input.competitorMedianThreshold;
  }
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE research_projects SET name = ?, description = ?, market = ?, language = ?, score_config = ?, updated_at = ? WHERE id = ?`)
      .run(input.name?.trim() || project.name, input.description ?? project.description, input.market === undefined ? project.market : input.market, input.language === undefined ? project.language : input.language, JSON.stringify(config), Date.now(), id);
    if (input.queries) {
      if (!input.queries.length || input.queries.length > 20) throw new HttpError(400, 'Añade entre 1 y 20 consultas visibles');
      sqlite.prepare(`DELETE FROM research_queries WHERE project_id = ?`).run(id);
      for (const query of input.queries) {
        sqlite.prepare(`INSERT INTO research_queries (id, project_id, role, query, filters, max_results, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
          .run(randomUUID(), id, query.role, query.query.trim(), JSON.stringify({ uploadDate: config.uploadDate }), config.maxResults);
      }
      sqlite.prepare(`UPDATE research_members SET in_sample = 0 WHERE project_id = ?`).run(id);
      sqlite.prepare(`UPDATE research_videos SET in_sample = 0 WHERE project_id = ?`).run(id);
      sqlite.prepare(`UPDATE research_projects SET last_score = NULL WHERE id = ?`).run(id);
    } else if (input.weights || input.competitorMedianThreshold != null) {
      sqlite.prepare(`UPDATE research_projects SET last_score = NULL WHERE id = ?`).run(id);
    }
  }).immediate();
  return getProject(sqlite, id);
}

export function patchMember(sqlite: Database.Database, projectId: string, channelId: string, input: { role?: string; notes?: string; tags?: string[]; language?: string | null; languageEvidence?: string | null }) {
  const member = sqlite.prepare(`SELECT * FROM research_members WHERE project_id = ? AND channel_id = ?`).get(projectId, channelId) as MemberRow | undefined;
  if (!member) throw new HttpError(404, 'El canal no está en la investigación');
  const role = input.role ?? member.role;
  if (!['reference', 'direct_competitor', 'indirect_competitor', 'discarded'].includes(role)) throw new HttpError(400, 'Rol inválido');
  const tags = input.tags ?? JSON.parse(member.tags);
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw new HttpError(400, 'Etiquetas inválidas');
  const language = input.language === undefined ? member.language : input.language;
  sqlite.prepare(`UPDATE research_members SET role = ?, role_manual = ?, notes = ?, tags = ?, language = ?, language_confidence = ?, language_evidence = ?, language_manual = ?, updated_at = ? WHERE project_id = ? AND channel_id = ?`)
    .run(role, input.role ? 1 : member.role_manual, input.notes?.slice(0, 2000) ?? member.notes, JSON.stringify(tags), language, input.language === undefined ? member.language_confidence : 'manual', input.languageEvidence ?? (input.language === undefined ? member.language_evidence : 'Corrección manual del usuario.'), input.language === undefined ? member.language_manual : 1, Date.now(), projectId, channelId);
  if (input.role && input.role !== member.role) sqlite.prepare(`UPDATE research_projects SET last_score = NULL WHERE id = ?`).run(projectId);
  for (const tag of tags) sqlite.prepare(`INSERT INTO channel_tags (channel_id, tag, note) VALUES (?, ?, '') ON CONFLICT(channel_id, tag) DO NOTHING`).run(channelId, tag);
  return getProject(sqlite, projectId);
}

function upsertMember(sqlite: Database.Database, projectId: string, queryText: string, queryRole: string, channel: ResearchChannel, now: number, replaceFoundBy = false) {
  const views = channel.videos.map(video => video.views).filter((value): value is number => value != null && value > 0);
  const counts = channelOutlierCounts(channel.videos.map(video => ({ id: video.id, views: video.views, contentKind: video.contentKind })));
  const suggestion = suggestLanguage(channel.videos.map(video => video.title));
  const existing = sqlite.prepare(`SELECT * FROM research_members WHERE project_id = ? AND channel_id = ?`).get(projectId, channel.channelId) as MemberRow | undefined;
  const found = new Set<string>(replaceFoundBy || !existing ? [] : JSON.parse(existing.found_by));
  found.add(queryText);
  const role = existing?.role_manual ? existing.role : queryRole === 'reference' ? 'reference' : 'direct_competitor';
  const language = existing?.language_manual ? existing.language : suggestion.language;
  const confidence = existing?.language_manual ? existing.language_confidence : suggestion.confidence;
  const evidence = existing?.language_manual ? existing.language_evidence : suggestion.evidence;
  if (!existing) {
    sqlite.prepare(`INSERT INTO research_members (project_id, channel_id, title, role, role_manual, language, language_confidence, language_evidence, language_manual, notes, tags, found_by, subscribers, median_views, comparable_videos, outlier_videos, updated_at, in_sample)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, '', '[]', ?, ?, ?, ?, ?, ?, 1)`).run(projectId, channel.channelId, channel.title, role, language, confidence, evidence, JSON.stringify([...found]), channel.subscribers, views.length ? calculateMedian(views) : null, counts.comparable, counts.outliers, now);
  } else {
    sqlite.prepare(`UPDATE research_members SET title = ?, role = ?, language = ?, language_confidence = ?, language_evidence = ?, found_by = ?, subscribers = ?, median_views = ?, comparable_videos = ?, outlier_videos = ?, updated_at = ?, in_sample = 1 WHERE project_id = ? AND channel_id = ?`)
      .run(channel.title, role, language, confidence, evidence, JSON.stringify([...found]), channel.subscribers, views.length ? calculateMedian(views) : null, counts.comparable, counts.outliers, now, projectId, channel.channelId);
  }
  const samples = channel.videos.map(video => ({ id: video.id, views: video.views, contentKind: video.contentKind }));
  for (const video of channel.videos) {
    const reference = outlierReference(samples, video.id);
    sqlite.prepare(`INSERT INTO research_videos (project_id, channel_id, video_id, title, views, outlier, in_sample) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(project_id, video_id) DO UPDATE SET title = excluded.title, views = excluded.views, outlier = excluded.outlier, channel_id = excluded.channel_id, in_sample = 1`)
      .run(projectId, channel.channelId, video.id, video.title, video.views, reference.isOutlier ? 1 : 0);
  }
}

export function queueResearch(sqlite: Database.Database, projectId: string, now = Date.now()) {
  if (!sqlite.prepare(`SELECT id FROM research_projects WHERE id = ?`).get(projectId)) throw new HttpError(404, 'Investigación no encontrada');
  const job = enqueueJob(sqlite, { type: 'research_run', payload: { projectId }, dedupeKey: `research:${projectId}`, now });
  return { jobId: job.job.id, created: job.created, status: job.job.status };
}

type SeenChannel = { channel: ResearchChannel; queries: { text: string; role: string }[] };

function remember(seen: Map<string, SeenChannel>, query: QueryRow, channel: ResearchChannel) {
  const current = seen.get(channel.channelId);
  const entry = { text: query.query, role: query.role };
  if (!current) seen.set(channel.channelId, { channel, queries: [entry] });
  else current.queries.push(entry);
}

function applySeen(sqlite: Database.Database, projectId: string, seen: Map<string, SeenChannel>, now: number, replace: boolean) {
  if (replace) {
    sqlite.prepare(`UPDATE research_members SET in_sample = 0 WHERE project_id = ?`).run(projectId);
    sqlite.prepare(`UPDATE research_videos SET in_sample = 0 WHERE project_id = ?`).run(projectId);
  }
  for (const item of seen.values()) {
    item.queries.forEach((query, index) => upsertMember(sqlite, projectId, query.text, query.role, item.channel, now, replace && index === 0));
  }
}

export async function executeResearchJob(sqlite: Database.Database, job: JobRow, searcher: ResearchSearcher, control: LeaseControl = {}): Promise<void> {
  const token = job.lease_token;
  if (!token) return;
  const now = () => control.now?.() ?? Date.now();
  const projectId = (JSON.parse(job.payload) as { projectId: string }).projectId;
  const queries = sqlite.prepare(`SELECT * FROM research_queries WHERE project_id = ?`).all(projectId) as QueryRow[];
  const abort = new AbortController();
  const stopRenewal = holdLease(sqlite, job.id, token, { ...control, leaseMs: control.leaseMs ?? LEASE_MS }, () => abort.abort());
  const seen = new Map<string, SeenChannel>();
  let allComplete = queries.length > 0;
  try {
    for (const query of queries) {
      const at = now();
      const gate = jobOwnership(sqlite, job.id, token, at);
      if (gate === 'cancelled') { settleCancelled(sqlite, job.id, token, at); return; }
      if (gate !== 'owned' || abort.signal.aborted) return;
      sqlite.prepare(`UPDATE research_queries SET status = 'running', started_at = ?, error = NULL WHERE id = ?`).run(at, query.id);
      let result: ResearchSearch;
      try { result = await searcher({ query: query.query, filters: JSON.parse(query.filters), maxResults: query.max_results }); }
      catch (error) { result = { ok: false, partial: false, error: error instanceof Error ? error.message : 'Fallo de búsqueda', channels: [] }; }
      const finished = now();
      const still = jobOwnership(sqlite, job.id, token, finished);
      if (still === 'cancelled') { settleCancelled(sqlite, job.id, token, finished); return; }
      if (still !== 'owned') return;
      const status = result.ok && !result.partial ? 'complete' : result.channels.length ? 'partial' : 'failed';
      if (status !== 'complete') allComplete = false;
      sqlite.prepare(`UPDATE research_queries SET status = ?, error = ?, finished_at = ? WHERE id = ?`).run(status, result.ok ? null : result.error, finished, query.id);
      if (status === 'complete' || result.channels.length) for (const channel of result.channels) remember(seen, query, channel);
    }
    const at = now();
    const gate = jobOwnership(sqlite, job.id, token, at);
    if (gate === 'cancelled') { settleCancelled(sqlite, job.id, token, at); return; }
    if (gate !== 'owned') return;
    let committed = false;
    sqlite.transaction(() => {
      if (jobOwnership(sqlite, job.id, token, at) !== 'owned') return;
      applySeen(sqlite, projectId, seen, at, allComplete);
      const info = sqlite.prepare(`UPDATE jobs SET status = 'succeeded', finished_at = ?, progress = 'listo', error = NULL, lease_owner = NULL, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ? AND cancel_requested = 0 AND status = 'running' AND lease_until > ?`).run(at, job.id, token, at);
      if (info.changes !== 1) throw new Error('LEASE_LOST');
      committed = true;
    }).immediate();
    if (committed) scoreProject(sqlite, projectId);
  } catch (error) {
    if (error instanceof Error && error.message === 'LEASE_LOST') return;
    throw error;
  } finally {
    stopRenewal();
  }
}
