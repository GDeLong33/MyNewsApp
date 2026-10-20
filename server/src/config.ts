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
};
