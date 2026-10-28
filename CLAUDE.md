# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Plannr is a Windows desktop app: one simple, all-in-one organizer for notes, files, calendar and customers. It is built for the owner of Nano Tech Services, a small tech repair company. The owner is not a programmer, so make technical decisions yourself, verify by running the app, and never ask them to edit code or run commands.

This folder is the code repo (public). The private project files sit one level up in the hub: `../ABOUTME.md` (status, decisions), `../Information/PLAN.md`, `../Handoff/` (handoff log, past chats), `../Research/`, `../Thoughts/` (ideas).

**[PLAN.md](../Information/PLAN.md)** (short) holds the decisions, the stack and a one-line index of everything built. Read it before starting work. The details live in `dev/`; read them on demand rather than in full:
- [dev/FEATURE-LOG.md](dev/FEATURE-LOG.md): how each phase and request was built (files, settings keys, migrations, owner feedback). Search it for the feature you're touching.
- [dev/ARCHITECTURE.md](dev/ARCHITECTURE.md): the full reference behind the summary below.

When a request is done, add a numbered entry at the end of FEATURE-LOG.md and one line to PLAN.md's index. Update ARCHITECTURE.md if a mechanism changed, and this file only for rules every session needs.

## Environment gotchas (this machine)

- Node is installed at `C:\Program Files\nodejs` but isn't on PATH in Claude's shells. Prefix Bash commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- VS Code sets `ELECTRON_RUN_AS_NODE=1`, which makes `electron` behave as plain Node. Unset it before launching Electron by hand (`tests/e2e/helpers.ts` already does).
- npm here blocks dependency install scripts unless they're listed under `allowScripts` in package.json. A new package that needs one requires `npm approve-scripts <pkg>` then `npm rebuild <pkg>`.
- TypeScript is v7 (the native compiler).

## Commands

```sh
npm run dev         # app with hot reload
npm run build       # production build into out/
npm start           # run the built app
npm run typecheck   # tsc for main/preload (node), renderer (web) and e2e configs
npm test            # Vitest unit tests (tests/unit), pure Node, no Electron
npm run test:e2e    # build (PC app + phone web app), then Playwright drives the real Electron app (tests/e2e)
npm run build:web   # the phone web app → out/web (served by the sync service; see server/README.md)
npm run check       # all of the above; run before calling work done
npx vitest run -t "search"          # single unit test by name
npx playwright test -g "drag"       # single e2e test (run `npm run build` first; e2e uses out/)
npm run dist        # build + Windows installer → release/Plannr-Setup-<version>.exe (set CSC_IDENTITY_AUTO_DISCOVERY=false; unset ELECTRON_RUN_AS_NODE)
PLANNR_EXE=release/win-unpacked/Plannr.exe npx playwright test   # run the e2e suite against the packaged app
npx playwright test --config tests/marketing/playwright.config.ts   # regenerate docs/screenshots (demo data) and a preview of the website (test-results/site.png); build first
PERF=1 npx playwright test --config tests/perf/playwright.config.ts  # startup timing
```

`tests/e2e/background.spec.ts` is skipped unless `PLANNR_SLOW=1`. It shows a real Windows notification, checks close-to-tray, and waits about a minute for the reminder scheduler. Normal test runs (`PLANNR_DATA_DIR` set) disable the tray, close-to-tray, reminders and the Start-menu shortcut; `PLANNR_BACKGROUND=1` turns them back on. App icons come from `node scripts/make-icon.mjs` (writes `resources/`).

E2E tests run serially in one app session with an isolated temp data dir (`PLANNR_DATA_DIR`), and save screenshots to `test-results/screens/`. **Open the screenshots and look at them**; several real bugs were caught only that way. The Desktop shortcut `Plannr.lnk` runs `node_modules/electron/dist/electron.exe` on this folder (the built `out/`), so rebuild after changes for the shortcut to pick them up.

## Releasing (public repo GLr-P/plannr)

