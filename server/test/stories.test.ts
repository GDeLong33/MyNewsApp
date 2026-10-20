import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createCollector, type FeedConfig } from "../src/collector/collect.js";
import { openDb, type Db } from "../src/db.js";
import { extractEntities, featuresFor } from "../src/stories/features.js";
import { compareDocs, Corpus, makeDoc, sharedConcepts } from "../src/stories/similarity.js";
import { fakeFetcher, hoursBefore, rss, type FixtureItem } from "./helpers.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const FOX: FeedConfig = { id: "fox", publisher: "Fox News", url: "https://fox.test/feed.xml" };
const NPR: FeedConfig = { id: "npr", publisher: "NPR", url: "https://npr.test/feed.xml" };
const BBC: FeedConfig = { id: "bbc", publisher: "BBC News", url: "https://bbc.test/feed.xml" };

// One event (an Ebola case in Nigeria) reported by three publishers in different words.
const ebolaFox: FixtureItem = {
  title: "Nigeria confirms first Ebola case as outbreak spreads across West Africa",
  link: "https://www.foxnews.com/world/nigeria-ebola",
  description: "Health officials in Nigeria confirmed an Ebola infection in Lagos on Tuesday, the latest country hit by the regional outbreak.",
  pubDate: hoursBefore(NOW, 5),
};
const ebolaNpr: FixtureItem = {
  title: "Nigeria reports its first Ebola case as the outbreak spreads",
  link: "https://www.npr.org/2026/10/20/nigeria-ebola",
  description: "Nigeria is the latest country to report an Ebola case as the outbreak spreads across the region. Kenya confirmed its first case earlier this month.",
  pubDate: hoursBefore(NOW, 4),
};
const ebolaBbc: FixtureItem = {
  title: "Ebola: Patient in Lagos tests positive as Nigeria confirms case",
  link: "https://www.bbc.co.uk/news/articles/nigeria-ebola",
  description: "The patient, who recently travelled from Kenya, is being treated in isolation in Lagos, Nigerian health officials said.",
  pubDate: hoursBefore(NOW, 3),
};

// Related but separate #1: the same person, two unrelated events.
const trumpTariffs: FixtureItem = {
  title: "Trump signs executive order raising tariffs on steel imports",
  link: "https://www.foxnews.com/politics/trump-steel-tariffs",
  description: "President Trump signed an order raising tariffs on imported steel and aluminum, citing national security.",
  pubDate: hoursBefore(NOW, 6),
};
const trumpRally: FixtureItem = {
  title: "Trump rallies supporters in Pennsylvania ahead of midterm elections",
  link: "https://www.npr.org/2026/10/20/trump-rally-erie",
  description: "President Trump held a rally in Erie, Pennsylvania, urging supporters to vote for Republican candidates in the midterms.",
  pubDate: hoursBefore(NOW, 2),
};

// Related but separate #2: the same country as the Ebola story, a different event.
const nigeriaFloods: FixtureItem = {
  title: "Floods displace thousands in northern Nigeria after river bursts its banks",
  link: "https://www.bbc.co.uk/news/articles/nigeria-floods",
  description: "Heavy rain caused the Niger River to overflow near Kano, forcing thousands of families from their homes, officials said.",
  pubDate: hoursBefore(NOW, 1),
};

function storyOf(db: Db, url: string): string {
  const row = db.prepare("SELECT story_id FROM articles WHERE url = ?").get(url) as { story_id: string } | undefined;
  assert.ok(row, `article ${url} exists`);
  return row.story_id;
}

function count(db: Db, sql: string, ...params: string[]): number {
  return Number(Object.values(db.prepare(sql).get(...params) as Record<string, number>)[0]);
}

function setup(feeds: Record<string, FixtureItem[] | number>, clock = { now: NOW }) {
  const db = openDb(":memory:");
  const responses: Record<string, string | number> = {};
  const set = (next: Record<string, FixtureItem[] | number>) => {
    for (const [url, value] of Object.entries(next)) responses[url] = typeof value === "number" ? value : rss(value);
  };
  set(feeds);
  const collector = createCollector(db, { feeds: [FOX, NPR, BBC], fetcher: fakeFetcher(responses), now: () => clock.now });
  return { db, collector, set, clock };
}

const allFixtures = {
  [FOX.url]: [ebolaFox, trumpTariffs],
  [NPR.url]: [ebolaNpr, trumpRally],
  [BBC.url]: [ebolaBbc, nigeriaFloods],
};

