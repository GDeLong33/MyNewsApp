# Demo checklist and release test log

## Before recording

- [ ] Start the **Pixel 8 emulator** from Android Studio's Device Manager.
- [ ] Install the latest release build:
  ```
  cd flutter_application_1
  flutter build apk --release
  flutter install -d emulator-5554 --release
  ```
- [ ] Open **Chrome** on the emulator once and finish its welcome screen, so publisher links open directly.
- [ ] Turn off notifications on the PC (Focus / Do Not Disturb). Close personal tabs and apps.
- [ ] Open in a browser: `https://163-192-125-189.sslip.io/stories` (to show the API) and the server terminal (to show the deployment and job log).
- [ ] Have the admin token ready on the server: `TOKEN=$(grep ^ADMIN_TOKEN= .env | cut -d= -f2)`.

## Demo script (5–7 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00–0:30 | Title / the README architecture diagram | What My News does. The server does all the work (collect, group, background, AI); the app only reads stored results. |
| 0:30–1:00 | The emulator | "I don't have an Android phone; I have an iPhone, which can't run a Windows-built app, and Phone Link can't mirror iPhones. This is the **release APK** in the Android emulator." |
| 1:00–2:00 | App: **Top stories** | One entry per story, publisher count, latest time, "News collected …" time, refresh. Scroll to a multi-publisher story. |
| 2:00–3:00 | Open the **France riots** story | AI overview card (AI-generated label, time, citations, excerpt-only note). **Original coverage**: only Fox (5 articles, Choose) and NPR. Tap NPR **Open**, show the article, press Back to return to the same screen. **Background**: France and Emmanuel Macron (Wikipedia). |
| 3:00–4:00 | **AI overview**, then **AI perspectives** | Agreement, plus the *disagreement* the AI caught (8,000 vs. 1,800 arrests). Perspectives: Macron vs. critics; open one: evidence and limits, supporting article, Switch. |
| 4:00–4:30 | A single-source or no-perspective story (e.g. **Alberta**) | "Insufficient evidence for distinct perspectives": it doesn't invent opposition. Single-source stories show the quota message instead of AI text. |
| 4:30–5:30 | Server terminal | `docker compose ps` (deployed and running). `/admin/runs` shows the **hourly `schedule` runs** with no app open. `/admin/ai-calls` totals. |
| 5:30–6:30 | **Two clients, same stored result** | Open the same story in the browser (`/stories/<id>`) and in the app: same `generatedAt`. Refresh both; the `/admin/ai-calls` total doesn't change, so reading never calls the AI. |
| 6:30–7:00 | Wrap-up | Grouping method and one weakness; AI limits (excerpts only); costs ($0). |

**Commands for the server part:**

```bash
cd ~/MyNewsApp/server && docker compose ps
curl -s -H "Authorization: Bearer $TOKEN" "https://163-192-125-189.sslip.io/admin/runs?limit=6" | grep -o '"id":[0-9]*,"trigger":"[a-z]*","started_at":"[^"]*","finished_at":"[^"]*","outcome":"[a-z]*"'
curl -s -H "Authorization: Bearer $TOKEN" "https://163-192-125-189.sslip.io/admin/ai-calls?limit=1" | grep -o '"totals":{[^}]*}'
```

## Release test log: 3 consecutive runs of the core workflow

**Core workflow:**
1. Launch the app.
2. Stories load.
3. Open a multi-publisher story.
4. Open one publisher article, then Back.
5. Open one background link, then Back.
6. Open the AI overview, then Back.
7. Open AI perspectives and one viewpoint, then Back.
8. Back to the list.
9. Pull to refresh.

A run passes when every step works with no crash, dead end, or endless spinner.

| Run | Date / time | Build | Device | Story used | Result | Notes |
|---|---|---|---|---|---|---|
| 1 | | 1.0.0+1 release APK | Android emulator, Pixel 8, Android 17 | | Pass / Fail | |
| 2 | | 1.0.0+1 release APK | Android emulator, Pixel 8, Android 17 | | Pass / Fail | |
| 3 | | 1.0.0+1 release APK | Android emulator, Pixel 8, Android 17 | | Pass / Fail | |

If a run fails, add the problem to the README's defect log, fix it, and restart the count at run 1.
