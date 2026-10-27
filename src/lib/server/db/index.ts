/**
 * SQLite connection + migrations.
 *
 * `node:sqlite` (built into Node ≥22.5, stable enough for this app) means no native module,
 * no prebuilt-binary download, and therefore no build toolchain on a machine that just wants to
 * run the app. It is still flagged "experimental" upstream, so **every** database access goes
 * through this module and the repositories next to it — swapping in `better-sqlite3` would touch
 * these files only.
 */
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { MIGRATIONS } from './migrations.js';
// `layout.ts` imports only *types* from this module, so this stays a one-way dependency even though
// the graph looks circular; the helpers themselves are hoisted function declarations.
import { mirrorAllChats, pruneMissingImages, relocateImages } from './layout.js';

export type Db = DatabaseSync;

/**
 * `node:sqlite` types rows as `Record<string, SQLOutputValue>`, so every read needs one cast.
 * These two helpers keep that cast in a single place instead of scattering `as unknown as T[]`.
 */
export function allRows<T>(statement: StatementSync, ...params: SQLInputValue[]): T[] {
	return statement.all(...params) as unknown as T[];
}

export function oneRow<T>(statement: StatementSync, ...params: SQLInputValue[]): T | undefined {
	return statement.get(...params) as unknown as T | undefined;
}

let instance: Db | undefined;

function applyMigrations(db: Db) {
	const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
	let version = row?.user_version ?? 0;

	for (let next = version; next < MIGRATIONS.length; next += 1) {
		db.exec('BEGIN');
		try {
			db.exec(MIGRATIONS[next]);
			// PRAGMA does not accept bound parameters; `next + 1` is a loop counter, not user input.
			db.exec(`PRAGMA user_version = ${next + 1}`);
			db.exec('COMMIT');
			version = next + 1;
		} catch (error) {
			db.exec('ROLLBACK');
			throw new Error(`Migration ${next + 1} failed: ${(error as Error).message}`, {
				cause: error
			});
		}
	}

	return version;
}

/**
 * Open (and migrate) a database file. Pass `:memory:` in tests.
 * WAL keeps readers from blocking the writer, which matters once a phone has the app open
 * while the desktop streams a reply.
 */
export function openDb(file: string = path.join(DATA_DIR, 'chatchat.db')): Db {
	if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec('PRAGMA busy_timeout = 5000');
	applyMigrations(db);

	// Migrate older layouts once: move flat pictures next to their chat, then rewrite every mirror.
	if (file !== ':memory:') {
		relocateImages(db);
		pruneMissingImages(db);
		mirrorAllChats(db);
	}

	return db;
}

/** Process-wide connection, opened on first use. */
export function db(): Db {
	instance ??= openDb();
	return instance;
}

/**
 * Tests only: install a specific connection (usually `:memory:`) as the process-wide one, so route
 * handlers can be exercised without touching `data/chatchat.db`.
 */
export function setDbForTests(database: Db): void {
	instance = database;
}

/** Test helper: drop the cached connection. */
export function closeDb() {
	instance?.close();
	instance = undefined;
}

export function schemaVersion(database: Db): number {
	const row = database.prepare('PRAGMA user_version').get() as { user_version: number };
	return row?.user_version ?? 0;
}
