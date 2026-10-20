import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCollector,
  markInterruptedRuns,
  RunInProgressError,
  type FeedConfig,
  type Fetcher,
} from "../src/collector/collect.js";
import { openDb, type Db } from "../src/db.js";
import { fakeFetcher, hoursBefore, rss } from "./helpers.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const now = () => NOW;

const FOX: FeedConfig = { id: "fox-latest", publisher: "Fox News", url: "https://fox.test/latest.xml" };
const FOX_WORLD: FeedConfig = { id: "fox-world", publisher: "Fox News", url: "https://fox.test/world.xml" };
const NPR: FeedConfig = { id: "npr-news", publisher: "NPR", url: "https://npr.test/news.xml" };
const BBC: FeedConfig = { id: "bbc-top", publisher: "BBC News", url: "https://bbc.test/top.xml" };

const foxXml = rss([
  { title: "Fox story one", link: "https://www.foxnews.com/politics/one", pubDate: hoursBefore(NOW, 2) },
  { title: "Fox story two", link: "https://www.foxnews.com/world/two", pubDate: hoursBefore(NOW, 5) },
]);
const nprXml = rss([
  { title: "NPR story", link: "https://www.npr.org/2026/10/20/nr-1/story", pubDate: hoursBefore(NOW, 1) },
]);
const bbcXml = rss([
  {
    title: "BBC story",
    link: "https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&amp;at_campaign=rss",
    pubDate: hoursBefore(NOW, 3),
  },
]);

function count(db: Db, sql: string, ...params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function setup(responses: Record<string, string | number | Error>, feeds = [FOX, NPR, BBC]) {
  const db = openDb(":memory:");
  const fetcher = fakeFetcher(responses);
  const collector = createCollector(db, { feeds, fetcher, now });
  return { db, fetcher, collector };
}

test("first run stores every article and logs a successful job run", async () => {
  const { db, collector } = setup({ [FOX.url]: foxXml, [NPR.url]: nprXml, [BBC.url]: bbcXml });
  const summary = await collector.run("manual");

  assert.equal(summary.outcome, "success");
  assert.equal(summary.inserted, 4);
  assert.equal(summary.feedsOk, 3);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 4);

  const run = db.prepare("SELECT * FROM job_runs WHERE id = ?").get(summary.id) as Record<string, unknown>;
  assert.equal(run.outcome, "success");
  assert.equal(run.trigger, "manual");
  assert.equal(run.started_at, NOW.toISOString());
  assert.equal(run.articles_inserted, 4);
  assert.equal(count(db, "SELECT COUNT(*) FROM job_feed_results WHERE run_id = ? AND ok = 1", summary.id), 3);

  const bbc = db.prepare("SELECT * FROM articles WHERE publisher = 'BBC News'").get() as Record<string, unknown>;
  assert.equal(bbc.url, "https://www.bbc.co.uk/news/articles/abc");
  assert.equal(bbc.published_at, new Date(NOW.getTime() - 3 * 3600_000).toISOString());
  assert.equal(bbc.published_at_source, "feed");
});

test("re-fetching identical feeds does not duplicate articles", async () => {
  const { db, collector } = setup({ [FOX.url]: foxXml, [NPR.url]: nprXml, [BBC.url]: bbcXml });
  await collector.run("manual");
  const ids = db.prepare("SELECT id FROM articles ORDER BY id").all();

  const second = await collector.run("schedule");
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 4);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 4);
  assert.deepEqual(db.prepare("SELECT id FROM articles ORDER BY id").all(), ids, "IDs are stable across runs");
  assert.equal(count(db, "SELECT COUNT(*) FROM job_runs"), 2);
});

