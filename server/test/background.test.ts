import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { backgroundCandidates, updateBackground, type Fetcher } from "../src/background.js";
import { createCollector, type FeedConfig } from "../src/collector/collect.js";
import { openDb, type Db } from "../src/db.js";
import { entityLookupPhrases } from "../src/stories/features.js";
import { fakeFetcher, hoursBefore, rss, type FixtureItem } from "./helpers.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const FOX: FeedConfig = { id: "fox", publisher: "Fox News", url: "https://fox.test/feed.xml" };
const NPR: FeedConfig = { id: "npr", publisher: "NPR", url: "https://npr.test/feed.xml" };

const albertaFox: FixtureItem = {
  title: "Alberta holds separation vote as independence fight grips Canada",
  link: "https://www.foxnews.com/world/alberta-vote",
  description: "Voters in Alberta decided whether to pursue independence from Canada, with Prime Minister Mark Carney urging unity. Oil prices were also discussed in Calgary.",
  pubDate: hoursBefore(NOW, 5),
};
const albertaNpr: FixtureItem = {
  title: "Alberta voters reject a move toward independence in referendum backing Canadian unity",
  link: "https://www.npr.org/2026/10/20/alberta-referendum",
  description: "Alberta voters rejected independence in a referendum, a result Mark Carney welcomed as a vote for Canada.",
  pubDate: hoursBefore(NOW, 4),
};

type Page = { type: string; title: string; description?: string } | 404 | 500;

