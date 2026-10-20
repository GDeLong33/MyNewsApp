import assert from "node:assert/strict";
import { test } from "node:test";
import { articleIdFor, cleanText, normalizeUrl, parsePublishedDate } from "../src/collector/normalize.js";
import { parseFeed } from "../src/collector/parse.js";

test("normalizeUrl strips tracking params, fragments, trailing slashes and forces https", () => {
  assert.equal(
    normalizeUrl("http://www.BBC.co.uk/news/articles/abc123/?at_medium=RSS&at_campaign=rss#1"),
    "https://www.bbc.co.uk/news/articles/abc123",
  );
  assert.equal(
    normalizeUrl("https://example.com/story?utm_source=x&id=7&b=2&fbclid=zzz"),
    "https://example.com/story?b=2&id=7",
  );
  assert.equal(normalizeUrl("  https://example.com/  "), "https://example.com/");
});

test("normalizeUrl rejects non-http and malformed URLs", () => {
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("ftp://example.com/file"), null);
});

test("articleIdFor is stable and differs per URL", () => {
  const a = articleIdFor("https://example.com/a");
  assert.equal(a, articleIdFor("https://example.com/a"));
  assert.notEqual(a, articleIdFor("https://example.com/b"));
  assert.match(a, /^[0-9a-f]{24}$/);
});

test("cleanText strips tags and entities, collapses whitespace and truncates", () => {
  assert.equal(cleanText("<p>Tom &amp; Jerry&#39;s   <b>day</b></p>", 100), "Tom & Jerry's day");
  assert.equal(cleanText("abcdefghij", 5), "abcd…");
  assert.equal(cleanText(undefined, 10), "");
});

test("parsePublishedDate applies the documented rule", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  assert.deepEqual(parsePublishedDate(["Tue, 20 Oct 2026 08:00:00 -0400"], now), {
    kind: "valid",
    iso: "2026-10-20T12:00:00.000Z",
  });
  assert.deepEqual(parsePublishedDate([undefined, "  "], now), { kind: "missing" });
  assert.deepEqual(parsePublishedDate(["yesterday-ish"], now), { kind: "invalid", raw: "yesterday-ish" });
  // More than an hour in the future is treated as invalid.
  assert.equal(parsePublishedDate(["2026-10-20T14:00:00Z"], now).kind, "invalid");
  // Within the 1-hour skew allowance is fine.
  assert.equal(parsePublishedDate(["2026-10-20T12:30:00Z"], now).kind, "valid");
  // Implausibly old dates are invalid.
  assert.equal(parsePublishedDate(["1970-01-01T00:00:00Z"], now).kind, "invalid");
  // Falls through to the next candidate when the first is bad.
  assert.deepEqual(parsePublishedDate(["garbage", "2026-10-19T00:00:00Z"], now), {
    kind: "valid",
    iso: "2026-10-19T00:00:00.000Z",
  });
});

test("parseFeed reads RSS items, CDATA and permalink guids", () => {
  const items = parseFeed(`<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item><title><![CDATA[Quotes "here"]]></title><link>https://a.example/1</link>
        <description><![CDATA[<p>Hi &amp; bye</p>]]></description><pubDate>Tue, 20 Oct 2026 18:32:14 GMT</pubDate></item>
      <item><title>No link</title><guid isPermaLink="true">https://a.example/2</guid></item>
      <item><title>Opaque guid</title><guid isPermaLink="false">abc-123</guid></item>
    </channel></rss>`);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Quotes "here"');
  assert.equal(items[0].link, "https://a.example/1");
  assert.equal(items[0].dates[0], "Tue, 20 Oct 2026 18:32:14 GMT");
  assert.equal(items[1].link, "https://a.example/2");
  assert.equal(items[2].link, undefined);
});

test("parseFeed reads Atom entries", () => {
  const items = parseFeed(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
      <entry><title>Atom story</title><id>tag:x,2026:1</id>
        <link rel="alternate" href="https://b.example/story"/><link rel="self" href="https://b.example/self"/>
        <published>2026-10-20T10:00:00Z</published><summary>Sum</summary></entry>
    </feed>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://b.example/story");
  assert.equal(items[0].description, "Sum");
  assert.equal(items[0].dates[0], "2026-10-20T10:00:00Z");
});

test("parseFeed handles a single item and an empty channel", () => {
  assert.equal(parseFeed(`<rss><channel><item><title>One</title></item></channel></rss>`).length, 1);
  assert.equal(parseFeed(`<rss><channel><title>Empty</title></channel></rss>`).length, 0);
});

test("parseFeed rejects documents that are not feeds", () => {
  assert.throws(() => parseFeed("<html><body>Service unavailable</body></html>"), /not an RSS or Atom feed/);
  assert.throws(() => parseFeed("plain text error"), /not an RSS or Atom feed/);
});
