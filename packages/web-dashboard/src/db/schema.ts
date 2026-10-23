import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