test("a changed headline updates the existing row instead of adding one", async () => {
  const responses: Record<string, string> = { [FOX.url]: foxXml };
  const { db, collector } = setup(responses, [FOX]);
  await collector.run("manual");

  responses[FOX.url] = rss([
    { title: "Fox story one (updated)", link: "https://www.foxnews.com/politics/one", pubDate: hoursBefore(NOW, 2) },
    { title: "Fox story two", link: "https://www.foxnews.com/world/two", pubDate: hoursBefore(NOW, 5) },
  ]);
  const summary = await collector.run("manual");
  assert.equal(summary.updated, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 2);
  assert.equal(
    count(db, "SELECT COUNT(*) FROM articles WHERE title = 'Fox story one (updated)'"),
    1,
  );
});

test("the same article via different tracking URLs or two feeds is stored once", async () => {
  const link = "https://www.foxnews.com/world/shared";
  const { db, collector } = setup(
    {
      [FOX.url]: rss([{ title: "Shared", link: `${link}?utm_source=rss`, pubDate: hoursBefore(NOW, 1) }]),
      [FOX_WORLD.url]: rss([{ title: "Shared", link: `${link}/#comments`, pubDate: hoursBefore(NOW, 1) }]),
    },
    [FOX, FOX_WORLD],
  );
  const summary = await collector.run("manual");
  assert.equal(summary.inserted, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 1);
});

test("missing or invalid dates fall back to first-seen time and never move forward", async () => {
  const responses: Record<string, string> = {
    [FOX.url]: rss([
      { title: "No date", link: "https://fox.test/a/no-date" },
      { title: "Bad date", link: "https://fox.test/a/bad-date", pubDate: "sometime soon" },
      { title: "Future date", link: "https://fox.test/a/future", pubDate: "Fri, 01 Jan 2027 00:00:00 GMT" },
    ]),
  };
  let clock = NOW;
  const db = openDb(":memory:");
  const collector = createCollector(db, { feeds: [FOX], fetcher: fakeFetcher(responses), now: () => clock });

  await collector.run("manual");
  const rows = db.prepare("SELECT published_at, published_at_source FROM articles").all() as Record<string, string>[];
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.published_at_source, "first_seen");
    assert.equal(r.published_at, NOW.toISOString());
  }

  // Two hours later the same undated items are still undated: their fallback date must not move.
  clock = new Date(NOW.getTime() + 2 * 3600_000);
  const later = await collector.run("schedule");
  assert.equal(later.unchanged, 3);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles WHERE published_at = ?", NOW.toISOString()), 3);
});

test("a valid date arriving later replaces the first-seen fallback", async () => {
  const responses: Record<string, string> = {
    [FOX.url]: rss([{ title: "Undated", link: "https://fox.test/a/x" }]),
  };
  const { db, collector } = setup(responses, [FOX]);
  await collector.run("manual");

  responses[FOX.url] = rss([{ title: "Undated", link: "https://fox.test/a/x", pubDate: hoursBefore(NOW, 6) }]);
  const summary = await collector.run("manual");
  assert.equal(summary.updated, 1);
  const row = db.prepare("SELECT published_at, published_at_source FROM articles").get() as Record<string, string>;
  assert.equal(row.published_at_source, "feed");
  assert.equal(row.published_at, new Date(NOW.getTime() - 6 * 3600_000).toISOString());
});

test("items without a usable link or title, or already older than 7 days, are skipped", async () => {
  const { db, collector } = setup(
    {
      [FOX.url]: rss([
        { title: "No link" },
        { title: "Bad link", link: "not a url" },
        { title: "", link: "https://fox.test/a/empty-title" },
        { title: "Eight days old", link: "https://fox.test/a/old", pubDate: hoursBefore(NOW, 192) },
        { title: "Six days old", link: "https://fox.test/a/ok", pubDate: hoursBefore(NOW, 144) },
      ]),
    },
    [FOX],
  );
  const summary = await collector.run("manual");
  assert.equal(summary.outcome, "success");
  assert.equal(summary.itemsSeen, 5);
  assert.equal(summary.skipped, 4);
  assert.equal(summary.inserted, 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 1);
});

