/**
 * `POST /api/images/scene` — "make a picture of this moment".
 *
 * The prompt is assembled **server-side** from the stored transcript, so the tagging rules live in one
 * place (`prompts/scene.ts`) and the browser cannot invent a prompt the tests never saw. Conversation
 * context is read from the database rather than trusted from the request body.
 */
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { getChat, listMessages, setChatStory } from '$lib/server/db/chats.js';
import { getChatCharacter } from '$lib/server/db/characters.js';
import { buildScenePrompt } from '$lib/server/prompts/scene.js';
import { mirrorChat } from '$lib/server/db/layout.js';

interface StoryLook {
	look?: string;
}

export async function POST({ request }) {
	const body = (await request.json().catch(() => null)) as {
		chatId?: string;
		shot?: 'wide' | 'medium' | 'close';
		extra?: string;
		look?: string;
	} | null;
	if (!body?.chatId) return json({ error: 'chatId is required' }, { status: 400 });

	const database = db();
	const chat = getChat(database, body.chatId);
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	// The look is remembered per chat, so the second picture matches the first without retyping.
	const story = (chat.story ? JSON.parse(chat.story) : {}) as StoryLook;
	if (body.look !== undefined && body.look !== story.look) {
		setChatStory(database, chat.id, { ...story, look: body.look });
		mirrorChat(database, chat.id);
	}

	const scene = buildScenePrompt({
		messages: listMessages(database, chat.id).map((message) => ({
			role: message.role,
			content: message.content
		})),
		character: getChatCharacter(database, chat.id) ?? null,
		look: body.look ?? story.look ?? null,
		shot: body.shot,
		extra: body.extra
	});

	return json(scene);
}
