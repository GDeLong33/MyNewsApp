import type { Features } from "./features.js";

// Matching rule thresholds (docs/grouping.md explains each one, and how they were tuned on live data).
export const MAX_GAP_HOURS = 72;
/** Below this similarity, articles never match. */
export const MIN_SIMILARITY = 0.2;
/** At or above this similarity, the "strong" evidence requirements apply; below it, the stricter "moderate" ones. */
export const STRONG_SIMILARITY = 0.35;
export const STRONG_EVIDENCE = { concepts: 2, entityConcepts: 1 };
export const MODERATE_EVIDENCE = { concepts: 3, entityConcepts: 2 };
/**
 * To join a story an article must also reach this similarity with a strict majority of its members,
 * so one broad article (e.g. a "Morning news brief" roundup) can't chain two unrelated events together.
 */
export const MIN_MEMBER_SIMILARITY = 0.1;
/** Words in more than this share of current articles are too common to count as evidence. */
export const MAX_CONCEPT_COMMONNESS = 0.2;

/** Document frequencies over the articles currently being grouped. */
export class Corpus {
  private readonly df = new Map<string, number>();
  n = 0;

  add(features: Features): void {
    this.n++;
    for (const t of features.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  idf(token: string): number {
    return Math.log((this.n + 1) / ((this.df.get(token) ?? 0) + 1)) + 1;
  }

  commonness(token: string): number {
    return this.n === 0 ? 0 : (this.df.get(token) ?? 0) / this.n;
  }
}

export interface Doc {
  id: string;
  publishedMs: number;
  features: Features;
  vector: Map<string, number>;
  norm: number;
}

export function makeDoc(id: string, publishedAt: string, features: Features, corpus: Corpus): Doc {
  const vector = new Map<string, number>();
  let sumSq = 0;
  for (const [t, tf] of features.tf) {
    const w = tf * corpus.idf(t);
    vector.set(t, w);
    sumSq += w * w;
  }
  return { id, publishedMs: Date.parse(publishedAt), features, vector, norm: Math.sqrt(sumSq) };
}

export function cosine(a: Doc, b: Doc): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] = a.vector.size <= b.vector.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.vector) {
    const other = large.vector.get(t);
    if (other !== undefined) dot += w * other;
  }
  return dot / (a.norm * b.norm);
}

export interface SharedConcepts {
  /** Each concept is a group of shared words; words of one name ("kate middleton") form one concept. */
  concepts: string[][];
  entityConcepts: number;
}

/**
 * Words both articles use, grouped so that one name counts once. Words in the same entity phrase in either
 * article are merged, so "Donald Trump" vs "Trump" or "Kate Middleton" is a single concept, not two.
 */
export function sharedConcepts(a: Doc, b: Doc, corpus: Corpus): SharedConcepts {
  const ignoreCommon = corpus.n >= 20;
  const shared = [...a.vector.keys()].filter(
    (t) => b.vector.has(t) && !(ignoreCommon && corpus.commonness(t) > MAX_CONCEPT_COMMONNESS),
  );
  const parent = new Map(shared.map((t) => [t, t]));
  const find = (t: string): string => {
    let root = t;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(t, root);
    return root;
  };
  const entityTokens = new Set<string>();
  for (const phrase of [...a.features.entities, ...b.features.entities]) {
    const inShared = phrase.filter((t) => parent.has(t));
    inShared.forEach((t) => entityTokens.add(t));
    for (let i = 1; i < inShared.length; i++) parent.set(find(inShared[i]), find(inShared[0]));
  }
  const groups = new Map<string, string[]>();
  for (const t of shared) {
    const root = find(t);
    groups.set(root, [...(groups.get(root) ?? []), t]);
  }
  const concepts = [...groups.values()];
  return { concepts, entityConcepts: concepts.filter((g) => g.some((t) => entityTokens.has(t))).length };
}

export interface Match {
  score: number;
  sharedConcepts: string[];
}

/**
 * Two articles describe the same event when they were published within 72 hours of each other and either:
 * - strong:   TF-IDF cosine similarity >= 0.35, with >= 2 shared concepts, >= 1 of them a name; or
 * - moderate: similarity 0.20-0.35, with >= 3 shared concepts, >= 2 of them names.
 * A single shared name or keyword can never satisfy either rule on its own.
 */
export function compareDocs(a: Doc, b: Doc, corpus: Corpus): Match | null {
  if (Math.abs(a.publishedMs - b.publishedMs) > MAX_GAP_HOURS * 3600_000) return null;
  const score = cosine(a, b);
  if (score < MIN_SIMILARITY) return null;
  const shared = sharedConcepts(a, b, corpus);
  const need = score >= STRONG_SIMILARITY ? STRONG_EVIDENCE : MODERATE_EVIDENCE;
  if (shared.concepts.length < need.concepts || shared.entityConcepts < need.entityConcepts) return null;
  return { score, sharedConcepts: shared.concepts.map((g) => g.join(" ")) };
}
