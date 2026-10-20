import { existsSync } from "node:fs";

// Local development reads server/.env. In production the host sets real env vars.
if (existsSync(".env")) process.loadEnvFile(".env");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Must point at persistent storage in production (docker-compose mounts server/data at /data).
  databasePath: process.env.DATABASE_PATH ?? "./data/mynews.db",
};