test("one failing feed does not stop the others; the run is recorded as partial", async () => {
  const { db, collector } = setup({
    [FOX.url]: foxXml,
    [NPR.url]: 503,
    // BBC missing from the map: the fake fetcher throws a DNS-style error.
  });
  const summary = await collector.run("schedule");

  assert.equal(summary.outcome, "partial");
  assert.equal(summary.feedsOk, 1);
  assert.equal(summary.feedsFailed, 2);
  assert.equal(summary.inserted, 2);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 2);

  const results = db
    .prepare("SELECT feed_id, ok, http_status, error FROM job_feed_results WHERE run_id = ? ORDER BY feed_id")
    .all(summary.id) as Record<string, unknown>[];
  assert.deepEqual(
    results.map((r) => [r.feed_id, r.ok]),
    [["bbc-top", 0], ["fox-latest", 1], ["npr-news", 0]],
  );
  assert.equal(results[2].http_status, 503);
  assert.equal(results[2].error, "HTTP 503");
  assert.match(String(results[0].error), /ENOTFOUND/);
});

test("a feed returning non-feed content fails alone and its partial writes are rolled back", async () => {
  const { db, collector } = setup({
    [FOX.url]: foxXml,
    [NPR.url]: "<html><body>Temporarily unavailable</body></html>",
    [BBC.url]: bbcXml,
  });
  const summary = await collector.run("manual");
  assert.equal(summary.outcome, "partial");
  const npr = summary.feeds.find((f) => f.feedId === "npr-news")!;
  assert.equal(npr.ok, false);
  assert.match(npr.error!, /not an RSS or Atom feed/);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles WHERE publisher = 'NPR'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 3);
});

test("a timed-out feed is reported as a timeout", async () => {
  const db = openDb(":memory:");
  const hanging: Fetcher = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  const collector = createCollector(db, { feeds: [FOX], fetcher: hanging, now, timeoutMs: 50 });
  const summary = await collector.run("manual");
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.feeds[0].error, "timed out after 50 ms");
});

test("when every feed fails, existing articles are kept and the run is marked failed", async () => {
  const responses: Record<string, string | number> = { [FOX.url]: foxXml, [NPR.url]: nprXml, [BBC.url]: bbcXml };
  const { db, collector } = setup(responses);
  await collector.run("manual");

  responses[FOX.url] = 500;
  responses[NPR.url] = 502;
  responses[BBC.url] = "garbage";
  const summary = await collector.run("schedule");

  assert.equal(summary.outcome, "failed");
  assert.equal(summary.feedsOk, 0);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 4, "still-valid articles are not erased");
  const run = db.prepare("SELECT outcome, error FROM job_runs WHERE id = ?").get(summary.id) as Record<string, string>;
  assert.equal(run.outcome, "failed");
  assert.equal(run.error, "all feeds failed");
});

test("overlapping runs are refused", async () => {
  const db = openDb(":memory:");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow: Fetcher = async () => {
    await gate;
    return new Response(foxXml, { status: 200 });
  };
  const collector = createCollector(db, { feeds: [FOX], fetcher: slow, now });

  const first = collector.run("schedule");
  assert.equal(collector.running, true);
  await assert.rejects(collector.run("manual"), RunInProgressError);
  release();
  assert.equal((await first).outcome, "success");
  assert.equal(collector.running, false);
  assert.equal(count(db, "SELECT COUNT(*) FROM job_runs"), 1);
});

test("runs left 'running' by a crash are marked interrupted at startup", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO job_runs (trigger, started_at, outcome) VALUES ('schedule', ?, 'running')").run(
    NOW.toISOString(),
  );
  assert.equal(markInterruptedRuns(db, NOW), 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM job_runs WHERE outcome = 'interrupted'"), 1);
  assert.equal(markInterruptedRuns(db, NOW), 0);
});
