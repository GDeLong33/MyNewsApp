import type { Db } from "../db.js";
import { retentionCutoffIso } from "../retention.js";
import { ModelError, type ModelClient } from "./model.js";
import { buildUserPrompt, PROMPT_VERSION, RESPONSE_SCHEMA, SYSTEM_PROMPT, type PromptArticle } from "./prompt.js";
import { InvalidOutputError, validateAnalysis } from "./validate.js";

export interface SummarizerOptions {
  /** null when no API key is configured: the summarizer then does nothing and stories show "pending". */
  client: ModelClient | null;
  maxPerRun: number;
  /** Minimum gap between model calls, to stay under the provider's requests-per-minute limit. */
  minIntervalMs: number;
  /** Wait this long before retrying a story whose same inputs already failed (not for temporary provider errors). */
  retryAfterMs?: number;
  /** Pause before the single in-batch retry of a temporary provider error (overload, timeout). */
  transientRetryDelayMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  publishers: string[];
}

export interface SummarizeResult {
  skipped: "no_api_key" | null;
  candidates: number;
  attempted: number;
  generated: number;
  failed: number;
  stoppedEarly: string | null;
}

export class SummarizerBusyError extends Error {
  constructor() {
    super("summarization is already running");
  }
}

export interface RunOptions {
  /** Ignore the retry back-off, e.g. after fixing a configuration error. */
  retryFailed?: boolean;
}

export interface Summarizer {
  readonly running: boolean;
  run(runOptions?: RunOptions): Promise<SummarizeResult>;
}

/** Articles sent per story; one per publisher first, then the newest others. */
const MAX_PROMPT_ARTICLES = 12;
const DEFAULT_RETRY_AFTER_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 15_000;
/** Stop the batch after this many stories in a row fail with temporary provider errors (the service is struggling). */
const MAX_CONSECUTIVE_TRANSIENT = 3;

interface CandidateRow {
  id: string;
  headline: string;
  articles_hash: string;
}

interface ArticleRow {
  id: string;
  publisher: string;
  title: string;
  excerpt: string | null;
  published_at: string;
}

export function createSummarizer(db: Db, options: SummarizerOptions): Summarizer {
  let active: Promise<SummarizeResult> | null = null;
  return {
    get running() {
      return active !== null;
    },
    run(runOptions = {}) {
      if (active) return Promise.reject(new SummarizerBusyError());
      active = runOnce(db, options, runOptions).finally(() => {
        active = null;
      });
      return active;
    },
  };
}

/**
 * Stories whose stored summary doesn't match their current articles (or that have none), most important first:
 * more publishers, then more articles, then newest. A story whose current inputs already failed recently waits.
 */
export function storiesNeedingSummary(db: Db, now: Date, retryAfterMs: number, limit: number): CandidateRow[] {
  return db
    .prepare(`
      SELECT s.id, s.headline, s.articles_hash
      FROM stories s LEFT JOIN story_summaries m ON m.story_id = s.id
      WHERE s.updated_at >= ?
        AND (m.input_hash IS NULL OR m.input_hash != s.articles_hash)
        AND NOT (m.last_error IS NOT NULL AND m.last_error_retryable = 0
                 AND m.last_attempt_hash = s.articles_hash AND m.last_attempt_at > ?)
      ORDER BY s.publisher_count DESC, s.article_count DESC, s.updated_at DESC, s.id
      LIMIT ?
    `)
    .all(retentionCutoffIso(now), new Date(now.getTime() - retryAfterMs).toISOString(), limit) as unknown as CandidateRow[];
}

function pickArticles(rows: ArticleRow[]): ArticleRow[] {
  const sorted = [...rows].sort((a, b) => b.published_at.localeCompare(a.published_at));
  const chosen: ArticleRow[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    if (!seen.has(r.publisher)) {
      seen.add(r.publisher);
      chosen.push(r);
    }
  }
  for (const r of sorted) if (!chosen.includes(r)) chosen.push(r);
  return chosen.slice(0, MAX_PROMPT_ARTICLES).sort((a, b) => a.published_at.localeCompare(b.published_at));
}

