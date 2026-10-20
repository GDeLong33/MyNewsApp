import type { FeedConfig } from "./collector/collect.js";

// Several section feeds per publisher give more overlapping coverage for story grouping.
// The same article appearing in two feeds of one publisher is stored once (deduped by URL).
export const FEEDS: FeedConfig[] = [
  { id: "fox-latest", publisher: "Fox News", url: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { id: "fox-world", publisher: "Fox News", url: "https://moxie.foxnews.com/google-publisher/world.xml" },
  { id: "fox-politics", publisher: "Fox News", url: "https://moxie.foxnews.com/google-publisher/politics.xml" },
  { id: "npr-news", publisher: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { id: "npr-world", publisher: "NPR", url: "https://feeds.npr.org/1004/rss.xml" },
  { id: "npr-politics", publisher: "NPR", url: "https://feeds.npr.org/1014/rss.xml" },
  { id: "bbc-top", publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { id: "bbc-world", publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
];
