import express, { type NextFunction, type Request, type Response } from "express";
import { adminRouter } from "./admin.js";
import type { Summarizer } from "./ai/summarizer.js";
import { storiesRouter } from "./api.js";
import type { Collector } from "./collector/collect.js";
import { bootStats, type Db } from "./db.js";

export interface AppOptions {
  collector?: Collector;
  summarizer?: Summarizer;
  adminToken?: string;
  /** Clock for retention filtering; injectable for tests. */
  now?: () => Date;
  /** Stories with fewer articles show AI status "not_available" (must match the summarizer's minArticles). */
  aiMinArticles?: number;
}

export function createApp(db: Db, options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");

  app.use(storiesRouter(db, options.now ?? (() => new Date()), options.aiMinArticles));

  app.get("/health", (_req, res) => {
    const time = new Date().toISOString();
    try {
      res.json({ status: "ok", time, database: { ok: true, ...bootStats(db) } });
    } catch (err) {
      console.error("health check database error", err);
      res.status(503).json({ status: "error", time, database: { ok: false } });
    }
  });

  if (options.collector) {
    app.use("/admin", adminRouter(db, options.collector, options.adminToken, options.summarizer));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
