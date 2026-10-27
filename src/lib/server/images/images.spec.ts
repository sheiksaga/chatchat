/**
 * Image pipeline tests, **without a GPU**: `fake-comfy.ts` is a real HTTP server that answers the four
 * endpoints the client uses, so these cover the parts that actually break — graph filling, byte
 * handling, storage, the marker grammar.
 *
 * The GPU-dependent half (does the picture look right?) is `comfy.smoke.spec.ts`, opt-in.
 */
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Point storage at a scratch directory *before* importing modules that read DATA_DIR at load time.
const dataDir = mkdtempSync(path.join(tmpdir(), 'chatchat-images-'));
process.env.CHATCHAT_DATA_DIR = dataDir;

const { startFakeComfy } = await import('../comfy/fake-comfy.js');
const { generateImage, generateInpaint } = await import('./generate.js');
const { readImageFile, pngSize, sniffMime } = await import('./store.js');
const { db, closeDb } = await import('../db/index.js');
const { getImage, listImages } = await import('../db/images.js');
const { createChat } = await import('../db/chats.js');
const { findImageMarkers, parseImageCommand, parseMarkerBody, stripImageMarkers } =
	await import('$lib/shared/image.js');

let comfy: Awaited<ReturnType<typeof startFakeComfy>>;

beforeAll(async () => {
	comfy = await startFakeComfy();
});

afterAll(async () => {
	await comfy.close();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe('image markers', () => {
	it('parses prompt, size, shot tag and seed', () => {
		const parsed = parseMarkerBody(
			'a harbour at dusk, 1boy, oil paint | 832x1216 | wide shot | 42'
		);
		expect(parsed?.prompt).toBe('a harbour at dusk, 1boy, oil paint, wide shot');
		expect(parsed?.width).toBe(832);
		expect(parsed?.height).toBe(1216);
		expect(parsed?.seed).toBe(42);
	});

	it('falls back to defaults and rejects an empty prompt', () => {
		expect(parseMarkerBody('just a prompt', { width: 1024, height: 1024 })).toMatchObject({
			prompt: 'just a prompt',
			width: 1024,
			height: 1024
		});
		expect(parseMarkerBody(' | 832x1216')).toBeNull();
	});

	it('snaps odd sizes into the 64-pixel grid ComfyUI wants', () => {
		expect(parseMarkerBody('x | 800x500')).toMatchObject({ width: 832, height: 512 });
	});

	it('finds markers in a reply and strips them from the visible text', () => {
		const reply = 'She looks up.\n[[IMG: a tower, dusk | 832x1216 | close-up]]\nThen silence.';
		const markers = findImageMarkers(reply);
		expect(markers).toHaveLength(1);
		expect(markers[0].prompt).toBe('a tower, dusk, close-up');
		expect(stripImageMarkers(reply)).toBe('She looks up.\n\nThen silence.');
	});

	it('only treats a leading /image as the command', () => {
		expect(parseImageCommand('/image a red fox')).toEqual({ prompt: 'a red fox' });
		expect(parseImageCommand('  /IMAGE  snow  ')).toEqual({ prompt: 'snow' });
		expect(parseImageCommand('/image')).toBeNull();
		expect(parseImageCommand('draw /image a fox')).toBeNull();
	});
});

describe('generateImage', () => {
	it('runs the graph, stores the bytes and records a row', { timeout: 20_000 }, async () => {
		const chat = createChat(db(), { title: 'Pictures' });
		const progress: number[] = [];

		const result = await generateImage({
			chatId: chat.id,
			prompt: 'a lighthouse, painterly',
			width: 832,
			height: 1216,
			seed: 7,
			comfyUrl: comfy.url,
			onProgress: (event) => progress.push(event.value)
		});

		// The queued graph carries the prompt, size and seed through to ComfyUI.
		const graph = comfy.queued.at(-1)?.graph as Record<string, { inputs: Record<string, unknown> }>;
		const serialised = JSON.stringify(graph);
		expect(serialised).toContain('a lighthouse, painterly');
		expect(serialised).toContain('832');
		expect(serialised).toContain('1216');
		expect(serialised).not.toContain('{{');

		const row = getImage(db(), result.image.id);
		expect(row?.prompt).toBe('a lighthouse, painterly');
		expect(row?.workflow).toBe('krea2-t2i');
		expect(row?.seed).toBe(7);
		expect(row?.width).toBe(1); // the stub's 1×1 PNG, read from the real IHDR
		expect(row?.width).toBe(pngSize(readImageFile(row!.file))?.width);

		const bytes = readImageFile(result.image.file);
		expect(sniffMime(bytes)).toBe('image/png');
		expect(listImages(db(), chat.id)).toHaveLength(1);
		// The fake has no websocket, so there are no progress events — and generation must still finish.
		// That is the same path a user hits behind a firewall that blocks ws://.
		expect(progress).toEqual([]);
	});

	it('rejects a non-image workflow before touching ComfyUI', async () => {
		await expect(
			generateImage({ prompt: 'x', workflow: 'anima-inpaint', comfyUrl: comfy.url })
		).rejects.toThrow(/not a text-to-image workflow/i);
	});

	it('surfaces a graph ComfyUI refuses', async () => {
		const broken = await startFakeComfy({ failWith: 'Value not in list: MODEL' });
		try {
			await expect(generateImage({ prompt: 'x', comfyUrl: broken.url })).rejects.toThrow(
				/rejected the graph/i
			);
		} finally {
			await broken.close();
		}
	});
});

describe('generateInpaint', () => {
	it('uploads source and mask, then queues the inpaint graph', async () => {
		const result = await generateInpaint({
			prompt: 'a red flower',
			source: Buffer.from('source-bytes'),
			mask: Buffer.from('mask-bytes'),
			comfyUrl: comfy.url
		});

		expect(comfy.uploads).toHaveLength(2);
		const graph = comfy.queued.at(-1)?.graph as Record<string, { inputs: Record<string, unknown> }>;
		const serialised = JSON.stringify(graph);
		expect(serialised).toContain('uploaded-1.png');
		expect(serialised).toContain('uploaded-2.png');
		expect(serialised).toContain('a red flower');
		expect(result.image.workflow).toBe('anima-inpaint');
	});
});
