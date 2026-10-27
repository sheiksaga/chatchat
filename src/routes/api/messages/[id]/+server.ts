/**
 * Per-message edits: `PATCH { content }` rewrites the text (and keeps the FTS index in step),
 * `DELETE` removes the message and its generations.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index.js';
import { deleteMessage, updateMessageContent } from '$lib/server/db/chats.js';

const patchSchema = z.object({ content: z.string().min(1) });

function exists(id: string): boolean {
	return Boolean(db().prepare('SELECT 1 FROM messages WHERE id = ?').get(id));
}

export async function PATCH({ params, request }) {
	if (!exists(params.id)) error(404, 'Message not found');

	const parsed = patchSchema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Content is required');

	updateMessageContent(db(), params.id, parsed.data.content);
	return json({ id: params.id, content: parsed.data.content });
}

export function DELETE({ params }) {
	if (!exists(params.id)) error(404, 'Message not found');
	deleteMessage(db(), params.id);
	return json({ id: params.id, deleted: true });
}
