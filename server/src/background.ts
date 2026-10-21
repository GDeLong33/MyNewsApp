import type { Db } from "./db.js";
import { retentionCutoffIso } from "./retention.js";
import { entityLookupPhrases, entityText, nameLikeWords } from "./stories/features.js";

// Background resources: for each story, look up Wikipedia pages for the names it is about. Only names that appear
// in at least 2 of the story's articles, or multi-word names/acronyms in its headline, qualify, so a passing mention
// never produces a link. Ambiguous names (disambiguation pages, name lists) and missing pages are skipped, not guessed.
// See docs/background.md.

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export interface BackgroundOptions {
  fetcher?: Fetcher;
  now?: () => Date;
  maxStoriesPerRun?: number;
  maxLinksPerStory?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export interface BackgroundStats {
  storiesChecked: number;
  storiesWithLinks: number;
  linksStored: number;
  lookups: number;
  cacheHits: number;
  failures: number;
}

const USER_AGENT = "MyNewsBot/0.1 (CS 403 class project; https://github.com/GDeLong33/MyNewsApp)";
const SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";

// Names that are too generic to be useful context, plus the outlets themselves.
const GENERIC = new Set(
  `us u.s usa uk u.k america american americans britain british europe european world west east north south
  january february march april may june july august september october november december
  fox fox news npr bbc bbc news cnn cbs nbc abc reuters ap associated press watch live exclusive breaking
  god government congress police`
    .split(/\s+/)
    .filter(Boolean),
);

interface StoryRow {
  id: string;
  headline: string;
  articles_hash: string;
}

interface Candidate {
  phrase: string;
  key: string;
  articles: number;
  inHeadline: boolean;
}

/** Names worth looking up for one story, best first. */
export function backgroundCandidates(
  headline: string,
  articles: { title: string; excerpt: string | null }[],
): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const texts = articles.map((a) => entityText(a.title, a.excerpt));
  // Words this story capitalizes mid-sentence somewhere: only those count when they start a sentence.
  const nameLike = new Set([headline, ...texts].flatMap((t) => [...nameLikeWords(t)]));
  const headlinePhrases = entityLookupPhrases(headline, nameLike);
  const headlineKeys = new Set(headlinePhrases.map((p) => p.toLowerCase()));
  for (const text of texts) {
    const seen = new Set<string>();
    for (const phrase of entityLookupPhrases(text, nameLike)) {
      const key = phrase.toLowerCase();
      if (GENERIC.has(key) || seen.has(key)) continue;
      seen.add(key);
      const c = byKey.get(key) ?? { phrase, key, articles: 0, inHeadline: headlineKeys.has(key) };
      c.articles++;
      byKey.set(key, c);
    }
  }
  // Headline names count even when the headline itself is Title Case and wasn't scanned above.
  for (const key of headlineKeys) {
    if (!byKey.has(key) && !GENERIC.has(key)) {
      const phrase = headlinePhrases.find((p) => p.toLowerCase() === key)!;
      byKey.set(key, { phrase, key, articles: 0, inHeadline: true });
    }
  }
  const score = (c: Candidate) => c.articles * 2 + (c.inHeadline ? 2 : 0) + (c.phrase.includes(" ") ? 1 : 0);
  // A single word from the headline alone is too risky ("Musk" -> perfume, "Watt" -> unit of power); single words
  // need 2+ articles. Multi-word names and acronyms (NATO, FBI) can qualify from the headline.
  const specific = (c: Candidate) => c.phrase.includes(" ") || /^[A-Z0-9]{2,}$/.test(c.phrase);
  return [...byKey.values()]
    .filter((c) => c.articles >= 2 || (c.inHeadline && specific(c)))
    .sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
}

interface Resource {
  id: number;
}

