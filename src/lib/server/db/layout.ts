/**
 * The shape of `data/`, and the code that keeps it that way.
 *
 * Every chat is a folder you can open in Explorer / Finder and understand without the app:
 *
 *   data/
 *     chatchat.db                     metadata (the app's working copy)
 *     config.json                     providers + keys (0600)
 *     cards/<characterId>.png         card avatars, shared by every chat using that card
 *     chats/<chatId>/
 *       chat.json                     transcript + images + character, pretty-printed
 *       story.json                    the scene record (`look`, whatever else the story holds)
 *       images/<imageId>.png          the pictures, next to the chat that made them
 *     images/<imageId>.png            pictures that belong to no chat
 *
 * The database stays the source of truth for the app; `chat.json` / `story.json` are a **mirror**,
 * rewritten atomically after every write. Two files, not two sources of truth: if the mirror is ever
 * deleted, the app still works and the next write recreates it.
 *
 * `file` columns store paths **relative to `data/`** (forward slashes), so moving the whole folder or
 * copying it to another machine changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CHATS_DIR, DATA_DIR, IMAGES_DIR } from '../config.js';
import type { Db } from './index.js';
import { getChat, listGenerations, listMessages, type ChatRow } from './chats.js';
import { getCharacter } from './characters.js';
import { listImages } from './images.js';

/** Directory that holds one chat's files. */
export function chatDir(chatId: string): string {
	return path.join(CHATS_DIR, chatId);
}

/** Where a picture for this chat lives, relative to `data/`. */
export function imageDirFor(chatId: string | null | undefined): string {
	return chatId ? `chats/${chatId}/images` : 'images';
}

/** Absolute path for a stored relative path, refusing anything that escapes `data/`. */
export function dataPath(relative: string): string {
	const root = path.resolve(DATA_DIR);
	const resolved = path.resolve(root, relative);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`Refusing to touch a path outside data/: ${relative}`);
	}
	return resolved;
}

function writeJsonAtomic(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
	fs.renameSync(temporary, file);
}

/**
 * Rewrite `chats/<id>/chat.json` and `story.json` from the database.
 *
 * Called after every write that changes a chat, so the files always describe the current state. Cheap
 * enough to run per message: a chat with hundreds of turns is a few hundred KB of JSON.
 */
export function mirrorChat(database: Db, chatId: string): void {
	const chat = getChat(database, chatId);
	if (!chat) return;

	const character = characterOf(database, chat);
	const messages = listMessages(database, chatId).map((message) => ({
		id: message.id,
		role: message.role,
		content: message.content,
		createdAt: message.created_at,
		...(message.role === 'assistant'
			? {
					generations: listGenerations(database, message.id).map((entry) => entry.content),
					stats: message.meta ? safeParse(message.meta) : null
				}
			: {})
	}));

	const images = listImages(database, chatId).map((image) => ({
		id: image.id,
		file: image.file,
		prompt: image.prompt,
		seed: image.seed,
		workflow: image.workflow,
		width: image.width,
		height: image.height,
		createdAt: image.created_at
	}));

	const story = chat.story ? safeParse(chat.story) : null;
	const directory = chatDir(chatId);
	fs.mkdirSync(path.join(directory, 'images'), { recursive: true });

	writeJsonAtomic(path.join(directory, 'chat.json'), {
		id: chat.id,
		title: chat.title,
		createdAt: chat.created_at,
		updatedAt: chat.updated_at,
		character,
		messageCount: messages.length,
		messages,
		images
	});
	writeJsonAtomic(path.join(directory, 'story.json'), story ?? {});
}

/** Remove a chat's folder, including its pictures. Called when the chat row is deleted. */
export function removeChatDir(chatId: string): void {
	fs.rmSync(chatDir(chatId), { recursive: true, force: true });
}

/**
 * Move pictures written by older versions (flat `images/<uuid>.png`) into their chat's folder and
 * update the database. Idempotent, and safe to run on every start: rows whose `file` already carries a
 * directory are skipped.
 */
export function relocateImages(database: Db): { moved: number; missing: number } {
	const rows = database.prepare('SELECT id, chat_id, file FROM images').all() as Array<{
		id: string;
		chat_id: string | null;
		file: string;
	}>;

	let moved = 0;
	let missing = 0;
	for (const row of rows) {
		if (row.file.includes('/')) continue;

		const target = `${imageDirFor(row.chat_id)}/${row.file}`;
		const source = path.join(IMAGES_DIR, row.file);
		if (fs.existsSync(source)) {
			fs.mkdirSync(path.dirname(dataPath(target)), { recursive: true });
			fs.renameSync(source, dataPath(target));
			moved += 1;
		} else if (!fs.existsSync(dataPath(target))) {
			missing += 1;
			continue;
		}

		database.prepare('UPDATE images SET file = ? WHERE id = ?').run(target, row.id);
	}

	return { moved, missing };
}

/**
 * Drop metadata for pictures whose bytes are gone (a deleted folder, a restored database without its
 * files). Keeping the row would render a broken thumbnail that answers 410 with no way to clear it.
 */
export function pruneMissingImages(database: Db): number {
	const rows = database.prepare('SELECT id, file FROM images').all() as Array<{
		id: string;
		file: string;
	}>;
	let removed = 0;
	for (const row of rows) {
		if (fs.existsSync(dataPath(row.file))) continue;
		database.prepare('DELETE FROM images WHERE id = ?').run(row.id);
		removed += 1;
	}
	return removed;
}

/** Rebuild every mirror. Used after a migration or an import, never on the read path. */
export function mirrorAllChats(database: Db): number {
	const rows = database.prepare('SELECT id FROM chats').all() as Array<{ id: string }>;
	for (const row of rows) mirrorChat(database, row.id);
	return rows.length;
}

function characterOf(database: Db, chat: ChatRow): { id: string; name: string } | null {
	const characterId = typeof chat.character_id === 'string' ? chat.character_id : null;
	if (!characterId) return null;
	const row = getCharacter(database, characterId);
	return row ? { id: row.id, name: row.name } : null;
}

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return { unparsable: json };
	}
}
