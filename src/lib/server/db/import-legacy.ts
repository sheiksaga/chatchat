/**
 * One-way importer for the pre-rewrite folder format.
 *
 * Legacy layout (see `legacy/tools/serve.js` header):
 *   <from>/index.json            { order: string[], meta: { [id]: {...} } }
 *   <from>/<id>/chat.json        { messages: [{ role, content }], generations: {...} }
 *   <from>/<id>/story.json       free-form scene record (optional)
 *   <from>/images/<id>.bin       picture bytes
 *   <from>/images/<id>.json      { mime, chatId, ... }
 *
 * The importer is deliberately forgiving: it reports what it could not map instead of failing
 * the whole run. It never writes to the legacy folder.
 */
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR } from '../config.js';
import { appendMessage, createChat, saveGeneration, type Role } from './chats.js';
import { insertImage } from './images.js';
import type { Db } from './index.js';

interface LegacyIndex {
	order: string[];
	meta: Record<string, Record<string, unknown>>;
}

interface LegacyChat {
	messages: Array<{ role: string; content: string }>;
	generations?: Record<string, unknown> | unknown[];
}

export interface ImportReport {
	chats: number;
	messages: number;
	generations: number;
	images: number;
	skipped: string[];
	warnings: string[];
}

const EXT_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

function isRole(value: string): value is Role {
	return value === 'system' || value === 'user' || value === 'assistant';
}

/** Generations were keyed either by message index (`{ "0": ["alt"] }`) or stored flat. */
function generationsFor(source: LegacyChat, messageIndex: number): string[] {
	const bag = source.generations;
	if (!bag) return [];
	const value = Array.isArray(bag)
		? bag[messageIndex]
		: (bag as Record<string, unknown>)[String(messageIndex)];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export async function importLegacy(
	db: Db,
	options: { from: string; imagesDir?: string }
): Promise<ImportReport> {
	const from = path.resolve(options.from);
	const imagesDir = options.imagesDir ?? IMAGES_DIR;
	const report: ImportReport = {
		chats: 0,
		messages: 0,
		generations: 0,
		images: 0,
		skipped: [],
		warnings: []
	};

	if (!existsSync(from)) {
		throw new Error(
			`Legacy chats folder not found: ${from}\n` +
				`Pass --from <path> or use the app once so the folder exists.`
		);
	}

	const indexPath = path.join(from, 'index.json');
	const index: LegacyIndex = existsSync(indexPath)
		? JSON.parse(await readFile(indexPath, 'utf8'))
		: { order: [], meta: {} };

	if (!index.order.length) {
		// No index.json: fall back to every folder that looks like a chat.
		const entries = await readdir(from, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === 'images') continue;
			if (existsSync(path.join(from, entry.name, 'chat.json'))) index.order.push(entry.name);
		}
	}

	for (const id of index.order) {
		const chatPath = path.join(from, id, 'chat.json');
		if (!existsSync(chatPath)) {
			report.skipped.push(`${id} (no chat.json)`);
			continue;
		}

		if (db.prepare('SELECT 1 FROM chats WHERE id = ?').get(id)) {
			report.skipped.push(`${id} (already imported)`);
			continue;
		}

		const source = JSON.parse(await readFile(chatPath, 'utf8')) as LegacyChat;
		const storyPath = path.join(from, id, 'story.json');
		const story = existsSync(storyPath) ? JSON.parse(await readFile(storyPath, 'utf8')) : undefined;

		const meta = index.meta?.[id];
		const title =
			(typeof meta?.title === 'string' && meta.title) ||
			firstMessageLine(source) ||
			`Imported ${id.slice(0, 8)}`;

		createChat(db, { id, title, story, meta });

		let index_ = 0;
		for (const message of source.messages ?? []) {
			if (!message || typeof message.content !== 'string') {
				report.warnings.push(`${id}: message ${index_} has no content`);
				index_ += 1;
				continue;
			}
			const role = isRole(message.role) ? message.role : 'user';
			if (!isRole(message.role)) report.warnings.push(`${id}: unknown role "${message.role}"`);

			const row = appendMessage(db, { chatId: id, role, content: message.content });
			report.messages += 1;

			generationsFor(source, index_).forEach((content, genIndex) => {
				saveGeneration(db, row.id, genIndex, content);
				report.generations += 1;
			});
			index_ += 1;
		}

		report.chats += 1;
	}

	// Images: bytes + sidecar metadata, tied to their chat.
	const legacyImages = path.join(from, 'images');
	if (existsSync(legacyImages)) {
		await mkdir(imagesDir, { recursive: true });
		for (const file of await readdir(legacyImages)) {
			if (!file.endsWith('.bin')) continue;
			const id = file.slice(0, -4);
			const metaPath = path.join(legacyImages, `${id}.json`);
			const meta = existsSync(metaPath)
				? (JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>)
				: {};
			const mime = typeof meta.mime === 'string' ? meta.mime : 'image/png';
			const chatId = typeof meta.chatId === 'string' ? meta.chatId : null;

			if (db.prepare('SELECT 1 FROM images WHERE id = ?').get(id)) continue;

			const target = `${id}.${EXT_BY_MIME[mime] ?? 'bin'}`;
			await copyFile(path.join(legacyImages, file), path.join(imagesDir, target));

			insertImage(db, {
				id,
				chatId:
					chatId && db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId) ? chatId : null,
				file: target,
				mime,
				prompt: typeof meta.prompt === 'string' ? meta.prompt : undefined,
				seed: typeof meta.seed === 'number' ? meta.seed : undefined,
				workflow: typeof meta.workflow === 'string' ? meta.workflow : undefined,
				meta
			});
			report.images += 1;
		}
	}

	return report;
}

/** Title fallback: the first message with text, whatever its role (system-only chats exist). */
function firstMessageLine(chat: LegacyChat): string | undefined {
	const message = (chat.messages ?? []).find((m) => m?.content && m.content.trim());
	if (!message) return undefined;
	return message.content.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
}
