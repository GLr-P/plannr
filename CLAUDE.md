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

`tests/e2e/background.spec.ts` is skipped unless `PLANNR_SLOW=1`. It shows a real Windows notification, checks close-to-tray, and waits about a minute for the reminder scheduler. Normal test runs (`PLANNR_DATA_DIR` set) disable the tray, close-to-tray, reminders and the Start-menu shortcut; `PLANNR_BACKGROUND=1` turns them back on. App icons come from `node scripts/make-icon.mjs` (writes `resources/`).

E2E tests run serially in one app session with an isolated temp data dir (`PLANNR_DATA_DIR`), and save screenshots to `test-results/screens/`. **Open the screenshots and look at them**; several real bugs were caught only that way. The Desktop shortcut `Plannr.lnk` runs `node_modules/electron/dist/electron.exe` on this folder (the built `out/`), so rebuild after changes for the shortcut to pick them up.

## Architecture

Electron with three processes, plus code shared by them:

- `src/main/`: owns all data and OS access. `db/` opens SQLite through **Node's built-in `node:sqlite`** (no native modules, so the same code runs in Vitest and Electron). `services/*` are plain functions taking a `Db`; they're unit-tested against `:memory:` databases and must not import `electron`. `api.ts` adapts services into the `PlannrApi` object and registers IPC.
- `src/shared/api.ts`: **the single contract** between main and the UI: types, the `PlannrApi` interface and `API_SHAPE`, which lists every method. A compile-time check fails if `API_SHAPE` misses a method. To add an API method: add it to the interface, add it to `API_SHAPE`, implement it in `src/main/api.ts`, then call `api.x.y()` from the renderer. The preload needs no changes, since it generates `window.plannr` from `API_SHAPE` and invokes the IPC channel `namespace:method`.
- `src/preload/`: sandboxed bridge, CommonJS output (package.json deliberately has no `"type": "module"`).
- `src/renderer/`: React UI with no router. Navigation is the `useNav` zustand store (`route`, back/forward history), and `App.tsx` switches on `route.view`. `useData` caches lightweight lists (note summaries, folders) for the sidebar, home and search suggestions. Update it via `upsertNote`/`refresh` after mutations (helpers in `actions.ts`). `useUi` persists per-device UI state (collapsed sections) in localStorage.

Cross-cutting mechanisms that later phases should reuse rather than reinvent:

- **Data model:** every synced table has a UUID `id`, ms timestamps `created_at`/`updated_at`, and a soft-delete `deleted_at`, ready for future multi-device sync. Migrations in `db/migrations.ts` are append-only and versioned with `PRAGMA user_version`.
- **Search:** one FTS5 table `search_index(type, id, title, body, extra, updated_at)` covers all entity types. `body` is shown in result snippets, and `extra` holds match-only terms (digits-only phone, status, tags) that never appear in snippets. Services call `indexEntity`/`unindexEntity` on every write; there are no triggers. The index is derived data: `services/reindex.ts` rebuilds it on startup whenever `SEARCH_INDEX_VERSION` changes, so bump that constant when you change what gets indexed. `buildFtsQuery` turns user text into safe quoted prefix terms. Snippets mark matches with `\u0001…\u0002`, which the renderer turns into `<mark>`; never use raw HTML. The ticket and customer list views filter with SQL `LIKE` (escaped with `likeTerm`) rather than FTS, because they combine search with status and date filters.
- **Customers, tickets and templates:** ticket numbers are `MAX(number)+1`, displayed with `formatTicketNumber`. Statuses come from `TICKET_STATUSES` in `shared/api.ts`. Date-only fields are `YYYY-MM-DD` strings and money is integer cents. A new ticket deep-copies a template's content (the default comes from the `defaultTemplateId` setting, and `ensureStarterTemplate` seeds "Repair intake" once). Template fill-ins are the `formField` inline atom node (`editor/FormField.tsx`); its value lives in the node attrs, and `extractText` renders it as `Label: value`. Ticket photos live in `ticket_photos` (before/after) and point at `files`.
- **Links:** the `links(src_type, src_id, dst_type, dst_id)` table holds "A references B" relationships. It's recomputed from note content on save (`@`-mentions are `mention` nodes with `id` and `kind` attrs) and powers backlinks. Calendar and ticket links should use it too.
- **Files:** `saveFile` copies bytes into `<dataDir>/attachments/xx/<uuid>.<ext>` and records them in `files`. The UI references files as `plannr://file/<uuid>`, served by the privileged protocol in `main/index.ts`, which only resolves known UUIDs.
- **Drag and drop:** draggable items set `DRAG_MIME` with a `{type, id}` payload (`actions.ts`), and drop targets read it with `readDrag`. Drop targets must not set `dropEffect`: sources use different `effectAllowed` values, and a mismatch silently blocks the drop.
- **Calendar** (`services/calendar.ts`, `views/CalendarView.tsx`, FullCalendar v6):
  - An event has a date-only `date` plus optional `start_time`/`end_time` (null = all day) and an optional link (`link_type`/`link_id`).
  - `kind = 'pickup'` events mirror a ticket's `pickup_on` both ways: `updateTicket` calls `syncPickupFromTicket`, and moving, converting or deleting a pickup event updates the ticket. A ticket has at most one pickup event, and it's hidden while the ticket is trashed.
  - Native drops onto the calendar find their date and time with `document.elementsFromPoint` (`[data-date]`, `.fc-timegrid-slot[data-time]`), because FullCalendar's own external-drag API doesn't handle HTML5 drag.
  - `calendar.drop` applies the rules: a ticket becomes or moves its pickup; a customer or note becomes a linked event.
