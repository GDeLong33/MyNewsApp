import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { bootStats, openDb, recordBoot } from "../src/db.js";

const tmp = mkdtempSync(join(tmpdir(), "mynews-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("GET /health reports ok and boot stats", async () => {
  const db = openDb(":memory:");
  recordBoot(db);
  const server = createApp(db).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.database.ok, true);
    assert.equal(body.database.bootCount, 1);
  } finally {
    server.close();
    db.close();
  }
});

test("unknown routes return JSON 404", async () => {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  } finally {
    server.close();
    db.close();
  }
});

test("data survives closing and reopening the database file", () => {
  const path = join(tmp, "nested", "persist.db");

  const first = openDb(path);
  recordBoot(first);
  const before = bootStats(first);
  first.close();

  // Reopening reruns migrations; they must be idempotent and keep existing rows.
  const second = openDb(path);
  recordBoot(second);
  const afterReopen = bootStats(second);
  second.close();

  assert.equal(before.bootCount, 1);
  assert.equal(afterReopen.bootCount, 2);
  assert.equal(afterReopen.firstBootAt, before.firstBootAt);
});
