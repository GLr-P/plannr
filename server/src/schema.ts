/** The sync service's tables, created on first use. Its own module: Workers only allow handlers as exports of the entry file. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS changes (
  space TEXT NOT NULL, tbl TEXT NOT NULL, rid TEXT NOT NULL,
  ts INTEGER NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (space, tbl, rid)
);
CREATE INDEX IF NOT EXISTS changes_seq ON changes (space, seq);
CREATE TABLE IF NOT EXISTS blobs (space TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (space, id, part));
CREATE TABLE IF NOT EXISTS drops (space TEXT PRIMARY KEY, token_hash TEXT NOT NULL, device TEXT, info TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox (space TEXT NOT NULL, id TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (space, id));
`
