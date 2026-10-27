/**
 * ComfyUI smoke test — **opt-in**, because it needs a GPU and a running ComfyUI.
 *
 *   CHATCHAT_COMFY_SMOKE=1 npx vitest run src/lib/server/comfy
 *
 * Proves the three things the image subsystem will depend on:
 *   1. a bundled graph runs with filled placeholders, with live progress events,
 *   2. output bytes come back through `/view`,
 *   3. source + mask upload through `/upload/image` for the inpaint graph.
 *
 * Everything here is skipped in the normal `npm run verify` (no GPU, no network).
 */
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGES_DIR } from '../config.js';
import { fetchImage, runGraph, uploadImage, type ComfyProgress } from './client.js';
import {
	ANIMA_INPAINT_DEFAULTS,
	GRAPHS,
	KREA2_DEFAULTS,
	fillGraph,
	loadGraph
} from './workflows.js';

const SMOKE = process.env.CHATCHAT_COMFY_SMOKE === '1';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Minimal RGBA PNG writer so the mask fixture needs no image dependency. */
function makePng(width: number, height: number, paint: (x: number, y: number) => number[]): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf: Buffer) => {
		let c = 0xffffffff;
		for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, sum]);
	};

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type RGBA

	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 4 + 1);
		raw[row] = 0; // no filter
		for (let x = 0; x < width; x += 1) {
			const [r, g, b, a] = paint(x, y);
			const at = row + 1 + x * 4;
			raw[at] = r;
			raw[at + 1] = g;
			raw[at + 2] = b;
			raw[at + 3] = a;
		}
	}

	return Buffer.concat([
		PNG_MAGIC,
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

describe.skipIf(!SMOKE)('ComfyUI graphs (needs GPU + :8188)', () => {
	it('runs krea2 t2i with progress events and returns PNG bytes', async () => {
		const graph = fillGraph(await loadGraph(GRAPHS['krea2-t2i'].file), {
			...KREA2_DEFAULTS,
			PROMPT: 'a lighthouse at dusk, painterly, dramatic clouds',
			WIDTH: 768,
			HEIGHT: 768,
			STEPS: 6,
			SEED: 12345
		});

		const progress: ComfyProgress[] = [];
		const result = await runGraph(graph, {
			onProgress: (p) => progress.push(p),
			timeoutMs: 8 * 60 * 1000
		});

		expect(result.promptId).toBeTruthy();
		expect(result.images.length).toBeGreaterThan(0);

		const bytes = await fetchImage(result.images[0]);
		expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);

		await mkdir(IMAGES_DIR, { recursive: true });
		const out = path.join(IMAGES_DIR, 'spike-krea2.png');
		await writeFile(out, bytes);

		console.log(
			`[comfy] krea2 t2i: ${bytes.length} bytes in ${result.elapsedMs} ms, ` +
				`${progress.length} progress events -> ${out}`
		);
		expect(progress.length).toBeGreaterThan(0);
	}, 600_000);

	it('uploads source + mask and runs the anima inpaint graph', async () => {
		const source = makePng(512, 512, (x, y) =>
			x < 256 ? [40, 60, 90, 255] : y < 256 ? [90, 40, 60, 255] : [60, 90, 40, 255]
		);
		// White = repaint, black = keep. Centre square only.
		const mask = makePng(512, 512, (x, y) =>
			x > 128 && x < 384 && y > 128 && y < 384 ? [255, 255, 255, 255] : [0, 0, 0, 255]
		);

		const initImage = await uploadImage(source, 'spike-source.png');
		const maskImage = await uploadImage(mask, 'spike-mask.png');
		expect(initImage).toMatch(/spike-source/);
		expect(maskImage).toMatch(/spike-mask/);

		const graph = fillGraph(await loadGraph(GRAPHS['anima-inpaint'].file), {
			...ANIMA_INPAINT_DEFAULTS,
			INIT_IMAGE: initImage,
			MASK_IMAGE: maskImage,
			INSTRUCTION: 'a red flower in the middle',
			SEED: 777
		});

		const result = await runGraph(graph, { timeoutMs: 8 * 60 * 1000 });
		expect(result.images.length).toBeGreaterThan(0);
		const bytes = await fetchImage(result.images[0]);
		expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);

		await mkdir(IMAGES_DIR, { recursive: true });
		const out = path.join(IMAGES_DIR, 'spike-inpaint.png');
		await writeFile(out, bytes);

		console.log(`[comfy] anima inpaint: ${bytes.length} bytes in ${result.elapsedMs} ms -> ${out}`);
	}, 600_000);
});
