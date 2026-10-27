/**
 * One card: read, patch (card editor), delete.
 *
 * Deleting a card nulls the `character_id` of any chat that used it (foreign key ON DELETE SET
 * NULL), because losing the character must not lose the transcript.
 */
import { error, json } from '@sveltejs/kit';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { CARDS_DIR } from '$lib/server/config.js';
import { db } from '$lib/server/db/index.js';
import { deleteCharacter, getCharacter, updateCharacter } from '$lib/server/db/characters.js';
import { characterInputSchema } from '$lib/shared/character.js';

export function GET({ params }) {
	const character = getCharacter(db(), params.id);
	if (!character) error(404, 'Character not found');
	return json({ character });
}

export async function PATCH({ params, request }) {
	if (!getCharacter(db(), params.id)) error(404, 'Character not found');

	const parsed = characterInputSchema.safeParse(await request.json());
	if (!parsed.success) {
		error(
			400,
			`Invalid card: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
		);
	}
	return json({ character: updateCharacter(db(), params.id, parsed.data) });
}

export function DELETE({ params }) {
	const character = getCharacter(db(), params.id);
	if (!character) error(404, 'Character not found');

	deleteCharacter(db(), params.id);
	if (character.avatar) {
		// Best effort: the row is gone either way, and a leftover file is a cosmetic problem.
		try {
			rmSync(path.join(CARDS_DIR, character.avatar), { force: true });
		} catch {
			/* ignore */
		}
	}
	return json({ id: params.id, deleted: true });
}
