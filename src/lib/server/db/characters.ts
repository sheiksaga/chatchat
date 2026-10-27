/**
 * Character card storage.
 *
 * The card itself lives in the `json` column as the normalised `Character` shape; only `name`,
 * `spec` and `avatar` are mirrored into columns, because those are what lists and joins need.
 * Avatars are files in `data/cards/` (a card PNG is ~1 MB — bad for a row, fine for a file).
 */
import { randomUUID } from 'node:crypto';
import type { Character, CharacterInput } from '$lib/shared/character.js';
import { characterSchema } from '$lib/shared/character.js';
import { allRows, oneRow, type Db } from './index.js';

export interface CharacterRow {
	id: string;
	name: string;
	spec: string;
	json: string;
	avatar: string | null;
	created_at: number;
	updated_at: number;
}

function now(): number {
	return Date.now();
}

function toCharacter(row: CharacterRow): Character {
	return characterSchema.parse({
		...(JSON.parse(row.json) as Record<string, unknown>),
		id: row.id,
		name: row.name,
		spec: row.spec,
		avatar: row.avatar
	});
}

/**
 * Insert or update a card. `avatar` is only changed when provided, so importing a card without a
 * picture never wipes one that was set later.
 */
export function upsertCharacter(
	db: Db,
	input: Character,
	options: { avatar?: string | null } = {}
): Character {
	const at = now();
	const existing = oneRow<{ avatar: string | null; created_at: number }>(
		db.prepare('SELECT avatar, created_at FROM characters WHERE id = ?'),
		input.id
	);

	const avatar = options.avatar !== undefined ? options.avatar : (existing?.avatar ?? null);
	const stored = characterSchema.parse({ ...input, avatar });

	db.prepare(
		`INSERT INTO characters (id, name, spec, json, avatar, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			spec = excluded.spec,
			json = excluded.json,
			avatar = excluded.avatar,
			updated_at = excluded.updated_at`
	).run(
		stored.id,
		stored.name,
		stored.spec,
		JSON.stringify(stored),
		stored.avatar,
		existing?.created_at ?? at,
		at
	);

	return stored;
}

export function listCharacters(db: Db): Character[] {
	return allRows<CharacterRow>(
		db.prepare('SELECT * FROM characters ORDER BY name COLLATE NOCASE ASC')
	).map(toCharacter);
}

export function getCharacter(db: Db, id: string): Character | undefined {
	const row = oneRow<CharacterRow>(db.prepare('SELECT * FROM characters WHERE id = ?'), id);
	return row ? toCharacter(row) : undefined;
}

/** Apply a partial edit from the card editor. Name is required, everything else is optional. */
export function updateCharacter(db: Db, id: string, patch: CharacterInput): Character {
	const current = getCharacter(db, id);
	if (!current) throw new Error(`character not found: ${id}`);
	return upsertCharacter(db, characterSchema.parse({ ...current, ...patch, id }));
}

export function deleteCharacter(db: Db, id: string): void {
	db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

/** Create a blank card, so "New character" needs no special-casing in the UI. */
export function createCharacter(db: Db, input: Partial<CharacterInput> = {}): Character {
	const character = characterSchema.parse({
		id: `card_${randomUUID().slice(0, 8)}`,
		name: input.name?.trim() || 'New character',
		spec: 'unknown',
		...input
	});
	return upsertCharacter(db, character);
}

/** Card attached to a chat, if any. */
export function getChatCharacter(db: Db, chatId: string): Character | undefined {
	const row = oneRow<{ character_id: string | null }>(
		db.prepare('SELECT character_id FROM chats WHERE id = ?'),
		chatId
	);
	return row?.character_id ? getCharacter(db, row.character_id) : undefined;
}

export function setChatCharacter(db: Db, chatId: string, characterId: string | null): void {
	db.prepare('UPDATE chats SET character_id = ?, updated_at = ? WHERE id = ?').run(
		characterId,
		now(),
		chatId
	);
}