test("the same event from three publishers becomes one story", async () => {
  const { db, collector } = setup(allFixtures);
  const run = await collector.run("manual");

  const story = storyOf(db, ebolaFox.link!);
  assert.equal(storyOf(db, ebolaNpr.link!), story);
  assert.equal(storyOf(db, ebolaBbc.link!), story);
  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(story) as Record<string, unknown>;
  assert.equal(row.publisher_count, 3);
  assert.equal(row.article_count, 3);
  assert.equal(row.updated_at, new Date(NOW.getTime() - 3 * 3600_000).toISOString(), "update time = latest article");
  assert.equal(story, `s_${(db.prepare("SELECT id FROM articles WHERE url = ?").get(ebolaFox.link!) as { id: string }).id}`,
    "story ID comes from the earliest (founding) article");
  assert.equal(run.stories?.storiesCreated, 4);
  assert.equal(run.stories?.articlesJoined, 2);
});

test("related but separate #1: the same person in two unrelated events stays as two stories", async () => {
  const { db, collector } = setup(allFixtures);
  await collector.run("manual");
  assert.notEqual(storyOf(db, trumpTariffs.link!), storyOf(db, trumpRally.link!));
});

test("related but separate #2: the same country in a different event stays separate", async () => {
  const { db, collector } = setup(allFixtures);
  await collector.run("manual");
  assert.notEqual(storyOf(db, nigeriaFloods.link!), storyOf(db, ebolaBbc.link!));
});

test("single-source stories are kept and labeled with one publisher", async () => {
  const { db, collector } = setup(allFixtures);
  await collector.run("manual");
  for (const item of [trumpTariffs, trumpRally, nigeriaFloods]) {
    const row = db.prepare("SELECT article_count, publisher_count FROM stories WHERE id = ?").get(storyOf(db, item.link!));
    assert.deepEqual({ ...(row as object) }, { article_count: 1, publisher_count: 1 });
  }
  assert.equal(count(db, "SELECT COUNT(*) FROM stories"), 4);
});

test("re-running identical input creates no new stories and keeps IDs", async () => {
  const { db, collector } = setup(allFixtures);
  await collector.run("manual");
  const before = db.prepare("SELECT id, headline FROM stories ORDER BY id").all();
  const second = await collector.run("schedule");
  assert.deepEqual(second.stories, { articlesExpired: 0, storiesCreated: 0, articlesJoined: 0, storiesRemoved: 0 });
  assert.deepEqual(db.prepare("SELECT id, headline FROM stories ORDER BY id").all(), before);
});

test("new coverage on a later run joins the existing story without duplicating it", async () => {
  const { db, collector, set } = setup({ [FOX.url]: [ebolaFox], [NPR.url]: [], [BBC.url]: [] });
  await collector.run("manual");
  const story = storyOf(db, ebolaFox.link!);

  set({ [NPR.url]: [ebolaNpr], [BBC.url]: [ebolaBbc] });
  const later = await collector.run("schedule");
  assert.equal(later.stories?.storiesCreated, 0);
  assert.equal(later.stories?.articlesJoined, 2);
  assert.equal(storyOf(db, ebolaNpr.link!), story);
  assert.equal(count(db, "SELECT COUNT(*) FROM stories"), 1);
  const evidence = JSON.parse(
    (db.prepare("SELECT story_match_json FROM articles WHERE url = ?").get(ebolaNpr.link!) as { story_match_json: string })
      .story_match_json,
  );
  assert.ok(evidence.score >= 0.2);
  assert.ok(evidence.sharedConcepts.some((c: string) => c.includes("ebola")));
});

