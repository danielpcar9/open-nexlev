import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(), // UC...
  title: text('title').notNull(),
  handle: text('handle'),
  subscriberCount: integer('subscriber_count').notNull(),
  viewCount: integer('view_count').notNull().default(0),
  videoCount: integer('video_count').notNull().default(0),
  avgViewsLast15: integer('avg_views_last_15').notNull(),
  subscriberToViewRatio: real('subscriber_to_view_ratio').notNull(),
  isFacelessCandidate: integer('is_faceless_candidate', { mode: 'boolean' }).default(true),
  nicheKeywords: text('niche_keywords'), // JSON array
  isSavedInSwipeFile: integer('is_saved_in_swipe_file', { mode: 'boolean' }).default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').references(() => channels.id),
  title: text('title').notNull(),
  viewCount: integer('view_count').notNull(),
  outlierScore: real('outlier_score').notNull(),
  viewsToSubsRatio: real('views_to_subs_ratio').notNull(),
  publishedText: text('published_text'),
  thumbnailUrl: text('thumbnail_url'),
  url: text('url').notNull(),
});

// A saved analysis is a snapshot, including the outliers and RPM assumptions.
export const savedChannels = sqliteTable('saved_channels', {
  id: text('id').primaryKey(),
  snapshot: text('snapshot', { mode: 'json' }).$type<import('@open-nexlev/niche-engine').NicheChannelResult>().notNull(),
  savedAt: integer('saved_at').notNull(),
});

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: integer('applied_at').notNull(),
});

export const trackedChannels = sqliteTable('tracked_channels', {
  channelId: text('channel_id').primaryKey(),
  title: text('title').notNull(),
  active: integer('active').notNull().default(1),
  intervalHours: integer('interval_hours').notNull().default(6),
  provider: text('provider').notNull(),
  nextDueAt: integer('next_due_at').notNull(),
  lastSuccessAt: integer('last_success_at'),
  lastAttemptAt: integer('last_attempt_at'),
  consecutiveErrors: integer('consecutive_errors').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
});

export const channelObservations = sqliteTable('channel_observations', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  observedAt: integer('observed_at').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
  provider: text('provider').notNull(),
  fromCache: integer('from_cache').notNull().default(0),
  totalViews: integer('total_views'),
  totalViewsPrecision: text('total_views_precision').notNull(),
  totalViewsResolution: integer('total_views_resolution'),
  subscribers: integer('subscribers'),
  subscribersPrecision: text('subscribers_precision').notNull(),
  subscribersResolution: integer('subscribers_resolution'),
  videoCount: integer('video_count'),
  videoCountPrecision: text('video_count_precision').notNull(),
  videoCountResolution: integer('video_count_resolution'),
}, table => [unique().on(table.channelId, table.provider, table.observedAt)]);

export const videoObservations = sqliteTable('video_observations', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  videoId: text('video_id').notNull(),
  observedAt: integer('observed_at').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
  provider: text('provider').notNull(),
  fromCache: integer('from_cache').notNull().default(0),
  views: integer('views'),
  viewsPrecision: text('views_precision').notNull(),
  viewsResolution: integer('views_resolution'),
  publishedAt: integer('published_at'),
  publishedText: text('published_text'),
  contentKind: text('content_kind').notNull(),
  title: text('title'),
}, table => [unique().on(table.videoId, table.provider, table.observedAt)]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  dedupeKey: text('dedupe_key'),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  leaseOwner: text('lease_owner'),
  leaseUntil: integer('lease_until'),
  progress: text('progress'),
  error: text('error'),
  cancelRequested: integer('cancel_requested').notNull().default(0),
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  channelId: text('channel_id').notNull(),
  videoId: text('video_id'),
  createdAt: integer('created_at').notNull(),
  evidence: text('evidence').notNull(),
  ruleVersion: integer('rule_version').notNull(),
  readAt: integer('read_at'),
  resolvedAt: integer('resolved_at'),
  dedupeKey: text('dedupe_key').notNull().unique(),
});

export const researchProjects = sqliteTable('research_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  market: text('market'),
  language: text('language'),
  scoreConfig: text('score_config').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastScore: text('last_score'),
});

export const researchMembers = sqliteTable('research_members', {
  projectId: text('project_id').notNull().references(() => researchProjects.id),
  channelId: text('channel_id').notNull(),
  title: text('title').notNull(),
  role: text('role').notNull(),
  roleManual: integer('role_manual').notNull().default(0),
  language: text('language'),
  languageConfidence: text('language_confidence'),
  languageEvidence: text('language_evidence'),
  languageManual: integer('language_manual').notNull().default(0),
  notes: text('notes').notNull().default(''),
  tags: text('tags').notNull().default('[]'),
  foundBy: text('found_by').notNull().default('[]'),
  subscribers: integer('subscribers'),
  medianViews: integer('median_views'),
  comparableVideos: integer('comparable_videos').notNull().default(0),
  outlierVideos: integer('outlier_videos').notNull().default(0),
  weeklyGrowth: real('weekly_growth'),
  growthReady: integer('growth_ready').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.channelId] })]);
