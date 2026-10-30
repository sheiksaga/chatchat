/**
 * POST /api/chat — the single text-generation endpoint.
 *
 * Contract: the browser posts `ChatRequest` (see `$lib/shared/chat-request`) and receives an
 * AI SDK UI message stream. The browser never talks to llama.cpp directly, and never holds a key.
 *
 * When `chatId` is present the server persists both turns, so a reload (or a phone picking up the
 * same conversation) sees the same history. That is the only write path for messages.
 */
import { randomUUID } from 'node:crypto';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { error } from '@sveltejs/kit';
import { chatRequestSchema } from '$lib/shared/chat-request.js';
import { MAX_REPLY_TOKENS, STOP_SEQUENCES } from '$lib/server/config.js';
import { getConfig } from '$lib/server/config-store.js';
import { activeModelFor, getBackend } from '$lib/server/backends/registry.js';
import { db } from '$lib/server/db/index.js';
import { mirrorChat } from '$lib/server/db/layout.js';
import { getChatCharacter } from '$lib/server/db/characters.js';
import { listImages } from '$lib/server/db/images.js';
import { assemblePrompt } from '$lib/server/prompts/rp.js';
import { sceneTarget } from '$lib/server/prompts/scene.js';
import { renderShotState } from '$lib/server/prompts/state.js';
import { storyStyle } from '$lib/shared/story.js';
import { parseStory } from '$lib/shared/story.js';
import {
	appendMessage,
	getChat,
	listGenerations,
	listMessages,
	renameChat,
	saveGeneration,
	updateMessageContent,
	updateMessageMeta
} from '$lib/server/db/chats.js';

