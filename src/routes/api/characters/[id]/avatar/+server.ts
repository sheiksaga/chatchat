/**
 * `GET /api/characters/<id>/avatar` — the card picture (or 404, so the UI falls back to initials).
 *
 * Cards are immutable per id (the file name is replaced on re-import), so the response is cacheable
 * for a long time; that is what keeps the library page snappy on a phone.
 */
import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CARDS_DIR } from '$lib/server/config.js';
import { db } from '$lib/server/db/index.js';
import { getCharacter } from '$lib/server/db/characters.js';

const TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp'
};

export function GET({ params }) {
	const character = getCharacter(db(), params.id);
	if (!character?.avatar) error(404, 'No avatar');

	const file = path.join(CARDS_DIR, path.basename(character.avatar));
	if (!existsSync(file)) error(404, 'Avatar file missing');

	const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
	const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
	return new Response(stream, {
		headers: {
			'content-type': type,
			'content-length': String(statSync(file).size),
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
}
