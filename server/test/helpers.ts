import type { Fetcher } from "../src/collector/collect.js";

export interface FixtureItem {
  title?: string;
  link?: string;
  guid?: string;
  description?: string;
  pubDate?: string;
}

/** Build an RSS 2.0 document from items. Omitted fields are left out of the XML. */
export function rss(items: FixtureItem[]): string {
  const tag = (name: string, value: string | undefined) => (value === undefined ? "" : `<${name}>${value}</${name}>`);
  const body = items
    .map(
      (i) =>
        `<item>${tag("title", i.title)}${tag("link", i.link)}${tag("guid", i.guid)}` +
        `${tag("description", i.description)}${tag("pubDate", i.pubDate)}</item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${body}</channel></rss>`;
}

/** What the fake fetcher returns for a URL: XML text, an HTTP error status, or a thrown error. */
export type FakeResponse = string | number | Error;

/** A fetch stand-in serving canned responses by URL; unknown URLs throw like a DNS failure. Counts calls. */
export function fakeFetcher(responses: Record<string, FakeResponse>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const r = responses[url];
    if (r === undefined) throw new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname}`);
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("error", { status: r });
    return new Response(r, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
  return Object.assign(fetcher, { calls });
}

/** RFC 822 date string `hoursAgo` before `now`, as RSS feeds publish it. */
export function hoursBefore(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 3600_000).toUTCString();
}
