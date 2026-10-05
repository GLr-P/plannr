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
  `
]
