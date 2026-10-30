import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { getCharacter, listCharacters } from '../db/characters.js';
import { SHIPPED_CHARACTERS, ensureShippedCharacters } from './shipped.js';

/** A real database in memory — the same migrations and pragmas as `data/chatchat.db`. */
function scratchDb(): Db {
	return openDb(':memory:');
}

describe('ensureShippedCharacters', () => {
	it('gives a brand-new install exactly one card', () => {
		const db = scratchDb();
		expect(listCharacters(db)).toHaveLength(0);

		ensureShippedCharacters(db);

		const cards = listCharacters(db);
		expect(cards.map((card) => card.name)).toEqual(['Storyboard']);
	});

	it('marks the card as an image utility, which is what makes markers draw themselves', () => {
		const db = scratchDb();
		ensureShippedCharacters(db);

		const card = getCharacter(db, SHIPPED_CHARACTERS[0].id);
		expect(card?.tags).toContain('image-generation');
		// The scene prompt builder prefixes `appearance` to every "of this moment" picture, and a utility
		// card that carried leftover body text put that text inside generated prompts.
		expect(card?.appearance).toBe('');
		// The card has to teach the vocabulary the parser actually accepts.
		expect(card?.description).toContain('PORTRAIT, SQUARE, LANDSCAPE, CINEMA');
		expect(card?.description).toContain('LOCK');
	});

	it('does nothing when the library already has cards', () => {
		// A user who deleted Storyboard, or who imported their own cards, must not have it reappear.
		const db = scratchDb();
		db.prepare(
			`INSERT INTO characters (id, name, spec, json, avatar, created_at, updated_at)
			 VALUES ('card_mine', 'Mine', 'chara_card_v2', '{"name":"Mine"}', NULL, 0, 0)`
		).run();

		ensureShippedCharacters(db);

		expect(listCharacters(db).map((card) => card.name)).toEqual(['Mine']);
	});

	it('is idempotent, so two starts cannot make two Storyboard cards', () => {
		const db = scratchDb();
		ensureShippedCharacters(db);
		ensureShippedCharacters(db);

		expect(listCharacters(db)).toHaveLength(1);
	});
});
