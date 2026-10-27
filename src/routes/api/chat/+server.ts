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
import { STOP_SEQUENCES } from '$lib/server/config.js';
import { getConfig } from '$lib/server/config-store.js';
import { activeModelFor, getBackend } from '$lib/server/backends/registry.js';
import { db } from '$lib/server/db/index.js';
import { mirrorChat } from '$lib/server/db/layout.js';
import { getChatCharacter } from '$lib/server/db/characters.js';
import { assemblePrompt } from '$lib/server/prompts/rp.js';
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
	const prompt = character
		? assemblePrompt(
				character,
				listMessages(db(), chatId!).map((row) => ({
					role: row.role,
					content: row.content
				})),
				{ userName: config.userName }
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
