// Schema changes are applied in order, once each, and recorded in schema_migrations.
// Never edit a migration that has shipped; add a new one instead.
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: "server_boots",
    // One row per process start. /health reports these, so a restart that keeps
    // the old rows proves the database file survived.
    sql: `
      CREATE TABLE server_boots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booted_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: "articles_and_job_runs",
    sql: `
      -- One row per publisher article. url is the normalized URL, so re-fetching updates the row.
      CREATE TABLE articles (
        id TEXT PRIMARY KEY,                -- sha256(url), first 24 hex chars
        url TEXT NOT NULL UNIQUE,
        publisher TEXT NOT NULL,
        feed_id TEXT NOT NULL,              -- feed that first delivered it
        guid TEXT,
        title TEXT NOT NULL,
        excerpt TEXT,                       -- feed description, HTML stripped (not full text)
        published_at TEXT NOT NULL,         -- ISO 8601 UTC
        published_at_source TEXT NOT NULL CHECK (published_at_source IN ('feed', 'first_seen')),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL            -- last time title/excerpt/date changed
      );
      CREATE INDEX idx_articles_published_at ON articles(published_at);
      CREATE INDEX idx_articles_publisher ON articles(publisher);

      -- One row per collection run. Holds counts only, never article text.
      CREATE TABLE job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger TEXT NOT NULL,              -- schedule | manual | startup
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL,              -- running | success | partial | failed | interrupted
        feeds_ok INTEGER NOT NULL DEFAULT 0,
        feeds_failed INTEGER NOT NULL DEFAULT 0,
        items_seen INTEGER NOT NULL DEFAULT 0,
        articles_inserted INTEGER NOT NULL DEFAULT 0,
        articles_updated INTEGER NOT NULL DEFAULT 0,
        articles_unchanged INTEGER NOT NULL DEFAULT 0,
        items_skipped INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX idx_job_runs_started_at ON job_runs(started_at);

      -- Per-feed outcome of each run, so one failed feed is visible without failing the run.
      CREATE TABLE job_feed_results (
        run_id INTEGER NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
        feed_id TEXT NOT NULL,
        publisher TEXT NOT NULL,
        ok INTEGER NOT NULL,
        http_status INTEGER,
        items_seen INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL,
        error TEXT,
        PRIMARY KEY (run_id, feed_id)
      );
    `,
  },
];
