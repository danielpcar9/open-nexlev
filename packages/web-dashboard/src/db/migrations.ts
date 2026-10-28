export type Migration = { version: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline_saved_channels',
    sql: `CREATE TABLE IF NOT EXISTS saved_channels (
      id TEXT PRIMARY KEY NOT NULL,
      snapshot TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );`,
  },
  {
    version: 2,
    name: 'tracking_observations',
    sql: `CREATE TABLE IF NOT EXISTS tracked_channels (
      channel_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      interval_hours INTEGER NOT NULL DEFAULT 6,
      provider TEXT NOT NULL,
      next_due_at INTEGER NOT NULL,
      last_success_at INTEGER,
      last_attempt_at INTEGER,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tracked_channels_due ON tracked_channels(active, next_due_at);
    CREATE TABLE IF NOT EXISTS channel_observations (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      provider TEXT NOT NULL,
      from_cache INTEGER NOT NULL DEFAULT 0,
      total_views INTEGER,
      total_views_precision TEXT NOT NULL,
      total_views_resolution INTEGER,
      subscribers INTEGER,
      subscribers_precision TEXT NOT NULL,
      subscribers_resolution INTEGER,
      video_count INTEGER,
      video_count_precision TEXT NOT NULL,
      video_count_resolution INTEGER,
      UNIQUE (channel_id, provider, observed_at)
    );
    CREATE INDEX IF NOT EXISTS channel_observations_channel_time ON channel_observations(channel_id, observed_at);
    CREATE TABLE IF NOT EXISTS video_observations (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      provider TEXT NOT NULL,
      from_cache INTEGER NOT NULL DEFAULT 0,
      views INTEGER,
      views_precision TEXT NOT NULL,
      views_resolution INTEGER,
      published_at INTEGER,
      published_text TEXT,
      content_kind TEXT NOT NULL,
      title TEXT,
      UNIQUE (video_id, provider, observed_at)
    );
    CREATE INDEX IF NOT EXISTS video_observations_channel_time ON video_observations(channel_id, observed_at);
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      query TEXT,
      filters TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS analysis_runs_started ON analysis_runs(started_at);
    CREATE INDEX IF NOT EXISTS analysis_runs_status ON analysis_runs(status);`,
  },
  {
    version: 3,
    name: 'jobs',
    sql: `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      dedupe_key TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at INTEGER NOT NULL,
      lease_owner TEXT,
      lease_until INTEGER,
      progress TEXT,
      error TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, next_attempt_at);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe ON jobs(dedupe_key) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      id TEXT PRIMARY KEY,
      pid INTEGER,
      last_seen_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );`,
  },
  {
    version: 4,
    name: 'alerts',
    sql: `CREATE TABLE IF NOT EXISTS alert_rules (
      channel_id TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 1,
      outlier_multiplier REAL NOT NULL DEFAULT 3,
      acceleration_percent REAL NOT NULL DEFAULT 100,
      acceleration_min_views INTEGER NOT NULL DEFAULT 1000,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      video_id TEXT,
      created_at INTEGER NOT NULL,
      evidence TEXT NOT NULL,
      rule_version INTEGER NOT NULL,
      read_at INTEGER,
      resolved_at INTEGER,
      dedupe_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS alerts_channel_created ON alerts(channel_id, created_at);`,
  },
  {
    version: 5,
    name: 'research',
    sql: `CREATE TABLE IF NOT EXISTS research_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      market TEXT,
      language TEXT,
      score_config TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_score TEXT
    );
    CREATE TABLE IF NOT EXISTS research_queries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id),
      role TEXT NOT NULL,
      query TEXT NOT NULL,
      filters TEXT NOT NULL,
      max_results INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS research_members (
      project_id TEXT NOT NULL REFERENCES research_projects(id),
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      role TEXT NOT NULL,
      role_manual INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      language_confidence TEXT,
      language_evidence TEXT,
      language_manual INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      found_by TEXT NOT NULL DEFAULT '[]',
      subscribers INTEGER,
      median_views INTEGER,
      comparable_videos INTEGER NOT NULL DEFAULT 0,
      outlier_videos INTEGER NOT NULL DEFAULT 0,
      weekly_growth REAL,
      growth_ready INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, channel_id)
    );
    CREATE TABLE IF NOT EXISTS research_videos (
      project_id TEXT NOT NULL REFERENCES research_projects(id),
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      views INTEGER,
      outlier INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS channel_tags (
      channel_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (channel_id, tag)
    );`,
  },
  {
    version: 6,
    name: 'lease_token_and_research_sample',
    sql: `ALTER TABLE jobs ADD COLUMN lease_token TEXT;
    ALTER TABLE research_members ADD COLUMN in_sample INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE research_videos ADD COLUMN in_sample INTEGER NOT NULL DEFAULT 1;`,
  },
  {
    version: 7,
    name: 'research_config_revision',
    sql: `ALTER TABLE research_projects ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 0;`,
  },
];
