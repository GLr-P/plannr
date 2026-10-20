# Plannr: Plan

Personal all-in-one organizer and business tool for Nano Tech Services (a small tech repair company). The owner is not a programmer, so Claude makes the technical decisions and checks its own work.

## Decision: a Windows desktop program built with Electron

| Option | Verdict |
|---|---|
| **Electron desktop app** (chosen) | A real Windows program with an installer, Start-menu entry and tray icon. Works offline, and data stays on this laptop. It's built with web technology, so the same interface can later run on the desktop PC, in a browser or on a phone. It runs on Node.js only (one winget install) and can be launched and screenshotted by automated tests, which is how Claude checks its own work. |
| Tauri (Rust + webview) | Smaller download, but it needs the Rust toolchain plus about 6 GB of Visual Studio Build Tools, and automated UI testing on Windows is weaker. That's more risk of getting stuck troubleshooting, for little gain on a 32 GB machine. |
| Web app only | Would need a server and hosting from day one, would be weaker offline, and puts business data and the vault online before we need to. We can add this later because the interface is web-based. |

## Tech stack

- **Electron + React + TypeScript**, built with electron-vite
- **SQLite** (Node's built-in `node:sqlite`, which Electron 44 ships, so no native add-on can break on install) is a single database file in the app's data folder. It uses **FTS5** full-text search, so search is instant across customers, tickets, notes and files.
- **TipTap** (ProseMirror) for the editor: Notion-style blocks, slash menu, collapsible sections, images, checklists and template fields
- **FullCalendar** for the calendar: month, week and day views with drag-and-drop from outside the calendar
- **Vault:** AES-256-GCM encryption, with the key derived from your passcode using scrypt. The passcode is never stored; only a check value is kept.
- **Tests:** Vitest for logic, and Playwright driving the real Electron app (with screenshots) for features

### Built so the future upgrades fit later
- Every record has a UUID, `created_at`, `updated_at` and a soft-delete flag. That's what multi-device sync needs later, without a rewrite.
- The interface only talks to data through one API layer. Swapping local storage for local + cloud later only changes that layer.
- Integrations (Google, Zoho, QuickBooks, AI) are separate modules that plug in, and they keep their credentials in the vault.

## Layout and feel

- **Left sidebar:** Home, Notes, Customers & Tickets, Calendar, Money, Vault and Settings, with collapsible lists (for example, pinned notes and open tickets). There's no right-hand panel.
- **Main area** shows whatever is selected.
- **Instant search (Ctrl+K or the search box):** results appear in a dropdown as you type, grouped by type. Clicking a result opens it, so you never go to a separate results page.
- Things open in place: dropdowns expand inline, and pages don't reload.
- Clean and minimal: neutral colors, one accent color, generous spacing, a readable font, and light and dark themes.

## Built so far

One line per build phase (1–7) and owner request (8 onwards). How each was built is in [dev/FEATURE-LOG.md](dev/FEATURE-LOG.md), which also opens with the original feature spec.

1. Foundation (2026-10-03)
2. Customers & Tickets (2026-10-03)
3. Calendar (2026-10-04)
4. Vault (2026-10-04)
5. Money (2026-10-04)
6. Integrations (2026-10-04)
7. Polish & install (2026-10-04)
8. Cleaner sidebar (2026-10-05)
9. Optimize and polish everything (2026-10-05)
10. More to create (2026-10-05)
11. Customization (2026-10-05)
12. For other people (2026-10-05)
13. More features (2026-10-05)
14. Phone and second PC (2026-10-05)
15. Profiles (2026-10-06)
16. Customizable fill-in fields (2026-10-06)
17. Choose your notifications (2026-10-09)
18. Tickets for any kind of work (2026-10-10)
19. Free-form ticket designer (2026-10-10)
20. Calculated fields; optional customer phone/email (2026-10-10)
21. Print the whole form (2026-10-10)
22. Print styles (2026-10-10)
23. Field text style (2026-10-10)
24. Local news (2026-10-11)
25. Free-form pages in notes (2026-10-11)
26. Tie it together and customize (2026-10-11)
27. News pages for games and PC parts (2026-10-11)
28. Everything in one place (2026-10-11)
29. ChatGPT for the assistant; sorting (2026-10-11)
30. Free assistant; YouTube fix (2026-10-11)
31. Organized sidebar, colour themes, website (2026-10-11)
32. One or two more things everywhere (2026-10-12)
33. Notes as Word + Excel + Canva (2026-10-12)
34. Better news (2026-10-12)
35. Entertainment: movies, shows, books, games, podcasts, Reddit (2026-10-12)
36. Discover (2026-10-12)
37. Where to watch (2026-10-12)
38. Fix: Reddit kept saying busy (2026-10-12)
39. Copy to other programs, print preview (2026-10-17)
40. Fix: long answers cut off on printed canvas forms (2026-10-20)
41. Maintenance: preserve custom sub-7 px print field sizes while fitting (2026-10-20)

## Quality rules Claude follows
- Plan each feature before coding, and keep changes small and complete.
- TypeScript strict mode, with lint and type checks before calling anything done.
- Every feature gets an automated test that launches the real app. Claude looks at the screenshots itself.
- Git commits after every working step, so any mistake can be undone.
- If something fails twice, stop, find the root cause and rethink rather than piling on patches.
