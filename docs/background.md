# Background resources

Each story's **Background** button group links to Wikipedia pages about the people, places and organizations it covers. The server picks them automatically after each hourly collection. The app only displays what's stored. Code: [server/src/background.ts](../server/src/background.ts).

## Method

1. **Find names in the story's articles.** These are runs of capitalized words in each title and feed excerpt, such as "Mark Carney", "Strait of Hormuz" or "NATO". The same name finder is used for grouping ([grouping.md](grouping.md)).
   - Job titles are removed: "President Donald Trump's" becomes "Donald Trump".
   - A word that starts a sentence only counts if the story also capitalizes it mid-sentence. "Top Trump ally warns…" gives "Trump", and "Violence erupts…" gives nothing.
   - Generic names are ignored: US, UK, America, months, and the news outlets themselves.
2. **Keep only names the story is clearly about:**
   - names that appear in **at least 2 of its articles**, or
   - multi-word names or acronyms that appear in its **headline**.

   Single words from the headline alone are excluded, because "Musk" resolved to the perfume ingredient and "Watt" to the unit of power. Candidates are ranked by how many articles mention them, whether they're in the headline, and whether they're multi-word.
3. **Look each name up** with Wikipedia's page-summary API (`https://en.wikipedia.org/api/rest_v1/page/summary/<name>`). Redirects are followed, so "Zelensky" leads to *Volodymyr Zelenskyy* and "FBI" to *Federal Bureau of Investigation*. A page is accepted only if it's a standard article. These are skipped:
   - **disambiguation pages** ("Mercury"),
   - **name lists** ("Anthony: name list", "Meloni: surname list"), and
   - **missing pages**.

   The server never guesses.
4. **Store up to 3 links per story**, labeled `<Page title> (Wikipedia)` with Wikipedia's short description, such as "Mark Carney (Wikipedia): Prime Minister of Canada since 2025". If none qualify, the app shows **"No background resource available"**.

## Scheduling, caching and cleanup

- **Which stories get checked:** each hourly cycle runs collection, then background, then AI summaries. It checks up to 40 stories whose articles changed since their last check (`stories.background_hash` ≠ `articles_hash`), multi-publisher stories first.
- **Caching:** each name's result is cached for 24 hours (`wiki_lookups`), so a name used by many stories, such as "Donald Trump", is fetched once.
- **Failures:**
  - If a lookup fails because of a network error or a Wikipedia server error, the other names still count, and the story stays marked unchecked so the next run tries again.
  - A failed background pass never affects collection or AI summaries.
- **Cleanup:**
  - When a story is deleted (all of its articles expired), its links go with it (`ON DELETE CASCADE`), and any `background_resources` row no remaining story uses is deleted.
  - Background pages may themselves be older than 7 days; they're kept only while linked to an active story.
- **Manual trigger:** `POST /admin/background` (admin token required) runs a pass immediately.

## Live results (local run against live feeds and Wikipedia, October 20, 2026)

130 stories, 54 with background links, including 7 of the 9 multi-publisher stories:

| Story | Background links |
|---|---|
| Alberta voters decide whether to take a step toward separating from Canada | Alberta · Canada · Mark Carney |
| Nigeria confirms an Ebola case in Abuja as a woman arriving from Uganda tests positive | Ebola · Abuja · Kenya |
| Violence erupts at France protests as Macron warns unrest is being exploited | France · Emmanuel Macron |
| Pope Leo XIV thanks wellwishers in first event after cancer surgery | Pope Leo XIV · Angelus |
| Strait of Hormuz crisis traps 6,000 sailors as attacks on ships mount | Strait of Hormuz · Iran |
| Trump makes Russia-friendly moves as he looks for a way to end the war with Ukraine | Donald Trump · Ukraine · Russia |
| Rays will face Brewers in World Series to produce a first-time champion | World Series |

## Tuning

The first live run produced several wrong links. Each was fixed with a rule, and the next run was checked again by reading every link:

| Wrong link | Cause | Fix |
|---|---|---|
| "Top Trumps" (card game) | "Top" was capitalized only because it starts the headline | Words that start a sentence must also be capitalized elsewhere in the story |
| "Violence", "Court", "Notebook", "Radio" | Ordinary words at the start of a sentence | Same rule |
| "Meloni: surname list", "Anthony: name list" | Name-list pages aren't context | Skip pages whose description is a name list |
| "Musk" (perfume), "Watt" (unit of power), "White" (color) | A single surname or noun from one headline | Single words need 2+ articles |

## Where it can be wrong

- **A common name can still point to the wrong person or place** if it appears in 2 articles. For example, "Paris" means Paris, France, even in a story about Paris, Texas.
- **Some relevant stories get nothing.** This happens when their key names are single words in only one article, or have no Wikipedia page, like "Limoges Town Hall". The app then honestly shows "No background resource available".
- **Wikipedia's summary text** is written by Wikipedia's editors, not by the server or the AI, and can change.
