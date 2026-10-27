/** Chat + message + search repositories. One table family per file, plain SQL, no ORM. */
import { randomUUID } from 'node:crypto';
import { allRows, oneRow, type Db } from './index.js';

export type Role = 'system' | 'user' | 'assistant';

export interface ChatRow {
	id: string;
	title: string;
	created_at: number;
	updated_at: number;
	story: string | null;
	meta: string | null;
}

export interface MessageRow {
	id: string;
	chat_id: string;
	seq: number;
	role: Role;
	content: string;
	created_at: number;
	meta: string | null;
}

export function now(): number {
	return Date.now();
}

export function createChat(
	db: Db,
	options: { id?: string; title?: string; story?: unknown; meta?: unknown } = {}
): ChatRow {
	const at = now();
	const row: ChatRow = {
		id: options.id ?? randomUUID(),
		title: options.title?.trim() || 'New chat',
		created_at: at,
		updated_at: at,
		story: options.story === undefined ? null : JSON.stringify(options.story),
		meta: options.meta === undefined ? null : JSON.stringify(options.meta)
	};

	db.prepare(
		`INSERT INTO chats (id, title, created_at, updated_at, story, meta)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(row.id, row.title, row.created_at, row.updated_at, row.story, row.meta);

	return row;
}

export function listChats(db: Db): ChatRow[] {
	return allRows<ChatRow>(db.prepare('SELECT * FROM chats ORDER BY updated_at DESC'));
}

export function getChat(db: Db, id: string): ChatRow | undefined {
	return oneRow<ChatRow>(db.prepare('SELECT * FROM chats WHERE id = ?'), id);
}

export function renameChat(db: Db, id: string, title: string): void {
	db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id);
}

export function setChatStory(db: Db, id: string, story: unknown): void {
	db.prepare('UPDATE chats SET story = ?, updated_at = ? WHERE id = ?').run(
		story === null ? null : JSON.stringify(story),
		now(),
		id
	);
}

export function deleteChat(db: Db, id: string): void {
	db.prepare('DELETE FROM chats WHERE id = ?').run(id);
}

/** Append a message and keep the chat's `updated_at` in the same transaction. */
export function appendMessage(
	db: Db,
	input: { chatId: string; role: Role; content: string; id?: string; meta?: unknown }
): MessageRow {
	const at = now();
	const row: MessageRow = {
		id: input.id ?? randomUUID(),
		chat_id: input.chatId,
		seq: 0,
		role: input.role,
		content: input.content,
		created_at: at,
		meta: input.meta === undefined ? null : JSON.stringify(input.meta)
	};

	db.exec('BEGIN');
	try {
		const last = oneRow<{ seq: number }>(
			db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE chat_id = ?'),
			input.chatId
		);
		row.seq = (last?.seq ?? 0) + 1;

		db.prepare(
			`INSERT INTO messages (id, chat_id, seq, role, content, created_at, meta)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(row.id, row.chat_id, row.seq, row.role, row.content, row.created_at, row.meta);

		db.prepare('INSERT INTO messages_fts (content, message_id, chat_id) VALUES (?, ?, ?)').run(
			row.content,
			row.id,
			row.chat_id
		);

		db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(at, input.chatId);
		db.exec('COMMIT');
		return row;
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

export function listMessages(db: Db, chatId: string): MessageRow[] {
	return allRows<MessageRow>(
		db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq ASC'),
		chatId
	);
}

export function deleteMessage(db: Db, id: string): void {
	db.exec('BEGIN');
	try {
		db.prepare('DELETE FROM messages WHERE id = ?').run(id);
		db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(id);
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

export function updateMessageContent(db: Db, id: string, content: string): void {
	db.exec('BEGIN');
	try {
		db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
		db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(id);
		const row = oneRow<{ chat_id: string }>(
			db.prepare('SELECT chat_id FROM messages WHERE id = ?'),
			id
		);
		if (row) {
			db.prepare('INSERT INTO messages_fts (content, message_id, chat_id) VALUES (?, ?, ?)').run(
				content,
				id,
				row.chat_id
			);
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

/** Rewrite one message's metadata blob (generation stats), leaving the text alone. */
export function updateMessageMeta(db: Db, id: string, meta: unknown): void {
	db.prepare('UPDATE messages SET meta = ? WHERE id = ?').run(
		meta === undefined ? null : JSON.stringify(meta),
		id
	);
}

/**
 * Full-text search (FTS5). Returns a snippet around the match, newest first.
 *
 * The query is passed straight to FTS5, so callers must validate what a user typed — see
 * `/api/search`, which quotes bare words so that `foo-bar` cannot become a syntax error.
 */
export function searchMessages(
	db: Db,
	query: string,
	limit = 20
): Array<{ message_id: string; chat_id: string; snippet: string }> {
	return allRows<{ message_id: string; chat_id: string; snippet: string }>(
		db.prepare(
			`SELECT message_id, chat_id, snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
			 FROM messages_fts
			 WHERE messages_fts MATCH ?
			 ORDER BY rowid DESC
			 LIMIT ?`
		),
		query,
		limit
	);
}

/** Alternate generations for one assistant message (the "cycle responses" feature). */
export function saveGeneration(db: Db, messageId: string, idx: number, content: string): void {
	db.prepare(
		`INSERT INTO generations (message_id, idx, content, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(message_id, idx) DO UPDATE SET content = excluded.content`
	).run(messageId, idx, content, now());
}

export function listGenerations(
	db: Db,
	messageId: string
): Array<{ idx: number; content: string }> {
	return allRows<{ idx: number; content: string }>(
		db.prepare('SELECT idx, content FROM generations WHERE message_id = ? ORDER BY idx ASC'),
		messageId
	);
}