- **Holidays** (`services/holidays.ts`): Google's public holiday calendars are downloaded as an iCal feed with no API key (`holidayFeedUrl`), parsed by `parseIcs`, and cached in the `holidays` table. They refresh weekly, and on startup when stale. They show as read-only calendar events (ids prefixed `holiday:`). Tests set `PLANNR_HOLIDAY_FIXTURE` to the saved real feed in `tests/fixtures/us-holidays.ics` so they never need the internet.
- **Vault** (`services/vault.ts` holds the pure crypto and storage; `main/vault-session.ts` holds the unlocked key in memory):
  - A random data key (DEK) encrypts each item's whole JSON (kind, title, fields) with AES-256-GCM, using the item id as additional data. Rows in `vault_keys` store the DEK wrapped by scrypt keys derived from the passcode and from the recovery key.
  - The renderer never sees the key, and vault data must never go into `search_index`, logs or other tables. Locking wipes the DEK buffer.
  - Electron 44's `clipboard.readText` and `writeText` are async (`clear()` is sync).
  - Unit tests pass a cheap KDF (`{N: 2**10}`); the app uses `DEFAULT_KDF`.
  - Item payloads are versioned (`v: 2` adds rich `notes` and `custom` fields); `normalize()` upgrades older payloads when they're read.
  - Vault files are stored as `<data>/vault/<id>.bin` (sealed, with the file id as additional data). Their name, type and size live in the sealed `vault_files.meta`. The privileged `plannr-vault://file/<id>/<name>` protocol decrypts in memory and returns 404 while locked. `webPreferences.plugins` is on so Chromium's PDF viewer can preview PDFs.
  - Vault notes use `NoteEditor` with `options={{ mentions: false, upload }}`, so pasted images go to the vault (`inline: true`, so they're hidden from attachments).
  - "Open in app" writes a temporary copy under `%TEMP%/plannr-vault-open`, which is deleted on lock, start and quit.
- **Money** (`services/money.ts`):
  - `recurring` holds bills and subscriptions, with `anchor_day` for month-safe advancing. `transactions` holds income and expenses; ticket payments are income rows with `ticket_id`, and `TicketSummary.paidCents` sums them.
  - `processAutopay` charges occurrences with `next_due < today` and `>= due_set_on`. It runs every minute in the background and before the money list and summary calls.
  - `dueMoneyReminders` shares `reminder_log`, keyed by recurring id. Money due dates are virtual calendar events (`money.occurrences`), not rows in `events`.
- **Background** (`main/background.ts`):
  - The tray, and close-to-tray unless the `runInBackground` setting is `false`.
  - `startReminders` checks `dueReminders` every minute and on resume. `reminder_log` keys (`kind@date`) make each reminder fire once; reminders missed while closed still fire if less than 12 hours old.
  - Windows only shows toasts for an app with a Start-menu shortcut carrying its AppUserModelID, so `ensureStartMenuShortcut` writes one (unpackaged builds only).
  - Notification clicks send a `navigate` IPC event, which the renderer receives through `window.plannrEvents.onNavigate`.
- **Editor:** TipTap v3 (`renderer/src/editor/`). `extensions.tsx` defines the slash commands and the `@`-mention, `SuggestionPopup.tsx` is the shared popup, and `upload.ts` handles image paste and drop. Note pages autosave with a debounce through `useAutosave` in `NoteView.tsx`.
- **Theme:** CSS custom properties in `styles/global.css` (`:root` and `[data-theme='dark']`). Main passes the initial theme as `?theme=` to avoid a flash, and `api.app.setTheme` recolors the native title-bar overlay. The window uses `titleBarStyle: 'hidden'`, so the custom title bar is a drag region, and interactive elements in it need `-webkit-app-region: no-drag`.

Data lives in `%APPDATA%\Plannr\data` (`plannr.db` and `attachments/`).

## Window pitfalls already hit

- The custom title bar is a Windows drag strip (`-webkit-app-region: drag`). **Any overlay covering the top 44px must set `-webkit-app-region: no-drag`**; otherwise clicks there drag the window and buttons like Close stop working. Playwright's synthetic clicks skip Windows hit-testing, so normal tests can't catch this. `tests/e2e/realclick.spec.ts` (`PLANNR_SLOW=1`) clicks with the real mouse (`scripts/real-click.ps1`).
- Keyboard events don't reach the page while Chromium's PDF viewer (an iframe) has focus. Overlays showing PDFs need clickable ways to close, not just Esc.

## TipTap pitfalls already hit

- `editor.commands.focus()` is deferred by one frame. When moving focus programmatically before the user types, call `editor.view.focus()` first.
- Toggles (`details`, with `persist: true`, so the `open` attr is saved): a closed toggle's body is `hidden`. Setting the open attr and moving the selection into the body in one transaction leaves the browser cursor in the title. Dispatch the open first, then the selection (see `enterToggleBody` in `extensions.tsx`).
- After inserting a block image, move the cursor to a paragraph after it (`upload.ts`). Leaving the image node selected makes the next paste replace it.
- TipTap's base CSS forces `img.ProseMirror-separator` to display with `!important`. These spacers surround inline node views, so overriding their layout (as `.ff-textarea` does in `business.css`) needs `!important` too.
- `editor.setEditable(x)` emits an `update` event by default. Pass `false` as the second argument, and only save on `transaction.docChanged`; otherwise just opening a note re-saves it and bumps `updated_at`.
