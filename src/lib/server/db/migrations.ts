/**
 * Database schema, versioned with SQLite's `PRAGMA user_version`.
 *
 * Rules for changing this file (see CLAUDE.md):
 * - **Append only.** Never edit a released migration; add the next one.
 * - Each entry is a full migration, applied in order when `user_version < index + 1`.
 * - SQL lives here, inline, on purpose: an agent reading one file sees the whole shape.
 *
 * Why SQLite: chats used to be a folder of JSON files loaded whole at boot
 * (`GET /api/all`, 32 MiB cap, last-write-wins across tabs). SQLite gives atomic commits,
 * partial reads, and FTS5 search with zero native build steps (`node:sqlite` ships in Node 24).
 */
export const MIGRATIONS: string[] = [
	// v1 — chats, messages, generations, images, FTS, provider config
	`
	CREATE TABLE chats (
		id         TEXT PRIMARY KEY,
		title      TEXT NOT NULL DEFAULT 'Untitled',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		story      TEXT,
		meta       TEXT
	);

	CREATE TABLE messages (
		id         TEXT PRIMARY KEY,
		chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		seq        INTEGER NOT NULL,
		role       TEXT NOT NULL,
		content    TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		meta       TEXT
	);
	CREATE UNIQUE INDEX messages_chat_seq ON messages(chat_id, seq);

	CREATE TABLE generations (
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		idx        INTEGER NOT NULL,
		content    TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (message_id, idx)
	);

	CREATE TABLE images (
		id         TEXT PRIMARY KEY,
		chat_id    TEXT REFERENCES chats(id) ON DELETE SET NULL,
		message_id TEXT,
		file       TEXT NOT NULL,
		mime       TEXT NOT NULL,
		width      INTEGER,
		height     INTEGER,
		prompt     TEXT,
		seed       INTEGER,
		workflow   TEXT,
		created_at INTEGER NOT NULL,
		meta       TEXT
	);
	CREATE INDEX images_chat ON images(chat_id, created_at);

	CREATE VIRTUAL TABLE messages_fts USING fts5(content, message_id UNINDEXED, chat_id UNINDEXED);

	CREATE TABLE providers (
		id     TEXT PRIMARY KEY,
		config TEXT NOT NULL
	);

	CREATE TABLE app_meta (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	`,
	// v2 — character cards (Phase 4a) and the chat → character link.
	`
	CREATE TABLE characters (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		spec       TEXT NOT NULL DEFAULT 'unknown',
		json       TEXT NOT NULL,
		avatar     TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX characters_name ON characters(name);

	ALTER TABLE chats ADD COLUMN character_id TEXT REFERENCES characters(id) ON DELETE SET NULL;
	`
];
