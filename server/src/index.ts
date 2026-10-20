import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb, recordBoot } from "./db.js";

const db = openDb(config.databasePath);
recordBoot(db);

const server = createApp(db).listen(config.port, "0.0.0.0", () => {
  console.log(`My News server listening on :${config.port} (db: ${config.databasePath})`);
});

// Docker sends SIGTERM before stopping the container; close cleanly so SQLite flushes the WAL.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
