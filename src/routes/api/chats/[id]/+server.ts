/**
 * Per-chat metadata: `PATCH { title | characterId | story }`, `DELETE` removes the chat (messages cascade).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index.js';
import { deleteChat, getChat, renameChat, setChatStory } from '$lib/server/db/chats.js';
import { getCharacter, setChatCharacter } from '$lib/server/db/characters.js';
import { mirrorChat, removeChatDir } from '$lib/server/db/layout.js';

const patchSchema = z.object({
	title: z.string().trim().min(1).max(200).optional(),
	/** `null` detaches the character; the transcript stays. */
	characterId: z.string().min(1).nullable().optional(),
	/** Merged into `chats.story` — today that is the scene `look` used for image prompts. */
	story: z.object({ look: z.string().max(400).optional() }).optional()
});

export async function PATCH({ params, request }) {
	const chat = getChat(db(), params.id);
	if (!chat) error(404, 'Chat not found');

	const parsed = patchSchema.safeParse(await request.json());
	if (
		!parsed.success ||
		(parsed.data.title === undefined &&
			parsed.data.characterId === undefined &&
			parsed.data.story === undefined)
	) {
		error(400, 'a title, characterId or story is required');
	}

	if (parsed.data.title !== undefined) renameChat(db(), params.id, parsed.data.title);
	if (parsed.data.characterId !== undefined) {
		if (parsed.data.characterId && !getCharacter(db(), parsed.data.characterId)) {
			error(400, 'unknown character');
		}
		setChatCharacter(db(), params.id, parsed.data.characterId);
	}
	if (parsed.data.story !== undefined) {
		// Merge, never replace: other story keys (scenes, seeds) must survive a look edit.
		const current = (chat.story ? JSON.parse(chat.story) : {}) as Record<string, unknown>;
		setChatStory(db(), params.id, { ...current, ...parsed.data.story });
	}
	mirrorChat(db(), params.id);
	return json({ id: params.id, ...parsed.data });
}

export function DELETE({ params }) {
	if (!getChat(db(), params.id)) error(404, 'Chat not found');
	deleteChat(db(), params.id);
	removeChatDir(params.id);
	return json({ id: params.id, deleted: true });
}
