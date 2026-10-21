# News collection

The server collects articles from RSS feeds every hour and stores them in the `articles` table. Every run is logged in `job_runs` and `job_feed_results`. The code is in [server/src/collector/](../server/src/collector/), and the feed list is in [server/src/feeds.ts](../server/src/feeds.ts).

## Sources

| Publisher | Feeds |
|---|---|
| NBC News | news, world, politics (`feeds.nbcnews.com/nbcnews/public/<section>`) |
| NPR | news (1001), world (1004), politics (1014) (`feeds.npr.org/<id>/rss.xml`) |
| BBC News | top stories, world (`feeds.bbci.co.uk/news/...`) |

Each publisher has several section feeds so there's more overlapping coverage to group into stories.

**Change on October 20, 2026:** **Fox News** (latest, world, politics) was replaced by **NBC News**, the project owner's choice. CNN was considered, but its RSS feeds stopped updating in April 2023. Fox articles already stored stay until they pass the 7-day window, unless removed by hand. A local live run with the new set returned 140 articles, which formed 11 multi-publisher stories (9 with the Fox set). Earlier evidence in these docs comes from the Fox, NPR and BBC set and is labeled with its date.

## Normalization and duplicate prevention

Each feed item becomes one article row:

- **URL** is normalized:
  - forced to `https`,
  - fragment and login info removed,
  - tracking parameters removed (`utm_*`, `at_*`, `fbclid`, `gclid`, `cmpid`, `ocid` and similar),
  - remaining query parameters sorted, and
  - trailing slash removed.

  For example, `https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&at_campaign=rss` becomes `https://www.bbc.co.uk/news/articles/abc`.
- **The normalized URL is the dedupe key.** `articles.url` is `UNIQUE`, and the article `id` is the first 24 hex characters of `sha256(url)`, so the ID never changes.
- **Re-fetching an article updates the existing row.**
  - If the title, excerpt or publication date changed, the row is updated and counted as `updated`.
  - Otherwise only `last_seen_at` is updated, and it's counted as `unchanged`.
  - The same article from two feeds of one publisher, or with different tracking parameters, is stored once.
- **Title and excerpt** have HTML tags and entities stripped and whitespace collapsed. Titles are capped at 300 characters. Excerpts come from the feed's description, are capped at 1,000 characters, and are **feed excerpts, not full article text**.
- **Skipped items** (counted in `skipped`):
  - no usable `http(s)` link,
  - an empty title, or
  - a valid publication date already more than 168 hours old when first seen.

  BBC's feed includes old pinned items (one was dated April 2025), and this rule keeps them out.

## Publication date rule

The 7-day window uses **publication time**, not download time. All timestamps are stored as ISO 8601 UTC.

1. The candidate fields are tried in order: RSS `pubDate`, then `dc:date`, then Atom `published`, then `updated`.
2. The first candidate that parses to a time **between 2000-01-01 and one hour after now** is used. The one-hour allowance covers clock differences. `published_at_source = 'feed'`.
3. If **no** candidate is present (**missing**), or none qualifies (**invalid**: unparseable, more than an hour in the future, or before 2000), the article's **first-seen time** (when the collector first stored it) is used instead. `published_at_source = 'first_seen'`.
4. A fallback date **never moves forward**. When the same undated item appears in later runs, the stored first-seen date stays. So an undated article still leaves the 7-day window about 168 hours after it first appeared, instead of staying forever.
5. If a later fetch includes a **valid** date for an article stored with a fallback, the valid date replaces it.

Why: dropping undated articles would lose real news. Using download time on every fetch would keep them forever. First-seen time is the closest available estimate, and `published_at_source` records that it's an estimate.

## Schedule

- The server process is always running (Docker `restart: unless-stopped` on the Oracle VM), and it runs a collection at **the top of every hour (UTC)**. Nothing depends on a client being connected.
- At startup it also runs once (trigger `startup`) if the last run started more than 50 minutes ago, so a deploy or reboot doesn't leave a gap. Set `COLLECT_ON_STARTUP=false` to turn this off.
- Only one run happens at a time. A run requested while another is in progress is refused (the manual trigger returns `409`).
- A run cut off by a restart is left as `running` and marked `interrupted` the next time the server starts.

## Failure isolation

- All feeds are fetched in parallel, with a 15-second timeout each. A fetch error (DNS failure, timeout, HTTP error status) is recorded for that feed only.
- Each feed's items are parsed and written in **their own transaction**. If a feed returns something that isn't RSS or Atom (for example an HTML error page), or a database error happens partway through, only that feed's writes are rolled back.
- Run outcome:
  - `success`: all feeds OK
  - `partial`: some feeds failed
  - `failed`: all feeds failed

  A failed run **never deletes** existing articles.
- The "last successful collection" time is the latest run with outcome `success` or `partial`.

## Job log

`job_runs` holds one row per run:
- `trigger` (`schedule` / `manual` / `startup`)
- `started_at`, `finished_at`
- `outcome`
- feed counts (`feeds_ok`, `feeds_failed`)
- article counts (`items_seen`, `articles_inserted`, `articles_updated`, `articles_unchanged`, `items_skipped`)
- `error`

`job_feed_results` holds one row per feed per run: `ok`, `http_status`, counts, `duration_ms`, and `error`.

The logs contain counts and error messages only, never article text, so they can be kept beyond the 7-day news window.

## Admin endpoints

Admin endpoints are protected by `Authorization: Bearer <ADMIN_TOKEN>`. `ADMIN_TOKEN` is set in `server/.env`. If it isn't set, the endpoints return `503`. A missing or wrong token returns `401`.

| Endpoint | What it does |
|---|---|
| `POST /admin/collect` | Runs a collection now (trigger `manual`) and returns the run summary with per-feed results. Returns `409` if a run is already in progress. |
| `GET /admin/runs?limit=20` | The job log, newest first, with per-feed results, `lastSuccessfulCollectionAt`, and whether a run is in progress. |
| `GET /admin/articles?limit=50` | Total article count, counts per publisher, and the newest stored articles. |

Example:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://163-192-125-189.sslip.io/admin/collect
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://163-192-125-189.sslip.io/admin/runs
```

## Expiry

After each run's feeds are stored, articles published more than 168 hours ago are deleted. This happens even when every feed failed. Then stories are regrouped and cleaned up. Between runs, the public API applies the same cutoff when each request comes in. Details are in [grouping.md](grouping.md#expiry-and-cleanup).
