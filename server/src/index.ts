import { createApp } from "./app.js";
import { createCollector, markInterruptedRuns } from "./collector/collect.js";
import { startHourlySchedule } from "./collector/scheduler.js";
import { config } from "./config.js";
import { openDb, recordBoot } from "./db.js";
import { FEEDS } from "./feeds.js";

const db = openDb(config.databasePath);
recordBoot(db);

const interrupted = markInterruptedRuns(db);
if (interrupted > 0) console.log(`marked ${interrupted} unfinished collection run(s) as interrupted`);

const collector = createCollector(db, { feeds: FEEDS });

const server = createApp(db, { collector, adminToken: config.adminToken }).listen(config.port, "0.0.0.0", () => {
  console.log(`My News server listening on :${config.port} (db: ${config.databasePath})`);
  if (!config.adminToken) console.warn("ADMIN_TOKEN is not set: /admin endpoints are disabled");
});

// Hourly collection runs in this always-on process, independent of any client.
const stopSchedule = startHourlySchedule(() => collector.run("schedule"));

if (config.collectOnStartup) {
  const last = db.prepare("SELECT MAX(started_at) AS at FROM job_runs WHERE outcome != 'interrupted'").get() as {
    at: string | null;
  };
  if (!last.at || Date.now() - Date.parse(last.at) > 50 * 60 * 1000) {
    collector.run("startup").catch((err) => console.error("startup collection failed", err));
  }
}

// Docker sends SIGTERM before stopping the container; close cleanly so SQLite flushes the WAL.
// A run cut off here is marked 'interrupted' on the next start.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopSchedule();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
