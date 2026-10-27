/**
 * Repository tests. These run on `:memory:` — no GPU, no files, no network.
 * `npm run verify` includes them, which is the whole point: an agent can change the data layer
 * and know within a second whether it broke anything.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { openDb, schemaVersion, type Db } from './index.js';
import {
	appendMessage,
	createChat,
	deleteChat,
	deleteMessage,
	getChat,
	listChats,
	listGenerations,
	listMessages,
	renameChat,
	saveGeneration,
	searchMessages,
	setChatStory,
	updateMessageContent
} from './chats.js';
import { getImage, insertImage, listImages } from './images.js';

let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
});

describe('schema', () => {
	it('migrates to the latest version', () => {
		// Bump this whenever a migration is appended: it is the canary for "the file and the code
		// disagree", which is exactly the bug an append-only rule is meant to make impossible.
		expect(schemaVersion(db)).toBe(2);
	});

	it('is idempotent when opened twice', () => {
		expect(() => openDb(':memory:')).not.toThrow();
	});
});

describe('chats', () => {
	it('creates, renames, lists and deletes', () => {
		const chat = createChat(db, { title: '  Lighthouse  ' });
		expect(chat.title).toBe('Lighthouse');
		expect(listChats(db)).toHaveLength(1);

		renameChat(db, chat.id, 'Harbour');
		expect(getChat(db, chat.id)?.title).toBe('Harbour');

		deleteChat(db, chat.id);
		expect(listChats(db)).toHaveLength(0);
	});

	it('stores the story record as JSON', () => {
		const chat = createChat(db, { story: { seed: 1, cast: ['maya'] } });
		expect(JSON.parse(getChat(db, chat.id)!.story!)).toEqual({ seed: 1, cast: ['maya'] });

		setChatStory(db, chat.id, null);
		expect(getChat(db, chat.id)!.story).toBeNull();
	});
});

describe('messages', () => {
	it('appends in order and bumps the chat timestamp', () => {
		const chat = createChat(db);
		const before = getChat(db, chat.id)!.updated_at;

		const first = appendMessage(db, { chatId: chat.id, role: 'user', content: 'hello' });
		const second = appendMessage(db, { chatId: chat.id, role: 'assistant', content: 'hi there' });

		expect([first.seq, second.seq]).toEqual([1, 2]);
		expect(listMessages(db, chat.id).map((m) => m.content)).toEqual(['hello', 'hi there']);
		expect(getChat(db, chat.id)!.updated_at).toBeGreaterThanOrEqual(before);
	});

	it('cascades deletes from the chat', () => {
		const chat = createChat(db);
		appendMessage(db, { chatId: chat.id, role: 'user', content: 'x' });
		deleteChat(db, chat.id);
		expect(listMessages(db, chat.id)).toHaveLength(0);
	});

	it('keeps the FTS index in step with edits and deletes', () => {
		const chat = createChat(db);
		const message = appendMessage(db, {
			chatId: chat.id,
			role: 'user',
			content: 'the lighthouse keeper'
		});

		expect(searchMessages(db, 'lighthouse')).toHaveLength(1);
		expect(searchMessages(db, 'lighthouse')[0].snippet).toContain('[lighthouse]');

		updateMessageContent(db, message.id, 'the harbour master');
		expect(searchMessages(db, 'lighthouse')).toHaveLength(0);
		expect(searchMessages(db, 'harbour')).toHaveLength(1);

		deleteMessage(db, message.id);
		expect(searchMessages(db, 'harbour')).toHaveLength(0);
	});
});

describe('generations', () => {
	it('upserts alternate replies per message', () => {
		const chat = createChat(db);
		const message = appendMessage(db, { chatId: chat.id, role: 'assistant', content: 'first' });

		saveGeneration(db, message.id, 0, 'first');
		saveGeneration(db, message.id, 1, 'second');
		saveGeneration(db, message.id, 1, 'second (edited)');

		expect(listGenerations(db, message.id)).toEqual([
			{ idx: 0, content: 'first' },
			{ idx: 1, content: 'second (edited)' }
		]);
	});
});

describe('images', () => {
	it('indexes image rows by chat', () => {
		const chat = createChat(db);
		const image = insertImage(db, {
			chatId: chat.id,
			file: 'abc.png',
			mime: 'image/png',
			width: 768,
			height: 768,
			prompt: 'a lighthouse',
			seed: 42,
			workflow: 'krea2-t2i'
		});

		expect(getImage(db, image.id)?.file).toBe('abc.png');
		expect(listImages(db, chat.id)).toHaveLength(1);
	});
});

describe('full-text search', () => {
	it('finds a message and returns a snippet with the match marked', () => {
		const chat = createChat(db, { title: 'With a lighthouse' });
		appendMessage(db, {
			chatId: chat.id,
			role: 'user',
			content: 'The lighthouse keeper climbed the stairs at dawn.'
		});

		const hits = searchMessages(db, '"lighthouse"');
		expect(hits).toHaveLength(1);
		expect(hits[0].chat_id).toBe(chat.id);
		expect(hits[0].snippet).toContain('[lighthouse]');
	});

	it('keeps the index in step when a message is edited or deleted', async () => {
		const chat = createChat(db, { title: 'Edits' });
		const row = appendMessage(db, { chatId: chat.id, role: 'user', content: 'original word' });

		expect(searchMessages(db, '"original"')).toHaveLength(1);
		updateMessageContent(db, row.id, 'replacement word');
		expect(searchMessages(db, '"original"')).toHaveLength(0);
		expect(searchMessages(db, '"replacement"')).toHaveLength(1);

		deleteMessage(db, row.id);
		expect(searchMessages(db, '"replacement"')).toHaveLength(0);
	});
});
