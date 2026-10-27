#!/usr/bin/env node
/**
 * `npm run import:cards` — one-way import of the old app's card library.
 *
 * Reads `<legacy>/cards/cards.js` (the generated manifest) and copies each avatar into
 * `data/cards/`. Idempotent: card ids hash name+description, so re-running updates in place.
 *
 * Env: `CHATCHAT_LEGACY_DIR` (default `./legacy`), `CHATCHAT_DATA_DIR` (default `./data`).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/lib/server/db/index.js';
import { upsertCharacter } from '../src/lib/server/db/characters.js';
import { parseCardsManifest } from '../src/lib/server/cards/parse.js';
import { CARDS_DIR, DATA_DIR } from '../src/lib/server/config.js';

const legacyDir = process.env.CHATCHAT_LEGACY_DIR ?? path.join(process.cwd(), 'legacy');
const manifestPath = path.join(legacyDir, 'cards', 'cards.js');

if (!existsSync(manifestPath)) {
	console.error(`No card manifest at ${manifestPath}`);
	console.error('Set CHATCHAT_LEGACY_DIR to the folder that contains cards/cards.js.');
	process.exitCode = 1;
} else {
	const cards = parseCardsManifest(readFileSync(manifestPath, 'utf8'));
	const db = openDb();
	mkdirSync(CARDS_DIR, { recursive: true });

	let avatars = 0;
	for (const card of cards) {
		// The manifest stores `avatar` as `cards/avatars/<file>.png` relative to the legacy root;
		// the rewrite stores one file per card id inside `data/cards/`.
		const hint = card.avatar;
		const source = hint ? path.join(legacyDir, hint) : null;
		let avatar: string | null = null;
		if (source && existsSync(source)) {
			avatar = `${card.id}${path.extname(source) || '.png'}`;
			copyFileSync(source, path.join(CARDS_DIR, avatar));
			avatars += 1;
		} else if (source) {
			console.warn(`  missing avatar for ${card.name}: ${source}`);
		}
		upsertCharacter(db, { ...card, avatar }, { avatar });
	}

	db.close();
	console.log(`Imported ${cards.length} cards (${avatars} avatars) into ${DATA_DIR}`);
}
