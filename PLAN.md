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

## Features

### Notes (simpler than Notion)
- A flat list of pages with optional **folders** and **tags**, plus pinning and favorites. Folders are simple, not Notion's nested page tree.
- Block editor: headings, lists, checklists, images, files, tables, code, callouts, **toggle (collapsible) sections**, and a `/` command menu
- `@` mentions link any note to a customer, ticket, file or calendar date. Every page shows its **backlinks**, meaning what links to it.

### Customers & Tickets
- **Customer:** name, phone, email, address, notes, and their full ticket history.
- **Ticket:** auto-numbered repair # (for example NT-0001), status (Intake → Diagnosing → Waiting on parts → Ready → Picked up), device, dates and price, plus a free-form body built from a template.
- **Templates:** design your own intake or repair sheet with fill-in fields (text, phone, email, checkbox, dropdown, date) and formatting. "New ticket from template" makes a copy. Fields like name, email and phone are saved to the customer record, so they're searchable.
- **Photos:** before and after galleries that drop into a ticket, collapsed by default and click to enlarge. Photos are copied into Plannr's own storage, so they don't break if the original file is moved.
- **Search and filter** by name, email, phone, repair #, device, status or date range. The list updates as you type.
- **Emails:** an "Emails" section on each customer shows your Zoho Mail threads with that address, and each one opens straight to the thread (phase 6).

### Calendar
- Month, week and day views. **Drag a customer or ticket from the sidebar onto a day** to create a linked event, for example "Example Customer picking up". You can edit the text.
- Reminders default to **the day before and the day of**, as Windows notifications. Plannr keeps running in the tray so reminders fire even when the window is closed.
- Clicking an event opens the linked ticket or note and shows why it's linked.
- Public holidays from Google (done in phase 3, no setup needed).
- Two-way **Google Calendar** sync of your own events (phase 6; the owner wants this, so plan it then).

### Money
- Bills and recurring bills with due-date reminders, income and payments, plus links between ticket payments and tickets.
- A simple monthly overview
- **QuickBooks Online** sync for customers, invoices and payments (phase 6).

### Vault
- A separate area locked by a **passcode you choose**, with no two-factor authentication.
- Its contents are encrypted on disk, so they're unreadable in the database file, the program files or backups. It locks automatically after a period of inactivity.
- Holds passwords (copy with one click, auto-cleared from the clipboard), secure notes, and the API keys for integrations.
- Note: a forgotten passcode can't be recovered, which is the price of real encryption. Plannr will offer a printable recovery key at setup.

### Safety
- **Automatic daily backups** of the database and attachments, with the last 30 kept. You can restore from Settings.

## Build phases

Each phase ends with Claude running the app, testing it automatically, taking screenshots and checking the result before moving on.

1. **Foundation:** project setup, app window, sidebar layout, themes, database, instant search, and Notes with the block editor. **Done (2026-10-03).** Includes `/` blocks, toggles, to-dos, image paste/drop/upload, a selection toolbar, `@` links with backlinks, tags, folders with drag-and-drop, pinning, trash/restore, light/dark themes, Ctrl+K search, back/forward, and a Desktop shortcut. Not done yet: tables and callout blocks (add when needed).
2. **Customers & Tickets:** customers, tickets, templates, photos, search and filters. **Done (2026-10-03).** Includes:
   - Auto-numbered tickets (NT-0001) with statuses, device, issue, received and pickup dates, and price
   - Pick or create a customer inline, with phone and email edited right on the ticket
   - Templates with fill-in form fields, plus a starter "Repair intake" template and a default-template choice
   - Before/after photo galleries (collapsible, drag between sides, full-screen viewer)
   - Ticket filters (status, date range, search by name, email, phone in any format, repair # or ticket text)
   - Customer pages with repair history
   - `@`-links and backlinks across notes, tickets and customers; open tickets on Home
   - The Zoho emails section waits for phase 6.
3. **Calendar:** views, drag-and-drop linking, reminders, tray and notifications. **Done (2026-10-04).** Includes:
   - Month, week and day views, with drag-and-drop from a ticket tray, the sidebar and the lists
   - A ticket dropped on a day becomes its pickup, synced both ways with the ticket's Pickup field
   - An event popover with a link to the item, reminder choices and notes; drag to move, double-click to open
   - "On the calendar" on linked pages and "Coming up" on Home
   - Windows notifications (day before at 9 AM, day of at 8 AM), close-to-tray, and a Start-with-Windows option
   - An app icon and a Start menu shortcut
   - Public holidays from Google’s holiday calendars (public feed, so no sign-in needed): pick a country or turn them off, optionally hide observances; refreshed weekly
4. **Vault**. **Done (2026-10-04).** Includes:
   - A passcode (6+ characters) turned into a key with scrypt (N=2^17); a random data key wraps every item in AES-256-GCM, bound to the item id
   - The data key is wrapped separately by the passcode and by a recovery key (shown once; copy, save or print)
   - Logins with a password generator, plus cards and secure notes; reveal and copy, with the clipboard auto-cleared after 30 s
   - Auto-lock after inactivity (1–60 min), on PC lock or sleep, and on close-to-tray; a wait after 5 wrong passcodes
   - Change passcode, or reset it with the recovery key
   - Nothing readable on disk (verified by tests that scan the raw database file); vault items are never in search
   - Encrypted files on any item (PDFs, scans, photos): names and contents are encrypted. Images and PDFs preview inside Plannr, decrypted only in memory; "Open in app" uses a temporary copy deleted on lock; "Save a copy" exports. New → Document creates an item and opens the file picker.
   - Every item has rich notes (the same editor as notes; pasted images are encrypted) and user-defined custom fields that can be hidden
5. **Money**. **Done (2026-10-04).** Includes:
   - Bills and subscriptions (weekly, monthly, quarterly, yearly or one-time; the day of month is kept, so the 31st survives short months)
   - Auto-pay (charged the day after the due date, with no backfill for dates before tracking started); mark paid or skip
   - Reminders N days before and on the day; due dates on the calendar and Home; cancelled items kept
   - Ticket payments with Paid / Owes badges
   - Overview: income, expenses, profit, subscription cost per month and year, coming up, customers who owe
   - Transactions with filters and search, plus CSV export
6. **Integrations:** Google Calendar, Zoho Mail and QuickBooks. These need you to do a one-time sign-up for free developer credentials with each service; Claude will give step-by-step instructions.
7. **Polish & install:** backups, installer, start-with-Windows option

**Later:** cloud sync to the desktop PC, a phone app, and ChatGPT/Claude integration (summarize a ticket, draft customer emails, ask questions about your notes).

## Quality rules Claude follows
- Plan each feature before coding, and keep changes small and complete.
- TypeScript strict mode, with lint and type checks before calling anything done.
- Every feature gets an automated test that launches the real app. Claude looks at the screenshots itself.
- Git commits after every working step, so any mistake can be undone.
- If something fails twice, stop, find the root cause and rethink rather than piling on patches.
