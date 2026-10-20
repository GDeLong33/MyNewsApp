// Model configuration and the Gemini REST client. The API key comes only from the server environment.

export interface ModelConfig {
  provider: "gemini";
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

/**
 * Defaults; GEMINI_MODEL overrides the model name. gemini-2.5-flash was the first choice, but on 2026-10-20 the API
 * rejected it for new accounts ("no longer available to new users") and named gemini-3.8-flash as its replacement.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "gemini",
  model: "gemini-3.8-flash",
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 60_000,
};

/**
 * "config" = the request itself is wrong (bad key, unknown model, invalid request): retrying other stories is
 * pointless until the configuration is fixed, so the summarizer stops the batch.
 */
export type ModelErrorKind =
  | "rate_limited"
  | "config"
  | "http"
  | "blocked"
  | "truncated"
  | "empty"
  | "timeout"
  | "network";

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface ModelRequest {
  system: string;
  user: string;
  schema: object;
}

export interface ModelResponse {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ModelClient {
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

type Fetcher = typeof fetch;

export class GeminiClient implements ModelClient {
  constructor(
    private readonly apiKey: string,
    private readonly config: ModelConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`;
    let res: Response;
    try {
      // The key goes in a header, never the URL, so it can't leak into logged error messages.
      res = await this.fetcher(url, {
        method: "POST",
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: request.schema,
          },
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ModelError("timeout", `model request timed out after ${this.config.timeoutMs} ms`);
      }
      throw new ModelError("network", `model request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const detail = await errorDetail(res);
      if (res.status === 429) throw new ModelError("rate_limited", `rate limited by Gemini (HTTP 429)${detail}`);
      if ([400, 401, 403, 404].includes(res.status)) {
        throw new ModelError("config", `Gemini returned HTTP ${res.status}${detail}`);
      }
      throw new ModelError("http", `Gemini returned HTTP ${res.status}${detail}`);
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new ModelError("blocked", `prompt blocked by Gemini: ${data.promptFeedback.blockReason}`);
    }
    const candidate = data.candidates?.[0];
    if (!candidate) throw new ModelError("empty", "Gemini returned no candidates");
    if (candidate.finishReason === "MAX_TOKENS") throw new ModelError("truncated", "model output was cut off (MAX_TOKENS)");
    if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
      throw new ModelError("blocked", `model stopped early: ${candidate.finishReason}`);
    }
    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim()) throw new ModelError("empty", "Gemini returned empty text");
    return {
      text,
      model: data.modelVersion ?? this.config.model,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ? `: ${body.error.message.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}