/** Fake Wikipedia summary endpoint keyed by the looked-up name. */
function fakeWiki(pages: Record<string, Page>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    const name = decodeURIComponent(url.split("/page/summary/")[1]).replace(/_/g, " ");
    asked.push(name);
    const page = pages[name] ?? 404;
    if (typeof page === "number") return new Response("{}", { status: page });
    return new Response(
      JSON.stringify({ ...page, content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${page.title.replace(/ /g, "_")}` } } }),
      { status: 200 },
    );
  };
  return Object.assign(fetcher, { asked });
}

const PAGES: Record<string, Page> = {
  Alberta: { type: "standard", title: "Alberta", description: "Province of Canada" },
  Canada: { type: "standard", title: "Canada", description: "Country in North America" },
  "Mark Carney": { type: "standard", title: "Mark Carney", description: "Prime Minister of Canada since 2025" },
  Calgary: { type: "standard", title: "Calgary", description: "City in Alberta, Canada" },
};

async function setup(items: Record<string, FixtureItem[]>) {
  const db = openDb(":memory:");
  const feeds = Object.fromEntries(Object.entries(items).map(([url, list]) => [url, rss(list)]));
  const collector = createCollector(db, { feeds: [FOX, NPR], fetcher: fakeFetcher(feeds), now: () => NOW });
  await collector.run("manual");
  return { db, collector };
}

function storyOf(db: Db, url: string): string {
  return (db.prepare("SELECT story_id FROM articles WHERE url = ?").get(url) as { story_id: string }).story_id;
}

test("lookup names drop titles and possessives", () => {
  assert.deepEqual(entityLookupPhrases("President Donald Trump's plan met Prime Minister Mark Carney in Ottawa."), [
    "Donald Trump",
    "Mark Carney",
    "Ottawa",
  ]);
});

test("a capitalized word at the start of a sentence only counts if the story also capitalizes it elsewhere", () => {
  const names = backgroundCandidates("Top Trump ally warns Republican Party could lose voters", [
    { title: "Top Trump ally warns Republican Party could lose voters", excerpt: "Violence erupts. A close ally of President Trump said the Republican Party is at risk." },
    { title: "Court records show Trump allies worried", excerpt: "Allies of Trump told a court the Republican Party faces losses." },
  ]).map((c) => c.phrase);
  assert.ok(names.includes("Trump"));
  assert.ok(names.includes("Republican Party"));
  assert.ok(!names.some((n) => /Top|Violence|Court/.test(n)), `unexpected: ${names.join(", ")}`);
});

test("only names in 2+ articles or the headline qualify; generic names and passing mentions don't", () => {
  const names = backgroundCandidates(albertaNpr.title!, [
    { title: albertaFox.title!, excerpt: albertaFox.description! },
    { title: albertaNpr.title!, excerpt: albertaNpr.description! },
  ]).map((c) => c.phrase);
  assert.ok(names.includes("Alberta"));
  assert.ok(names.includes("Mark Carney"));
  assert.ok(names.includes("Canada"));
  assert.ok(!names.includes("Calgary"), "mentioned once, not in the headline");
  assert.ok(!names.some((n) => /^(Fox|NPR)/.test(n)));
});

test("relevant pages are stored, served with descriptive labels, and capped per story", async () => {
  const { db } = await setup({ [FOX.url]: [albertaFox], [NPR.url]: [albertaNpr] });
  const wiki = fakeWiki(PAGES);
  const stats = await updateBackground(db, { fetcher: wiki, now: () => NOW });
  assert.equal(stats.storiesChecked, 1);
  assert.equal(stats.linksStored, 3);
  assert.ok(!wiki.asked.includes("Calgary"));

  const server = createApp(db, { now: () => NOW }).listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const story = await (await fetch(`http://127.0.0.1:${port}/stories/${storyOf(db, albertaFox.link!)}`)).json();
    assert.equal(story.background.length, 3);
    const alberta = story.background.find((b: { title: string }) => b.title === "Alberta (Wikipedia)");
    assert.equal(alberta.url, "https://en.wikipedia.org/wiki/Alberta");
    assert.equal(alberta.description, "Province of Canada");
    assert.equal(alberta.matchedTerm, "Alberta");
  } finally {
    server.close();
  }
});

test("ambiguous and missing pages are skipped, so no unrelated link is shown", async () => {
  const lone: FixtureItem = {
    title: "Mercury Party rising as Zorblax Group unveils plan",
    link: "https://www.foxnews.com/a/mercury",
    description: "A short report on the Mercury Party. Musk was mentioned once.",
    pubDate: hoursBefore(NOW, 2),
  };
  const { db } = await setup({ [FOX.url]: [lone], [NPR.url]: [] });
  const wiki = fakeWiki({
    "Mercury Party": { type: "disambiguation", title: "Mercury Party" },
    "Zorblax Group": { type: "standard", title: "Zorblax Group", description: "Surname list" },
    Musk: { type: "standard", title: "Musk", description: "Class of aromatic substances used in perfumes" },
  });
  await updateBackground(db, { fetcher: wiki, now: () => NOW });
  assert.deepEqual(wiki.asked.sort(), ["Mercury Party", "Zorblax Group"], "a single word in one article is never looked up");
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM story_background").get() as { n: number }).n), 0);
  const checked = db.prepare("SELECT background_hash FROM stories").get() as { background_hash: string | null };
  assert.ok(checked.background_hash, "story is marked as checked (none found), not retried every hour");
});

test("unchanged stories aren't re-checked, and repeated names come from the cache", async () => {
  const { db, collector } = await setup({ [FOX.url]: [albertaFox], [NPR.url]: [albertaNpr] });
  const wiki = fakeWiki(PAGES);
  await updateBackground(db, { fetcher: wiki, now: () => NOW });
  const firstAsks = wiki.asked.length;

  await collector.run("schedule");
  assert.equal((await updateBackground(db, { fetcher: wiki, now: () => NOW })).storiesChecked, 0);
  assert.equal(wiki.asked.length, firstAsks, "no new lookups for an unchanged story");
});

test("a network failure doesn't stop the pass and the story is retried next time", async () => {
  const { db } = await setup({ [FOX.url]: [albertaFox], [NPR.url]: [albertaNpr] });
  const failing = fakeWiki({ ...PAGES, Alberta: 500 });
  const stats = await updateBackground(db, { fetcher: failing, now: () => NOW });
  assert.equal(stats.failures, 1);
  assert.ok(stats.linksStored >= 1, "other names still produce links");
  const row = db.prepare("SELECT background_hash FROM stories").get() as { background_hash: string | null };
  assert.equal(row.background_hash, null, "left unchecked so the next run retries");
  assert.equal((await updateBackground(db, { fetcher: fakeWiki(PAGES), now: () => NOW })).storiesChecked, 1);
});

test("background links are removed with their story, and unused resources are deleted", async () => {
  const old = { ...albertaFox, pubDate: hoursBefore(NOW, 160) };
  const oldNpr = { ...albertaNpr, pubDate: hoursBefore(NOW, 159) };
  const db = openDb(":memory:");
  const clock = { now: NOW };
  const collector = createCollector(db, {
    feeds: [FOX, NPR],
    fetcher: fakeFetcher({ [FOX.url]: rss([old]), [NPR.url]: rss([oldNpr]) }),
    now: () => clock.now,
  });
  await collector.run("manual");
  await updateBackground(db, { fetcher: fakeWiki(PAGES), now: () => clock.now });
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM background_resources").get() as { n: number }).n), 3);

  clock.now = new Date(NOW.getTime() + 10 * 3600_000); // both articles past 168 hours
  await collector.run("schedule");
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM stories").get() as { n: number }).n), 0);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM story_background").get() as { n: number }).n), 0);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM background_resources").get() as { n: number }).n), 0);
});