test("a broad roundup article cannot chain two unrelated events into one story", async () => {
  const doj: FixtureItem = {
    title: "DOJ charges 28 in California with voting crimes as election tensions escalate",
    link: "https://www.npr.org/a/doj-voting",
    description: "The Justice Department charged 28 people in California with voting crimes ahead of the election.",
    pubDate: hoursBefore(NOW, 6),
  };
  const roundup: FixtureItem = {
    title: "Morning news brief",
    link: "https://www.npr.org/a/morning-brief",
    description:
      "The Justice Department charged 28 people in California with voting crimes ahead of the election. " +
      "Trump waived sanctions on Russia as he seeks a deal to end the war in Ukraine.",
    pubDate: hoursBefore(NOW, 5),
  };
  const russia: FixtureItem = {
    title: "Trump waives sanctions on Russia as he seeks a deal to end the war in Ukraine",
    link: "https://www.npr.org/a/russia-sanctions",
    description: "Trump waived sanctions on Russia, pressing Moscow and Kyiv toward a deal to end the war in Ukraine.",
    pubDate: hoursBefore(NOW, 4),
  };

  // Sanity check: on its own, the Russia article does match the roundup, so chaining is a real risk here.
  const corpus = new Corpus();
  const feats = [doj, roundup, russia].map((i) => featuresFor(i.title!, i.description!));
  feats.forEach((f) => corpus.add(f));
  const [dDoj, dRoundup, dRussia] = [doj, roundup, russia].map((i, k) => makeDoc(String(k), new Date(Date.parse(i.pubDate!)).toISOString(), feats[k], corpus));
  assert.ok(compareDocs(dRoundup, dDoj, corpus), "roundup matches the DOJ story");
  assert.ok(compareDocs(dRussia, dRoundup, corpus), "Russia article matches the roundup");
  assert.equal(compareDocs(dRussia, dDoj, corpus), null, "Russia article does not match the DOJ story");

  const { db, collector } = setup({ [FOX.url]: [], [NPR.url]: [doj, roundup, russia], [BBC.url]: [] });
  await collector.run("manual");
  assert.equal(storyOf(db, roundup.link!), storyOf(db, doj.link!));
  assert.notEqual(storyOf(db, russia.link!), storyOf(db, doj.link!));
});

