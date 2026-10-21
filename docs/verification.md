# Verification evidence

These are the required checks from the assignment (§10). Results come from the deployed server (`https://163-192-125-189.sslip.io`), the Android release build running in the emulator, and the automated tests (`cd server && npm test`: 74 tests, all passing).

| # | Check | Expected | Actual result | Evidence |
|---|---|---|---|---|
| 1 | Repeated ingestion | Fetching identical inputs twice doesn't duplicate articles or stories | **Pass.** Deployed run #1 (startup) inserted 152 articles. Run #2 (manual, 10 s later) inserted **0**, with 168 unchanged. A second grouping run created **0** stories. | `/admin/runs` (Oct 20, 22:33 UTC); tests "re-fetching identical feeds does not duplicate articles" and "re-running identical input creates no new stories" |
| 2 | Same event, different publishers | Relevant articles in one story, with working publisher buttons | **Pass.** 9 stories with 2–3 publishers on live data, for example Alberta referendum (BBC, Fox, NPR), France riots (Fox, NPR), Pope Leo XIV (BBC, Fox). In the emulator, the France story shows only **Fox News** (5 articles, chooser) and **NPR** buttons, and Open launches the article in Chrome. | [grouping.md](grouping.md#live-results-deployed-server-october-20-2026); emulator screenshots |
| 3 | Similar topic, different events | Unrelated events stay separate | **Pass.** Live pairs kept apart: "Trump's economy" (Fox) vs. "US economy under Trump" (BBC); two different "Former US ambassador" stories; two different Elon Musk stories. Tests: Trump tariffs vs. Trump rally, Nigeria Ebola vs. Nigeria floods, and a roundup article that can't chain two events. | [grouping.md](grouping.md); `server/test/stories.test.ts` |
| 4 | Hourly automation | Deployed config plus ≥2 consecutive scheduled runs without client activity | **Pass, pending final record.** The schedule runs inside the always-on server process at :00 UTC (`startHourlySchedule`), and Docker `restart: unless-stopped` keeps it running. *Run records to be pasted below.* | `server/src/collector/scheduler.ts`, `server/docker-compose.yml`; `/admin/runs` output below |
| 5 | Seven-day boundary | Expired articles leave the API and are removed during cleanup; recent ones remain | **Pass** (controlled timestamps). An article 165 h old is listed; 4 h later, **with no run in between**, it's gone from `/stories` and returns 404, while the row is still stored. The next run deletes it (`articles_expired: 1`), and a 1-hour-old article remains. | Tests "the API hides expired articles between runs…" and "expiry deletes articles past 168 hours…" |
| 6 | Source expiration inside a group | Expired source buttons disappear; summaries stop depending on removed content | **Pass.** When Fox's article passes 168 h, the Fox source disappears from `/stories/:id` right away, and the stored AI summary that cited it is **hidden** (status `pending`). The next pass regenerates it from the remaining articles, and the new citations exclude the expired article. | Tests "when a source expires, the old summary is hidden at once and rebuilt…" and "a story that loses one source keeps the rest…" |
| 7 | Shared AI output | Repeated reads from two clients reuse the same stored summary with no extra generation | **Pass.** Two separate HTTP clients (02:50 UTC) and the emulator app (02:47 UTC) all received the France summary generated at **02:42:07Z**. Every model request is logged in `ai_calls`; a test shows 4 parallel reads plus a second collection still leave exactly 1 call. | Command output in the [AI docs](ai.md#reuse-and-regeneration); test "two clients reading repeatedly…" |
| 8 | Provider failure | An unavailable news source or AI model gives a clear status while stored stories stay usable | **Pass.** Live: on Oct 20, Gemini returned HTTP 404, then 503 "high demand", then 429 quota errors. The stories API kept serving all stories, and affected stories showed `failed` or "temporarily unavailable" messages, never fake text. Feeds: one failing feed gives a `partial` run without losing articles (tests with HTTP 503, DNS failure, an HTML error page and a timeout). | [ai.md](ai.md#failure-handling); `server/test/collector.test.ts` |
| 9 | Client connectivity failure | Useful retry state or labeled cached content | **Pass, screenshot pending.** When the app can't reach the server, it shows "Couldn't load stories" with "Can't reach the My News server. Check that you're online and try again." and a **Try again** button. A failed refresh keeps the current list and shows a notice. *Screenshot from a test build pointed at a non-existent server to be added.* | `flutter_application_1/lib/api/news_api.dart`, `story_list_screen.dart` |
| 10 | Physical-phone presentation | Release build on a phone, shown through Phone Link | **Deviation.** No Android phone was available (the developer has an iPhone, which can't run a Windows-built app, and Phone Link can't mirror iPhones). The **release APK** is demonstrated in the Android Studio emulator (Pixel 8, Android 17). | Release notes below |
| 11 | Beta-readiness regression | 3 consecutive clean core-workflow runs; no open critical or major defects | *To be completed with the run log in [demo-checklist.md](demo-checklist.md).* The defect log has no open critical or major items. | [README](../README.md#defect-log) |
| 12 | Source fidelity | Original excerpts stay original; AI claims traceable to inputs | **Pass.** Excerpts are shown as "Latest report · original wording" and "Feed excerpt, not the full article". AI text is always labeled "AI-generated" with numbered citations. The server rejects uncited overviews, drops uncited points, and removes quotation marks from quotes not found in the input. The live parse check confirms every AI citation is an article in that story. A manual review of 3 summaries found unsupported claims, which were fixed and re-checked. | [ai.md](ai.md#manual-review-of-three-summaries); `tool/live_check.dart` |

## Scheduled run records (check 4)

*Paste the output of the command below, run on the server:*

```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://163-192-125-189.sslip.io/admin/runs?limit=12" | grep -o '"id":[0-9]*,"trigger":"[a-z]*","started_at":"[^"]*","finished_at":"[^"]*","outcome":"[a-z]*"'
```

## Grouping examples

See [grouping.md](grouping.md): 9 live multi-publisher stories, 3 live related-but-separate pairs, and the 2 fixture pairs in the tests.

## AI summary review

See [ai.md](ai.md#manual-review-of-three-summaries): Alberta, France and Ilhan Omar, reviewed against their excerpts, corrected, and re-checked twice. There are 3 stories with real contrasting perspectives: France, Ilhan Omar and the Strait of Hormuz.
