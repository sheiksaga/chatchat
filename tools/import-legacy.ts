#!/usr/bin/env node
/**
 * CLI wrapper around `src/lib/server/db/import-legacy.ts`.
 *
 *   npm run import:legacy                 # reads legacy/chats
 *   npm run import:legacy -- --from /path/to/chats --to data/chatchat.db
 *
 * Run with `tsx` (dev dependency) so this file can import the TypeScript repository modules
 * without a build step. It writes only to the new database and `data/images/`.
 */
import path from 'node:path';
import { openDb } from '../src/lib/server/db/index.js';
import { importLegacy } from '../src/lib/server/db/import-legacy.js';

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const from = arg('from', path.join(process.cwd(), 'legacy', 'chats'));
const to = arg('to', path.join(process.cwd(), 'data', 'chatchat.db'));

console.log(`importing legacy chats\n  from: ${from}\n  to:   ${to}`);

const db = openDb(to);

try {
	const report = await importLegacy(db, { from });
	console.log(
		`\nimported ${report.chats} chats, ${report.messages} messages, ` +
			`${report.generations} generations, ${report.images} images`
	);
	for (const warning of report.warnings) console.warn(`  warning: ${warning}`);
	for (const skip of report.skipped) console.log(`  skipped: ${skip}`);
	if (report.chats === 0 && report.images === 0) {
		console.log('\nnothing to import — the legacy folder had no chats.');
	}
} catch (error) {
	console.error(`\nimport failed: ${(error as Error).message}`);
	process.exitCode = 1;
} finally {
	db.close();
}
