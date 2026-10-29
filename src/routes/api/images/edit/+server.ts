/**
 * `POST /api/images/edit` — change part of a picture with one sentence.
 *
 * JSON in, SSE out, same shape as `/api/images`: the stream *is* the job, so there is no registry to
 * leak when a tab closes. The source image is read from disk by id rather than uploaded from the
 * browser — the bytes are already here, and a 1.5 MB round trip through the phone's uplink is exactly
 * the thing that gets slow over Tailscale.
 *
 *   `{type:"progress", value, max}` · `{type:"done", image, url}` · `{type:"error", message}`
 */
import { Buffer } from 'node:buffer';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index.js';
import { getImage } from '$lib/server/db/images.js';
import { generateEdit } from '$lib/server/images/generate.js';
import { readImageFile } from '$lib/server/images/store.js';

const bodySchema = z.object({
	imageId: z.string().min(1),
	instruction: z.string().trim().min(1).max(2000),
	chatId: z.string().min(1).optional(),
	/** Which message the result belongs under; defaults to the source picture's message. */
	messageId: z.string().min(1).nullable().optional(),
	steps: z.number().int().min(1).max(20).optional(),
	seed: z.number().int().min(0).optional()
});

export async function POST({ request }) {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	}

	const source = getImage(db(), parsed.data.imageId);
	if (!source) return json({ error: 'No such image' }, { status: 404 });

	// Read before the stream starts: a missing file is a 404 the browser can show, not a broken event.
	let bytes: Buffer;
	try {
		bytes = readImageFile(source.file);
	} catch {
		return json({ error: 'That image file is missing from disk' }, { status: 410 });
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: unknown) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

			try {
				const result = await generateEdit({
					instruction: parsed.data.instruction,
					source: bytes,
					sourceId: source.id,
					width: source.width ?? undefined,
					height: source.height ?? undefined,
					chatId: parsed.data.chatId ?? source.chat_id ?? null,
					// An edit is a new picture of the *same* moment, so it lands beside its source.
					messageId:
						parsed.data.messageId === undefined ? source.message_id : parsed.data.messageId,
					steps: parsed.data.steps,
					seed: parsed.data.seed,
					onProgress: (progress) =>
						send({ type: 'progress', value: progress.value, max: progress.max })
				});
				send({ type: 'done', image: result.image, url: result.url, elapsedMs: result.elapsedMs });
			} catch (cause) {
				send({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			'x-accel-buffering': 'no'
		}
	});
}
