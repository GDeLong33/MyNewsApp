import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { SummarizerBusyError, type Summarizer } from "./ai/summarizer.js";
import { lastSuccessfulCollectionAt, RunInProgressError, type Collector } from "./collector/collect.js";
import type { Db } from "./db.js";

/** Bearer-token check for instructor/demo endpoints. Disabled entirely when no token is configured. */
function requireAdmin(adminToken: string | undefined) {
  const expected = adminToken ? createHash("sha256").update(adminToken).digest() : null;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!expected) {
      res.status(503).json({ error: "admin_disabled", message: "ADMIN_TOKEN is not configured on the server" });
      return;
    }
    const match = /^Bearer (.+)$/.exec(req.get("authorization") ?? "");
    const given = match ? createHash("sha256").update(match[1]).digest() : null;
    if (!given || !timingSafeEqual(given, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

function limitParam(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function adminRouter(
  db: Db,
  collector: Collector,
  adminToken: string | undefined,
  summarizer?: Summarizer,
): Router {
  const router = Router();
  router.use(requireAdmin(adminToken));

  // Manual collection trigger for demos. Waits for collection + grouping, then starts AI summaries in the
  // background (they are paced for the provider's rate limit, so they can take a few minutes).
  router.post("/collect", async (_req, res) => {
    try {
      const summary = await collector.run("manual");
      let summarizerStarted = false;
      if (summarizer && !summarizer.running) {
        summarizerStarted = true;
        summarizer.run().catch((err) => console.error("background summarization failed", err));
      }
      res.json({ ...summary, summarizerStarted });
    } catch (err) {
      if (err instanceof RunInProgressError) {
        res.status(409).json({ error: "run_in_progress", message: err.message });
        return;
      }
      throw err;
    }
  });

  // Manual AI summarization pass; waits for it to finish. ?retryFailed=true skips the 2-hour retry back-off.
  router.post("/summarize", async (req, res) => {
    if (!summarizer) {
      res.status(503).json({ error: "summarizer_unavailable" });
      return;
    }
    try {
      res.json(await summarizer.run({ retryFailed: req.query.retryFailed === "true" }));
    } catch (err) {
      if (err instanceof SummarizerBusyError) {
        res.status(409).json({ error: "summarizer_running", message: err.message });
        return;
      }
      throw err;
    }
  });

  // Job log: recent runs, newest first, each with its per-feed results.
  router.get("/runs", (req, res) => {
    const limit = limitParam(req.query.limit, 20, 200);
    const runs = db.prepare("SELECT * FROM job_runs ORDER BY id DESC LIMIT ?").all(limit) as { id: number }[];
    const feedRows = db.prepare("SELECT * FROM job_feed_results WHERE run_id = ? ORDER BY feed_id");
    res.json({
      lastSuccessfulCollectionAt: lastSuccessfulCollectionAt(db),
      running: collector.running,
      runs: runs.map((run) => ({ ...run, feeds: feedRows.all(run.id) })),
    });
  });

  // AI call log: every model request with outcome and token counts, plus summary coverage.
  router.get("/ai-calls", (req, res) => {
    const limit = limitParam(req.query.limit, 50, 500);
    const totals = db
      .prepare("SELECT COUNT(*) AS calls, SUM(ok) AS succeeded, SUM(1 - ok) AS failed FROM ai_calls")
      .get() as Record<string, number | null>;
    const coverage = db
      .prepare(`
        SELECT COUNT(*) AS stories,
               SUM(CASE WHEN m.input_hash = s.articles_hash THEN 1 ELSE 0 END) AS current,
               SUM(CASE WHEN m.content_json IS NOT NULL AND m.input_hash != s.articles_hash THEN 1 ELSE 0 END) AS outdated,
               SUM(CASE WHEN m.content_json IS NULL THEN 1 ELSE 0 END) AS none
        FROM stories s LEFT JOIN story_summaries m ON m.story_id = s.id
      `)
      .get();
    res.json({
      running: summarizer?.running ?? false,
      totals: { calls: Number(totals.calls ?? 0), succeeded: Number(totals.succeeded ?? 0), failed: Number(totals.failed ?? 0) },
      coverage,
      calls: db.prepare("SELECT * FROM ai_calls ORDER BY id DESC LIMIT ?").all(limit),
    });
  });

  // Stored articles, newest first, for checking what the collector saved.
  router.get("/articles", (req, res) => {
    const limit = limitParam(req.query.limit, 50, 500);
    const total = db.prepare("SELECT COUNT(*) AS n FROM articles").get() as { n: number };
    const byPublisher = db
      .prepare("SELECT publisher, COUNT(*) AS count FROM articles GROUP BY publisher ORDER BY publisher")
      .all();
    const articles = db.prepare("SELECT * FROM articles ORDER BY published_at DESC LIMIT ?").all(limit);
    res.json({ total: Number(total.n), byPublisher, articles });
  });

  return router;
}
