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
import { parseStory } from '$lib/shared/story.js';

export async function POST({ request }) {
	const body = (await request.json().catch(() => null)) as {
		chatId?: string;
		shot?: 'wide' | 'medium' | 'close';
		extra?: string;
		/** An override for the record's look — the panel sends what it shows, without saving it. */
		look?: string;
		/** An override for the record's style, same rule. */
		style?: string;
		workflow?: string;
	} | null;
	if (!body?.chatId) return json({ error: 'chatId is required' }, { status: 400 });

	const database = db();
	const chat = getChat(database, body.chatId);
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	// The look, the render style and the seed are remembered per chat, so the second picture matches the
	// first without retyping. `parseStory` also copes with the `{ look }`-only records written before the
	// style and seed existed.
	const story = parseStory(chat.story ? JSON.parse(chat.story) : null);
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
		style: body.style ?? story.style,
		shot: body.shot,
		extra: body.extra,
		workflow: body.workflow,
		// The record of what the earlier pictures in this chat actually drew. Without it the scene was
		// rebuilt from the last two messages only, which is how a dress became a blouse and the set became
		// an office between two pictures.
		state: story.shotState
	});

	return json({ ...scene, workflow: body.workflow });
}
