# My News

An AI-powered news service built for CS 403. News organizations often cover the same event, but readers have to visit several sites to compare coverage and get background. My News brings that coverage into one story.

## How it works

- **Collect:** a scheduled server job pulls articles from at least three publishers every hour, with duplicate prevention and a rolling 7-day retention window.
- **Group:** related articles from different publishers are grouped into a single story. Stories covered by only one outlet are kept and labeled accurately.
- **Summarize:** the server uses an AI model to generate an overview and supported perspectives for each story. Summaries are stored and reused, so reading them never triggers a new AI call.
- **Read:** the Flutter app shows one list entry per story. Each story has buttons for every publisher that covered it, background resources, and the AI overview and perspectives, all clearly labeled as AI-generated.

## Architecture

News sources → scheduled worker → database → API → Flutter app

The Flutter app does no ingestion, grouping or AI work. It only reads results the server has already stored. API keys stay on the server.

## Tech stack

- **Server:** Node.js, TypeScript, SQLite
- **Client:** Flutter / Dart (Android)
- **AI:** *(provider TBD)*

## Status

Work in progress for CS 403, due October 2026.
