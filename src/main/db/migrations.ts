// Append-only: never edit a migration that has shipped, add a new one instead.
// Every synced record has a UUID id, created_at/updated_at (ms) and deleted_at (soft delete)
// so cross-device sync can be added later without reshaping data.
export const migrations: string[] = [
  /* 1: notes, folders, files, links, settings, search */ `
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content_json TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX notes_folder ON notes(folder_id);
  CREATE INDEX notes_updated ON notes(updated_at);

  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  -- Generic "A links to B" edges (mentions now; calendar/ticket links later). Derived from content.
  CREATE TABLE links (
    src_type TEXT NOT NULL,
    src_id TEXT NOT NULL,
    dst_type TEXT NOT NULL,
    dst_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (src_type, src_id, dst_type, dst_id)
  );
  CREATE INDEX links_dst ON links(dst_type, dst_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE search_index USING fts5(
    type UNINDEXED,
    id UNINDEXED,
    title,
    body,
    updated_at UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  );
  `,

  /* 2: customers, tickets, ticket photos, templates */ `
  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    phone_digits TEXT NOT NULL DEFAULT '', -- phone with only digits, for format-agnostic search
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX customers_name ON customers(name COLLATE NOCASE);

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id),
    status TEXT NOT NULL DEFAULT 'intake',
    device TEXT NOT NULL DEFAULT '',
    issue TEXT NOT NULL DEFAULT '',
    price_cents INTEGER,
    received_on TEXT, -- YYYY-MM-DD (date only, no timezone surprises)
    pickup_on TEXT,   -- YYYY-MM-DD
    closed_at INTEGER,
    template_id TEXT,
    content_json TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX tickets_customer ON tickets(customer_id);
  CREATE INDEX tickets_status ON tickets(status);

  CREATE TABLE ticket_photos (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id),
    kind TEXT NOT NULL CHECK (kind IN ('before', 'after')),
    sort REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX ticket_photos_ticket ON ticket_photos(ticket_id);
  `,

  /* 3: search index gets an `extra` column for match-only terms (digits-only phone, status…) kept out of snippets.
        The index is derived data: rebuildSearchIndex() refills it on next start (see services/reindex.ts). */ `
  DROP TABLE search_index;
  CREATE VIRTUAL TABLE search_index USING fts5(
    type UNINDEXED,
    id UNINDEXED,
    title,
    body,
    extra,
    updated_at UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  );
  `,

  /* 4: calendar events and reminder bookkeeping */ `
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,       -- YYYY-MM-DD
    start_time TEXT,          -- HH:MM, NULL = all day
    end_time TEXT,            -- HH:MM
    kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'pickup')),
    link_type TEXT,           -- 'ticket' | 'customer' | 'note'
    link_id TEXT,
    reminders TEXT NOT NULL DEFAULT '["day_before","day_of"]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX events_date ON events(date);
  CREATE INDEX events_link ON events(link_id);

  -- One row per reminder already shown, so each fires once. The key includes the date, so moving an event re-arms it.
  CREATE TABLE reminder_log (
    event_id TEXT NOT NULL,
    reminder_key TEXT NOT NULL,
    fired_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, reminder_key)
  );

  -- Existing ticket pickup dates become pickup events.
  INSERT INTO events (id, title, date, kind, link_type, link_id, created_at, updated_at)
  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
           substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
         COALESCE(NULLIF(c.name, ''), printf('NT-%04d', t.number)) || ' pickup',
         t.pickup_on, 'pickup', 'ticket', t.id, t.updated_at, t.updated_at
  FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.pickup_on IS NOT NULL AND t.deleted_at IS NULL;
  `,

  /* 5: public holidays, cached from Google's holiday calendar feeds (read-only, refreshed weekly) */ `
  CREATE TABLE holidays (
    region TEXT NOT NULL,
    uid TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    observance INTEGER NOT NULL DEFAULT 0, -- 1 = observance (e.g. Daylight Saving), 0 = public holiday
    PRIMARY KEY (region, uid)
  );
  CREATE INDEX holidays_date ON holidays(date);
  `,

  /* 6: vault. Nothing here is readable without the passcode or recovery key:
        vault_keys holds the data key encrypted ("wrapped") by each, vault_items holds AES-256-GCM ciphertext. */ `
  CREATE TABLE vault_keys (
    id TEXT PRIMARY KEY CHECK (id IN ('passcode', 'recovery')),
    salt TEXT NOT NULL,     -- base64
    params TEXT NOT NULL,   -- scrypt parameters (JSON), so they can be raised later
    wrapped TEXT NOT NULL,  -- base64: iv | tag | encrypted data key
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE vault_items (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,     -- base64: iv | tag | ciphertext of the item JSON (kind, title, fields)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  `,

  /* 7: encrypted vault files. Contents live in <data>/vault/<id>.bin (AES-256-GCM); name/type/size are in the encrypted meta. */ `
  CREATE TABLE vault_files (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    meta TEXT NOT NULL,   -- base64 sealed JSON {name, mime, size, inline}
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX vault_files_item ON vault_files(item_id);
  `,

  /* 8: money: bills & subscriptions (recurring), and income/expense transactions (incl. ticket payments) */ `
  CREATE TABLE recurring (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('bill', 'subscription')),
    name TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly', 'once')),
    next_due TEXT NOT NULL,       -- YYYY-MM-DD
    anchor_day INTEGER NOT NULL,  -- day of month it's due (so the 31st comes back after short months)
    category TEXT NOT NULL DEFAULT '',
    autopay INTEGER NOT NULL DEFAULT 0,
    remind_days INTEGER NOT NULL DEFAULT 3,  -- remind this many days before (plus on the day); -1 = no reminders
    url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,       -- 0 = cancelled
    cancelled_on TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,           -- YYYY-MM-DD
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT '',
    ticket_id TEXT,
    recurring_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX transactions_date ON transactions(date);
  CREATE INDEX transactions_ticket ON transactions(ticket_id);
  `,

  /* 9: when a bill's due date was set; earlier due dates count as already paid (no auto-pay backfill) */ `
  ALTER TABLE recurring ADD COLUMN due_set_on TEXT;
  UPDATE recurring SET due_set_on = date(created_at / 1000, 'unixepoch', 'localtime');
  `,

  /* 10: Google Calendar sync. Plannr events mirror to a 'Plannr' Google calendar (two-way); other Google calendars
         are cached read-only in google_events for display. */ `
  ALTER TABLE events ADD COLUMN google_id TEXT;
  ALTER TABLE events ADD COLUMN google_synced_at INTEGER; -- events.updated_at as of the last push/pull
  CREATE INDEX events_google ON events(google_id);

  CREATE TABLE google_events (
    calendar_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,      -- YYYY-MM-DD (local)
    end_date TEXT,           -- last day for multi-day all-day events
    start_time TEXT,         -- HH:MM local; NULL = all day
    end_time TEXT,
    html_link TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (calendar_id, event_id)
  );
  CREATE INDEX google_events_date ON google_events(date);
  `,

  /* 11: QuickBooks Online: which QuickBooks record each Plannr customer/transaction became */ `
  CREATE TABLE qbo_links (
    local_type TEXT NOT NULL,   -- customer | income | expense
    local_id TEXT NOT NULL,
    qbo_id TEXT NOT NULL,
    sync_token TEXT NOT NULL,   -- QuickBooks version (needed to update/delete)
    synced_at INTEGER NOT NULL, -- the local updated_at that was sent
    PRIMARY KEY (local_type, local_id)
  );
  `,

  /* 12: per-transaction "no tax" (amounts otherwise include tax) */ `
  ALTER TABLE transactions ADD COLUMN tax_exempt INTEGER NOT NULL DEFAULT 0;
  `,

  /* 13: payment already in QuickBooks as an invoice made there (its number); not sent as a sales receipt */ `
  ALTER TABLE transactions ADD COLUMN qbo_invoice TEXT NOT NULL DEFAULT '';
  `,

  /* 14: custom icon (picker name or emoji) and colour for notes and folders */ `
  ALTER TABLE notes ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT '';
  ALTER TABLE folders ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT '';
  `,

  /* 15: sidebar sections (Pinned, Folders and your own), folders inside folders, manual order */ `
  CREATE TABLE sidebar_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO sidebar_sections (id, name, sort, created_at, updated_at) VALUES ('pinned', 'Pinned', 1, 0, 0), ('folders', 'Folders', 2, 0, 0);
  ALTER TABLE notes ADD COLUMN section_id TEXT;
  ALTER TABLE notes ADD COLUMN sort REAL NOT NULL DEFAULT 0;
  UPDATE notes SET section_id = 'pinned' WHERE pinned = 1;
  ALTER TABLE folders ADD COLUMN section_id TEXT NOT NULL DEFAULT 'folders';
  ALTER TABLE folders ADD COLUMN parent_id TEXT;
  `,

  /* 16: note templates (templates were ticket-only), with an icon for notes made from them */ `
  ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'ticket';
  ALTER TABLE templates ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  `,

  /* 17: quotes & invoices (ticket line items) and the parts inventory */ `
  CREATE TABLE parts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL DEFAULT 0,
    reorder_at REAL NOT NULL DEFAULT 0,
    supplier TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE ticket_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'labour',
    description TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 1,
    unit_cents INTEGER NOT NULL DEFAULT 0,
    part_id TEXT,
    cost_cents INTEGER,
    sort REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX ticket_items_ticket ON ticket_items(ticket_id);
  ALTER TABLE tickets ADD COLUMN tax_exempt INTEGER NOT NULL DEFAULT 0;
  `,

  /* 18: tasks (standalone to-dos with due dates and reminders) */ `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    due_time TEXT,
    remind INTEGER NOT NULL DEFAULT 1,
    done_at INTEGER,
    link_type TEXT,
    link_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX tasks_due ON tasks(due_date);
  `,

  /* 19: repeating events (daily/weekly/monthly/yearly, until, skipped dates); google_reset re-creates the Google copy */ `
  ALTER TABLE events ADD COLUMN repeat TEXT NOT NULL DEFAULT '';
  ALTER TABLE events ADD COLUMN repeat_until TEXT;
  ALTER TABLE events ADD COLUMN exdates TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE events ADD COLUMN google_reset INTEGER NOT NULL DEFAULT 0;
  `
]
