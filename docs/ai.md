# AI summaries and perspectives

The server uses **Google Gemini** to write, for each story:
- an overview (what happened, with agreement, disagreement and uncertainty), and
- perspectives (distinct viewpoints, when the coverage supports them).

Output is generated during backend processing, stored in SQLite, and served to every reader. **Reading a story never calls the model.**

| What | Where |
|---|---|
| System prompt, user-prompt builder, output schema, `PROMPT_VERSION` | [server/src/ai/prompt.ts](../server/src/ai/prompt.ts) |
| Model configuration (provider, model, temperature, token limit, timeout) and the Gemini client | [server/src/ai/model.ts](../server/src/ai/model.ts) |
| Output validation | [server/src/ai/validate.ts](../server/src/ai/validate.ts) |
| Scheduling, pacing and storage | [server/src/ai/summarizer.ts](../server/src/ai/summarizer.ts) |
| What the API may show (ready / outdated / pending / failed) | [server/src/ai/view.ts](../server/src/ai/view.ts) |

## Model configuration

- **Provider:** Google Gemini API (`generativelanguage.googleapis.com/v1beta`), free tier.
- **Model:** `gemini-3.5-flash-lite` by default. Override it with `GEMINI_MODEL`. The model version Gemini reports back is stored with each summary and each call.
  - The project's free tier for it is **500 requests per day, 15 per minute and 250K input tokens per minute** (per ai.dev/rate-limit, October 20, 2026).
  - It replaced `gemini-3.8-flash`, which worked but allows only 20 requests per day. That limit ran out on the first day.
  - The first choice was `gemini-2.5-flash`. On the first deploy (October 20), all 40 calls in that batch failed with HTTP 404 "no longer available to new users", and the API named `gemini-3.8-flash` as the replacement.
  - That incident led to two fixes. HTTP 400/401/403/404 is now a *configuration error* that stops the batch after one call. And `POST /admin/summarize?retryFailed=true` skips the 2-hour retry wait once the setting is fixed.
- **Settings:** temperature 0.2, max output 4,096 tokens, 60-second timeout. JSON output is forced with `responseMimeType: application/json` and a `responseSchema`.
- **Key:** `GEMINI_API_KEY`, kept only in the server's `.env`. It's sent in the `x-goog-api-key` header (never the URL), so it can't appear in logged errors. The Flutter app never sees it.

## What the model receives

For each story, it receives up to 12 of its current articles: one per publisher first, then the newest others. Each article goes in as JSON with:
- a short reference (`A1`, `A2`…),
- the publisher,
- the title,
- the publication time, and
- the **feed excerpt**.

**The input is never full article text**, and every analysis says so (`inputScope`: "Generated from feed headlines and short excerpts only, not full articles…").

### Prompt-injection guard

Article text is treated as data, not instructions, in three ways:
1. The system prompt says the article data is untrusted and that any instructions inside it must be ignored.
2. The articles are passed as a JSON array between `<<<ARTICLES_BEGIN>>>` and `<<<ARTICLES_END>>>` markers. Any `<<<` or `>>>` in article text is removed first, so an article can't close the data block early.
3. Everything the model returns is validated, so even a successful injection can only produce text that cites the story's own articles.

## Rules in the prompt (summary)

- Use only facts in the provided articles. No outside knowledge, and no invented numbers, names or quotes.
- Cite the supporting article references for the overview, every point, and every perspective.
- The overview describes claims *as reported*. Agreement among sources is not proof.
- Perspectives must be grounded in what people in the coverage say or do. They are **never** assigned or named based on which outlet published the article.
- Never invent disagreement. If fewer than two distinct viewpoints are supported, return none and report `insufficient_evidence`.

## Validation before storing

The server checks everything the model returns before saving it:

| Check | Action |
|---|---|
| Not valid JSON | Generation fails (honest "failed" status) |
| Citation to a reference that wasn't in the prompt | Citation dropped |
| Point or perspective with no valid citation | Dropped |
| Overview with no valid citation | **Generation fails.** Untraceable text is never shown. |
| Perspective named after an outlet ("Fox", "NPR", "BBC") | Dropped |
| Fewer than 2 perspectives left, or the model said insufficient | Shown as "Insufficient evidence for distinct perspectives." |
| Text in quotation marks that doesn't appear in any input title or excerpt | Quotation marks removed, so a paraphrase never looks like a verbatim quote |

Anything dropped is recorded in that call's `ai_calls.error` field for review.

## Reuse and regeneration

