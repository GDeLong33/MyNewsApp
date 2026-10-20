# Story grouping

An **article** is one publisher's report. A **story** is one event, and it can contain articles from several publishers. Grouping runs on the server after every hourly collection, in [server/src/stories/](../server/src/stories/). The Flutter app only reads the results.

## Method

1. **Features per article** ([features.ts](../server/src/stories/features.ts)):
   - *Content words* from the title and the feed excerpt:
     - lowercased, accents removed,
     - stopwords and bare numbers dropped,
     - plurals lightly stemmed.

     Title words count double.
   - *Name phrases*: runs of capitalized words, such as "Kate Middleton", "Bank of England" or "FAA". Job titles ("President", "Former", "Judge", "Prime Minister"…) are removed from these phrases, because two stories about different judges must not look alike because of the word "Judge". Title Case headlines are skipped for name detection.

2. **Similarity** ([similarity.ts](../server/src/stories/similarity.ts)): TF-IDF cosine similarity between two articles. IDF is computed over all current (non-expired) articles, so words used everywhere, like "Trump" this week, count for little.

3. **Shared concepts**: the words both articles use, grouped so that **one name counts once**. "Donald Trump" vs. "Trump" is one concept, and so is "Pope Leo XIV". A word used by more than 20% of current articles doesn't count as evidence.

4. **Matching rule.** Two articles describe the same event only if they were published **within 72 hours** of each other and either:

   | Rule | Similarity | Shared concepts | …of which names |
   |---|---|---|---|
   | strong | ≥ 0.35 | ≥ 2 | ≥ 1 |
   | moderate | 0.20 – 0.35 | ≥ 3 | ≥ 2 |
   | (no match) | < 0.20 | | |

   **A single shared person or keyword can never satisfy either rule**, because both need at least 2 distinct concepts.

5. **Assignment.** This is incremental, and existing assignments never change:
   - New (ungrouped) articles are processed oldest first.
   - Each one is compared with every article already in a story.
   - It joins the story whose member gives the best match, **if** it also has some similarity (cosine 0.1 or more) with a **strict majority** of that story's members. This stops chaining, where one broad article, like NPR's "Morning news brief" roundup, links two unrelated events.
   - With no qualifying story, the article founds a new one.
   - Single-source stories are normal and stay in the list.

6. **Story fields:**
   - `id` = `s_` + the founding article's ID. It never changes, and re-running identical input reproduces it.
   - `headline` = the title of the member most similar to the others.
   - `updated_at` = the latest publication time among its articles.
   - `article_count`, `publisher_count`.
   - `articles_hash` = a fingerprint of the member articles. A stored AI summary is current only while its `input_hash` equals this.

   Each joined article stores *why* it joined (`story_match_json`: the matched article, the score, the shared concepts). `GET /stories/:id` returns this as `grouping`.

## How the thresholds were chosen

All cross-publisher article pairs from a live collection on October 20, 2026 (151 articles) were scored and read by hand:

- **The first draft accepted 3 false matches.** It used similarity ≥ 0.20 with ≥ 2 concepts and ≥ 1 name. The false matches were:
  - "Voters weigh in on Trump's economy" vs. "How is the US economy doing under President Trump?" (similarity 0.236)
  - two unrelated "Former US ambassador…" stories (0.226; "Former" was being treated as a name)
  - two different Ukraine stories (0.206)
- **Fixes:** job titles were removed from name phrases, and the stricter *moderate* rule was added for 0.20–0.35. All three pairs are now rejected, and the 9 multi-publisher stories below are still found. One borderline true pair was lost: Fox's "Ilhan Omar's sister questioned by feds" vs. BBC's "Obama blasts federal probe of Ilhan Omar" (0.253, only 1 shared name). The rules deliberately favor missing a merge over making a wrong one.
- **Chaining showed up in the first live grouping run.** "Trump's Russia-friendly moves" joined a DOJ voting-crimes story through NPR's "Morning news brief", which mentions both topics. Requiring a strict majority of members to be related fixed it, without splitting any real story.

## Live results (deployed server, October 20, 2026)

On the deployed server's first grouping run, the stored live articles became 126 stories. 9 have 2–3 publishers, 13 more have several articles from one publisher, and 104 are single-article stories. A local run against the same feeds 30 minutes earlier produced the same 9 multi-publisher groups.

