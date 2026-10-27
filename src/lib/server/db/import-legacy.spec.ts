/**
 * Importer test against a synthetic legacy folder — the real one on this machine is empty,
 * so this fixture *is* the specification of the old format.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './index.js';
import { listChats, listGenerations, listMessages, searchMessages } from './chats.js';
import { listImages } from './images.js';
import { importLegacy } from './import-legacy.js';

let db: Db;
let root: string;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function fixture() {
	root = await mkdtemp(path.join(tmpdir(), 'chatchat-legacy-'));
	const write = async (relative: string, value: unknown) => {
		const file = path.join(root, relative);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(
			file,
			typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)
		);
	};

	await write('index.json', {
		order: ['chatA', 'chatB', 'chatMissing'],
		meta: { chatA: { title: 'Harbour lights', avatar: 'a.png' } }
	});

	await write('chatA/chat.json', {
		messages: [
			{ role: 'user', content: 'the lighthouse at dusk' },
			{ role: 'assistant', content: 'the beam sweeps the harbour' }
		],
		generations: { 1: ['the beam sweeps', 'the lamp turns'] }
	});
	await write('chatA/story.json', { seed: 7, cast: ['maya'] });

	await write('chatB/chat.json', {
		messages: [
			{ role: 'system', content: 'you are a narrator' },
			{ role: 'wizard', content: 'roles outside the enum are coerced' }
		]
	});

	await write('images/img1.bin', PNG);
	await write('images/img1.json', {
		mime: 'image/png',
		chatId: 'chatA',
		seed: 7,
		prompt: 'lighthouse'
	});
	await write('images/orphan.bin', PNG);
	await write('images/orphan.json', { chatId: 'nope' });
}

beforeEach(async () => {
	db = openDb(':memory:');
	await fixture();
});

describe('legacy import', () => {
	it('imports chats, messages, generations, stories and images', async () => {
		const report = await importLegacy(db, { from: root, imagesDir: path.join(root, 'out-images') });

		expect(report.chats).toBe(2);
		expect(report.messages).toBe(4);
		expect(report.generations).toBe(2);
		expect(report.images).toBe(2);
		expect(report.skipped.join(' ')).toContain('chatMissing');

		const chats = listChats(db);
		expect(chats).toHaveLength(2);
		expect(chats.find((c) => c.id === 'chatA')?.title).toBe('Harbour lights');
		// No meta title: falls back to the first message with text.
		expect(chats.find((c) => c.id === 'chatB')?.title).toBe('you are a narrator');

		const messages = listMessages(db, 'chatA');
		expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(listGenerations(db, messages[1].id)).toEqual([
			{ idx: 0, content: 'the beam sweeps' },
			{ idx: 1, content: 'the lamp turns' }
		]);
	});

	it('coerces unknown roles instead of dropping messages', async () => {
		const report = await importLegacy(db, { from: root, imagesDir: path.join(root, 'out-images') });
		expect(report.warnings.join(' ')).toContain('unknown role "wizard"');
		expect(listMessages(db, 'chatB').map((m) => m.role)).toEqual(['system', 'user']);
	});

	it('indexes imported text for search', async () => {
		await importLegacy(db, { from: root, imagesDir: path.join(root, 'out-images') });
		expect(searchMessages(db, 'lighthouse')).toHaveLength(1);
		expect(searchMessages(db, 'harbour')).toHaveLength(1);
	});

	it('detaches images whose chat is missing and keeps the bytes', async () => {
		const imagesDir = path.join(root, 'out-images');
		await importLegacy(db, { from: root, imagesDir });
		const images = listImages(db, 'chatA');
		expect(images).toHaveLength(1);
		expect(images[0].seed).toBe(7);

		const { readdir } = await import('node:fs/promises');
		expect(await readdir(imagesDir)).toEqual(['img1.png', 'orphan.png']);
	});

	it('is idempotent', async () => {
		await importLegacy(db, { from: root, imagesDir: path.join(root, 'out-images') });
		const second = await importLegacy(db, { from: root, imagesDir: path.join(root, 'out-images') });
		expect(second.chats).toBe(0);
		expect(second.skipped.join(' ')).toContain('already imported');
		expect(listChats(db)).toHaveLength(2);
	});

	it('explains itself when the folder is missing', async () => {
		await expect(importLegacy(db, { from: path.join(root, 'nope') })).rejects.toThrow(
			/Legacy chats folder not found/
		);
	});
});