export async function POST({ request }: { request: Request }) {
	const parsed = chatRequestSchema.safeParse(await request.json());
	if (!parsed.success) {
		error(
			400,
			`Invalid chat request: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`
		);
	}

	const {
		messages,
		chatId,
		samplers,
		provider: requestedProvider,
		regenerateMessageId
	} = parsed.data;

	const backend = (() => {
		try {
			return getBackend(requestedProvider);
		} catch (cause) {
			error(400, cause instanceof Error ? cause.message : String(cause));
		}
	})();

	const model = parsed.data.model || activeModelFor(backend.provider.id);
	if (!model) error(400, 'No model selected for this provider');

	// A wrong model id used to produce a 200 with an empty stream (measured: a typo'd gemma id gave
	// "no reply, no error"). Ask the backend what it actually serves and say so instead — a local
	// server answers this in milliseconds and the user gets a sentence they can act on.
	const available = await backend.listModels().catch(() => null as string[] | null);
	if (available?.length && !available.includes(model)) {
		error(400, `Unknown model "${model}". This provider serves: ${available.join(', ')}`);
	}

	// Precedence: per-request sliders > global overrides > the backend's own defaults.
	// Getting this order wrong is what makes a tuned per-model `temp` from `models-router.ini`
	// silently disappear, so it is stated once, here.
	const config = getConfig();
	const providerDefaults = await backend.samplerDefaults(model);
	const llamaExtras = backend.caps.llamacppSamplers
		? {
				...providerDefaults,
				...config.samplers,
				...samplers,
				// Reasoning models (qwen3.x, gemma-4, ornith) otherwise spend the whole budget in a
				// hidden think block. Harmless on models whose template ignores it.
				...(backend.caps.thinkingToggle ? { chat_template_kwargs: { enable_thinking: false } } : {})
			}
		: { ...providerDefaults, ...config.samplers, ...samplers };

	if (chatId) {
		// A chat must exist before we accept text for it; a stale tab is a client bug, not a 500.
		if (!getChat(db(), chatId)) error(404, 'Chat not found');

		const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
		const lastText = (lastUserMessage?.parts ?? [])
			.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
			.map((part) => part.text)
			.join('');
		if (lastUserMessage && lastText) {
			const existing = db().prepare('SELECT 1 FROM messages WHERE id = ?').get(lastUserMessage.id);
			if (!existing) {
				appendMessage(db(), {
					id: lastUserMessage.id,
					chatId,
					role: 'user',
					content: lastText
				});
				// First message names the chat; renaming is a later feature, but a list of
				// "New chat" entries is useless so the default title gets replaced once.
				if (listMessages(db(), chatId).length === 1) {
					renameChat(db(), chatId, lastText.replace(/\s+/g, ' ').trim().slice(0, 60));
				}
				mirrorChat(db(), chatId);
			}
		}
	}

	// Only a stored assistant message in this chat can be regenerated; anything else is a stale tab.
	const regenerateTarget =
		chatId && regenerateMessageId
			? db()
					.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ? AND role = ?')
					.get(regenerateMessageId, chatId, 'assistant')
				? regenerateMessageId
				: undefined
			: undefined;

	// Server-owned assistant message id: the stream and the database row must be the same message,
	// otherwise the client's freshly streamed reply has an id the server data cannot match (which
	// silently breaks version arrows and stats until the next reload).
	const assistantId = randomUUID();

	// Wall-clock time covers queueing + load, which is what the reader actually waited for.
	const started = Date.now();
	// Text seen so far. `Stop` aborts the stream, and without this the partial reply would vanish
	// on reload even though the reader is looking at it.
	let partial = '';
	let persisted = false;

	/**
	 * With a character attached, the prompt is built from the stored transcript and the card, not
	 * from the client's copy: the card's system prompt, lore and post-history instructions are the
	 * whole point of a roleplay chat, and a browser must not be able to drop them.
	 */
	const character = chatId ? getChatCharacter(db(), chatId) : undefined;
	// A storyboard card has no memory of its own pictures, so hand it the last one verbatim. Only for
	// image-utility cards: a roleplay prompt must not grow an image tag list it never asked for.
	// Storyboard chats are told which dialect to write in: a caption-trained model (Z-Image) reads a
	// paragraph, a Danbooru model (Krea2, Anima) reads comma tags, and the card cannot know which one the
	// picker holds. This is the same split `prompts/scene.ts` makes for "of this moment".
	const shotStyle =
		chatId && character?.tags.includes('image-generation') ? shotStyleHint(chatId) : undefined;
	const shotState =
		chatId && character?.tags.includes('image-generation') ? shotStateBlock(chatId) : undefined;

	const previousShot =
		chatId && character?.tags.includes('image-generation')
			? (listImages(db(), chatId).findLast((row) => row.prompt)?.prompt ?? undefined)
			: undefined;
	const prompt = character
		? assemblePrompt(
				character,
				listMessages(db(), chatId!).map((row) => ({
					role: row.role,
					content: row.content
				})),
				{ userName: config.userName, previousShot, shotStyle, shotState }
			)
		: null;

	const result = streamText({
		// Ties the model stream to the HTTP request: when the reader closes the tab or presses Stop,
		// the backend request is cancelled too instead of streaming into the void.
		abortSignal: request.signal,
		model: backend.chatModel(model),
		// Character prompts put the post-history instructions *after* the transcript, which is the whole
		// point of that card field (recency). AI SDK 7 rejects system messages inside `messages` unless
		// this opt-in is set; llama.cpp's chat templates handle a trailing system turn correctly, and
		// SillyTavern sends prompts the same way.
		allowSystemInMessages: prompt !== null,
		messages: prompt ? prompt.messages : await convertToModelMessages(messages as UIMessage[]),
		stopSequences: [...STOP_SEQUENCES],
		maxOutputTokens: MAX_REPLY_TOKENS,
		providerOptions: { [backend.provider.id]: llamaExtras },
		onChunk: ({ chunk }) => {
			if (chunk.type === 'text-delta') partial += chunk.text;
		},
		onAbort: () => {
			savePartial({ aborted: true });
		},
		onEnd: ({ text, usage }) => {
			if (!chatId || !text.trim()) return;
			persisted = true;

			const stats = {
				model,
				provider: backend.provider.id,
				ms: Date.now() - started,
				promptTokens: usage?.inputTokens,
				completionTokens: usage?.outputTokens
			};

			if (regenerateTarget) {
				// Append to the generation history *before* overwriting, so "previous version" works.
				saveGeneration(
					db(),
					regenerateTarget,
					listGenerations(db(), regenerateTarget).length,
					text
				);
				updateMessageContent(db(), regenerateTarget, text);
				updateMessageMeta(db(), regenerateTarget, stats);
				mirrorChat(db(), chatId!);
				return;
			}

			const row = appendMessage(db(), {
				id: assistantId,
				chatId,
				role: 'assistant',
				content: text,
				meta: stats
			});
			// The first generation is the original text; cycling starts from it.
			saveGeneration(db(), row.id, 0, text);
			// Mirror *after* the row exists. This was missing here (every other write path has it), so
			// `data/chats/<id>/chat.json` stopped one reply short until something else wrote: anything that
			// read the folder — a backup, an import, a script — saw a transcript the database did not.
			mirrorChat(db(), chatId!);
		}
	});

	/**
	 * Persist whatever arrived before an abort. Called from `onAbort`, so it must be idempotent and
	 * must never touch the same row twice (a later `onEnd` would duplicate the reply).
	 */
	function savePartial(extra: { aborted?: boolean }) {
		if (!chatId || persisted || !partial.trim()) return;
		persisted = true;

		const stats = {
			model,
			provider: backend.provider.id,
			ms: Date.now() - started,
			...extra
		};

		if (regenerateTarget) {
			saveGeneration(
				db(),
				regenerateTarget,
				listGenerations(db(), regenerateTarget).length,
				partial
			);
			updateMessageContent(db(), regenerateTarget, partial);
			updateMessageMeta(db(), regenerateTarget, stats);
			mirrorChat(db(), chatId!);
			return;
		}

		const row = appendMessage(db(), {
			id: assistantId,
			chatId,
			role: 'assistant',
			content: partial,
			meta: stats
		});
		saveGeneration(db(), row.id, 0, partial);
		mirrorChat(db(), chatId!);
	}

	// The default error text is "An error occurred."; a local app should say what actually broke,
	// otherwise the only debugging tool is the server console.
	return result.toUIMessageStreamResponse({
		// Keep the id stable across the wire and the database (see `assistantId`).
		generateMessageId: () => assistantId,
		onError: (cause) => (cause instanceof Error ? cause.message : String(cause))
	});
}

