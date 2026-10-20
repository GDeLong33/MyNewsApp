import { XMLParser } from "fast-xml-parser";

/** One feed entry as published, before normalization. */
export interface RawItem {
  title?: string;
  link?: string;
  guid?: string;
  description?: string;
  /** Date strings in priority order. */
  dates: (string | undefined)[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

type Node = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object" && "#text" in value) return textOf((value as Node)["#text"]);
  return undefined;
}

/** Parse RSS 2.0 or Atom XML into raw items. Throws if the document is neither. */
export function parseFeed(xml: string): RawItem[] {
  const doc = parser.parse(xml) as Node;

  const rss = doc.rss as Node | undefined;
  if (rss && typeof rss === "object" && rss.channel) {
    const channel = asArray(rss.channel as Node | Node[])[0];
    return asArray(channel.item as Node | Node[] | undefined).map(rssItem);
  }

  const feed = doc.feed as Node | undefined;
  if (feed && typeof feed === "object") {
    return asArray(feed.entry as Node | Node[] | undefined).map(atomItem);
  }

  throw new Error("not an RSS or Atom feed");
}

function rssItem(item: Node): RawItem {
  const guid = textOf(item.guid);
  const guidIsLink =
    !!guid && /^https?:\/\//i.test(guid) && (item.guid as Node | undefined)?.["@_isPermaLink"] !== "false";
  return {
    title: textOf(item.title),
    link: textOf(item.link) ?? (guidIsLink ? guid : undefined),
    guid,
    description: textOf(item.description),
    dates: [textOf(item.pubDate), textOf(item["dc:date"])],
  };
}

function atomItem(entry: Node): RawItem {
  const links = asArray(entry.link as Node | Node[] | undefined);
  const alternate = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate");
  return {
    title: textOf(entry.title),
    link: typeof alternate?.["@_href"] === "string" ? alternate["@_href"] : undefined,
    guid: textOf(entry.id),
    description: textOf(entry.summary) ?? textOf(entry.content),
    dates: [textOf(entry.published), textOf(entry.updated)],
  };
}
