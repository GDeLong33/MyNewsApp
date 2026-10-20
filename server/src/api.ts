import { Router } from "express";
import { aiView, type SummaryRow } from "./ai/view.js";
import { lastSuccessfulCollectionAt } from "./collector/collect.js";
import type { Db } from "./db.js";
import { RETENTION_HOURS, retentionCutoffIso } from "./retention.js";

// Public, read-only API for the Flutter app. Every query filters on the retention cutoff at request time,
// so an article that expires between hourly runs disappears immediately (and a story with none left 404s).

interface StoryListRow {
  id: string;
  headline: string;
  latest: string;
  article_count: number;
  publisher_count: number;
  publishers: string;
}

interface ArticleRow {
  id: string;
  publisher: string;
  title: string;
  url: string;
  excerpt: string | null;
  published_at: string;
  published_at_source: "feed" | "first_seen";
  story_match_json: string | null;
}

function limitParam(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function storiesRouter(db: Db, now: () => Date): Router {
  const router = Router();

  // Top stories: one entry per story, newest coverage first.
  router.get("/stories", (req, res) => {
    const limit = limitParam(req.query.limit, 50, 200);
    const cutoff = retentionCutoffIso(now());
    const rows = db
      .prepare(`
        SELECT s.id, s.headline, MAX(a.published_at) AS latest, COUNT(*) AS article_count,
               COUNT(DISTINCT a.publisher) AS publisher_count, GROUP_CONCAT(DISTINCT a.publisher) AS publishers
        FROM stories s JOIN articles a ON a.story_id = s.id AND a.published_at >= ?
        GROUP BY s.id
        ORDER BY latest DESC, s.id
        LIMIT ?
      `)
      .all(cutoff, limit) as unknown as StoryListRow[];

    res.json({
      generatedAt: now().toISOString(),
      lastSuccessfulCollectionAt: lastSuccessfulCollectionAt(db),
      retentionHours: RETENTION_HOURS,
      stories: rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        updatedAt: r.latest,
        articleCount: Number(r.article_count),
        publisherCount: Number(r.publisher_count),
        publishers: r.publishers.split(",").sort(),
      })),
    });
  });

  // Story detail: its articles grouped by publisher (one "Original coverage" button per publisher).
  router.get("/stories/:id", (req, res) => {
    const story = db
      .prepare("SELECT id, headline, created_at, articles_hash FROM stories WHERE id = ?")
      .get(req.params.id) as { id: string; headline: string; created_at: string; articles_hash: string } | undefined;
    const articles = story
      ? (db
          .prepare(`
            SELECT id, publisher, title, url, excerpt, published_at, published_at_source, story_match_json
            FROM articles WHERE story_id = ? AND published_at >= ?
            ORDER BY published_at DESC, id
          `)
          .all(story.id, retentionCutoffIso(now())) as unknown as ArticleRow[])
      : [];
    if (!story || articles.length === 0) {
      res.status(404).json({ error: "not_found", message: "Story not found or all of its articles have expired" });
      return;
    }

    const byPublisher = new Map<string, ArticleRow[]>();
    for (const a of articles) byPublisher.set(a.publisher, [...(byPublisher.get(a.publisher) ?? []), a]);

    // Stored AI output only; reading a story never calls the model.
    const summary = db.prepare("SELECT * FROM story_summaries WHERE story_id = ?").get(story.id) as SummaryRow | undefined;
    const ai = aiView(summary, articles.map((a) => a.id), story.articles_hash);

    res.json({
      id: story.id,
      headline: story.headline,
      createdAt: story.created_at,
      updatedAt: articles[0].published_at,
      articleCount: articles.length,
      publisherCount: byPublisher.size,
      lastSuccessfulCollectionAt: lastSuccessfulCollectionAt(db),
      sources: [...byPublisher.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([publisher, list]) => ({
          publisher,
          articles: list.map((a) => ({
            id: a.id,
            title: a.title,
            url: a.url,
            // Feed description only: an excerpt, not the full article.
            excerpt: a.excerpt,
            publishedAt: a.published_at,
            publishedAtEstimated: a.published_at_source === "first_seen",
            grouping: a.story_match_json ? JSON.parse(a.story_match_json) : null,
          })),
        })),
      ai,
    });
  });

  return router;
}
