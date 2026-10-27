/**
 * The `data/` layout: one folder per chat, a readable mirror of each chat, and the one-way move of
 * pictures that older versions wrote flat into `data/images/`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The layout module reads DATA_DIR at import time, so point it at a scratch folder first.
const dataDir = mkdtempSync(path.join(tmpdir(), 'chatchat-layout-'));
process.env.CHATCHAT_DATA_DIR = dataDir;

const { openDb, closeDb } = await import('./index.js');
const { appendMessage, createChat, renameChat, setChatStory } = await import('./chats.js');
const { insertImage, getImage } = await import('./images.js');
const { mirrorChat, removeChatDir, relocateImages, imageDirFor } = await import('./layout.js');
const { writeImageFile, readImageFile } = await import('../images/store.js');
const { upsertCharacter } = await import('./characters.js');

let db: Awaited<ReturnType<typeof openDb>>;

beforeAll(() => {
	mkdirSync(path.join(dataDir, 'images'), { recursive: true });
	db = openDb(path.join(dataDir, 'test.db'));
});

afterAll(() => {
	db.close();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe('mirrorChat', () => {
	it('writes chat.json and story.json next to the chat', () => {
		const chat = createChat(db, { title: 'A tower' });
		setChatStory(db, chat.id, { look: 'a cliff at dusk' });
		appendMessage(db, { chatId: chat.id, role: 'user', content: 'Hello there' });
		appendMessage(db, { chatId: chat.id, role: 'assistant', content: 'Well met.' });

		mirrorChat(db, chat.id);

		const chatFile = path.join(dataDir, 'chats', chat.id, 'chat.json');
		const storyFile = path.join(dataDir, 'chats', chat.id, 'story.json');
		expect(existsSync(chatFile)).toBe(true);
		expect(existsSync(storyFile)).toBe(true);

		const mirror = JSON.parse(readFileSync(chatFile, 'utf8')) as {
			title: string;
			messageCount: number;
			messages: Array<{ role: string; content: string }>;
			images: unknown[];
		};
		expect(mirror.title).toBe('A tower');
		expect(mirror.messageCount).toBe(2);
		expect(mirror.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
		expect(JSON.parse(readFileSync(storyFile, 'utf8'))).toEqual({ look: 'a cliff at dusk' });
	});

	it('lists the chat pictures, so a folder tells the whole story', () => {
		const chat = createChat(db, { title: 'Pictures' });
		const file = writeImageFile('img-1', Buffer.from('not really a png'), 'image/png', chat.id);
		insertImage(db, { id: 'img-1', chatId: chat.id, file, mime: 'image/png', prompt: 'a tower' });

		mirrorChat(db, chat.id);

		const mirror = JSON.parse(
			readFileSync(path.join(dataDir, 'chats', chat.id, 'chat.json'), 'utf8')
		) as { images: Array<{ id: string; file: string; prompt: string }> };
		expect(mirror.images).toHaveLength(1);
		expect(mirror.images[0]).toMatchObject({ id: 'img-1', prompt: 'a tower' });
		expect(mirror.images[0].file).toBe(`chats/${chat.id}/images/img-1.png`);
	});

	it('records the character a chat is played with', () => {
		const character = upsertCharacter(db, {
			id: 'card_mira',
			name: 'Mira',
			description: 'A ranger.',
			appearance: 'green cloak',
			personality: 'quiet',
			scenario: '',
			firstMessage: 'Hello.',
			exampleDialogue: '',
			systemPrompt: '',
			postHistoryInstructions: '',
			creatorNotes: '',
			tags: [],
			alternateGreetings: [],
			book: null,
			spec: 'chara_card_v3',
			avatar: null,
			createdAt: 0,
			updatedAt: 0
		} as unknown as Parameters<typeof upsertCharacter>[1]);
		const chat = createChat(db, { title: 'With Mira' });
		db.prepare('UPDATE chats SET character_id = ? WHERE id = ?').run(character.id, chat.id);

		mirrorChat(db, chat.id);

		const mirror = JSON.parse(
			readFileSync(path.join(dataDir, 'chats', chat.id, 'chat.json'), 'utf8')
		) as { character: { id: string; name: string } | null };
		expect(mirror.character).toEqual({ id: character.id, name: 'Mira' });
	});

	it('mirrors a rename, so the file never drifts from the app', () => {
		const chat = createChat(db, { title: 'Before' });
		mirrorChat(db, chat.id);
		renameChat(db, chat.id, 'After');
		mirrorChat(db, chat.id);

		const mirror = JSON.parse(
			readFileSync(path.join(dataDir, 'chats', chat.id, 'chat.json'), 'utf8')
		) as { title: string };
		expect(mirror.title).toBe('After');
	});
});

describe('removeChatDir', () => {
	it('removes the folder and everything in it', () => {
		const chat = createChat(db, { title: 'Doomed' });
		mirrorChat(db, chat.id);
		expect(existsSync(path.join(dataDir, 'chats', chat.id))).toBe(true);

		removeChatDir(chat.id);
		expect(existsSync(path.join(dataDir, 'chats', chat.id))).toBe(false);
	});
});

describe('relocateImages', () => {
	it('moves flat pictures into their chat folder and rewrites the row', () => {
		const chat = createChat(db, { title: 'Legacy picture' });
		// Simulate the old layout: bytes in data/images/<id>.png, `file` without a directory.
		writeFileSync(path.join(dataDir, 'images', 'old-1.png'), 'bytes');
		insertImage(db, { id: 'old-1', chatId: chat.id, file: 'old-1.png', mime: 'image/png' });

		const report = relocateImages(db);

		expect(report.moved).toBeGreaterThanOrEqual(1);
		const row = getImage(db, 'old-1');
		expect(row?.file).toBe(`chats/${chat.id}/images/old-1.png`);
		expect(existsSync(path.join(dataDir, 'chats', chat.id, 'images', 'old-1.png'))).toBe(true);
		expect(readImageFile(row!.file).toString()).toBe('bytes');
	});

	it('is idempotent: a second run moves nothing', () => {
		const before = relocateImages(db).moved;
		expect(before).toBe(0);
	});

	it('keeps chat-less pictures in data/images', () => {
		writeFileSync(path.join(dataDir, 'images', 'orphan.png'), 'bytes');
		insertImage(db, { id: 'orphan', chatId: null, file: 'orphan.png', mime: 'image/png' });

		relocateImages(db);

		expect(getImage(db, 'orphan')?.file).toBe('images/orphan.png');
	});

	it('names the right folder for chat and non-chat pictures', () => {
		expect(imageDirFor('chat-1')).toBe('chats/chat-1/images');
		expect(imageDirFor(null)).toBe('images');
	});
});
