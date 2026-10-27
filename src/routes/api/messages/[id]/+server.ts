/**
 * Per-message edits: `PATCH { content }` rewrites the text (and keeps the FTS index in step),
 * `DELETE` removes the message and its generations.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index.js';
import { mirrorChat } from '$lib/server/db/layout.js';
import { deleteMessage, updateMessageContent } from '$lib/server/db/chats.js';

const patchSchema = z.object({ content: z.string().min(1) });

function chatOf(id: string): string | null {
	const row = db().prepare('SELECT chat_id FROM messages WHERE id = ?').get(id) as
		{ chat_id: string } | undefined;
	return row?.chat_id ?? null;
}

export async function PATCH({ params, request }) {
	const chatId = chatOf(params.id);
	if (!chatId) error(404, 'Message not found');

	const parsed = patchSchema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Content is required');

	updateMessageContent(db(), params.id, parsed.data.content);
	mirrorChat(db(), chatId);
	return json({ id: params.id, content: parsed.data.content });
}

export function DELETE({ params }) {
	const chatId = chatOf(params.id);
	if (!chatId) error(404, 'Message not found');
	deleteMessage(db(), params.id);
	mirrorChat(db(), chatId);
	return json({ id: params.id, deleted: true });
}
