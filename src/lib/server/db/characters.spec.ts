/** Character storage tests: upsert semantics, the avatar rule, and the chat link. */
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, openDb } from './index.js';
import {
	createCharacter,
	deleteCharacter,
	getCharacter,
	getChatCharacter,
	listCharacters,
	setChatCharacter,
	updateCharacter,
	upsertCharacter
} from './characters.js';
import { createChat } from './chats.js';
import { normalizeCardJson } from '../cards/parse.js';

const CARD = normalizeCardJson({
	spec: 'chara_card_v2',
	data: {
		name: 'Jess',
		description: '{{char}} is {{user}}’s wife.',
		first_mes: 'Morning.',
		alternate_greetings: ['Evening.'],
		tags: ['slice-of-life']
	}
});

let db = openDb(':memory:');

afterEach(() => {
	closeDb();
	db = openDb(':memory:');
});

describe('characters repo', () => {
	it('stores and reads a card back unchanged', () => {
		upsertCharacter(db, CARD);
		const read = getCharacter(db, CARD.id)!;
		expect(read).toMatchObject({
			name: 'Jess',
			description: '{{char}} is {{user}}’s wife.',
			firstMessage: 'Morning.',
			alternateGreetings: ['Evening.'],
			tags: ['slice-of-life']
		});
	});

	it('updates in place instead of duplicating', () => {
		upsertCharacter(db, CARD);
		upsertCharacter(db, { ...CARD, description: 'edited' });
		expect(listCharacters(db)).toHaveLength(1);
		expect(getCharacter(db, CARD.id)?.description).toBe('edited');
	});

	it('keeps an existing avatar when an import has none', () => {
		upsertCharacter(db, CARD, { avatar: 'card_x.png' });
		upsertCharacter(db, { ...CARD, name: 'Jess' }); // no avatar option
		expect(getCharacter(db, CARD.id)?.avatar).toBe('card_x.png');
	});

	it('lists cards alphabetically, case-insensitively', () => {
		upsertCharacter(db, { ...CARD, id: 'b', name: 'zeta' });
		upsertCharacter(db, { ...CARD, id: 'a', name: 'Alpha' });
		expect(listCharacters(db).map((c) => c.name)).toEqual(['Alpha', 'zeta']);
	});

	it('creates a blank card with a usable name', () => {
		const card = createCharacter(db);
		expect(card.name).toBe('New character');
		expect(card.id).toMatch(/^card_/);
	});

	it('applies a partial edit and keeps the id', () => {
		upsertCharacter(db, CARD);
		const updated = updateCharacter(db, CARD.id, { scenario: 'A kitchen, 7am' });
		expect(updated.id).toBe(CARD.id);
		expect(updated.scenario).toBe('A kitchen, 7am');
		expect(updated.name).toBe('Jess');
	});

	it('deletes a card and clears the chat link', () => {
		upsertCharacter(db, CARD);
		const chat = createChat(db, { title: 'with a character' });
		setChatCharacter(db, chat.id, CARD.id);
		expect(getChatCharacter(db, chat.id)?.name).toBe('Jess');

		deleteCharacter(db, CARD.id);
		expect(getCharacter(db, CARD.id)).toBeUndefined();
		expect(getChatCharacter(db, chat.id)).toBeUndefined();
	});

	it('survives a card whose JSON is from an older schema version', () => {
		// Simulate a row written before `book` existed by storing minimal JSON.
		db.prepare(
			`INSERT INTO characters (id, name, spec, json, avatar, created_at, updated_at)
			 VALUES ('old', 'Old', 'chara_card_v1', '{"name":"Old"}', NULL, 0, 0)`
		).run();
		expect(getCharacter(db, 'old')).toMatchObject({
			name: 'Old',
			description: '',
			alternateGreetings: [],
			book: null
		});
	});
});
