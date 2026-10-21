# API

**Base URL:** `https://163-192-125-189.sslip.io`

All responses are JSON, and all timestamps are ISO 8601 UTC. The public endpoints only read stored results. They never fetch news or call an AI model.

## Public

### `GET /health`
Returns server and database status: `{"status":"ok","time":…,"database":{"ok":true,"bootCount":…,"firstBootAt":…,"lastBootAt":…}}`.

### `GET /stories?limit=50`
Top stories, newest coverage first. There is one entry per story. Only articles from the last 168 hours count, checked at request time. `limit` can be 1–200.

```json
{
  "generatedAt": "2026-10-20T23:10:00.000Z",
  "lastSuccessfulCollectionAt": "2026-10-20T23:00:00.104Z",
  "retentionHours": 168,
  "stories": [
    {
      "id": "s_4f1c0a9b2e7d3c5a8b6e0f12",
      "headline": "Alberta voters decide whether to take a step toward separating from Canada",
      "updatedAt": "2026-10-20T21:14:03.000Z",
      "articleCount": 4,
      "publisherCount": 3,
      "publishers": ["BBC News", "NBC News", "NPR"],
      "aiStatus": "ready",
      "hasAiAnalysis": true
    }
  ]
}
```

### `GET /stories/{id}`
One story, with its current articles grouped by publisher. Each publisher becomes one "Original coverage" button. Returns `404 {"error":"not_found"}` if the story doesn't exist or all of its articles have expired.

```json
{
  "id": "s_4f1c0a9b2e7d3c5a8b6e0f12",
  "headline": "Alberta voters decide whether to take a step toward separating from Canada",
  "createdAt": "2026-10-20T22:33:05.001Z",
  "updatedAt": "2026-10-20T21:14:03.000Z",
  "articleCount": 4,
  "publisherCount": 3,
  "lastSuccessfulCollectionAt": "2026-10-20T23:00:00.104Z",
  "sources": [
    {
      "publisher": "BBC News",
      "articles": [
        {
          "id": "9c0e…",
          "title": "'Great result for Canada', says Carney as Alberta votes to reject separatism",
          "url": "https://www.bbc.co.uk/news/articles/…",
          "excerpt": "Feed description text (an excerpt, not the full article).",
          "publishedAt": "2026-10-20T21:14:03.000Z",
          "publishedAtEstimated": false,
          "grouping": { "matchedArticleId": "…", "score": 0.378, "sharedConcepts": ["alberta", "canada", "carney"] }
        }
      ]
    }
  ]
}
```

- `publishedAtEstimated: true` means the feed gave no valid date, so the first-seen time is used. See [collection.md](collection.md).
- `grouping` explains why the article joined the story. It is `null` for the article that founded the story. See [grouping.md](grouping.md).

The detail response also includes `background`, the context links chosen by the server ([background.md](background.md)). It's an empty list when none qualified, and the app then shows "No background resource available":

```json
"background": [
  { "title": "Mark Carney (Wikipedia)", "url": "https://en.wikipedia.org/wiki/Mark_Carney",
    "description": "Prime Minister of Canada since 2025", "source": "Wikipedia", "matchedTerm": "Mark Carney" }
]
```

It also includes `ai`, the stored AI analysis. See [ai.md](ai.md) for when each status applies.

```json
"ai": {
  "status": "ready",
  "message": "AI-generated analysis of the coverage listed below.",
  "label": "AI-generated",
  "generatedAt": "2026-10-20T23:01:12.000Z",
  "model": "gemini-3.5-flash-lite",
  "promptVersion": "2026-10-20.1",
  "inputScope": "Generated from feed headlines and short excerpts only, not full articles. Read the original coverage for full context.",
  "inputArticleIds": ["9c0e…", "75ee…"],
  "overview": { "text": "…", "citations": ["9c0e…", "75ee…"] },
  "agreement": [{ "text": "…", "citations": ["…"] }],
  "disagreement": [],
  "uncertainties": [{ "text": "…", "citations": ["…"] }],
  "perspectives": {
    "status": "supported",
    "message": null,
    "items": [{ "name": "Supporters of independence", "summary": "…", "evidenceLimits": "…", "citations": ["…"] }]
  }
}
```

- `status` is one of:
  - `ready`
  - `outdated`: shown, but flagged as missing newer articles
  - `pending`: none yet, or it depended on an expired article
  - `failed`
  - `not_available`: single-source story outside the free-quota policy

  For `pending`, `failed` and `not_available`, `overview` and `perspectives` are `null`. Show `message` instead.
- `citations` are article `id`s from `sources[].articles[]`.
- When `perspectives.status` is `insufficient_evidence`, `items` is empty and `message` is "Insufficient evidence for distinct perspectives."

## Admin

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`. They're described in [collection.md](collection.md#admin-endpoints).

| Endpoint | Purpose |
|---|---|
| `POST /admin/collect` | Run a collection now, including expiry and grouping. |
| `GET /admin/runs` | Job log with per-feed results. Each run also records `articles_expired`, `stories_created`, `articles_joined` and `stories_removed`. |
| `GET /admin/articles` | Raw stored articles. |
| `POST /admin/background` | Choose background links now and wait for it to finish. |
| `POST /admin/summarize` | Run an AI summarization pass now and wait for it to finish. |
| `GET /admin/ai-calls` | AI call log, totals, and summary coverage. |
