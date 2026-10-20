import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createCollector, type FeedConfig } from "../src/collector/collect.js";
import { msUntilNextHour } from "../src/collector/scheduler.js";
import { openDb } from "../src/db.js";
import { fakeFetcher, hoursBefore, rss } from "./helpers.js";

const TOKEN = "test-admin-token";
const FEED: FeedConfig = { id: "npr-news", publisher: "NPR", url: "https://npr.test/news.xml" };

async function withServer(adminToken: string | undefined, fn: (base: string) => Promise<void>) {
  const db = openDb(":memory:");
  const fetcher = fakeFetcher({
    [FEED.url]: rss([{ title: "Story", link: "https://www.npr.org/a/1", pubDate: hoursBefore(new Date(), 1) }]),
  });
  const collector = createCollector(db, { feeds: [FEED], fetcher });
  const server: Server = createApp(db, { collector, adminToken }).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    db.close();
  }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test("admin endpoints reject missing or wrong tokens", async () => {
  await withServer(TOKEN, async (base) => {
    assert.equal((await fetch(`${base}/admin/collect`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/admin/collect`, { method: "POST", headers: auth("wrong") })).status, 401);
    assert.equal((await fetch(`${base}/admin/runs`, { headers: { authorization: TOKEN } })).status, 401);
  });
});

test("admin endpoints are disabled when no token is configured", async () => {
  await withServer(undefined, async (base) => {
    const res = await fetch(`${base}/admin/collect`, { method: "POST", headers: auth("anything") });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "admin_disabled");
  });
});

test("manual trigger runs a collection; runs and articles are then visible", async () => {
  await withServer(TOKEN, async (base) => {
    const collect = await fetch(`${base}/admin/collect`, { method: "POST", headers: auth(TOKEN) });
    assert.equal(collect.status, 200);
    const summary = await collect.json();
    assert.equal(summary.trigger, "manual");
    assert.equal(summary.outcome, "success");
    assert.equal(summary.inserted, 1);

    const runs = await (await fetch(`${base}/admin/runs`, { headers: auth(TOKEN) })).json();
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].outcome, "success");
    assert.equal(runs.runs[0].feeds[0].feed_id, "npr-news");
    assert.equal(runs.lastSuccessfulCollectionAt, summary.startedAt);

    const articles = await (await fetch(`${base}/admin/articles`, { headers: auth(TOKEN) })).json();
    assert.equal(articles.total, 1);
    assert.equal(articles.articles[0].title, "Story");
    assert.deepEqual(articles.byPublisher, [{ publisher: "NPR", count: 1 }]);
  });
});

test("msUntilNextHour targets the next top of the hour in UTC", () => {
  assert.equal(msUntilNextHour(new Date("2026-10-20T12:00:00.000Z")), 3600_000);
  assert.equal(msUntilNextHour(new Date("2026-10-20T12:59:30.000Z")), 30_000);
  assert.equal(msUntilNextHour(new Date("2026-10-20T23:45:00.000Z")), 15 * 60_000);
});
