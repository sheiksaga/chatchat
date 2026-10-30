/**
 * `POST /api/images` — generate one picture and stream progress back on the same request.
 *
 * One request, one response, no job registry: the stream *is* the job. That keeps the client trivial
 * (read lines, update a bar) and means an abandoned tab cancels nothing that costs GPU time beyond what
 * ComfyUI is already doing — a deliberate trade for an app that runs on the user's own machine.
 *
 * Events, one JSON object per SSE frame:
 *   `{type:"progress", value, max}`   — a sampler step
 *   `{type:"done", image:{…}}`        — the finished image row
 *   `{type:"error", message}`         — anything that went wrong, then the stream closes
 *
 * `GET /api/images?chatId=…` lists a chat's images (used by tests and by the gallery on reload).
 */
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index.js';
import { listImages } from '$lib/server/db/images.js';
import { generateImage } from '$lib/server/images/generate.js';
import { deriveShotState, mergeShotState } from '$lib/server/prompts/state.js';
import { getChat, setChatStory } from '$lib/server/db/chats.js';
import { mirrorChat } from '$lib/server/db/layout.js';
import { effectiveStyle, parseStory, pinStyle } from '$lib/shared/story.js';
import { DEFAULT_WORKFLOW, T2I_GRAPH_IDS, type GraphId } from '$lib/server/comfy/workflows.js';

const bodySchema = z.object({
	chatId: z.string().min(1).optional(),
	messageId: z.string().min(1).optional(),
	prompt: z.string().trim().min(1).max(4000),
	width: z.number().int().min(256).max(2048).optional(),
	height: z.number().int().min(256).max(2048).optional(),
	steps: z.number().int().min(1).max(60).optional(),
	seed: z.number().int().min(0).optional(),
	/** Which image model to use. Every text-to-image graph is valid here, picker-visible or not. */
	workflow: z
		.enum(T2I_GRAPH_IDS as [string, ...string[]])
		.default(DEFAULT_WORKFLOW) as z.ZodType<GraphId>
});

export async function GET({ url }) {
	const chatId = url.searchParams.get('chatId');
	if (!chatId) return json({ images: [] });
	return json({ images: listImages(db(), chatId) });
}

/**
 * The chat's style, or null when the chat is unknown (a scratch draw with no chat).
 *
 * `effectiveStyle`, not the raw field: a Krea2 chat left on `none` must still be pinned to anime, which is
 * the whole difference between a portrait and a photograph on that checkpoint.
 */
function chatStyle(chatId: string) {
	const chat = getChat(db(), chatId);
	if (!chat) return null;
	const story = parseStory(chat.story ? JSON.parse(chat.story) : null);
	return effectiveStyle(story.style, story.imageWorkflow);
}

export async function POST({ request }) {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: unknown) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

			try {
				// The chat's render style is pinned here, not left to the writer: a storyboard model that drops
				// the style tags for one beat flips the whole sequence from anime to painted realism.
				const style = parsed.data.chatId ? chatStyle(parsed.data.chatId) : null;
				const prompt = pinStyle(parsed.data.prompt, style);

				const result = await generateImage({
					...parsed.data,
					prompt,
					onProgress: (progress) =>
						send({ type: 'progress', value: progress.value, max: progress.max })
				});
				// The picture that was actually drawn is the only trustworthy record of the scene, so the
				// state is derived from the prompt that produced it and merged into the chat.
				if (parsed.data.chatId) {
					const database = db();
					const chat = getChat(database, parsed.data.chatId);
					if (chat) {
						const story = parseStory(chat.story ? JSON.parse(chat.story) : null);
						setChatStory(database, chat.id, {
							...story,
							shotState: mergeShotState(story.shotState, deriveShotState(prompt))
						});
						mirrorChat(database, chat.id);
					}
				}
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
