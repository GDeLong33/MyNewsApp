# AI development reflection

> **DRAFT for Gavin to edit.** Parts in [brackets] need your own words, especially what *you* personally verified. Delete this note before submitting.

## Tools used

I built My News with **Claude Code** (Anthropic's coding agent, running in VS Code). It wrote most of the server code, tests and Flutter screens. It also ran commands on my PC: tests, builds, the Android emulator, and screenshots of the app through `adb`. I ran every command on the Oracle Cloud server myself, made the decisions (hosting, AI provider, testing on the emulator instead of a phone), and did all commits and pushes. The app itself uses **Google Gemini** (`gemini-3.5-flash-lite`) on the server to write story summaries.

## Two representative prompts

1. *"Add the collector: 3+ publishers via RSS, normalized into an articles table with a stable ID or normalized URL so re-fetching updates instead of duplicating. Handle missing or invalid publication dates and document the rule. Add the hourly scheduled job, a protected manual trigger endpoint, a job-runs table (start time, outcome, article counts), and isolation so one failed feed doesn't crash the run. Write tests for dedupe and failure handling. Done when I can trigger a run and see rows and a job log."*

   This worked well because it listed every requirement *and* a concrete "done when" test that I could check on the live server.

2. *"Add story grouping: related articles from different publishers join one story, with a stable story ID, headline and update time. Single-source stories stay. A shared person or keyword alone must not merge two events. Explain the method and one way it can be wrong. … Add tests, including two related-but-separate topics. Done when the tests pass and I can see grouped stories from live data."*

   Asking for "one way it can be wrong" and live data made the AI tune the rules against real articles instead of just its own test cases.

## An AI-generated mistake I found and corrected

[Pick one and rewrite it in your words. Two candidates:]

- **Hosting choice.** Early on, the AI picked Fly.io for the server and wrote its configuration without asking me, even though my instructions said to ask before choosing a hosting provider. Fly.io isn't free. I questioned it ("why are we using Fly.io… is there any free option?"), and we moved to my existing Oracle Cloud free server, so the deployment now costs $0.
- **AI summaries that added facts.** When I reviewed the live summaries, the Ilhan Omar summary called Obama "former President" and Omar "Democratic Representative". Both are true, but neither appeared in the articles, which breaks the rule that AI text must come only from the sources. It also printed "(A1)" inside the text, and the France summary blamed Le Pen and Mélenchon for a criticism the articles attributed to someone else. We tightened the prompt, added code that strips the reference IDs, made the server regenerate every summary when the prompt changes, and re-checked the same stories until they were fixed (see docs/ai.md).

Other mistakes the AI made and we fixed together are in the README defect log. These include grouping that merged unrelated stories, a Gemini model that wasn't available to new accounts, and wrong Wikipedia links like "Top Trumps" (a card game) for a Trump story.

## What I personally verified

[Edit to match what you actually did:]

- Ran the deploy commands on the Oracle server and confirmed `/health` worked, and that data survived a container restart (`bootCount` went up, `firstBootAt` stayed the same).
- Triggered collection runs and read the job log and stored articles myself.
- Checked the free-tier quota on Google's usage page (ai.dev/rate-limit), which is why we switched to a model with 500 requests a day.
- Read the grouped stories on `/stories` and [checked that they were really the same events].
- Used the app in the emulator: [the story list, a story's buttons, opening articles, the AI screens].
- [Read the three reviewed AI summaries against their source excerpts.]
- Completed the three release test runs in docs/demo-checklist.md.

[This is an individual project, so there are no team member contributions to list.]
