import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { mirrorChat } from '$lib/server/db/layout.js';
import { appendMessage, createChat, listChats, renameChat } from '$lib/server/db/chats.js';
import { getCharacter, setChatCharacter } from '$lib/server/db/characters.js';
import { getConfig } from '$lib/server/config-store.js';
import { greetingFor } from '$lib/server/prompts/rp.js';
import type { ChatSummary } from '$lib/shared/chat.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => {
	const chats: ChatSummary[] = listChats(db()).map((chat) => ({
		id: chat.id,
		title: chat.title,
		updatedAt: chat.updated_at,
		messageCount: 0
	}));
	return { chats };
};

export const actions: Actions = {
	/**
	 * `?/newChat` with an optional `characterId`. A character chat is titled after the card and
	 * opens with its greeting already in the transcript, which is what every card UI does and what
	 * the model needs to stay in persona from the first token.
	 */
	newChat: async ({ request }) => {
		const form = await request.formData();
		const characterId = String(form.get('characterId') ?? '').trim();
		const character = characterId ? getCharacter(db(), characterId) : undefined;

		const chat = createChat(db(), { title: character?.name ?? 'New chat' });

		if (character) {
			setChatCharacter(db(), chat.id, character.id);
			const greeting = greetingFor(character, getConfig().userName);
			if (greeting) {
				appendMessage(db(), {
					chatId: chat.id,
					role: 'assistant',
					content: greeting,
					meta: { greeting: true }
				});
			}
			// A card's name is a better title than "New chat"; keep the auto-title rule intact for
			// plain chats (first user message), so nothing is renamed here.
			renameChat(db(), chat.id, character.name);
		}

		// Create the chat's folder now, not on its first message: an empty new chat should already be
		// visible in data/chats/ with its chat.json and story.json.
		mirrorChat(db(), chat.id);
		redirect(303, `/chat/${chat.id}`);
	}
};
