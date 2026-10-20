// Schema changes are applied in order, once each, and recorded in schema_migrations.
// Never edit a migration that has shipped; add a new one instead.
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: "server_boots",
    // One row per process start. /health reports these, so a restart that keeps
    // the old rows proves the database file survived.
    sql: `
      CREATE TABLE server_boots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booted_at TEXT NOT NULL
      );
    `,
  },
];
