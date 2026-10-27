/**
 * `POST /api/images/inpaint` — edit part of a picture.
 *
 * Multipart, because the two inputs *are* pictures: `source` (the image being edited), `mask` (white =
 * repaint, black = keep) and a `prompt` field describing what should appear. The mask editor draws both
 * client-side, so the browser sends PNG bytes rather than a list of shapes.
 */
import { Buffer } from 'node:buffer';
import { json } from '@sveltejs/kit';
import { generateInpaint } from '$lib/server/images/generate.js';

const MAX_BYTES = 24 * 1024 * 1024;

export async function POST({ request }) {
	const form = await request.formData().catch(() => null);
	if (!form) return json({ error: 'Expected a multipart form' }, { status: 400 });

	const source = form.get('source');
	const mask = form.get('mask');
	const prompt = String(form.get('prompt') ?? '').trim();
	if (!(source instanceof File) || !(mask instanceof File)) {
		return json({ error: 'Both source and mask images are required' }, { status: 400 });
	}
	if (!prompt) return json({ error: 'A prompt is required' }, { status: 400 });
	if (source.size > MAX_BYTES || mask.size > MAX_BYTES) {
		return json({ error: 'Images must be under 24 MB' }, { status: 413 });
	}

	try {
		const result = await generateInpaint({
			prompt,
			source: Buffer.from(await source.arrayBuffer()),
			mask: Buffer.from(await mask.arrayBuffer()),
			chatId: (form.get('chatId') as string) || null,
			messageId: (form.get('messageId') as string) || null,
			steps: Number(form.get('steps')) || undefined
		});
		return json({ image: result.image, url: result.url, elapsedMs: result.elapsedMs });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 502 });
	}
}
