# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Plannr is a Windows desktop app: one simple, all-in-one organizer for notes, files, calendar and customers. It is built for the owner of Nano Tech Services, a small tech repair company. The owner is not a programmer, so make technical decisions yourself, verify by running the app, and never ask them to edit code or run commands.

**[PLAN.md](PLAN.md) is the source of truth for decisions, the feature spec and build phases (with progress). Read it before starting work and update it when a phase finishes or a decision changes.**

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
npm run test:e2e    # build, then Playwright drives the real Electron app (tests/e2e)
npm run check       # all of the above; run before calling work done
npx vitest run -t "search"          # single unit test by name
npx playwright test -g "drag"       # single e2e test (run `npm run build` first; e2e uses out/)
```

E2E tests run serially in one app session with an isolated temp data dir (`PLANNR_DATA_DIR`), and save screenshots to `test-results/screens/`. **Open the screenshots and look at them**; several real bugs were caught only that way. The Desktop shortcut `Plannr.lnk` runs `node_modules/electron/dist/electron.exe` on this folder (the built `out/`), so rebuild after changes for the shortcut to pick them up.

## Architecture

Electron with three processes, plus code shared by them:

- `src/main/`: owns all data and OS access. `db/` opens SQLite through **Node's built-in `node:sqlite`** (no native modules, so the same code runs in Vitest and Electron). `services/*` are plain functions taking a `Db`; they're unit-tested against `:memory:` databases and must not import `electron`. `api.ts` adapts services into the `PlannrApi` object and registers IPC.
- `src/shared/api.ts`: **the single contract** between main and the UI: types, the `PlannrApi` interface and `API_SHAPE`, which lists every method. A compile-time check fails if `API_SHAPE` misses a method. To add an API method: add it to the interface, add it to `API_SHAPE`, implement it in `src/main/api.ts`, then call `api.x.y()` from the renderer. The preload needs no changes, since it generates `window.plannr` from `API_SHAPE` and invokes the IPC channel `namespace:method`.
- `src/preload/`: sandboxed bridge, CommonJS output (package.json deliberately has no `"type": "module"`).
- `src/renderer/`: React UI with no router. Navigation is the `useNav` zustand store (`route`, back/forward history), and `App.tsx` switches on `route.view`. `useData` caches lightweight lists (note summaries, folders) for the sidebar, home and search suggestions. Update it via `upsertNote`/`refresh` after mutations (helpers in `actions.ts`). `useUi` persists per-device UI state (collapsed sections) in localStorage.

Cross-cutting mechanisms that later phases should reuse rather than reinvent:

- **Data model:** every synced table has a UUID `id`, ms timestamps `created_at`/`updated_at`, and a soft-delete `deleted_at`, ready for future multi-device sync. Migrations in `db/migrations.ts` are append-only and versioned with `PRAGMA user_version`.
- **Search:** one FTS5 table `search_index(type, id, title, body, updated_at)` covers all entity types. Services call `indexEntity`/`unindexEntity` on every write; there are no triggers. `buildFtsQuery` turns user text into safe quoted prefix terms. Snippets mark matches with `\u0001…\u0002`, which the renderer turns into `<mark>`; never use raw HTML.
- **Links:** the `links(src_type, src_id, dst_type, dst_id)` table holds "A references B" relationships. It's recomputed from note content on save (`@`-mentions are `mention` nodes with `id` and `kind` attrs) and powers backlinks. Calendar and ticket links should use it too.
- **Files:** `saveFile` copies bytes into `<dataDir>/attachments/xx/<uuid>.<ext>` and records them in `files`. The UI references files as `plannr://file/<uuid>`, served by the privileged protocol in `main/index.ts`, which only resolves known UUIDs.
- **Drag and drop:** draggable items set `DRAG_MIME` with a `{type, id}` payload (`actions.ts`). Drop targets read it with `readDrag`. The calendar should accept the same payload.
- **Editor:** TipTap v3 (`renderer/src/editor/`). `extensions.tsx` defines the slash commands and the `@`-mention, `SuggestionPopup.tsx` is the shared popup, and `upload.ts` handles image paste and drop. Note pages autosave with a debounce through `useAutosave` in `NoteView.tsx`.
- **Theme:** CSS custom properties in `styles/global.css` (`:root` and `[data-theme='dark']`). Main passes the initial theme as `?theme=` to avoid a flash, and `api.app.setTheme` recolors the native title-bar overlay. The window uses `titleBarStyle: 'hidden'`, so the custom title bar is a drag region, and interactive elements in it need `-webkit-app-region: no-drag`.

Data lives in `%APPDATA%\Plannr\data` (`plannr.db` and `attachments/`).

## TipTap pitfalls already hit

- `editor.commands.focus()` is deferred by one frame. When moving focus programmatically before the user types, call `editor.view.focus()` first.
- `editor.setEditable(x)` emits an `update` event by default. Pass `false` as the second argument, and only save on `transaction.docChanged`; otherwise just opening a note re-saves it and bumps `updated_at`.