| Story (headline chosen by the server) | Publishers | Articles | Story ID |
|---|---|---|---|
| Alberta voters decide whether to take a step toward separating from Canada | BBC News, Fox News, NPR | 4 | `s_d59e3aee7e77424507d64f1c` |
| Violence erupts at France protests as Macron warns unrest is being exploited | Fox News, NPR | 6 | `s_a2f096fefb2a7d73f665af61` |
| 4 Canadian soldiers killed, dozens injured after fast-moving fire erupts at military base | BBC News, Fox News | 3 | `s_d52d08bec5175b56278161ee` |
| Pope Leo XIV thanks wellwishers in first event after cancer surgery | BBC News, Fox News | 2 | `s_0d5edefabea466697791cb75` |
| Saudi Arabia on edge: Iconic Kingdom Centre sends workers home amid Houthi attacks | BBC News, Fox News | 2 | `s_40214389b5a6dbe596b27a2a` |
| Limoges Town Hall 'largely lost' after far-left rioters set historic building on fire | BBC News, Fox News | 2 | `s_b720abf172c6a81406a03e7e` |
| Rays will face Brewers in World Series to produce a first-time champion | Fox News, NPR | 2 | `s_5f4ec105e6c165ded767f53d` |
| Obama blasts federal probe of Ilhan Omar as 'so appalling' | BBC News, Fox News | 2 | `s_c9bec4fb200e38ebaf158cfa` |
| Judge chastises Trump administration plan to push ahead overhaul of DC golf course | Fox News, NPR | 2 | `s_8ced3e09efe9b7819f6a3487` |

Open any of them at `https://163-192-125-189.sslip.io/stories/<id>`. These stories will expire 168 hours after their articles were published, so the IDs are evidence for this date only.

The golf-course pair was checked against the excerpts. Both are about Judge Ana Reyes and the East Potomac Golf Links case.

**Related topics that correctly stayed separate (live):**
- "Voters prepare to weigh-in on Trump's economy" (Fox) vs. "How is the US economy really doing under President Trump?" (BBC). Same person and topic, different pieces. Similarity 0.236, but only 1 shared name.
- "Former US ambassador says South Korea prosecuted him" (Fox) vs. "Former U.S. ambassador on Trump's recent moves to embrace Russia" (NPR). Same words, different people and events. 0 shared names after job titles are removed.
- "Elon Musk continues to dominate midterm fundraising" (NPR) vs. "Elon Musk says Tesla-SpaceX merger would be a good idea" (BBC). Only 1 shared concept ("elon musk").

**Fixture tests** ([server/test/stories.test.ts](../server/test/stories.test.ts)) cover two related-but-separate cases:
- *Same person:* "Trump signs executive order raising tariffs on steel imports" vs. "Trump rallies supporters in Pennsylvania". They share only `trump` and `president`, with similarity 0.115.
- *Same country:* "Nigeria confirms first Ebola case" vs. "Floods displace thousands in northern Nigeria". They share only `nigeria` and `official`, with similarity 0.044–0.063.

The same fixtures confirm that three differently worded Ebola reports (Fox, NPR, BBC) form one story, with similarities of 0.27–0.68.

## Where it can be wrong

- **Missed merges (one event split into two stories).**
  - Feed excerpts are short. Two outlets describing the same event in different words can fall under the thresholds. Live example: Fox's "Fatalities, injuries reported at Canadian Forces Base Wainwright" and BBC's "Deadly fire at Canada military base" scored 0.209, with only 1 shared name ("base" and "fire" are ordinary words). On its own that pair would have stayed apart. It ended up in the right story only because a second Fox article bridged it.
  - Because assignments never change, two stories that start separately are **never merged later**, even if a new article clearly links them.
- **Wrong merges (two events in one story).**
  - Two different events with the same people *and* the same place within 72 hours can pass. An example would be two separate court rulings against the same agency by the same judge.
  - Ongoing sagas get grouped together: the Ilhan Omar probe articles join each other even when each covers a different development (a raid, a statement, a winery closure).
  - Roundup headlines that cover several topics ("…And, Macron condemns protests") join whichever story they match best.
- **Headline choice.** The headline is one publisher's original title, so it carries that outlet's framing. It is not a neutral summary.
- **Name detection is a heuristic.** Capitalized words at the start of a sentence can be mistaken for names, and lowercase names are missed.

## Expiry and cleanup

Each hourly run, in one transaction after collection:
1. **Expired articles are deleted.** These are articles published more than 168 hours ago, by publication time. This happens even if every feed failed.
2. Ungrouped articles are assigned, as described above.
3. **Stories with no articles left are deleted.** Their `story_summaries` rows are removed automatically (`ON DELETE CASCADE`).
4. Remaining stories are refreshed: counts, headline, update time, and `articles_hash`. When a story loses an expired source, its hash changes, so any stored summary built from the old set no longer matches. The AI step will regenerate it, and the API will never present it as current.

**Between runs**, the API applies the same 168-hour cutoff at request time. An article that expires at 10:30 disappears from `/stories` immediately, even though the database row is only deleted at 11:00. A story whose articles have all expired returns 404.
