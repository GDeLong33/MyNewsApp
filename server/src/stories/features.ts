// Text features used for story grouping: weighted content words and named-entity phrases.
// See docs/grouping.md for how these feed into the matching rule.

const STOPWORDS = new Set(
  `a about above across after again against all almost also am amid among an and another any are around as at
  back be became because been before being below between both but by came can could did do does doing done down
  during each even few for from further get gets got had has have having he her here hers herself him himself his
  how however i if in into is it its itself just like made make many may me might more most much must my near no
  nor not now of off on once one only onto or other our ours out over own per said same say saying says she should
  since so some still such take than that the their theirs them then there these they this those though through
  to told too toward under until up upon us very via was way we were what when where whether which while who whom
  whose why will with within without would yet you your
  new news report reports reported week weeks day days year years time today tonight yesterday
  monday tuesday wednesday thursday friday saturday sunday latest live update updates watch video breaking
  first last two three people according amid exclusive opinion analysis`
    .split(/\s+/)
    .filter(Boolean),
);

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Lowercased, accent-free content words with stopwords and bare numbers removed, lightly stemmed. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
    .map(stem)
    .filter((t) => !STOPWORDS.has(t));
}

/** True for Title Case Headlines, where capital letters say nothing about names. */
function isTitleCase(text: string): boolean {
  const words = text.match(/[A-Za-z][A-Za-z'’-]{3,}/g) ?? [];
  if (words.length < 4) return false;
  return words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.7;
}

const CONNECTORS = new Set(["of", "de", "al", "bin", "van", "von", "la", "le", "du", "da"]);

// Capitalized titles and roles ("President Trump", "Former US ambassador") are not names: two stories about
// different judges or presidents must not look alike because of the title word.
const TITLE_WORDS = new Set(
  `president former judge justice senator sen rep representative gov governor minister prime king queen prince
  princess pope secretary general gen chief mayor sir dame lord lady mr mrs ms dr saint st rev ambassador
  official officials leader spokesman spokeswoman ceo chairman director`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Named-entity phrases, approximated as runs of capitalized words ("Kate Middleton", "Bank of England", "FAA").
 * A capitalized stopword at the start of a sentence ("The", "After") is ignored. Returns each phrase as tokens.
 */
export function extractEntities(text: string): string[][] {
  const phrases: string[][] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\s+[-–—|]\s+/)) {
    const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
    let current: string[] = [];
    const flush = () => {
      while (current.length && CONNECTORS.has(current.at(-1)!)) current.pop();
      if (current.length) phrases.push(tokenize(current.join(" ")).filter((t) => !TITLE_WORDS.has(t)));
      current = [];
    };
    words.forEach((word, i) => {
      if (/^\p{Lu}/u.test(word)) {
        if (i === 0 && STOPWORDS.has(word.toLowerCase())) return;
        current.push(word);
      } else if (CONNECTORS.has(word) && current.length) {
        current.push(word);
      } else {
        flush();
      }
    });
    flush();
  }
  return phrases.filter((p) => p.length > 0);
}

export interface Features {
  /** Term frequencies; title words count double. */
  tf: Map<string, number>;
  /** Entity phrases as token lists. */
  entities: string[][];
}

export function featuresFor(title: string, excerpt: string | null): Features {
  const tf = new Map<string, number>();
  for (const t of tokenize(title)) tf.set(t, (tf.get(t) ?? 0) + 2);
  for (const t of tokenize(excerpt ?? "")) tf.set(t, (tf.get(t) ?? 0) + 1);
  const entityText = [isTitleCase(title) ? "" : title, excerpt ?? ""].filter(Boolean).join(". ");
  return { tf, entities: extractEntities(entityText) };
}
