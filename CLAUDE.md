# CLAUDE.md

Guidance for Claude Code sessions in this repo. The full assignment text is in [docs/spec.md](docs/spec.md); read it when a detail matters. This file is the short version.

## Project

**My News** (CS 403): an AI-powered news service. Due **Friday, October 23, 2026, 11:59 p.m. Eastern**. The deliverable is a Flutter MVP ready for a limited commercial beta, demoed on a physical Android phone through Microsoft Phone Link.

The server collects news from several publishers, groups articles about the same event into one story, finds background resources, generates AI summaries and perspectives, and stores the results. The Flutter app only displays what the server already stored.

## Requirements summary

**Architecture**
- Backend deployed to an internet-accessible host (not just a laptop), with persistent storage that survives restarts.
- Server owns: hourly collection, normalization, grouping, background lookup, AI generation, and cleanup.
- API with documented endpoints for a story list and full story detail (e.g. `GET /stories`, `GET /stories/:id`) returning IDs, timestamps, sources, background links, summary text and summary status.

**Collection and retention**
- At least 3 distinct publishers (RSS, news APIs, or an aggregator).
- Automatic hourly collection that runs with no clients open. An optional manual trigger for demos must be protected from general users.
- Duplicate prevention: re-fetching an article updates/reuses its record (stable ID or normalized URL).
- Rolling 7-day window by **publication time**, not download time. Remove articles older than 168 hours each run, and the API must filter expired articles between runs. Document how missing/invalid publication dates are handled.
- Cleanup: delete empty story groups along with their summaries and background links. Regenerate summaries for groups that lost articles. Keep background resources only while linked to an active story.
- Failures: a failed feed or AI call must not crash the run or erase valid data. Record job runs (start time, outcome, article counts, successes/failures). Expose the last successful collection time. Mark outdated or unavailable summaries.
- Store timestamps in UTC and show readable local dates in the app. Logs may outlive the window but must not keep expired article bodies or summaries.

**Grouping**
- Automatically group articles from different publishers about the same event. A single shared keyword isn't enough to group (same person, different events must stay separate).
- Keep each article's publisher, title, publication time, URL and available text.
- Stories have a stable ID, readable headline and update time. Single-source stories are kept and labeled accurately. New coverage joins existing stories without duplicating them.
- Evidence: 5+ multi-publisher groups and 2 examples of related-but-separate stories. Document the method and one way it can go wrong.

**Flutter client**
- Native Flutter/Dart (Android is fine). No PWA, website, or webview wrapper.
- Story list: one entry per story with headline, latest article time, distinct publisher count, refresh, and loading/empty/error states. Newest first.
- Story detail: overview, plus separate button groups for **Original coverage** (one per publisher that covered it, and no others), **Background** (descriptive labels, or "No background resource available"), **AI overview**, and **AI perspectives**.
- Original wording and AI wording must be clearly distinct. Never label an excerpt as a full article or AI text as a quotation.
- Optional local cache: shows last sync time, indicates offline mode, and hides expired news even while offline.

**AI**
- A real model generates the summaries on the server. Prompts and model configuration are saved in the repo.
- Overview covers agreement, disagreement and uncertainty. Perspectives: 2+ distinct viewpoints only when the evidence supports them, otherwise "Insufficient evidence for distinct perspectives". Never assign viewpoints based only on the publisher.
- Traceability: cite the supporting articles, show the generation time, label output "AI-generated", and disclose when the input was only feed excerpts.
- Generate once and reuse for all readers. Regenerate only when the inputs change. Repeated reads must not call the model.
- Treat article text as data, not instructions (guard against prompt injection).
- On failure, show an honest status and never present fallback text as AI output.
- Evidence: 3+ stories with real contrasting perspectives, plus a manual review of 3 summaries.

**Beta readiness and submission**
- Complete core workflow with no dead ends. No known critical or major defects. Graceful failure states. Usable phone UI.
- Release build on the phone. Record build/version, device, date and results for 3 consecutive clean runs.
- README: setup, architecture diagram, data model, API, grouping method, retention, service choices, costs/quotas, limitations, release notes, defect log.
- Also submit: APK, deployed API URL, `.env.example`, verification table (spec §10), a 5–7 min Phone Link demo, and a one-page AI development reflection.

## Stack and layout

- `/server`: Node.js + TypeScript backend with SQLite storage. It runs the scheduled worker, the API, and the AI calls.
- `/flutter_application_1`: Flutter (Dart) client for Android, created by the user with `flutter create`. Keep this folder name.
- `/docs`: spec and project documentation.

Hosting: the user's Oracle Cloud Always Free VM (Ubuntu 20.04, ARM64), running Docker Compose with Caddy for HTTPS. See [docs/deploy.md](docs/deploy.md).

The AI provider isn't chosen yet. Ask before picking one.

## Rules

- **Keys and secrets live only in `.env`** (server side). Never hard-code them, never put them in the Flutter build, and never commit them. Make sure `.env` is gitignored.
- **Keep `.env.example` up to date** with every variable the server needs, using placeholder values only.
- **The Flutter app only reads server results.** It never fetches news feeds, never groups articles, and never calls an AI provider. Opening publisher or background links in a browser is the only external access it has.
- Don't do anything on the client that would make the server redo work. Refresh and AI buttons read stored data only.

## Working style

- Work in **small, focused steps** that would each make a reasonable commit.
- **Test each stage before starting the next** (e.g. ingestion works and dedupes before grouping; the API works before the Flutter screens use it). Say what was tested and how.
- **Stop and tell the user when something is needed from them**, such as an API key, account signup, hosting choice, phone or Phone Link setup, or any decision that is theirs to make. Don't work around it with fake keys or placeholder services.
- **Never commit or push.** The user handles all git commits and pushes. Leave changes in the working tree and summarize them.
- Stay on the **`main` branch**. Don't create branches or worktrees.
- Check the work plan in spec §8 and the verification checks in spec §10 when deciding what to do next.
