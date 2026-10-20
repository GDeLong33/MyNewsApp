// Checks model output before it is stored. Anything that can't be traced to the input articles is dropped,
// and output with no traceable overview is rejected outright rather than shown.

export interface CitedText {
  text: string;
  /** Article IDs (not prompt refs). */
  citations: string[];
}

export interface Perspective {
  name: string;
  summary: string;
  evidenceLimits: string;
  citations: string[];
}

export interface Analysis {
  overview: CitedText;
  agreement: CitedText[];
  disagreement: CitedText[];
  uncertainties: CitedText[];
  perspectivesStatus: "supported" | "insufficient_evidence";
  perspectives: Perspective[];
  /** What validation removed, for the operator log. */
  dropped: string[];
}

export class InvalidOutputError extends Error {}

interface InputArticle {
  ref: string;
  id: string;
  title: string;
  excerpt: string | null;
}

const MAX_POINTS = 5;
const MAX_PERSPECTIVES = 4;

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function validateAnalysis(raw: string, articles: InputArticle[], publisherNames: string[]): Analysis {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new InvalidOutputError("model output is not valid JSON");
  }
  if (!data || typeof data !== "object") throw new InvalidOutputError("model output is not a JSON object");

  const dropped: string[] = [];
  const byRef = new Map(articles.map((a) => [a.ref.toUpperCase(), a.id]));
  const sourceText = articles.map((a) => `${a.title} ${a.excerpt ?? ""}`).join(" ").toLowerCase();

  const citations = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    for (const ref of value) {
      const id = typeof ref === "string" ? byRef.get(ref.trim().replace(/^\[|\]$/g, "").toUpperCase()) : undefined;
      if (id) ids.add(id);
      else dropped.push(`unknown citation ${JSON.stringify(ref)}`);
    }
    return [...ids];
  };

  // An AI paraphrase must not look like a verbatim quote: keep quotation marks only around words found in the input.
  const unquoteInvented = (text: string): string =>
    text.replace(/["“”]([^"“”]{4,}?)["“”]/g, (whole, inner: string) => {
      if (sourceText.includes(inner.toLowerCase())) return whole;
      dropped.push(`quotation marks removed from unverified quote ${JSON.stringify(inner)}`);
      return inner;
    });

  const cited = (value: unknown, max: number, what: string): CitedText | null => {
    const obj = (value ?? {}) as Record<string, unknown>;
    const text = unquoteInvented(str(obj.text, max));
    const cites = citations(obj.citations);
    if (!text) return null;
    if (cites.length === 0) {
      dropped.push(`${what} without a valid citation`);
      return null;
    }
    return { text, citations: cites };
  };

  const points = (value: unknown, what: string): CitedText[] =>
    (Array.isArray(value) ? value : [])
      .map((v) => cited(v, 400, what))
      .filter((v): v is CitedText => v !== null)
      .slice(0, MAX_POINTS);

  const overview = cited(data.overview, 1200, "overview");
  if (!overview) throw new InvalidOutputError("overview is missing or has no valid citation");

  const outlet = new RegExp(`\\b(${publisherNames.map((p) => p.split(" ")[0]).join("|")})\\b`, "i");
  let perspectives: Perspective[] = [];
  for (const value of Array.isArray(data.perspectives) ? data.perspectives : []) {
    const obj = (value ?? {}) as Record<string, unknown>;
    const name = str(obj.name, 60);
    const summary = unquoteInvented(str(obj.summary, 800));
    const cites = citations(obj.citations);
    if (!name || !summary) continue;
    if (cites.length === 0) {
      dropped.push(`perspective "${name}" without a valid citation`);
      continue;
    }
    if (publisherNames.length > 0 && outlet.test(name)) {
      dropped.push(`perspective "${name}" named after a news outlet`);
      continue;
    }
    perspectives.push({ name, summary, evidenceLimits: str(obj.evidenceLimits, 400), citations: cites });
  }
  perspectives = perspectives.slice(0, MAX_PERSPECTIVES);

  // Fewer than two supported viewpoints is reported as insufficient evidence, never padded out.
  const supported = data.perspectivesStatus === "supported" && perspectives.length >= 2;
  if (!supported && perspectives.length > 0) dropped.push(`${perspectives.length} perspective(s) shown as insufficient evidence`);

  return {
    overview,
    agreement: points(data.agreement, "agreement point"),
    disagreement: points(data.disagreement, "disagreement point"),
    uncertainties: points(data.uncertainties, "uncertainty point"),
    perspectivesStatus: supported ? "supported" : "insufficient_evidence",
    perspectives: supported ? perspectives : [],
    dropped,
  };
}
