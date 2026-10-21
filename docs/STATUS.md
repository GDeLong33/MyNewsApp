# My News: Project Status

**Last updated:** October 20, 2026
**Due:** Friday, October 23, 2026, 11:59 p.m. Eastern (3 days left)
**Deployed API:** https://163-192-125-189.sslip.io (try [/health](https://163-192-125-189.sslip.io/health))

Update this file at the end of each work session.

## The project in one paragraph

My News is a CS 403 app that groups news coverage of the same event from several publishers into one story. The **server** (`/server`, Node + TypeScript + SQLite, running on an Oracle Cloud VM) collects articles every hour, groups them into stories, finds background links, generates AI summaries and perspectives, and stores everything. The **Flutter app** (`/flutter_application_1`, Android) only reads the stored results from the server's API and shows the story list, story details, publisher and background buttons, and AI analysis. The full assignment text is in [spec.md](spec.md), and the short version is in [../CLAUDE.md](../CLAUDE.md).

```
RSS feeds ──► hourly worker ──► SQLite (on VM disk) ──► API (/stories, /stories/:id) ──► Flutter app
                   │                                         ▲
                   └──► AI provider (summaries, stored) ─────┘   (app never calls feeds or AI)
```

## Progress at a glance

| Area | Rubric points | Status |
|---|---|---|
| Deployed backend, persistent storage, API, server/client split | 15 | Partly done: deployed with `/health` only, no story API yet |
| Three-publisher ingestion, hourly schedule, dedupe, 7-day retention | 20 | Done and deployed; hourly run records still to collect for evidence |
| Automatic story grouping | 15 | Done and deployed: 9 multi-publisher stories on live data |
| Flutter list, detail, buttons, usability, beta readiness | 20 | Screens written and checked against the live API; not yet compiled, which needs Windows Developer Mode and Android Studio; needs an Android phone for the demo |
| Grounded AI summaries, perspectives, attribution, shared reuse | 20 | Built and tested with a fake model (Gemini free tier chosen); needs a live test, deploy, and the manual review of 3 summaries |
| Verification evidence, docs, demo, AI reflection | 10 | Partly done: spec copy, CLAUDE.md, deploy guide |

## Done

- [x] Assignment copied to [docs/spec.md](spec.md); project rules and requirements summary in [CLAUDE.md](../CLAUDE.md).
- [x] Flutter project created in `/flutter_application_1` (still the default counter app).
- [x] Minimal server in `/server`:
  - Express 5 + TypeScript, using Node's built-in SQLite (`node:sqlite`), so there are no native packages to compile.
  - `GET /health` returns status plus database startup stats. Unknown routes return a JSON 404.
  - Database path set by `DATABASE_PATH`, with a small migration system ([server/src/migrations.ts](../server/src/migrations.ts)).
  - 3 passing tests (`npm test`): health, 404, and data surviving a database reopen.
  - Dockerfile, `.env.example`, and a root `.gitignore` that excludes `.env`, `node_modules`, `dist` and database files.
- [x] Deployed to the Oracle Cloud Always Free VM (Ubuntu 20.04, ARM64):
  - Docker Compose runs the server plus Caddy, which provides automatic Let's Encrypt HTTPS.
  - Oracle security list rules fixed: ports 80/443 had been set as *source* ports instead of *destination* ports.
  - Persistence verified: the database kept its first startup record (`firstBootAt`) after the container was recreated (`bootCount` went from 1 to 2).
  - Steps documented in [docs/deploy.md](deploy.md).