/** Choose background links for stories whose articles changed since their last check (multi-publisher first). */
export async function updateBackground(db: Db, options: BackgroundOptions = {}): Promise<BackgroundStats> {
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;
  const maxLinks = options.maxLinksPerStory ?? 3;
  const ttlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const stats: BackgroundStats = { storiesChecked: 0, storiesWithLinks: 0, linksStored: 0, lookups: 0, cacheHits: 0, failures: 0 };

  const stories = db
    .prepare(`
      SELECT id, headline, articles_hash FROM stories
      WHERE updated_at >= ? AND (background_hash IS NULL OR background_hash != articles_hash)
      ORDER BY publisher_count DESC, article_count DESC, updated_at DESC, id
      LIMIT ?
    `)
    .all(retentionCutoffIso(now()), options.maxStoriesPerRun ?? 40) as unknown as StoryRow[];

  const loadArticles = db.prepare("SELECT title, excerpt FROM articles WHERE story_id = ? AND published_at >= ?");
  const cached = db.prepare("SELECT resource_id, status, checked_at FROM wiki_lookups WHERE term_key = ?");
  const saveLookup = db.prepare(`
    INSERT INTO wiki_lookups (term_key, resource_id, status, checked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(term_key) DO UPDATE SET resource_id = excluded.resource_id, status = excluded.status, checked_at = excluded.checked_at
  `);
  const upsertResource = db.prepare(`
    INSERT INTO background_resources (url, title, description, source, fetched_at) VALUES (?, ?, ?, 'Wikipedia', ?)
    ON CONFLICT(url) DO UPDATE SET title = excluded.title, description = excluded.description, fetched_at = excluded.fetched_at
    RETURNING id
  `);

  /** Resource ID for a name, null if Wikipedia has no unambiguous page, or "error" on a network problem. */
  const lookup = async (c: Candidate): Promise<number | null | "error"> => {
    const hit = cached.get(c.key) as { resource_id: number | null; status: string; checked_at: string } | undefined;
    if (hit && now().getTime() - Date.parse(hit.checked_at) < ttlMs && (hit.status === "none" || hit.resource_id !== null)) {
      stats.cacheHits++;
      return hit.status === "found" ? hit.resource_id : null;
    }
    stats.lookups++;
    try {
      const res = await fetcher(SUMMARY_URL + encodeURIComponent(c.phrase.replace(/ /g, "_")), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
      });
      if (res.status === 404) {
        saveLookup.run(c.key, null, "none", now().toISOString());
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as {
        type?: string;
        title?: string;
        description?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
      };
      const url = page.content_urls?.desktop?.page;
      // Disambiguation pages, name lists ("Meloni: surname list") and unusual pages aren't context: don't guess.
      const isNameList = /\b(surname|given name|family name|name list|disambiguation|topics referred to)\b/i.test(page.description ?? "");
      if (page.type !== "standard" || !url || !page.title || isNameList) {
        saveLookup.run(c.key, null, "none", now().toISOString());
        return null;
      }
      const description = page.description ?? page.extract?.split(/(?<=\.)\s/)[0]?.slice(0, 160) ?? null;
      const row = upsertResource.get(url, page.title, description, now().toISOString()) as unknown as Resource;
      saveLookup.run(c.key, row.id, "found", now().toISOString());
      return row.id;
    } catch (err) {
      stats.failures++;
      console.warn(`background lookup failed for "${c.phrase}": ${err instanceof Error ? err.message : String(err)}`);
      return "error";
    }
  };

  for (const story of stories) {
    const articles = loadArticles.all(story.id, retentionCutoffIso(now())) as { title: string; excerpt: string | null }[];
    const chosen: { resourceId: number; term: string }[] = [];
    let hadError = false;
    for (const c of backgroundCandidates(story.headline, articles)) {
      if (chosen.length >= maxLinks) break;
      const id = await lookup(c);
      if (id === "error") hadError = true;
      else if (id !== null && !chosen.some((x) => x.resourceId === id)) chosen.push({ resourceId: id, term: c.phrase });
    }
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM story_background WHERE story_id = ?").run(story.id);
      const link = db.prepare("INSERT INTO story_background (story_id, resource_id, matched_term, rank) VALUES (?, ?, ?, ?)");
      chosen.forEach((x, i) => link.run(story.id, x.resourceId, x.term, i));
      // On a network error, leave the story marked unchecked so the next run tries again.
      if (!hadError) db.prepare("UPDATE stories SET background_hash = ? WHERE id = ?").run(story.articles_hash, story.id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      if (!String(err).includes("FOREIGN KEY")) throw err; // story deleted meanwhile: nothing to store
    }
    stats.storiesChecked++;
    if (chosen.length) stats.storiesWithLinks++;
    stats.linksStored += chosen.length;
  }

  removeOrphanBackground(db);
  console.log(
    `background: ${stats.storiesChecked} stories checked, ${stats.storiesWithLinks} with links, ` +
      `${stats.lookups} lookups (${stats.cacheHits} cached), ${stats.failures} failures`,
  );
  return stats;
}

/** Background resources are kept only while an active story links to them. */
export function removeOrphanBackground(db: Db): number {
  return Number(
    db
      .prepare("DELETE FROM background_resources WHERE id NOT IN (SELECT resource_id FROM story_background)")
      .run().changes,
  );
}
