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
14. **Phone and second PC:** sync between devices. Decided: a free Cloudflare sync service the owner runs (Worker + D1), end-to-end encrypted; the phone is a web app added to the iPhone Home Screen with everything the PC has (money, vault, notes, tasks, calendar, tickets, customers). **Built and tested (2026-10-05)**: the sync engine and service, Settings → Sync & devices (QR code to add a phone, join link for a second PC), and the phone web app (same screens with a phone layout, offline, camera for ticket photos). The service is **deployed (2026-10-06)** at https://plannr-sync.nanotechservices.workers.dev (owner's Cloudflare account; `server/wrangler.toml` is local only; redeploy with `npx wrangler@4 deploy` in server/ after `npm run build:web`). Signing: SignPath declined (2026-10-09); the owner decided releases stay unsigned (Smart App Control is off on their PC; the README and website explain the SmartScreen warning and that Smart App Control blocks unsigned apps).
15. **Profiles (requested 2026-10-06):** the owner also works at a second job and wants two completely separate sets of everything (no shared QuickBooks, Zoho, Google, customers, money or vault), a simple switcher, the same Cloudflare sync service, and one way to copy things across. Built generically as **profiles** (work, personal, side job…), not "businesses", because Plannr is public. **Done (2026-10-06)**, PC and phone.
   - A profile is its own data folder: the first stays `%APPDATA%\Plannr\data`, others go in `data\profiles\<id>\`. The list, the open one and the window position live in `data\profiles.json` (`main/profiles.ts`, pure and unit-tested; `main/profile-manager.ts` runs it). Everything already keyed on the data folder (database, attachments, vault, settings, sign-in tokens, sync key) is separate automatically. The first profile is named after the business details if filled in, otherwise "Main".
   - Switching relaunches Plannr (about a second) instead of swapping in place, so no timer, sign-in or half-finished QuickBooks/Google sync from one profile can touch the other. It goes Home first so open pages save. The window keeps its size and position. In tests the app exits and the test starts it again.
   - The switcher replaces the "Plannr" name in the title bar (it shows the open profile's name and colour once there are two); the tray menu has "Switch profile"; the window title names the profile. Settings → General → Profiles: add, rename, colour, open, remove (not the first or the open one; its folder goes to the Recycle Bin). A new profile starts with the welcome tour. Per-profile UI state uses `plannr-ui:<id>` in localStorage (the renderer gets `?profile=`).
   - Reminders (events, tasks, bills, autopay) are checked for every profile, not just the open one (the others' databases are opened read/write for this); a notification for another profile is prefixed with its name, and clicking it switches there and shows the item (`?navigate=`).
   - Each profile gets its own backup folder (new ones: `Documents\Plannr Backups\<name>`, saved as its `backupDir` setting when first opened) so backups never prune or restore another profile.
   - Copy or move a note to another profile from its right-click menu (`services/transfer.ts`): pictures and files are copied into that profile's storage; @-links become plain text. Moving puts the original in the trash.
   - New **File** block in notes (`editor/FileAttachment.tsx`): /File, or paste/drop any non-image file; shows name and size, opens in its Windows app. Searchable by name, exported to Markdown as a link. Not in the vault (it keeps its own encrypted files).
   - Sync: each profile is its own encrypted space on the same service; only the open profile syncs on the PC. Join links now carry the profile's name and colour (`#join=<key>&name=…&color=…`; old links still parse).
   - Phone (`src/web/profiles.ts`): the list is in localStorage; each profile is its own pair of databases in the OPFS pool (first profile keeps `/plannr.db`/`/files.db`, others `/p-<id>.db`). The page tells the worker which profile to open (`{ init }` message). Opening another profile's join link adds it as a new profile (spaces told apart by `keyFingerprint`, never storing the key); opening a known one just switches to it. The switcher sits at the top of the drawer. Copying notes between profiles is PC-only.
   - **When releasing this:** redeploy the sync service (`npm run build:web`, then `npx wrangler@4 deploy` in server/) at the same time, since the deployed phone app is older and can't read the new join links.
