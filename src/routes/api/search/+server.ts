/**
 * `GET /api/search?q=…` — full-text search across every chat's messages.
 *
 * FTS5 has its own query syntax, and a stray quote or dash is a hard error rather than "no results".
 * The user's text is therefore split into words, each quoted, and OR-ed: `don't panic` searches for
 * both words instead of throwing. That is the behaviour people expect from a search box.
 */
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { searchMessages } from '$lib/server/db/chats.js';

/** FTS5 treats these as operators; quoting each word keeps them literal. */
function toFtsQuery(input: string): string {
	return input
		.split(/\s+/)
		.map((word) => word.replace(/["']/g, '').trim())
		.filter(Boolean)
		.map((word) => `"${word}"`)
		.join(' OR ');
}

export function GET({ url }) {
	const query = (url.searchParams.get('q') ?? '').trim();
	if (query.length < 2) return json({ query, hits: [] });

	const fts = toFtsQuery(query);
	if (!fts) return json({ query, hits: [] });

	let rows: Array<{ message_id: string; chat_id: string; snippet: string }>;
	try {
		rows = searchMessages(db(), fts, 30);
	} catch (cause) {
		// A malformed query must read as "nothing found", not as a 500 in the sidebar.
		return json({ query, hits: [], error: cause instanceof Error ? cause.message : String(cause) });
	}

	const titles = new Map(
		(db().prepare('SELECT id, title FROM chats').all() as Array<{ id: string; title: string }>).map(
			(row) => [row.id, row.title]
		)
	);

	return json({
		query,
		hits: rows.map((row) => ({
			messageId: row.message_id,
			chatId: row.chat_id,
			chatTitle: titles.get(row.chat_id) ?? 'Chat',
			snippet: row.snippet
		}))
	});
}
