/**
 * Image metadata repository. Bytes live in `data/images/<id>.<ext>`; this table is the index.
 * (Decision 2026-10-26: files for bytes, SQLite for metadata — see `_notes/TODO.md`.)
 */
import { randomUUID } from 'node:crypto';
import { allRows, oneRow, type Db } from './index.js';
import { now } from './chats.js';
import type { ImageRecord } from '../../shared/image.js';

/**
 * A stored picture. The columns the browser sees are declared once, in `shared/image.ts`; this row adds
 * the three that are ours alone (where the bytes are, what they are, and the raw ComfyUI report).
 */
export interface ImageRow extends ImageRecord {
	file: string;
	mime: string;
	meta: string | null;
}

export function insertImage(
	db: Db,
	input: {
		id?: string;
		chatId?: string | null;
		messageId?: string | null;
		file: string;
		mime: string;
		width?: number;
		height?: number;
		prompt?: string;
		seed?: number;
		workflow?: string;
		meta?: unknown;
	}
): ImageRow {
	const row: ImageRow = {
		id: input.id ?? randomUUID(),
		chat_id: input.chatId ?? null,
		message_id: input.messageId ?? null,
		file: input.file,
		mime: input.mime,
		width: input.width ?? null,
		height: input.height ?? null,
		prompt: input.prompt ?? null,
		seed: input.seed ?? null,
		workflow: input.workflow ?? null,
		created_at: now(),
		meta: input.meta === undefined ? null : JSON.stringify(input.meta)
	};

	db.prepare(
		`INSERT INTO images (id, chat_id, message_id, file, mime, width, height, prompt, seed, workflow, created_at, meta)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		row.id,
		row.chat_id,
		row.message_id,
		row.file,
		row.mime,
		row.width,
		row.height,
		row.prompt,
		row.seed,
		row.workflow,
		row.created_at,
		row.meta
	);

	return row;
}

export function getImage(db: Db, id: string): ImageRow | undefined {
	return oneRow<ImageRow>(db.prepare('SELECT * FROM images WHERE id = ?'), id);
}

export function listImages(db: Db, chatId: string): ImageRow[] {
	return allRows<ImageRow>(
		db.prepare('SELECT * FROM images WHERE chat_id = ? ORDER BY created_at ASC'),
		chatId
	);
}

export function deleteImage(db: Db, id: string): void {
	db.prepare('DELETE FROM images WHERE id = ?').run(id);
}