test("expiry deletes articles past 168 hours, removes empty stories and their summaries, keeps recent ones", async () => {
  const old: FixtureItem = { ...trumpTariffs, pubDate: hoursBefore(NOW, 160) };
  const clock = { now: NOW };
  const { db, collector, set } = setup({ [FOX.url]: [old], [NPR.url]: [trumpRally], [BBC.url]: [] }, clock);
  await collector.run("manual");
  const oldStory = storyOf(db, old.link!);
  db.prepare("INSERT INTO story_summaries (story_id, input_hash, status) VALUES (?, 'x', 'ready')").run(oldStory);

  clock.now = new Date(NOW.getTime() + 10 * 3600_000); // old article is now 170 hours old
  set({ [FOX.url]: [] });
  const run = await collector.run("schedule");

  assert.equal(run.stories?.articlesExpired, 1);
  assert.equal(run.stories?.storiesRemoved, 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles WHERE url = ?", old.link!), 0);
  assert.equal(count(db, "SELECT COUNT(*) FROM stories WHERE id = ?", oldStory), 0);
  assert.equal(count(db, "SELECT COUNT(*) FROM story_summaries WHERE story_id = ?", oldStory), 0, "summary cascades");
  assert.equal(count(db, "SELECT COUNT(*) FROM articles WHERE url = ?", trumpRally.link!), 1, "recent article stays");
  const logged = db.prepare("SELECT articles_expired, stories_removed FROM job_runs WHERE id = ?").get(run.id);
  assert.deepEqual({ ...(logged as object) }, { articles_expired: 1, stories_removed: 1 });
});

test("expiry still runs when every feed fails", async () => {
  const clock = { now: NOW };
  const old: FixtureItem = { ...trumpTariffs, pubDate: hoursBefore(NOW, 167) };
  const { db, collector, set } = setup({ [FOX.url]: [old], [NPR.url]: [trumpRally], [BBC.url]: [] }, clock);
  await collector.run("manual");

  clock.now = new Date(NOW.getTime() + 2 * 3600_000);
  set({ [FOX.url]: 500, [NPR.url]: 500, [BBC.url]: 500 });
  const run = await collector.run("schedule");
  assert.equal(run.outcome, "failed");
  assert.equal(run.stories?.articlesExpired, 1);
  assert.equal(count(db, "SELECT COUNT(*) FROM articles"), 1, "only the expired article is removed");
});

test("a story that loses one source keeps the rest, and its summary fingerprint changes", async () => {
  const clock = { now: NOW };
  const oldFox: FixtureItem = { ...ebolaFox, pubDate: hoursBefore(NOW, 100) };
  const npr: FixtureItem = { ...ebolaNpr, pubDate: hoursBefore(NOW, 98) };
  const bbc: FixtureItem = { ...ebolaBbc, pubDate: hoursBefore(NOW, 60) };
  const { db, collector } = setup({ [FOX.url]: [oldFox], [NPR.url]: [npr], [BBC.url]: [bbc] }, clock);
  await collector.run("manual");
  const story = storyOf(db, oldFox.link!);
  assert.equal(storyOf(db, bbc.link!), story);
  const before = db.prepare("SELECT articles_hash FROM stories WHERE id = ?").get(story) as { articles_hash: string };
  db.prepare("INSERT INTO story_summaries (story_id, input_hash, status) VALUES (?, ?, 'ready')").run(story, before.articles_hash);

  clock.now = new Date(NOW.getTime() + 69 * 3600_000); // Fox is now 169h old (expires); NPR 167h and BBC 129h stay
  await collector.run("schedule");

  const after = db.prepare("SELECT publisher_count, article_count, articles_hash FROM stories WHERE id = ?").get(story) as Record<string, unknown>;
  assert.equal(after.publisher_count, 2);
  assert.equal(after.article_count, 2);
  assert.notEqual(after.articles_hash, before.articles_hash);
  const summary = db.prepare("SELECT input_hash FROM story_summaries WHERE story_id = ?").get(story) as { input_hash: string };
  assert.notEqual(summary.input_hash, after.articles_hash, "the old summary no longer matches its inputs");
});

test("the API hides expired articles between runs and lists stories newest first", async () => {
  const clock = { now: NOW };
  const old: FixtureItem = { ...trumpTariffs, pubDate: hoursBefore(NOW, 165) };
  const { db, collector } = setup({ [FOX.url]: [old, ebolaFox], [NPR.url]: [ebolaNpr, trumpRally], [BBC.url]: [ebolaBbc] }, clock);
  await collector.run("manual");
  const oldStory = storyOf(db, old.link!);
  const ebola = storyOf(db, ebolaFox.link!);

  const server = createApp(db, { now: () => clock.now }).listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let list = await (await fetch(`${base}/stories`)).json();
    assert.equal(list.stories.length, 3);
    assert.deepEqual(list.stories.map((s: { id: string }) => s.id).slice(0, 1), [storyOf(db, trumpRally.link!)], "newest first");
    const ebolaEntry = list.stories.find((s: { id: string }) => s.id === ebola);
    assert.equal(ebolaEntry.publisherCount, 3);
    assert.deepEqual(ebolaEntry.publishers, ["BBC News", "Fox News", "NPR"]);
    assert.ok(list.lastSuccessfulCollectionAt);

    const detail = await (await fetch(`${base}/stories/${ebola}`)).json();
    assert.deepEqual(detail.sources.map((s: { publisher: string }) => s.publisher), ["BBC News", "Fox News", "NPR"]);
    assert.equal(detail.sources[1].articles[0].url, "https://www.foxnews.com/world/nigeria-ebola");
    assert.equal(detail.sources[1].articles[0].publishedAtEstimated, false);

    // Four hours later, without any collection run, the 165-hour-old article is past 168 hours.
    clock.now = new Date(NOW.getTime() + 4 * 3600_000);
    list = await (await fetch(`${base}/stories`)).json();
    assert.equal(list.stories.length, 2);
    assert.ok(!list.stories.some((s: { id: string }) => s.id === oldStory));
    assert.equal((await fetch(`${base}/stories/${oldStory}`)).status, 404);
    assert.equal(count(db, "SELECT COUNT(*) FROM articles WHERE url = ?", old.link!), 1, "row still stored until the next run");

    assert.equal((await fetch(`${base}/stories/does-not-exist`)).status, 404);
  } finally {
    server.close();
  }
});

test("entity extraction treats names as phrases and ignores titles", () => {
  assert.deepEqual(extractEntities("President Donald Trump met Kate Middleton at the Bank of England."), [
    ["donald", "trump"],
    ["kate", "middleton"],
    ["bank", "england"],
  ]);
  assert.deepEqual(extractEntities("The FAA said Tuesday."), [["faa"]]);
});

test("one shared name counts as one concept, so it can never merge stories alone", () => {
  const corpus = new Corpus();
  const a = featuresFor("Donald Trump visits Ohio factory", "Donald Trump toured a car plant.");
  const b = featuresFor("Trump comments on Supreme Court ruling", "Trump criticized the justices.");
  corpus.add(a);
  corpus.add(b);
  const da = makeDoc("a", NOW.toISOString(), a, corpus);
  const db = makeDoc("b", NOW.toISOString(), b, corpus);
  assert.deepEqual(sharedConcepts(da, db, corpus).concepts, [["trump"]]);
  assert.equal(compareDocs(da, db, corpus), null);
});
