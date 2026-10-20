import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.js";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const rows = db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[];
  const applied = new Set(rows.map((r) => r.id));

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
  }
}

/** Run fn inside a transaction; roll back and rethrow if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function recordBoot(db: Db): void {
  db.prepare("INSERT INTO server_boots (booted_at) VALUES (?)").run(new Date().toISOString());
}

export interface BootStats {
  bootCount: number;
  firstBootAt: string | null;
  lastBootAt: string | null;
}

export function bootStats(db: Db): BootStats {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS bootCount, MIN(booted_at) AS firstBootAt, MAX(booted_at) AS lastBootAt FROM server_boots",
    )
    .get() as unknown as BootStats;
  return { bootCount: Number(row.bootCount), firstBootAt: row.firstBootAt, lastBootAt: row.lastBootAt };
}
