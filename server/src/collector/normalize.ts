import { createHash } from "node:crypto";

// Query parameters that only track where a click came from. Removing them makes the
// same article map to one URL (e.g. BBC appends ?at_medium=RSS&at_campaign=rss).
const TRACKING_PARAM = /^(utm_.*|at_.*|fbclid|gclid|dclid|msclkid|cmpid|ocid|icid|mc_cid|mc_eid)$/i;

/** Canonical form of an article URL, or null if it isn't a usable http(s) URL. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.protocol = "https:";
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

/** Stable article ID derived from the normalized URL. */
export function articleIdFor(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 24);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Strip HTML tags and entities, collapse whitespace, and cap the length. */
export function cleanText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export type DateResult =
  | { kind: "valid"; iso: string }
  | { kind: "missing" }
  | { kind: "invalid"; raw: string };

const MAX_FUTURE_MS = 60 * 60 * 1000; // allow 1 hour of clock skew
const EARLIEST_MS = Date.UTC(2000, 0, 1);

/**
 * Publication-date rule (documented in docs/collection.md):
 * candidates are tried in order (RSS pubDate, dc:date, Atom published, updated) and the
 * first one that parses to a time between 2000-01-01 and one hour from now wins.
 * If none is present the date is "missing"; if some are present but none qualify, "invalid".
 */
export function parsePublishedDate(candidates: (string | undefined)[], now: Date): DateResult {
  let firstRaw: string | undefined;
  for (const candidate of candidates) {
    const raw = candidate?.trim();
    if (!raw) continue;
    firstRaw ??= raw;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms) && ms >= EARLIEST_MS && ms <= now.getTime() + MAX_FUTURE_MS) {
      return { kind: "valid", iso: new Date(ms).toISOString() };
    }
  }
  return firstRaw === undefined ? { kind: "missing" } : { kind: "invalid", raw: firstRaw };
}
