/**
 * Guard rails on `POST /api/images/edit` — the half of the route that runs *before* any GPU work.
 *
 * The happy path (ComfyUI actually editing) is covered by hand and by `comfy.smoke.spec.ts`; what is cheap
 * to get wrong and expensive to discover is the refusal side: a missing image should say so, a missing file
 * should say so, and an empty instruction should never reach the queue.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `vitest.setup.ts` already points CHATCHAT_DATA_DIR at a scratch folder, so this spec only has to use it.
const dataDir = process.env.CHATCHAT_DATA_DIR as string;

const { closeDb, db, openDb } = await import('$lib/server/db/index.js');
const { insertImage } = await import('$lib/server/db/images.js');
const { POST } = await import('./+server.js');

function post(body: unknown) {
	return POST({
		request: new Request('http://localhost/api/images/edit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0]);
}

/** A 1×1 PNG is enough: the route only reads its dimensions before the GPU work starts. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
	'base64'
);

beforeAll(() => {
	openDb();
});

afterAll(() => {
	closeDb();
});

describe('POST /api/images/edit', () => {
	it('rejects a body without an image or an instruction', async () => {
		expect((await post({ imageId: 'x' })).status).toBe(400);
		expect((await post({ imageId: 'x', instruction: '   ' })).status).toBe(400);
		expect((await post({ instruction: 'make it night' })).status).toBe(400);
	});

	it('answers 404 for an image that does not exist, instead of starting a stream', async () => {
		const response = await post({ imageId: 'missing', instruction: 'make it night' });
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: expect.stringMatching(/no such image/i) });
	});

	it('answers 410 when the row exists but the file does not', async () => {
		// A pruned folder or a hand-deleted PNG: better a clear 410 than a broken event stream.
		const row = insertImage(db(), {
			id: 'edit-410',
			chatId: null,
			messageId: null,
			file: 'chats/gone/images/gone.png',
			mime: 'image/png',
			width: 1,
			height: 1,
			prompt: 'gone',
			seed: 1,
			workflow: 'anima-turbo-t2i',
			meta: null
		});
		const response = await post({ imageId: row.id, instruction: 'make it night' });
		expect(response.status).toBe(410);
		expect(await response.json()).toMatchObject({ error: expect.stringMatching(/missing/i) });
	});

	it('streams the job for a real image, in the same SSE shape as /api/images', async () => {
		const file = path.join('chats', 'edit-chat', 'images', 'source.png');
		mkdirSync(path.join(dataDir, path.dirname(file)), { recursive: true });
		writeFileSync(path.join(dataDir, file), PNG);

		const row = insertImage(db(), {
			id: 'edit-ok',
			chatId: null,
			messageId: null,
			file,
			mime: 'image/png',
			width: 1,
			height: 1,
			prompt: 'source',
			seed: 1,
			workflow: 'anima-turbo-t2i',
			meta: null
		});

		// ComfyUI is not running in unit tests, so the job fails — but it must fail *inside* the stream,
		// after the headers, or the client loses its progress UI.
		const response = await post({ imageId: row.id, instruction: 'make it night' });
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/event-stream');

		const frames = (await response.text())
			.split('\n')
			.filter((line) => line.startsWith('data: '))
			.map((line) => JSON.parse(line.slice(6)) as { type: string; message?: string });
		expect(frames.some((frame) => frame.type === 'error')).toBe(true);
	});
});