async function runOnce(db: Db, options: SummarizerOptions, runOptions: RunOptions): Promise<SummarizeResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const result: SummarizeResult = { skipped: null, candidates: 0, attempted: 0, generated: 0, failed: 0, stoppedEarly: null };
  if (!options.client) return { ...result, skipped: "no_api_key" };
  const client = options.client;

  const retryAfterMs = runOptions.retryFailed ? 0 : (options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
  const candidates = storiesNeedingSummary(db, now(), retryAfterMs, options.maxPerRun);
  result.candidates = candidates.length;

  const loadArticles = db.prepare(`
    SELECT id, publisher, title, excerpt, published_at FROM articles
    WHERE story_id = ? AND published_at >= ? ORDER BY published_at, id
  `);
  const logCall = db.prepare(`
    INSERT INTO ai_calls (story_id, started_at, duration_ms, model, prompt_version, input_hash, article_count, ok, error, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const saveSuccess = db.prepare(`
    INSERT INTO story_summaries (story_id, content_json, input_hash, input_article_ids, excerpt_only, model, prompt_version,
      generated_at, last_attempt_at, last_attempt_hash, last_error)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(story_id) DO UPDATE SET content_json = excluded.content_json, input_hash = excluded.input_hash,
      input_article_ids = excluded.input_article_ids, excerpt_only = 1, model = excluded.model,
      prompt_version = excluded.prompt_version, generated_at = excluded.generated_at,
      last_attempt_at = excluded.last_attempt_at, last_attempt_hash = excluded.last_attempt_hash, last_error = NULL,
      last_error_retryable = 0
  `);
  // A failure records the attempt but leaves any earlier successful content in place.
  const saveFailure = db.prepare(`
    INSERT INTO story_summaries (story_id, last_attempt_at, last_attempt_hash, last_error, last_error_retryable)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(story_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
      last_attempt_hash = excluded.last_attempt_hash, last_error = excluded.last_error,
      last_error_retryable = excluded.last_error_retryable
  `);
  const transientDelay = options.transientRetryDelayMs ?? DEFAULT_TRANSIENT_RETRY_DELAY_MS;
  let consecutiveTransient = 0;

  for (const [index, story] of candidates.entries()) {
    if (index > 0) await sleep(options.minIntervalMs);
    const rows = loadArticles.all(story.id, retentionCutoffIso(now())) as unknown as ArticleRow[];
    if (rows.length === 0) continue;
    const chosen = pickArticles(rows);
    const promptArticles: PromptArticle[] = chosen.map((a, i) => ({
      ref: `A${i + 1}`,
      publisher: a.publisher,
      title: a.title,
      published: a.published_at,
      excerpt: a.excerpt,
    }));

    result.attempted++;
    let startedAt = now().toISOString();
    let t0 = Date.now();
    let usage: { input: number | null; output: number | null } = { input: null, output: null };
    let modelName = client.model;
    const request = { system: SYSTEM_PROMPT, user: buildUserPrompt(story.headline, promptArticles), schema: RESPONSE_SCHEMA };
    try {
      let response;
      try {
        response = await client.generate(request);
      } catch (err) {
        if (!(err instanceof ModelError && err.transient)) throw err;
        // Temporary provider trouble: log this attempt, wait, and try once more.
        logCall.run(story.id, startedAt, Date.now() - t0, modelName, PROMPT_VERSION, story.articles_hash, chosen.length, 0,
          `${err.message.slice(0, 450)} (retrying)`, null, null);
        await sleep(transientDelay);
        startedAt = now().toISOString();
        t0 = Date.now();
        response = await client.generate(request);
      }
      usage = { input: response.inputTokens, output: response.outputTokens };
      modelName = response.model;
      const analysis = validateAnalysis(
        response.text,
        chosen.map((a, i) => ({ ref: `A${i + 1}`, id: a.id, title: a.title, excerpt: a.excerpt })),
        options.publishers,
      );
      const { dropped, ...content } = analysis;
      const generatedAt = now().toISOString();
      saveSuccess.run(
        story.id, JSON.stringify(content), story.articles_hash, JSON.stringify(chosen.map((a) => a.id)),
        modelName, PROMPT_VERSION, generatedAt, generatedAt, story.articles_hash,
      );
      logCall.run(story.id, startedAt, Date.now() - t0, modelName, PROMPT_VERSION, story.articles_hash, chosen.length, 1,
        dropped.length ? `validation dropped: ${dropped.join("; ").slice(0, 500)}` : null, usage.input, usage.output);
      result.generated++;
      consecutiveTransient = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof ModelError && err.transient;
      result.failed++;
      try {
        saveFailure.run(story.id, now().toISOString(), story.articles_hash, message.slice(0, 500), retryable ? 1 : 0);
      } catch {
        // The story was deleted by a collection run while the model was working; nothing to record against.
      }
      logCall.run(story.id, startedAt, Date.now() - t0, modelName, PROMPT_VERSION, story.articles_hash, chosen.length, 0,
        message.slice(0, 500), usage.input, usage.output);
      if (err instanceof ModelError && err.kind === "rate_limited") {
        result.stoppedEarly = "rate limited; remaining stories wait for the next run";
        break;
      }
      if (err instanceof ModelError && err.kind === "config") {
        result.stoppedEarly = `configuration error, stopping until it is fixed: ${message.slice(0, 200)}`;
        break;
      }
      consecutiveTransient = retryable ? consecutiveTransient + 1 : 0;
      if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
        result.stoppedEarly = `model unavailable for ${consecutiveTransient} stories in a row; remaining stories wait for the next run`;
        break;
      }
      if (!(err instanceof ModelError) && !(err instanceof InvalidOutputError)) console.error("summarizer error", err);
    }
  }

  console.log(
    `summarizer: ${result.generated} generated, ${result.failed} failed of ${result.attempted} attempted` +
      (result.stoppedEarly ? ` (${result.stoppedEarly})` : ""),
  );
  return result;
}
