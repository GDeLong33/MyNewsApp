import type { Analysis } from "./validate.js";

// Decides what the API may show for a story's AI analysis. Content is only served when every article it was
// generated from is still current; otherwise the reader sees an honest status instead.

export const AI_LABEL = "AI-generated";
export const INPUT_SCOPE =
  "Generated from feed headlines and short excerpts only, not full articles. Read the original coverage for full context.";
export const INSUFFICIENT_PERSPECTIVES = "Insufficient evidence for distinct perspectives.";

export interface SummaryRow {
  content_json: string | null;
  input_hash: string | null;
  input_article_ids: string | null;
  excerpt_only: number;
  model: string | null;
  prompt_version: string | null;
  generated_at: string | null;
  last_attempt_at: string | null;
  last_attempt_hash: string | null;
  last_error: string | null;
  last_error_retryable: number;
}

/** not_available = the story is outside the AI quota policy (too few articles); nothing will be generated for it. */
export type AiStatus = "ready" | "outdated" | "pending" | "failed" | "not_available";

export interface AiView {
  status: AiStatus;
  message: string;
  label: typeof AI_LABEL;
  generatedAt: string | null;
  model: string | null;
  promptVersion: string | null;
  inputScope: string | null;
  inputArticleIds: string[];
  overview: Analysis["overview"] | null;
  agreement: Analysis["agreement"];
  disagreement: Analysis["disagreement"];
  uncertainties: Analysis["uncertainties"];
  perspectives: {
    status: Analysis["perspectivesStatus"];
    message: string | null;
    items: Analysis["perspectives"];
  } | null;
}

function noContent(status: "pending" | "failed" | "not_available", message: string): AiView {
  return {
    status,
    message,
    label: AI_LABEL,
    generatedAt: null,
    model: null,
    promptVersion: null,
    inputScope: null,
    inputArticleIds: [],
    overview: null,
    agreement: [],
    disagreement: [],
    uncertainties: [],
    perspectives: null,
  };
}

export function aiView(
  row: SummaryRow | undefined,
  currentArticleIds: string[],
  articlesHash: string,
  minArticles = 1,
): AiView {
  const current = new Set(currentArticleIds);
  const failedNow = !!row?.last_error && row.last_attempt_hash === articlesHash;
  const unavailable = (): AiView =>
    currentArticleIds.length < minArticles
      ? noContent(
          "not_available",
          `To stay within the free AI quota, AI analysis is only generated for stories covered by at least ${minArticles} articles. Read the original coverage below.`,
        )
      : !failedNow
      ? noContent("pending", "AI analysis has not been generated for the current coverage yet.")
      : row?.last_error_retryable
        ? noContent("failed", "AI analysis is temporarily unavailable because the AI service was busy. It will be retried automatically. The original coverage is still available.")
        : noContent("failed", "AI analysis could not be generated. The original coverage is still available.");

  if (!row?.content_json) return unavailable();

  const inputIds: string[] = JSON.parse(row.input_article_ids ?? "[]");
  // Never serve analysis that depends on an article that has expired or left the story.
  if (inputIds.some((id) => !current.has(id))) return unavailable();

  const content = JSON.parse(row.content_json) as Omit<Analysis, "dropped">;
  const newer = currentArticleIds.filter((id) => !inputIds.includes(id)).length;
  const upToDate = row.input_hash === articlesHash;
  return {
    status: upToDate ? "ready" : "outdated",
    message: upToDate
      ? "AI-generated analysis of the coverage listed below."
      : newer > 0
        ? `AI-generated analysis that does not yet include ${newer} newer article${newer === 1 ? "" : "s"}. It will be updated.`
        : "AI-generated analysis; the source articles have changed since it was written. It will be updated.",
    label: AI_LABEL,
    generatedAt: row.generated_at,
    model: row.model,
    promptVersion: row.prompt_version,
    inputScope: row.excerpt_only ? INPUT_SCOPE : null,
    inputArticleIds: inputIds,
    overview: content.overview,
    agreement: content.agreement,
    disagreement: content.disagreement,
    uncertainties: content.uncertainties,
    perspectives: {
      status: content.perspectivesStatus,
      message: content.perspectivesStatus === "supported" ? null : INSUFFICIENT_PERSPECTIVES,
      items: content.perspectives,
    },
  };
}
