# Plannr

**One simple app for running a small repair business on Windows:** tickets and customers, a calendar, money, notes and a locked vault, all in one window. Everything stays on your computer.

[**⬇ Download for Windows**](https://github.com/GLr-P/plannr/releases/latest) · [Website](https://glr-p.github.io/plannr/) · Free and open source (GPL-3.0)

![Plannr home screen](docs/screenshots/home.png)

## What's inside

| | |
|---|---|
| **Tickets** | Every repair from drop-off to pickup: status, device, problem, price, pickup date, before/after photos, and a check-in form (passcode, condition, accessories…) from a template you can change. Print an intake slip, a receipt or a device label. |
| **Customers** | Contact details and the full repair history for each customer. Search by name, email, phone number in any format, or ticket number. |
| **Calendar** | Month, week and day views. Drag a ticket onto a day to set its pickup. Reminders pop up in Windows. Public holidays included. |
| **Money** | Ticket payments (tax included, tax on top, or no tax), expenses, bills and subscriptions with auto-pay, who still owes you, and monthly totals. CSV export. |
| **Notes** | A clean editor with checklists, tables, callouts, toggles and photos. `@` links notes, tickets and customers together. Folders, your own sidebar sections, icons and colours. Seven starter templates (repair guide, supplier, inventory, meeting notes…). |
| **Vault** | Passwords, cards and documents, encrypted with your own passcode (AES-256). Locks itself when you step away. |

Optional connections, if you use them:

- **Google Calendar**: your Plannr events on your phone, and your Google calendars inside Plannr
- **Zoho Mail**: every email with a customer, right on their page
- **QuickBooks Online**: customers, payments and expenses sent to your books automatically

Each connection uses your own free developer key, so your data goes straight from your computer to the service. Settings has step-by-step instructions.

## Screenshots

| | |
|---|---|
| ![A repair ticket](docs/screenshots/ticket.png) | ![Calendar](docs/screenshots/calendar.png) |
| ![Money overview](docs/screenshots/money.png) | ![A note with a table and a callout](docs/screenshots/note.png) |
| ![Dark mode](docs/screenshots/ticket-dark.png) | ![Settings: layout](docs/screenshots/settings.png) |

## Make it yours

Light or dark, 8 accent colours, compact spacing and bigger text. Drag the menu into any order and hide what you don't use. Choose what Home shows. Pick your own ticket number prefix, status names, currency and payment methods. A short welcome tour sets the basics the first time you open it.

## Install

1. Download **Plannr-Setup-x.y.z.exe** from the [latest release](https://github.com/GLr-P/plannr/releases/latest).
2. Run it. Windows may say *"Windows protected your PC"* because the installer isn't code-signed yet: click **More info → Run anyway**.
3. Plannr opens with a one-minute welcome tour.

Works on Windows 10 and 11 (64-bit). Your data lives in `%APPDATA%\Plannr\data`, and Plannr backs it up every day to `Documents\Plannr Backups` (you can change the folder or restore a backup in Settings). Uninstalling keeps your data.

## Privacy

Plannr has no account, no server and no tracking. Nothing leaves your computer unless you connect Google, Zoho or QuickBooks, and then only to that service. Keys and sign-ins are encrypted with Windows' own protection (DPAPI), and the vault is encrypted with your passcode.

## For developers

Built with Electron, React, TypeScript, TipTap and SQLite (`node:sqlite`).

```sh
npm install
npm run dev        # run with hot reload
npm run check      # typecheck + unit tests (Vitest) + end-to-end tests (Playwright, drives the real app)
npm run dist       # build the Windows installer into release/
```

See [CLAUDE.md](CLAUDE.md) for the architecture and [PLAN.md](PLAN.md) for the roadmap. Issues and pull requests are welcome.

## License

[GNU General Public License v3.0](LICENSE). You can use, change and share Plannr; if you share a changed version, it has to stay open source under the same license.