/**
 * Which prompt dialect this chat draws with, in a paragraph the card can follow.
 *
 * The image model is chosen in the composer and remembered on the chat, so the storyboard prompt can be
 * written for it. Measured: Z-Image is caption-trained and its storyboard beats repeated each other when
 * fed tag soup; Krea2 and Anima are Danbooru models and read a caption as noise.
 */
/** The state block the writer reads, derived from the pictures already drawn. */
function shotStateBlock(chatId: string): string | undefined {
	const chat = getChat(db(), chatId);
	const story = parseStory(chat?.story ? JSON.parse(chat.story) : null);
	return renderShotState(story.shotState) || undefined;
}

function shotStyleHint(chatId: string): string {
	const chat = getChat(db(), chatId);
	const story = parseStory(chat?.story ? JSON.parse(chat.story) : null);
	const target = sceneTarget(story.imageWorkflow);

	const render = storyStyle(story.style);
	// The render style is a chat-level choice, so it belongs in every prompt rather than being retyped by
	// the writer — pinning it is also how a model with an unstable look (Krea2) is held to one style.
	const styleLine = render.tags ? `RENDER STYLE (keep it in every prompt): ${render.tags}` : '';

	if (target === 'zimage') {
		const captionStyle = render.prose
			? `RENDER STYLE (keep it in every prompt): ${render.prose}`
			: '';
		return [
			'PROMPT STYLE (this chat draws with Z-Image, a caption model):',
			'write ONE caption paragraph of 40-80 words in plain sentences — who is in the shot, what they are',
			'wearing, the action, the place and the light. No Danbooru tags, no comma list of keywords, no',
			'"masterpiece" padding. Open the paragraph with what has changed in this beat, then describe the shot.',
			'Put that paragraph in the PROMPT segment; the rest of the marker is unchanged.',
			captionStyle
		]
			.filter(Boolean)
			.join(' ');
	}

	return [
		'PROMPT STYLE (this chat draws with a Danbooru model):',
		'comma-delimited tags, subject count first (1girl, 1man, 2men, crowd), then features, action, props,',
		'environment, light. No sentences. Open the tag list with what has changed in this beat.',
		'For nudity or sex use the plain Danbooru terms the model was trained on — nude, topless, penis,',
		'erection, handjob, cum, sweat — because a polite euphemism or "begins to …" draws nothing at all.',
		styleLine
	]
		.filter(Boolean)
		.join(' ');
}
