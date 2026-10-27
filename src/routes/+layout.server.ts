/**
 * The sidebar is on every page, so the chat list is loaded once here instead of per route.
 */
import { db } from '$lib/server/db/index.js';
import { listChats } from '$lib/server/db/chats.js';
import { getConfig } from '$lib/server/config-store.js';
import type { ChatSummary } from '$lib/shared/chat.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = () => {
	const chats: ChatSummary[] = listChats(db()).map((row) => ({
		id: row.id,
		title: row.title,
		updatedAt: row.updated_at,
		messageCount: 0
	}));
	// Reading comfort belongs on the shell, not in every page.
	return { chats, appearance: getConfig().appearance, userName: getConfig().userName };
};
