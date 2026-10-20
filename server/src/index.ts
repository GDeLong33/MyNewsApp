import { DEFAULT_MODEL_CONFIG, GeminiClient } from "./ai/model.js";
import { createSummarizer } from "./ai/summarizer.js";
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

const modelConfig = { ...DEFAULT_MODEL_CONFIG, model: config.geminiModel ?? DEFAULT_MODEL_CONFIG.model };
const summarizer = createSummarizer(db, {
  client: config.geminiApiKey ? new GeminiClient(config.geminiApiKey, modelConfig) : null,
  maxPerRun: config.aiMaxPerRun,
  minIntervalMs: config.aiMinIntervalMs,
  publishers: [...new Set(FEEDS.map((f) => f.publisher))],
});

const server = createApp(db, { collector, summarizer, adminToken: config.adminToken }).listen(config.port, "0.0.0.0", () => {
  console.log(`My News server listening on :${config.port} (db: ${config.databasePath})`);
  if (!config.adminToken) console.warn("ADMIN_TOKEN is not set: /admin endpoints are disabled");
  console.log(
    config.geminiApiKey
      ? `AI summaries: ${modelConfig.model}, up to ${config.aiMaxPerRun} per run, ${config.aiMinIntervalMs} ms apart`
      : "GEMINI_API_KEY is not set: AI summaries are disabled and stories will show 'pending'",
  );
});

/** One hourly cycle: collect + group, then generate any missing or outdated AI summaries. */
async function cycle(trigger: "schedule" | "startup") {
  try {
    await collector.run(trigger);
  } finally {
    if (!summarizer.running) await summarizer.run();
  }
}

// Hourly work runs in this always-on process, independent of any client.
const stopSchedule = startHourlySchedule(() => cycle("schedule"));

if (config.collectOnStartup) {
  const last = db.prepare("SELECT MAX(started_at) AS at FROM job_runs WHERE outcome != 'interrupted'").get() as {
    at: string | null;
  };
  if (!last.at || Date.now() - Date.parse(last.at) > 50 * 60 * 1000) {
    cycle("startup").catch((err) => console.error("startup cycle failed", err));
  } else {
    summarizer.run().catch((err) => console.error("startup summarization failed", err));
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