- Each story has a fingerprint, `stories.articles_hash`, built from its articles' IDs and their last-change times. A stored summary records the hash it was generated from (`input_hash`) and the exact article IDs it used (`input_article_ids`).
- After each hourly collection, the summarizer processes stories with no summary or with a stale one (`input_hash` ≠ `articles_hash`). Multi-publisher stories go first, then larger and newer ones.
- **Repeated reads of unchanged content never call the model.** The `ai_calls` table logs every model request, and a test checks that 4 parallel reads plus a second collection run still leave exactly 1 call.
- **What the API serves:**

  | Status | When | Content shown? |
  |---|---|---|
  | `ready` | Generated from the story's current articles | Yes |
  | `outdated` | New articles joined since generation, but every input article is still current | Yes, flagged ("does not yet include N newer articles") |
  | `pending` | No summary yet, or an input article has expired or left the story | **No.** A summary that depends on a removed article is never served, even between runs. |
  | `failed` | The last attempt for the current inputs failed | **No**, honest message; original sources stay available |
  | `not_available` | The story has fewer articles than `AI_MIN_ARTICLES` and no summary | **No.** The message explains the quota policy. |

## Failure handling

- A model error is recorded against that story (`last_error`) and in `ai_calls`. Errors include timeouts, HTTP errors, rate limits, blocked output, truncated output and invalid output. **A failure never erases an earlier successful summary.**
- **Temporary provider trouble** means HTTP 500/502/503/504 (Gemini answered "model is currently experiencing high demand" several times on October 20), a timeout, or a network error. It's handled like this:
  - retried once after 15 seconds in the same batch;
  - if it still fails, the story is marked `failed`, with the message that the AI service was busy and it will be retried automatically;
  - it's retried on the next run, with no back-off;
  - after 3 stories in a row fail this way, the batch stops.
- The request timeout is 120 seconds. Live calls took 8–55 seconds, and the original 60-second limit caused timeouts.
- Any other failure, such as invalid or untraceable output or blocked output, waits 2 hours before the same inputs are retried.
- A rate-limit response (HTTP 429) stops the batch right away. The remaining stories wait for the next hourly run.
- A configuration error (HTTP 400/401/403/404, such as a bad key or an unknown model) also stops the batch after one call.
- Without `GEMINI_API_KEY`, the summarizer does nothing and stories show `pending`. Collection, grouping and the API work normally.

## Quotas and cost

- **Cost:** $0 on the free tier.
- **Free-tier limits** are per model and reset at midnight Pacific time:
  - `gemini-3.5-flash-lite`: 500 requests per day, 15 per minute.
  - `gemini-3.8-flash`: only 20 per day. It ran out on the first day after about 20 real calls, so the server switched to the lite model.
- **The server's own budget, to stay inside those limits:**

  | Setting | Default | Effect |
  |---|---|---|
  | `AI_DAILY_BUDGET` | 250 | At most 250 calls per quota day (midnight to midnight Pacific) **to the configured model**, retries included. That's half the free quota, leaving room for manual tests. Calls to other models don't count, because Google's limits are per model. |
  | `AI_MIN_ARTICLES` | 2 | Only stories with 2+ current articles are summarized. Single-source stories without a summary show status `not_available`, explaining that AI analysis is reserved for multi-article stories to stay within the free quota. |
  | `AI_MAX_PER_RUN` | 20 | At most 20 stories per hourly run |
  | `AI_MIN_INTERVAL_MS` | 6,500 | Gap between calls, about 9 per minute against the 15-per-minute limit |

- **Priority order:** multi-publisher stories first, then larger, then newer. New articles joining a story, or an expiry, also cost a call to regenerate. On a busy news day, some multi-article stories may wait until the next day and show `pending` until then.
- When the budget or Google's quota runs out, the batch stops cleanly (`stoppedEarly` says why). Stories keep any summary they already have.
- **Data use:** Google may use free-tier prompts and responses to improve its products. Our inputs are public headlines and feed excerpts, so this was judged acceptable. A paid tier would avoid it.

## Admin endpoints

- `POST /admin/summarize` runs a summarization pass now and waits for it to finish. Add `?retryFailed=true` to retry recently failed stories immediately.
- `GET /admin/ai-calls` shows the call log, totals, and coverage (stories with a current, outdated or missing summary).
- `POST /admin/collect` also starts a summarization pass in the background after collecting.

## Manual review of three summaries

*To be completed against live output:* for three stories, compare each overview, point and perspective with the cited excerpts. Record unsupported claims, missing context and corrections made.
