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
  return rawEntityPhrases(text)
    .map((p) => tokenize(p.words.join(" ")).filter((t) => !TITLE_WORDS.has(t)))
    .filter((p) => p.length > 0);
}

const cleanWord = (w: string) => w.replace(/['’]s$/, "").replace(/[.'’-]+$/, "");

/** Lowercased words the text capitalizes somewhere other than the start of a sentence: evidence they're names. */
export function nameLikeWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const p of rawEntityPhrases(text)) {
    p.words.forEach((w, i) => {
      if (!p.atStart || i > 0) out.add(cleanWord(w).toLowerCase());
    });
  }
  return out;
}

/**
 * The same phrases in their original spelling, for looking them up (e.g. on Wikipedia): leading and trailing
 * titles and possessives removed, so "President Donald Trump's" becomes "Donald Trump". With `nameLike`, words
 * at the start of a sentence are kept only if the text also capitalizes them elsewhere, so "Top Trump ally warns"
 * gives "Trump" and "Violence erupts" gives nothing.
 */
export function entityLookupPhrases(text: string, nameLike?: Set<string>): string[] {
  const out: string[] = [];
  for (const p of rawEntityPhrases(text)) {
    let words = p.words.map(cleanWord);
    if (p.atStart && nameLike) {
      while (words.length && !nameLike.has(words[0].toLowerCase())) words.shift();
    }
    while (words.length && TITLE_WORDS.has(words[0].toLowerCase().replace(/\.$/, ""))) words.shift();
    while (words.length && (TITLE_WORDS.has(words.at(-1)!.toLowerCase()) || CONNECTORS.has(words.at(-1)!))) words.pop();
    const phrase = words.join(" ").trim();
    if (phrase.length >= 3) out.push(phrase);
  }
  return out;
}

function rawEntityPhrases(text: string): { words: string[]; atStart: boolean }[] {
  const phrases: { words: string[]; atStart: boolean }[] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\s+[-–—|]\s+/)) {
    const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
    let current: string[] = [];
    let currentAtStart = false;
    const flush = () => {
      while (current.length && CONNECTORS.has(current.at(-1)!)) current.pop();
      if (current.length) phrases.push({ words: current, atStart: currentAtStart });
      current = [];
    };
    words.forEach((word, i) => {
      if (/^\p{Lu}/u.test(word)) {
        if (i === 0 && STOPWORDS.has(word.toLowerCase())) return;
        if (current.length === 0) currentAtStart = i === 0;
        current.push(word);
      } else if (CONNECTORS.has(word) && current.length) {
        current.push(word);
      } else {
        flush();
      }
    });
    flush();
  }
  return phrases;
}

/** Text to scan for names: the excerpt, plus the title unless it is Title Case. */
export function entityText(title: string, excerpt: string | null): string {
  return [isTitleCase(title) ? "" : title, excerpt ?? ""].filter(Boolean).join(". ");
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
  return { tf, entities: extractEntities(entityText(title, excerpt)) };
}