- Commit emails use `241555371+GLr-P@users.noreply.github.com` (set in this repo's git config); never commit the owner's personal email or real customer data. Website screenshots come from the demo-data script (tests/marketing).
- To release: bump `version` in package.json, run `npm run check`, run `npm run dist` (with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `ELECTRON_RUN_AS_NODE` unset), push, then `"C:\Program Files\GitHub CLI\gh.exe" release create vX.Y.Z release/Plannr-Setup-X.Y.Z.exe --title ... --notes-file ...`.
- **Releases are unsigned, by the owner's choice (2026-10-09).** SignPath declined the project; the owner turned Smart App Control off on this PC, so unsigned builds run here. The README and website tell other users to click past SmartScreen, or that Smart App Control blocks Plannr. Don't reintroduce signing without asking.
- VS Code sets ELECTRON_RUN_AS_NODE in PowerShell too: remove it before Start-Process on Plannr.exe, or it runs as plain Node ("bad option" errors).
- Don't mark releases as pre-release: the Download buttons link to `/releases/latest`, which skips pre-releases.
- The website is docs/index.html (GitHub Pages from main /docs). Pushing, releasing and deploying are pre-approved (2026-10-20); don't ask.

## Architecture (summary)

Electron with three processes, plus code they share. **The full reference is [dev/ARCHITECTURE.md](dev/ARCHITECTURE.md).** Read only the section for the area you're changing: data model, search, tickets/templates, links, files, drag and drop, calendar, holidays, vault, money, Google, Zoho, QuickBooks, backups, sync and phone app, profiles, news, entertainment, canvas, packaging, background, copy and print, editor, theme, and the window and TipTap pitfalls.

- `src/main/`: all data and OS access. SQLite goes through `node:sqlite`. `services/*` are plain functions taking a `Db`, unit-tested on `:memory:`, and must not import `electron`. `api.ts` adapts them into `PlannrApi` and registers IPC.
- `src/shared/api.ts`: the single contract between main and the UI (`PlannrApi`, `API_SHAPE`). To add an API method: add it to the interface, add it to `API_SHAPE`, implement it in `src/main/api.ts`, then call `api.x.y()`. The preload needs no change.
- `src/preload/`: the sandboxed bridge, built as CommonJS (package.json deliberately has no `"type": "module"`).
- `src/renderer/`: React with no router. The `useNav` store holds the route and `App.tsx` switches on `route.view`; `useData` caches lists and `useUi` holds per-device UI state.
- `src/web/` + `server/`: the phone web app (the same services on SQLite-WASM) and the Cloudflare sync Worker.

**Rules that break things if missed:**
- Services stay free of Electron, and of Node APIs beyond what `src/web/shims` covers, or the phone build breaks.
- Migrations (`db/migrations.ts`) are append-only. A new synced table or setting goes in `SYNCED_TABLES`/`SYNCED_SETTINGS` **and** gets triggers in a new migration (`tableTriggersSql`). Sync pulls use UPSERT, never `INSERT OR REPLACE`.
- If you change what gets searched, bump `SEARCH_INDEX_VERSION`. Services call `indexEntity`/`unindexEntity` themselves. Snippets mark matches with `\u0001…\u0002`, never raw HTML.
- Vault data never goes into `search_index`, logs or other tables, and the renderer never sees the key.
- Anything stored outside the data folder must be per profile. Keep wording generic ("profiles", not "businesses").
- Money is stored as integer cents. Date-only fields are `YYYY-MM-DD` strings.
- Downloads go through `fetchText`. Tests never touch the internet; they use fixtures (`PLANNR_NEWS_FIXTURES`, `PLANNR_HOLIDAY_FIXTURE`).
- New editor node types need a case in `shared/rich-copy.ts`. No CSS gradients in printouts (pdf.js smears them).
- Overlays covering the top 44px need `-webkit-app-region: no-drag`. Overlays showing PDFs need a clickable close, because Esc doesn't reach the page.
- Every npm package is a devDependency, since Vite bundles everything into `out/`.

Data lives in `%APPDATA%\Plannr\data`.
