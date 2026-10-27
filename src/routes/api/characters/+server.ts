/**
 * `GET  /api/characters` — the card library.
 * `POST /api/characters` — two bodies are accepted:
 *   - `multipart/form-data` with `file` = a card PNG/JPEG/JSON (what "Import card" sends),
 *   - `application/json` with `{ name? }` or full card fields (what "New character" sends).
 *
 * The avatar image is stored as `data/cards/<id>.png`; the card row keeps only the file name.
 */
import { json, error } from '@sveltejs/kit';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CARDS_DIR } from '$lib/server/config.js';
import { db } from '$lib/server/db/index.js';
import { createCharacter, listCharacters, upsertCharacter } from '$lib/server/db/characters.js';
import { normalizeCardJson, parseCardFile } from '$lib/server/cards/parse.js';
import { characterInputSchema } from '$lib/shared/character.js';

export function GET() {
	return json({ characters: listCharacters(db()) });
}

export async function POST({ request }) {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File)) error(400, 'a card file is required');

		const bytes = new Uint8Array(await file.arrayBuffer());
		let card;
		try {
			card = await parseCardFile(bytes);
		} catch (cause) {
			error(400, `not a character card: ${cause instanceof Error ? cause.message : String(cause)}`);
		}

		// Only images carry their own avatar; a JSON card keeps whatever picture it already had.
		let avatar: string | null = null;
		if (/image\/(png|jpeg|webp)/.test(file.type)) {
			mkdirSync(CARDS_DIR, { recursive: true });
			avatar = `${card.id}.png`;
			writeFileSync(path.join(CARDS_DIR, avatar), bytes);
		}

		return json({ character: upsertCharacter(db(), card, { avatar }) });
	}

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const character =
		'name' in body && !('description' in body) && Object.keys(body).length <= 1
			? createCharacter(db(), characterInputSchema.parse(body))
			: upsertCharacter(db(), normalizeCardJson(body));

	return json({ character });
}