16. **Customizable fill-in fields (requested 2026-10-06):** **Done (2026-10-06).** Fields were too rigid (one per line, label left, fixed size). Now each field's gear menu sets:
   - Width: full (one per line, label column lines up), half or third (side by side when placed on the same line), small (sits inside a sentence, e.g. "Deliver on [date] between [time] and [time]").
   - Label left, above or hidden; placeholder; a hint under the box; height for long text.
   - Types: short/long text, number, money (currency symbol inside), date, time, phone, email, checkbox, dropdown, pick one (buttons), pick several (stored as a JSON list; shown as "a, b" in search, print and export).
   - **Fills in from** the ticket: customer name/phone/email/address, ticket title/summary, received/pickup date (edit both ways), ticket number and price (read-only). `editor/formLinks.ts` is a small store the open ticket page fills; typing a linked customer field on a ticket with no customer creates one. Linked fields keep a copy of the value in their attrs for search; printouts skip them (the header already prints the customer and dates).
   - Fields can be dragged by their grip; after Done the cursor carries on right after the field. Old fields keep their look (defaults: full, label left).
   - Proven by tests/e2e/forms.spec.ts, which builds a flower shop order form entirely through the app and takes an order with it.
   - Still repair-flavoured: the ticket page's own header ("Device", "What's wrong with it?") is fixed wording; worth making per template so other kinds of orders read naturally.
