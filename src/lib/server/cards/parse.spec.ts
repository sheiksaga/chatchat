/**
 * Card parsing tests. Fixtures cover the three specs plus this repo's old flattened manifest,
 * because all four shapes exist on this machine and each one broke a different parser in the past.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	cardId,
	normalizeBook,
	normalizeCardJson,
	parseCardFile,
	parseCardsManifest
} from './parse.js';

const V3_CARD = {
	spec: 'chara_card_v3',
	spec_version: '3.0',
	data: {
		name: 'Seraphina',
		description: 'A guardian of the Eldoria woods. {{char}} is calm.',
		personality: 'Kind, watchful',
		scenario: 'A glade at dusk',
		first_mes: 'Welcome, traveller.',
		mes_example: '<START>\n{{user}}: Hello\n{{char}}: Welcome.',
		system_prompt: 'Stay in character.',
		post_history_instructions: 'End with an action.',
		alternate_greetings: ['You again?', 'Turn back.'],
		tags: ['fantasy', 'guardian'],
		creator: 'someone',
		character_version: '1.2',
		creator_notes: 'Exported from SillyTavern',
		character_book: {
			name: 'Eldoria',
			token_budget: 512,
			extensions: { scan_depth: 4 },
			entries: [
				{
					keys: ['eldoria', 'forest'],
					secondary_keys: [],
					content: 'Eldoria is the whole wood.',
					enabled: true,
					insertion_order: 10,
					name: 'Lore'
				},
				{ keys: ['empty'], content: '   ', enabled: true }
			]
		}
	}
};

const V1_CARD = {
	name: 'Old Timer',
	description: 'A v1 card.',
	personality: 'gruff',
	scenario: '',
	first_mes: 'Hm.',
	mes_example: ''
};

const MANIFEST_CARD = {
	name: 'Storyboard',
	description: '',
	personality: '',
	scenario: '',
	firstMes: '',
	mesExample: '',
	systemPrompt: '',
	postHistoryInstructions: '',
	alternateGreetings: [],
	groupOnlyGreetings: [],
	tags: [],
	creator: '',
	characterVersion: '',
	creatorNotes: 'Automatically created character.',
	characterBook: null,
	spec: 'chara_card_v2',
	appearance: '',
	avatar: 'cards/avatars/card_abc.png'
};

describe('normalizeCardJson', () => {
	it('flattens a v3 card, including its lorebook', () => {
		const card = normalizeCardJson(V3_CARD);
		expect(card).toMatchObject({
			name: 'Seraphina',
			spec: 'chara_card_v3',
			firstMessage: 'Welcome, traveller.',
			exampleMessages: '<START>\n{{user}}: Hello\n{{char}}: Welcome.',
			systemPrompt: 'Stay in character.',
			postHistoryInstructions: 'End with an action.',
			alternateGreetings: ['You again?', 'Turn back.'],
			tags: ['fantasy', 'guardian'],
			creator: 'someone',
			characterVersion: '1.2'
		});
		expect(card.book?.entries).toHaveLength(1); // the empty entry is dropped
		expect(card.book?.entries[0]).toMatchObject({
			keys: ['eldoria', 'forest'],
			insertionOrder: 10
		});
		expect(card.book?.scanDepth).toBe(4);
	});

	it('reads a flat v1 card', () => {
		const card = normalizeCardJson(V1_CARD);
		expect(card).toMatchObject({
			name: 'Old Timer',
			spec: 'chara_card_v1',
			firstMessage: 'Hm.',
			personality: 'gruff'
		});
		expect(card.book).toBeNull();
	});

	it('reads the old flattened manifest shape (camelCase keys)', () => {
		const card = normalizeCardJson(MANIFEST_CARD);
		expect(card).toMatchObject({
			name: 'Storyboard',
			spec: 'chara_card_v2',
			creatorNotes: 'Automatically created character.'
		});
	});

	it('keeps the avatar hint from the old manifest without inventing one', () => {
		expect(normalizeCardJson(MANIFEST_CARD).avatar).toBe('cards/avatars/card_abc.png');
		expect(normalizeCardJson(V3_CARD).avatar).toBeNull();
	});

	it('keeps {{char}} and {{user}} placeholders untouched', () => {
		expect(normalizeCardJson(V3_CARD).description).toContain('{{char}}');
	});

	it('rejects a card without a name', () => {
		expect(() => normalizeCardJson({ description: 'nameless' })).toThrow(/no name/);
	});

	it('is idempotent: the same card always gets the same id', () => {
		expect(normalizeCardJson(V3_CARD).id).toBe(normalizeCardJson(V3_CARD).id);
		expect(cardId('a', 'b')).toBe(cardId('a', 'b'));
		expect(cardId('a', 'b')).not.toBe(cardId('a', 'c'));
	});
});

describe('normalizeBook', () => {
	it('accepts a bare array (the old app stored entries without the wrapper)', () => {
		expect(normalizeBook([{ keys: ['x'], content: 'y' }])?.entries).toHaveLength(1);
	});

	it('accepts an index-keyed object (v3 exports do this)', () => {
		const book = normalizeBook({ entries: { 0: { keys: ['x'], content: 'y' } } });
		expect(book?.entries[0].content).toBe('y');
	});

	it('returns null for no book, so "none" stays distinguishable from "empty"', () => {
		expect(normalizeBook(undefined)).toBeNull();
		expect(normalizeBook(null)).toBeNull();
	});
});

describe('parseCardsManifest', () => {
	it('strips the window assignment and comment', () => {
		const source = `/* generated */\nwindow.CHATCHAT_CARDS = ${JSON.stringify([MANIFEST_CARD])};\n`;
		expect(parseCardsManifest(source)).toHaveLength(1);
	});

	it('parses the real manifest on this machine when it is present', () => {
		const manifest = path.join(process.cwd(), 'legacy', 'cards', 'cards.js');
		let source: string;
		try {
			source = readFileSync(manifest, 'utf8');
		} catch {
			return; // the legacy folder is not part of the rewrite; skip when absent
		}
		const cards = parseCardsManifest(source);
		expect(cards.length).toBeGreaterThan(0);
		for (const card of cards) {
			expect(card.name.length).toBeGreaterThan(0);
			expect(card.id).toMatch(/^card_/);
		}
	});
});

describe('parseCardFile', () => {
	it('parses a PNG card through the image-metadata reader', async () => {
		// Build a real PNG carrying a v3 card in a tEXt chunk, the way SillyTavern exports one.
		const png = await makeCardPng(V3_CARD);
		const card = await parseCardFile(png);
		expect(card.name).toBe('Seraphina');
		expect(card.spec).toBe('chara_card_v3');
		expect(card.book?.entries[0].content).toBe('Eldoria is the whole wood.');
	});

	it('parses a plain JSON card file', async () => {
		const card = await parseCardFile(new TextEncoder().encode(JSON.stringify(V1_CARD)));
		expect(card.name).toBe('Old Timer');
	});

	it('throws on bytes that are neither an image nor JSON', async () => {
		await expect(parseCardFile(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
	});
});

/** Minimal valid 1×1 PNG with a base64 `ccv3` tEXt chunk appended before IEND. */
async function makeCardPng(card: unknown): Promise<Uint8Array> {
	const { deflateSync } = await import('node:zlib');
	const crc = (buffer: Buffer): number => {
		let table = crcTable;
		if (!table) {
			table = crcTable = new Int32Array(256);
			for (let n = 0; n < 256; n++) {
				let c = n;
				for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
				table[n] = c;
			}
		}
		let value = -1;
		for (const byte of buffer) value = (value >>> 8) ^ table[(value ^ byte) & 0xff];
		return (value ^ -1) >>> 0;
	};
	let crcTable: Int32Array | undefined;

	const chunk = (type: string, data: Buffer): Buffer => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const crcBuffer = Buffer.alloc(4);
		crcBuffer.writeUInt32BE(crc(typeAndData));
		return Buffer.concat([length, typeAndData, crcBuffer]);
	};

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA

	const rawPixel = deflateSync(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
	const base64 = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
	const text = Buffer.concat([Buffer.from('ccv3\0', 'latin1'), Buffer.from(base64, 'latin1')]);

	return new Uint8Array(
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk('IHDR', ihdr),
			chunk('IDAT', rawPixel),
			chunk('tEXt', text),
			chunk('IEND', Buffer.alloc(0))
		])
	);
}
