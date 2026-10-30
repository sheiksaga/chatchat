import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { getChat, listChats, listGenerations, listMessages } from '$lib/server/db/chats.js';
import { getConfig } from '$lib/server/config-store.js';
import { backendFor } from '$lib/server/backends/registry.js';
import { getChatCharacter } from '$lib/server/db/characters.js';
import { listImages } from '$lib/server/db/images.js';
import { messageStatsSchema, type ChatDetail, type ChatSummary } from '$lib/shared/chat.js';
import { parseStory } from '$lib/shared/story.js';
import type { ImageRecord } from '$lib/shared/image.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ params }) => {
	const database = db();
	const chat = getChat(database, params.id);
	if (!chat) error(404, 'Chat not found');

	const detail: ChatDetail = {
		id: chat.id,
		title: chat.title,
		updatedAt: chat.updated_at,
		messageCount: 0,
		// Normalised here, not in the component: every chat has a well-shaped record even when the stored
		// JSON predates the field, so the panel and the prompt builder can never see a half-built story.
		story: parseStory(chat.story ? (JSON.parse(chat.story) as unknown) : null),
		messages: listMessages(database, chat.id).map((message) => ({
			id: message.id,
			role: message.role,
			content: message.content,
			createdAt: message.created_at,
			// Saved alternates, oldest first. `generations[0]` is the original reply.
			generations:
				message.role === 'assistant'
					? listGenerations(database, message.id).map((g) => g.content)
					: [],
			stats:
				message.role === 'assistant' && message.meta
					? (messageStatsSchema.safeParse(JSON.parse(message.meta)).data ?? null)
					: null
		}))
	};

	const chats: ChatSummary[] = listChats(database).map((row) => ({
		id: row.id,
		title: row.title,
		updatedAt: row.updated_at,
		messageCount: 0
	}));

	// Which backend this chat talks to comes from the server config, not from the browser, so a
	// phone and a desktop see the same selection.
	const config = getConfig();
	const provider = config.activeProvider;
	const providerConfig = config.providers.find((p) => p.id === provider);

	// Typed as the browser-facing shape on purpose: a page load must not leak `file`/`mime`/`meta`
	// into the bundle's idea of what a picture is.
	const images: ImageRecord[] = listImages(database, chat.id);

	return {
		chat: detail,
		chats,
		provider,
		providerLabel: providerConfig?.label ?? provider,
		model: config.activeModel[provider] ?? '',
		activeModel: config.activeModel,
		// The idle VRAM release only exists where the backend has an unload route.
		caps: providerConfig ? backendFor(providerConfig).caps : null,
		character: getChatCharacter(database, chat.id) ?? null,
		images
	};
};
