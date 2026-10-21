import type { FeedConfig } from "./collector/collect.js";

// Several section feeds per publisher give more overlapping coverage for story grouping.
// The same article appearing in two feeds of one publisher is stored once (deduped by URL).
// Fox News (latest/world/politics) was a source until 2026-10-20, when the owner replaced it with NBC News.
// (CNN was considered, but its RSS feeds stopped updating in April 2023.)
export const FEEDS: FeedConfig[] = [
  { id: "nbc-news", publisher: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/news" },
  { id: "nbc-world", publisher: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/world" },
  { id: "nbc-politics", publisher: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/politics" },
  { id: "npr-news", publisher: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { id: "npr-world", publisher: "NPR", url: "https://feeds.npr.org/1004/rss.xml" },
  { id: "npr-politics", publisher: "NPR", url: "https://feeds.npr.org/1014/rss.xml" },
  { id: "bbc-top", publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { id: "bbc-world", publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
];
