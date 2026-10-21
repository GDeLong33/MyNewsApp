import { createHash } from "node:crypto";
import { removeOrphanBackground } from "../background.js";
import { transaction, type Db } from "../db.js";
import { retentionCutoffIso } from "../retention.js";
import { featuresFor } from "./features.js";
import { compareDocs, Corpus, cosine, makeDoc, MIN_MEMBER_SIMILARITY, type Doc, type Match } from "./similarity.js";

export interface StoryStats {
  articlesExpired: number;
  storiesCreated: number;
  articlesJoined: number;
  storiesRemoved: number;
}

interface ArticleRow {
  id: string;
  publisher: string;
  title: string;
  excerpt: string | null;
  published_at: string;
  updated_at: string;
  story_id: string | null;
}

/**
 * Runs after each collection, in one transaction:
 * 1. delete articles published more than 168 hours ago;
 * 2. assign every ungrouped article to the best-matching existing story, or start a new one;
 * 3. delete stories left with no articles (their summaries cascade), and refresh the rest.
 * Existing assignments never change, so story IDs are stable and new coverage joins an existing story.
 */
export function processStories(db: Db, now: Date): StoryStats {
  return transaction(db, () => {
    const nowIso = now.toISOString();
    const articlesExpired = Number(
      db.prepare("DELETE FROM articles WHERE published_at < ?").run(retentionCutoffIso(now)).changes,
    );

    const rows = db
      .prepare("SELECT id, publisher, title, excerpt, published_at, updated_at, story_id FROM articles ORDER BY published_at, id")
      .all() as unknown as ArticleRow[];

    const corpus = new Corpus();
    const features = rows.map((r) => featuresFor(r.title, r.excerpt));
    features.forEach((f) => corpus.add(f));
    const docs = rows.map((r, i) => makeDoc(r.id, r.published_at, features[i], corpus));

    // Members of each story, built up as articles are assigned (oldest first, so the earliest report founds a story).
    const members = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.story_id) members.set(r.story_id, [...(members.get(r.story_id) ?? []), i]);
    });

    const assign = db.prepare("UPDATE articles SET story_id = ?, story_match_json = ? WHERE id = ?");
    const createStory = db.prepare(`
      INSERT OR IGNORE INTO stories (id, headline, created_at, updated_at, article_count, publisher_count, articles_hash)
      VALUES (?, ?, ?, ?, 1, 1, '')
    `);

    let storiesCreated = 0;
    let articlesJoined = 0;
    rows.forEach((row, i) => {
      if (row.story_id) return;
      const best = bestStory(docs[i], members, docs, corpus);
      if (best) {
        row.story_id = best.storyId;
        assign.run(best.storyId, JSON.stringify(best.evidence), row.id);
        articlesJoined++;
      } else {
        row.story_id = `s_${row.id}`;
        createStory.run(row.story_id, row.title, nowIso, row.published_at);
        assign.run(row.story_id, null, row.id);
        storiesCreated++;
      }
      members.set(row.story_id, [...(members.get(row.story_id) ?? []), i]);
    });

    const storiesRemoved = Number(
      db
        .prepare("DELETE FROM stories WHERE id NOT IN (SELECT story_id FROM articles WHERE story_id IS NOT NULL)")
        .run().changes,
    );
    // Deleting a story cascades to its summary and background links; drop resources no story uses any more.
    removeOrphanBackground(db);

    const refresh = db.prepare(`
      UPDATE stories SET headline = ?, updated_at = ?, article_count = ?, publisher_count = ?, articles_hash = ?
      WHERE id = ?
    `);
    for (const [storyId, idx] of members) {
      const storyRows = idx.map((i) => rows[i]);
      refresh.run(
        rows[centralIndex(idx, docs)].title,
        storyRows.reduce((max, r) => (r.published_at > max ? r.published_at : max), ""),
        storyRows.length,
        new Set(storyRows.map((r) => r.publisher)).size,
        articlesHash(storyRows),
        storyId,
      );
    }

    return { articlesExpired, storiesCreated, articlesJoined, storiesRemoved };
  });
}

interface Evidence {
  matchedArticleId: string;
  score: number;
  sharedConcepts: string[];
}

function bestStory(
  doc: Doc,
  members: Map<string, number[]>,
  docs: Doc[],
  corpus: Corpus,
): { storyId: string; evidence: Evidence } | null {
  let best: { storyId: string; evidence: Evidence } | null = null;
  for (const [storyId, idx] of members) {
    let top: { match: Match; id: string } | null = null;
    let related = 0;
    for (const i of idx) {
      if (cosine(doc, docs[i]) >= MIN_MEMBER_SIMILARITY) related++;
      const match = compareDocs(doc, docs[i], corpus);
      if (match && (!top || match.score > top.match.score)) top = { match, id: docs[i].id };
    }
    if (!top || related <= idx.length / 2) continue;
    if (!best || top.match.score > best.evidence.score) {
      best = {
        storyId,
        evidence: {
          matchedArticleId: top.id,
          score: Math.round(top.match.score * 1000) / 1000,
          sharedConcepts: top.match.sharedConcepts,
        },
      };
    }
  }
  return best;
}

/** The member most similar to the others gives the story's headline; ties go to the earliest article. */
function centralIndex(idx: number[], docs: Doc[]): number {
  let bestIdx = idx[0];
  let bestSum = -1;
  for (const i of idx) {
    const sum = idx.reduce((s, j) => (i === j ? s : s + cosine(docs[i], docs[j])), 0);
    if (sum > bestSum + 1e-9) {
      bestSum = sum;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Fingerprint of a story's inputs: member IDs and their last-content-change times. A stored summary is current
 * only while its input_hash equals this, so expiry or new coverage automatically makes it stale.
 */
function articlesHash(storyRows: ArticleRow[]): string {
  const parts = storyRows.map((r) => `${r.id}:${r.updated_at}`).sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}