17. **Choose your notifications (requested 2026-10-09):** **Done (2026-10-09).** Every event has a **Notify me** row: for events with a time, when it starts or 5/10/15/30 min, 1 or 2 hours, 1 day before; for all-day events, the morning of (8 AM), the day before (9 AM) or a week before; or **Don't notify**. Several can be picked. Settings → General → Notifications sets the defaults for new timed and all-day events (setting `eventReminders`, synced; migration 21 re-creates the settings triggers) and has a **Test notification** button. Reminder kinds are `day_of`, `day_before`, `week_before` and `before:<minutes>` (`isReminderKind` in shared/api.ts); a reminder caught up after the event began says "Started at …". Tasks and bills keep their own reminders. Notifications come from the PC (Plannr in the tray); the phone web app can't show them in the background.
18. **Tickets for any kind of work (requested 2026-10-10):** **Done (2026-10-10).** Tickets were still built for computer repair (title "Device", "What's wrong with it?", fixed top section). Now:
   - Each ticket template has **Top of the ticket** (`TicketLayout` in shared/api.ts, `templates.layout`, migration 22): names for the title and summary boxes (or hide the summary), the two dates' names (the second goes on the calendar, and its name is used in calendar titles, e.g. "Maya delivery"), and whether the customer, price and payments, quote/invoice lines, photos and emails show. Only differences from `DEFAULT_TICKET_LAYOUT` are stored. Tickets read their template's layout live (`layoutForTicket`).
   - Defaults are neutral ("Title", "Details"); the starter "Repair intake" keeps the repair wording (`REPAIR_TICKET_LAYOUT`). `ensureTicketLayouts` (once) gave existing installs' Repair intake that layout and pointed template-less tickets at the default template, so old tickets look as before.
   - The / menu in tickets and ticket templates has **Customer details** (linked name, phone, email, address fields) and **Ticket dates**.
   - A linked "Customer name" field on a ticket with no customer offers matching existing customers; a typed name becomes a new customer only when you leave the field (or on leaving the page).
   - Neutral wording elsewhere: lists ("Untitled", "Ticket"), the intake slip ("Ticket T-0001", "Details", the template's own names), the "Label" print, settings and message placeholders.

19. **Free-form ticket designer (requested 2026-10-10):** **Done (2026-10-10).** The owner wants templates to work like Canva/Photoshop: put anything anywhere and resize it freely.
   - Templates → **New canvas template** (ticket templates). A canvas is stored as DocJSON `{ type: 'canvas', attrs: { height }, content: [items] }` (`shared/canvas.ts`), each item with `attrs.id` and `attrs.box` {x, y, w, h} in page units (`CANVAS_WIDTH` = 780, scaled to fit). Items: `formField` (same attrs as in documents, so linking, search, printing and copying just work), `canvasText` (attrs.text + style), `image`, `canvasShape` (box or line), `canvasPart` (the ticket's photos, quote lines or payments, supplied by the ticket page through `useTicketParts`).
   - Designer (`canvas/CanvasDesigner.tsx`): toolbar (text, heading, field, customer, title, dates, picture, box, line, photos, lines, payments), drag to move, 8 resize handles, alignment guides that snap to other items and the page centre (`snapBox`, Alt = free), arrow-key nudges, Delete, Ctrl+D, undo/redo, double-click to type, a properties bar (position and size, text size/bold/italic/align/colour, fill/border/corners, picture fit, field settings, front/back), and a draggable page height. New canvas templates start with a heading, customer details, dates and notes, and a layout that hides the ticket's own customer/dates/price/lines/photos (they go on the canvas).
   - On a ticket (`canvas/CanvasView.tsx`) the canvas is filled in; below 560 px wide (phones) items stack in reading order.
   - The fill-in field was split into `FieldLabel`/`FieldBody`/`useFieldValue` so documents and canvases share it.
20. **Calculated fields; optional customer phone/email (requested 2026-10-10):** **Done (2026-10-10).**
   - New field type **Calculated**: a formula over the form's other fields, e.g. `({Flower Price} + {Delivery Fee?} + {Addons?}) * 1.12` (`shared/formula.ts`: a small parser, never eval; field names in braces, ignoring case and spaces; + − * / ( ) and %; blank fields count as 0; unknown names, circles or division by zero give no answer). Shown as money or a number, read-only, and kept on the field (attrs.value) for search and printing; blank until something it uses is filled in. Documents recalculate in a ProseMirror `appendTransaction` plugin (FormField); canvases in CanvasView. The field settings list the form's other fields to click into the formula and warn about unknown names.
   - Top of the ticket: the customer's phone and email can each be hidden (`showCustomerPhone`, `showCustomerEmail`).
   - Printouts also leave out fields that look like card numbers (card no./number, credit, CVV/CVC, expiry), like passcodes.
21. **Print the whole form (requested 2026-10-10):** **Done (2026-10-10).** Print → **Form (everything, as designed)** (`services/print-form.ts`, print kind `form`): a canvas prints at its places (scaled to Letter), a document in order, with every value filled in (linked ones from the ticket and customer, calculated totals, checkboxes, pictures and photos as data: URLs, lines and payments parts). It is the shop's copy, so it includes everything, card numbers too; the intake slip (now labelled the customer copy) still leaves out passcodes and card numbers. Follow-up (0.9.10): canvas fields always fill their box (the document-only width setting is ignored and hidden there), so screen and paper match; the printout has the business header, softer boxes and bold totals; calculated fields are worked out at print time. 0.9.11 (owner feedback): no header bar (just the date), solid black text and borders (light grey prints fuzzy), the canvas laid out at printed size instead of zoomed, and labels sized to the largest that fits on one line (10–18 px, `labelSize`, estimated since the print window runs no scripts).
22. **Print styles (requested 2026-10-10):** **Done.** Templates choose the Form printout's look (`TicketLayout.printStyle`, `printAccent`; Top of the ticket → Printed form): **Modern** (default; the owner asked for a mix of Lines and Clean: coloured small-caps labels, answers on 1.25 px underlines, ruled lines for long answers, the total as a colour badge), Boxes, Lines, Clean, Elegant. Everything prints in solid black plus one accent colour, no grey tints or hairlines (the owner prints on an HP OfficeJet 8022e inkjet). Styles are CSS classes on the printout body (`s-<style>`) in `print-form.ts`. Each field can also print without its line or box (`noLines` attr, "Print without a line or box" in its settings).
23. **Field text style (requested 2026-10-10):** **Done.** A field's settings set its label and answer bold/italic (`labelBold` default on, `labelItalic`, `valueBold`, `valueItalic`), text sizes in px (`labelSize`, `valueSize`; 0 = automatic, the printed label still auto-fits) and **Lines when printed**: Normal, Last line only (one underline right under the last line of writing) or None (`printLines` '' | 'last' | 'none'; the older `noLines` reads as none via `printLinesOf`). Applied on screen (CSS classes `ff-lb-off/li/vb/vi`, variables `--ffl`/`--ffv`) and on the Form printout (`lb0/li/vb/vi`, `.fv.last`).

**Later:**
- A built-in AI helper (summarize a ticket, draft customer emails, ask questions about your notes).
- **Sync for other Plannr users** (requested 2026-10-06): a guided setup inside Plannr (Settings → Sync & devices) that deploys the sync service to the user's own free Cloudflare account, so people who download Plannr get sync without running commands. Decided over one shared service run by the owner (uptime, limits and cost would fall on the owner). Today only the owner's service exists, and creating a space on it needs the owner's setup code.

## Quality rules Claude follows
- Plan each feature before coding, and keep changes small and complete.
- TypeScript strict mode, with lint and type checks before calling anything done.
- Every feature gets an automated test that launches the real app. Claude looks at the screenshots itself.
- Git commits after every working step, so any mistake can be undone.
- If something fails twice, stop, find the root cause and rethink rather than piling on patches.
