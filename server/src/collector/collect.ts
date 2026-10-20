import { transaction, type Db } from "../db.js";
import { articleIdFor, cleanText, normalizeUrl, parsePublishedDate } from "./normalize.js";
import { parseFeed } from "./parse.js";

export interface FeedConfig {
  id: string;
  publisher: string;
  url: string;
}

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export type Trigger = "schedule" | "manual" | "startup";

export interface CollectorOptions {
  feeds: FeedConfig[];
  fetcher?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
}

export interface FeedResult {
  feedId: string;
  publisher: string;
  ok: boolean;
  httpStatus: number | null;
  itemsSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  durationMs: number;
  error: string | null;
}

export interface RunSummary {
  id: number;
  trigger: Trigger;
  startedAt: string;
  finishedAt: string;
  outcome: "success" | "partial" | "failed";
  feedsOk: number;
  feedsFailed: number;
  itemsSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  feeds: FeedResult[];
}

export class RunInProgressError extends Error {
  constructor() {
    super("a collection run is already in progress");
  }
}

export interface Collector {
  readonly running: boolean;
  run(trigger: Trigger): Promise<RunSummary>;
}

export const RETENTION_MS = 168 * 60 * 60 * 1000;
const USER_AGENT = "MyNewsBot/0.1 (CS 403 class project; RSS reader)";
const DEFAULT_TIMEOUT_MS = 15_000;

/** One collector per database; it refuses overlapping runs. */
export function createCollector(db: Db, options: CollectorOptions): Collector {
  let active: Promise<RunSummary> | null = null;
  return {
    get running() {
      return active !== null;
    },
    run(trigger) {
      if (active) return Promise.reject(new RunInProgressError());
      active = runOnce(db, options, trigger).finally(() => {
        active = null;
      });
      return active;
    },
  };
}

/** Runs left as 'running' were cut off by a crash or restart. Call once at startup. */
export function markInterruptedRuns(db: Db, now = new Date()): number {
  const result = db
    .prepare("UPDATE job_runs SET outcome = 'interrupted', finished_at = ? WHERE outcome = 'running'")
    .run(now.toISOString());
  return Number(result.changes);
}

interface FetchOutcome {
  feed: FeedConfig;
  httpStatus: number | null;
  xml: string | null;
  error: string | null;
  durationMs: number;
}

async function fetchFeed(feed: FeedConfig, fetcher: Fetcher, timeoutMs: number): Promise<FetchOutcome> {
  const started = Date.now();
  const done = (httpStatus: number | null, xml: string | null, error: string | null): FetchOutcome => ({
    feed,
    httpStatus,
    xml,
    error,
    durationMs: Date.now() - started,
  });
  try {
    const res = await fetcher(feed.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) return done(res.status, null, `HTTP ${res.status}`);
    return done(res.status, await res.text(), null);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : errorMessage(err);
    return done(null, null, message);
  }
}

