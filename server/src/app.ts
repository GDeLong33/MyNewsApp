import express, { type NextFunction, type Request, type Response } from "express";
import { bootStats, type Db } from "./db.js";

export function createApp(db: Db) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    const time = new Date().toISOString();
    try {
      res.json({ status: "ok", time, database: { ok: true, ...bootStats(db) } });
    } catch (err) {
      console.error("health check database error", err);
      res.status(503).json({ status: "error", time, database: { ok: false } });
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
