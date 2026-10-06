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
6. **Integrations:** Google Calendar is **done and connected (2026-10-04)**: Plannr events sync two-way with a "Plannr" Google calendar, and the chosen Google calendars show read-only. Zoho Mail is **connected (2026-10-04)**: an Emails section on customers and tickets, read-only, with sandboxed reading. QuickBooks Online is **connected (2026-10-05)**: customers, ticket payments (sales receipts, with a tax-included, + tax or no-tax choice per payment) and expenses sync one way to QuickBooks from a chosen start date; payments invoiced in QuickBooks can be linked to the invoice number so they are not sent twice. **Phase 6 done.** Originally: Google Calendar, Zoho Mail and QuickBooks. These need you to do a one-time sign-up for free developer credentials with each service; Claude will give step-by-step instructions.
7. **Polish & install:** backups, installer, start-with-Windows option. **Done (2026-10-04).** Includes:
   - Daily verified backups (keeps 30; files mirrored; folder changeable; restore that saves the current data first)
   - NSIS installer (`npm run dist` builds `release/Plannr-Setup-<version>.exe`) with Start menu and desktop shortcuts and an uninstaller that keeps the data
   - The whole e2e suite also passes against the packaged exe
   - Not code-signed yet, so Windows SmartScreen will warn on first install


## Next (requested 2026-10-05, in this order)
8. **Cleaner sidebar.** **Done (2026-10-05).** Notes is one menu item (hover for + note / + folder). Pinned and Folders only appear when used. Recent notes are off by default, with a setting to show them. Trash sits at the bottom with Templates and Settings. Folders show their icon, which turns into the expand arrow on hover.
9. **Optimize and polish everything,** and add features that are missing. **Done (2026-10-05).**
   - Right-click menus on notes and folders: rename, icon (picker or emoji) and colour, pin, move to a folder, delete. Clicking the icon by a note's title changes it too.
   - Organise the sidebar: drag the main menu into any order; Vault sits apart at the bottom. Sections: Pinned, Folders and your own (add, rename, drag to reorder, remove). Drag notes and folders to reorder them, into folders (folders can nest), or onto a section. Right-click also offers "Move to section".
   - Ticket form fields line up (one label column, boxes the same width).
   - Undo after deleting notes, tickets, customers, payments, transactions and bills.
   - Business details in Settings (logo, contact, GST/HST name, rate and number, terms). Tickets print an intake slip (passcodes are never printed), a receipt (tax split out) and a device label (Brother, Dymo or 4×6).
   - Fixed: the first click on a collapsed folder did nothing; payments and expenses now each remember their own tax choice.
   - Settings in tabs (General, Business, Connected accounts, Backups & data). Keyboard shortcuts list (Ctrl+/), Ctrl+T new ticket, Ctrl+1–6 follow the menu order, Ctrl+, Settings.
   - Startup measured at about 0.4 s to a usable window (PERF=1 script in tests/perf), so code-splitting isn't worth it.
   - Noted for customization or sharing: the "NT-" ticket prefix and CAD currency are hard-coded.
10. **More to create:** note types and more templates. **Done (2026-10-05).**
   - Note templates: 7 starters (Meeting notes, Checklist, Repair guide, Supplier, Inventory, Weekly plan, Daily log), each with its own icon. Pick one from **New note ▾**, or right-click a note → Save as template. The Templates page has Ticket and Note tabs.
   - New blocks: Table (right-click a cell to add or delete rows and columns, or toggle the header row; columns resize) and Callout (info, tip, warning, important, note; click the icon to change it).
11. **Customization:** as much as sensible (sidebar, sections, colours, layout and so on). **Done (2026-10-05).**
   - Look (Settings → General): theme, 8 accent colours, comfortable or compact spacing, 4 text sizes (zoom), week starts Sunday or Monday.
   - Layout tab: hide menu items (everything except Home); choose and reorder the Home sections; recent notes in the sidebar. The menu order itself is set by dragging in the sidebar.
   - Tickets tab: your own number prefix (search follows it: "ab7" finds AB-0007, in the ticket list and the main search) and names for the five statuses.
   - Business tab: currency (shown with a plain symbol, e.g. $ for CAD) and your own payment methods.
   - Plus everything from the sidebar work: sections, icons and colours, order.
   - Display preferences live in the shared formatters (`setDisplayPrefs` in shared/api.ts), so the main process (printing, search titles) and the window agree.
12. **For other people:** **Done (2026-10-05).** Welcome tour on fresh installs (business name with a suggested ticket prefix, currency, pick the parts you want, optional connections, tips; reopen it from Settings → General). New installs default to "T-"; installs that already had tickets keep "NT-". Published as open source (GPL-3.0) at https://github.com/GLr-P/plannr, with the website at https://glr-p.github.io/plannr/ (served from docs/) and **v0.9.0 (beta)** as the first release with the installer.
13. **More features (requested 2026-10-05):** **All done (2026-10-05).** Quotes/invoices + inventory (`services/items.ts`, TicketLines, InventoryView), Reports (`services/reports.ts`, MoneyReports), customer messages (`lib/messages.ts`, MessageDialog), Tasks (`services/tasks.ts`, TasksView), quick capture (`main/capture.ts`, Capture.tsx, global shortcut), repeating events (`occurrenceDates` in calendar.ts; Google gets an RRULE and instances with recurringEventId are skipped on pull), import/export (`services/portability.ts`).
   1. Quotes and invoices: ticket line items (parts, labour, discount), printable quote/invoice, totals with tax
   2. Parts inventory: stock and cost, parts used on tickets come off stock, low-stock warning, profit per repair
   3. Reports (Money → Reports): GST/HST summary per quarter (collected minus paid, i.e. ITCs), charts for income and expenses per month, repairs per month, turnaround and top devices
   4. Customer messages: templates such as "Ready for pickup", opened as an email draft or copied
   5. Tasks: standalone tasks with due dates and reminders, plus every checkbox from notes and tickets; shown on the calendar and Home
   6. Quick capture: a global shortcut opens a small box to jot a note or task, even from the tray
   7. Repeating events (daily, weekly, monthly, yearly), synced to Google as recurrence
   8. Import contacts from CSV; export everything to Markdown and CSV
14. **Phone and second PC:** sync between devices. Decided: a free Cloudflare sync service the owner runs (Worker + D1), end-to-end encrypted; the phone is a web app added to the iPhone Home Screen with everything the PC has (money, vault, notes, tasks, calendar, tickets, customers). **Built and tested (2026-10-05)**: the sync engine and service, Settings → Sync & devices (QR code to add a phone, join link for a second PC), and the phone web app (same screens with a phone layout, offline, camera for ticket photos). Remaining: deploying the service to the owner's Cloudflare account, and a signed Plannr build so the PC can update to a version with sync.

**Later:** a built-in AI helper (summarize a ticket, draft customer emails, ask questions about your notes).

## Quality rules Claude follows
- Plan each feature before coding, and keep changes small and complete.
- TypeScript strict mode, with lint and type checks before calling anything done.
- Every feature gets an automated test that launches the real app. Claude looks at the screenshots itself.
- Git commits after every working step, so any mistake can be undone.
- If something fails twice, stop, find the root cause and rethink rather than piling on patches.