- [x] News collector ([docs/collection.md](collection.md)):
  - 8 RSS feeds from 3 publishers: Fox News, NPR, BBC News.
  - Normalized into an `articles` table. The normalized URL is the unique key and the ID is a hash of it, so re-fetching updates instead of duplicating.
  - Publication date rule documented: a missing or invalid date falls back to the first-seen time, which never moves forward.
  - Hourly schedule at :00 UTC inside the server process, plus a run at startup.
  - Protected `POST /admin/collect` trigger, plus `GET /admin/runs` (job log) and `GET /admin/articles`.
  - `job_runs` and `job_feed_results` tables. Each feed is fetched and written separately, so one failed feed gives a `partial` run instead of a crash.
  - 29 passing tests covering dedupe, date rules, failure isolation, timeouts, overlapping runs and admin auth.
  - Tested locally against the live feeds: 151 articles on the first run; the second run found 0 new and 168 unchanged.
  - **Deployed to the VM on October 20.** The startup run (#1) stored 152 articles: 70 Fox, 57 BBC, 25 NPR. The manual run (#2) found 0 new and 168 unchanged, with all 8 feeds OK.

- [x] Expiry, grouping, cleanup and the stories API ([grouping.md](grouping.md), [api.md](api.md)):
  - 168-hour expiry by publication time on every run, even when all feeds fail. The API applies the same cutoff at request time between runs.
  - Grouping uses TF-IDF similarity plus at least 2 shared concepts, with names counted once and job titles ignored. A strict-majority check stops chaining. Thresholds were tuned on live data.
  - Stable story IDs (`s_<founding article id>`). New coverage joins existing stories. Single-source stories are kept.
  - Empty stories are deleted, and their summaries go with them (cascade). Stories that lose a source get a new `articles_hash`, so old summaries become stale.
  - `GET /stories` and `GET /stories/:id` (public, read-only).
  - 42 tests pass, including two related-but-separate cases (same person, same country) and a chaining case.
  - **Deployed October 20.** The first run on the server made 126 stories, 9 of them with 2–3 publishers. Live at `/stories`.

- [x] Submission docs written (October 20, about 11 p.m.): root README (architecture, data model, API, services, costs, limitations, release notes, defect log), [verification.md](verification.md), [demo-checklist.md](demo-checklist.md) with the release test log, and a draft [ai-reflection.md](ai-reflection.md) for Gavin to personalize.

**Remaining for submission:** paste the scheduled-run records into verification.md (check 4); connectivity-failure screenshot (check 9); 3 release test runs logged (check 11); Gavin edits the AI reflection; record the demo; submit the repo link and APK.

## Still to do

The order follows the spec's work plan (§8). Each step gets tested before the next one starts.

### 1. Ingestion and retention (server)
- [x] Publishers: Fox News, NPR, BBC News (8 feeds).
- [x] Fetch, parse and normalize RSS/Atom; dedupe by normalized URL.
- [x] Hourly schedule, protected manual trigger, job log, per-feed failure isolation.
- [x] Date rule for missing or invalid dates documented in [collection.md](collection.md).
- [x] Collector deployed. Manual trigger and job log confirmed on the live URL.
- [ ] Confirm the hourly `schedule` runs appear in `/admin/runs` at :00 UTC. Two in a row are needed for the verification table.
- [x] 7-day retention and cleanup, tested with controlled timestamps.

### 2. Story grouping (server)
- [x] Grouping, stable IDs, single-source stories, new coverage joining, evidence and failure modes documented in [grouping.md](grouping.md).
- [x] Deployed and checked on the VM's live data. Evidence table in grouping.md updated.

### 3. Story API (server)
- [x] `GET /stories` and `GET /stories/:id`, documented in [api.md](api.md).
- [ ] Add background links and AI fields to `GET /stories/:id` (steps 4–5).
- [ ] Copy the API description into the final README.

### 4. Background resources (server): DONE in code, October 20 ([background.md](background.md))
- [x] Wikipedia lookups for names in 2+ articles, or multi-word names in the headline; disambiguation and name-list pages skipped; up to 3 links per story; 24-hour cache; cleanup with the story. 8 tests, 71 total.
- [x] Local live check: 54 of 130 stories have links (7 of 9 multi-publisher), and every link was read and judged relevant.
- [ ] Deploy and confirm on the server.

Original checklist:
- [ ] Automatically find relevant links, for example by searching Wikipedia using the story's key entities. Store them per story.
- [ ] Show "No background resource available" when nothing relevant is found.
- [ ] Demo relevant links on 3+ stories.

### 5. AI summaries and perspectives (server)
- [x] Provider: Google Gemini free tier. Key is in the VM's `server/.env` as `GEMINI_API_KEY`.
- [x] Prompt, model config, Gemini client, validation, summarizer job, storage and `ai` field on `GET /stories/:id` ([ai.md](ai.md)). 14 tests with a fake model, 56 total.
- [x] Deployed. `gemini-3.8-flash` works: 11 live summaries generated October 20. Fixed along the way: the old model returned 404, there were 503 overload errors and timeouts, and the free quota (20/day) ran out.
- [ ] Deploy the daily budget (10 calls/day, stories with 2+ articles, 2 per run). Confirm multi-publisher stories get summaries after the quota resets at 07:00 UTC on October 21.
- [x] Switched to `gemini-3.5-flash-lite` (500/day free). Budget 250/day, counted per model. 33 multi-article stories summarized.
- [x] Manual review of 3 summaries (Alberta, France, Omar), with unsupported claims found and fixed through prompt versions .2 and .3, re-checked twice. Recorded in ai.md.
- [x] 3 stories with real contrasting perspectives: France, Ilhan Omar, Strait of Hormuz. Recorded in ai.md.

### 6. Flutter app (`/flutter_application_1`)
- [x] Story list, story detail with the four button groups, AI overview screen, perspectives and perspective detail screens, local readable times, offline/timeout/404 messages, and the API URL as a `--dart-define` setting ([README](../flutter_application_1/README.md)).
- [x] Android manifest: INTERNET permission for release builds, https VIEW query for links, app label "My News".
- [ ] **Needs Gavin:** Windows Developer Mode on, Android Studio installed, licenses accepted.
- [ ] First compile and run (Windows desktop or phone); fix anything found on a real screen.
- [x] Demo decision (October 20): Gavin has no Android phone, so the demo will use the release APK in the **Android Studio emulator**. The spec says emulator-only doesn't meet the phone requirement; Gavin judged the instructor will accept it. Say so openly in the demo.
- [x] Emulator working (Pixel 8, Android 17). This needed SVM Mode enabled in the MSI BIOS and NDK 28.2.13676358 (installed with `android sdk install ndk/28.2.13676358`).
- [x] Release APK built (44.8 MB) and installed on the emulator. The story list and a single-source story detail render correctly with live data (checked with adb screenshots, October 20).
- [x] Checked on the emulator with live data (October 20, 10:47–10:50 p.m.): France story detail (AI overview card, Fox with 5 articles "Choose", NPR "Open", 2 Wikipedia background links, AI buttons); AI overview screen; perspectives list (3 viewpoints); perspective detail with evidence/limits, supporting coverage and Switch; publisher link opens Chrome and Back returns to the same screen.
- [ ] Before the demo: open Chrome on the emulator once and finish its first-run screen, so links open directly.
- [ ] Connectivity-failure evidence: build a test APK with a non-existent API URL and screenshot the retry screen. (Gavin doesn't want airplane mode used.)
- [ ] Optional: local cache showing the last sync time, hiding expired stories even offline.
- [ ] Release APK built and installed on the phone.

### 7. Verification, docs and demo
- [ ] Verification table for all checks in spec §10, with real results, screenshots and logs. This includes at least two consecutive hourly run records.
- [ ] README:
  - setup instructions and architecture diagram,
  - data model and API description,
  - grouping method and retention behavior,
  - service choices, costs and quotas,
  - known limitations, release notes and a defect log.
- [ ] Three consecutive clean runs of the core workflow on the phone (record build, device, date, results).
- [ ] One-page AI development reflection: tools used, 2 prompts, 1 AI mistake that was caught, and what was personally verified.
- [ ] 5–7 minute demo on the physical phone through Microsoft Phone Link, live or recorded.

## Needed from Gavin

| What | When it's needed |
|---|---|
| `ADMIN_TOKEN` in the VM's `server/.env` (`openssl rand -hex 32`, see [deploy.md](deploy.md)) | Now, when deploying the collector |
| Flutter SDK and Android toolchain working on the PC (`flutter doctor`) | Before step 6 |
| Phone with USB debugging enabled + Phone Link tested | Before the demo |
| Commit and push after each step, then redeploy on the VM | After each step |

## Suggested schedule

| Date | Goal |
|---|---|
| Tue Oct 20 | Ingestion, dedupe, hourly job, retention (step 1), deployed so hourly run records start piling up |
| Wed Oct 21 | Grouping + story API (steps 2–3); background links + AI (steps 4–5) |
| Thu Oct 22 | Flutter app (step 6), release APK on the phone, failure testing |
| Fri Oct 23 | Verification table, README, reflection, demo recording; submit by 11:59 p.m. |