async function runOnce(db: Db, options: CollectorOptions, trigger: Trigger): Promise<RunSummary> {
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const startedAt = now().toISOString();
  const runId = Number(
    db
      .prepare("INSERT INTO job_runs (trigger, started_at, outcome) VALUES (?, ?, 'running')")
      .run(trigger, startedAt).lastInsertRowid,
  );

  try {
    // Fetch all feeds in parallel; fetchFeed never throws, so one bad feed can't sink the others.
    const fetched = await Promise.all(options.feeds.map((f) => fetchFeed(f, fetcher, timeoutMs)));
    const runNow = now();
    const feeds = fetched.map((f) => ingestFeed(db, f, runNow));

    const sum = (key: "itemsSeen" | "inserted" | "updated" | "unchanged" | "skipped") =>
      feeds.reduce((total, f) => total + f[key], 0);
    const feedsOk = feeds.filter((f) => f.ok).length;
    const feedsFailed = feeds.length - feedsOk;
    const outcome = feedsFailed === 0 ? "success" : feedsOk === 0 ? "failed" : "partial";
    const finishedAt = now().toISOString();

    const summary: RunSummary = {
      id: runId,
      trigger,
      startedAt,
      finishedAt,
      outcome,
      feedsOk,
      feedsFailed,
      itemsSeen: sum("itemsSeen"),
      inserted: sum("inserted"),
      updated: sum("updated"),
      unchanged: sum("unchanged"),
      skipped: sum("skipped"),
      feeds,
    };

    transaction(db, () => {
      const insertFeed = db.prepare(`
        INSERT INTO job_feed_results
          (run_id, feed_id, publisher, ok, http_status, items_seen, inserted, updated, unchanged, skipped, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const f of feeds) {
        insertFeed.run(
          runId, f.feedId, f.publisher, f.ok ? 1 : 0, f.httpStatus, f.itemsSeen,
          f.inserted, f.updated, f.unchanged, f.skipped, f.durationMs, f.error,
        );
      }
      db.prepare(`
        UPDATE job_runs SET finished_at = ?, outcome = ?, feeds_ok = ?, feeds_failed = ?, items_seen = ?,
          articles_inserted = ?, articles_updated = ?, articles_unchanged = ?, items_skipped = ?, error = ?
        WHERE id = ?
      `).run(
        finishedAt, outcome, feedsOk, feedsFailed, summary.itemsSeen, summary.inserted,
        summary.updated, summary.unchanged, summary.skipped,
        outcome === "failed" ? "all feeds failed" : null, runId,
      );
    });

    console.log(
      `collection run ${runId} (${trigger}): ${outcome}, ${feedsOk}/${feeds.length} feeds ok, ` +
        `${summary.inserted} new, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.skipped} skipped`,
    );
    return summary;
  } catch (err) {
    db.prepare("UPDATE job_runs SET finished_at = ?, outcome = 'failed', error = ? WHERE id = ?").run(
      now().toISOString(),
      errorMessage(err),
      runId,
    );
    throw err;
  }
}

interface ExistingArticle {
  title: string;
  excerpt: string | null;
  published_at: string;
  published_at_source: "feed" | "first_seen";
}

/** Parse one fetched feed and upsert its articles in a single transaction. Never throws. */
function ingestFeed(db: Db, fetched: FetchOutcome, now: Date): FeedResult {
  const result: FeedResult = {
    feedId: fetched.feed.id,
    publisher: fetched.feed.publisher,
    ok: false,
    httpStatus: fetched.httpStatus,
    itemsSeen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    durationMs: fetched.durationMs,
    error: fetched.error,
  };
  if (fetched.xml === null) return result;

  const nowIso = now.toISOString();
  const cutoffMs = now.getTime() - RETENTION_MS;
  const counts = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };

  try {
    const items = parseFeed(fetched.xml);
    result.itemsSeen = items.length;

    const select = db.prepare(
      "SELECT title, excerpt, published_at, published_at_source FROM articles WHERE url = ?",
    );
    const insert = db.prepare(`
      INSERT INTO articles
        (id, url, publisher, feed_id, guid, title, excerpt, published_at, published_at_source,
         first_seen_at, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = db.prepare(`
      UPDATE articles SET guid = ?, title = ?, excerpt = ?, published_at = ?, published_at_source = ?,
        last_seen_at = ?, updated_at = ?
      WHERE url = ?
    `);
    const touch = db.prepare("UPDATE articles SET last_seen_at = ? WHERE url = ?");

    transaction(db, () => {
      for (const item of items) {
        const url = item.link ? normalizeUrl(item.link) : null;
        const title = cleanText(item.title, 300);
        if (!url || !title) {
          counts.skipped++;
          continue;
        }
        const excerpt = cleanText(item.description, 1000) || null;
        const date = parsePublishedDate(item.dates, now);
        const existing = select.get(url) as ExistingArticle | undefined;

        if (!existing) {
          // Don't store articles that are already outside the 7-day window.
          if (date.kind === "valid" && Date.parse(date.iso) < cutoffMs) {
            counts.skipped++;
            continue;
          }
          const publishedAt = date.kind === "valid" ? date.iso : nowIso;
          const source = date.kind === "valid" ? "feed" : "first_seen";
          insert.run(
            articleIdFor(url), url, fetched.feed.publisher, fetched.feed.id, item.guid ?? null,
            title, excerpt, publishedAt, source, nowIso, nowIso, nowIso,
          );
          counts.inserted++;
          continue;
        }

        // A valid feed date replaces the stored one; a missing/invalid one keeps the stored date,
        // so a first-seen fallback never moves forward and the article still expires on time.
        const publishedAt = date.kind === "valid" ? date.iso : existing.published_at;
        const source = date.kind === "valid" ? "feed" : existing.published_at_source;
        const changed =
          existing.title !== title || existing.excerpt !== excerpt || existing.published_at !== publishedAt;
        if (changed) {
          update.run(item.guid ?? null, title, excerpt, publishedAt, source, nowIso, nowIso, url);
          counts.updated++;
        } else {
          touch.run(nowIso, url);
          counts.unchanged++;
        }
      }
    });

    Object.assign(result, counts, { ok: true, error: null });
  } catch (err) {
    // Parse or database error: this feed's writes were rolled back; other feeds are unaffected.
    result.error = errorMessage(err);
  }
  return result;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
