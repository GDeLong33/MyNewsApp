import { existsSync } from "node:fs";

const PLACEHOLDER_TOKEN = "replace-with-a-long-random-string";

/** The repo is public, so the .env.example placeholder or a short token would be guessable: treat as unset. */
function usableAdminToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token === PLACEHOLDER_TOKEN || token.length < 16) {
    console.warn("ADMIN_TOKEN is the example placeholder or shorter than 16 characters; ignoring it");
    return undefined;
  }
  return token;
}

// Local development reads server/.env. In production the host sets real env vars.
if (existsSync(".env")) process.loadEnvFile(".env");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Must point at persistent storage in production (docker-compose mounts server/data at /data).
  databasePath: process.env.DATABASE_PATH ?? "./data/mynews.db",
  // Bearer token for /admin endpoints (manual collect, job log). Unset = admin endpoints disabled.
  adminToken: usableAdminToken(process.env.ADMIN_TOKEN),
  // Collect once at startup if the last run is older than ~50 minutes.
  collectOnStartup: process.env.COLLECT_ON_STARTUP !== "false",
  // AI summaries (Gemini). No key = summaries stay "pending"; the rest of the server works normally.
  geminiApiKey: process.env.GEMINI_API_KEY || undefined,
  geminiModel: process.env.GEMINI_MODEL || undefined,
  // Free-tier pacing. The free quota seen on 2026-10-20 was 20 requests/day for gemini-3.8-flash, so by default the
  // server spends at most 10 calls per quota day (retries included), 2 stories per hourly run, on stories with 2+ articles.
  aiDailyBudget: positiveInt(process.env.AI_DAILY_BUDGET, 10),
  aiMaxPerRun: positiveInt(process.env.AI_MAX_PER_RUN, 2),
  aiMinArticles: positiveInt(process.env.AI_MIN_ARTICLES, 2),
  aiMinIntervalMs: positiveInt(process.env.AI_MIN_INTERVAL_MS, 6500),
};

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
