/**
 * Image bytes on disk, metadata in SQLite.
 *
 * A picture lives next to the chat that made it — `data/chats/<chatId>/images/<uuid>.png` — so the
 * folder for a conversation contains its transcript, its scene state and its pictures. Images with no
 * chat fall back to `data/images/`. Paths stored in the database are **relative to `data/`**, which
 * makes the whole folder portable (see `db/layout.ts`).
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, imageDirFor } from '../db/layout.js';

const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};

/** Absolute path for a stored relative path (`chats/<id>/images/<uuid>.png`). */
export function imagePath(file: string): string {
	return dataPath(file);
}

export function extensionFor(mime: string): string {
	const extension = EXTENSIONS[mime];
	if (!extension) throw new Error(`Unsupported image type: ${mime} (expected PNG, JPEG or WebP)`);
	return extension;
}

/**
 * Write bytes for an image id, inside the chat's folder when there is a chat.
 * Returns the path stored in the database, relative to `data/`.
 */
export function writeImageFile(
	id: string,
	bytes: Buffer,
	mime: string,
	chatId?: string | null
): string {
	const file = `${imageDirFor(chatId)}/${id}.${extensionFor(mime)}`;
	fs.mkdirSync(path.dirname(imagePath(file)), { recursive: true });
	fs.writeFileSync(imagePath(file), bytes);
	return file;
}

export function readImageFile(file: string): Buffer {
	return fs.readFileSync(imagePath(file));
}

export function deleteImageFile(file: string): void {
	fs.rmSync(imagePath(file), { force: true });
}

/** True when the file is still on disk — used by `/api/images/[id]` to answer 410, not 500. */
export function imageFileExists(file: string): boolean {
	return fs.existsSync(imagePath(file));
}

/** Sniff the real type from magic bytes; a ComfyUI node can hand us either PNG or JPEG. */
export function sniffMime(bytes: Buffer): string {
	if (
		bytes.length >= 8 &&
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
		bytes.subarray(8, 12).toString('latin1') === 'WEBP'
	) {
		return 'image/webp';
	}
	return 'image/png';
}

/** Read width/height out of a PNG header (IHDR). ComfyUI only writes PNG, so no full decoder needed. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
	if (bytes.length < 24 || sniffMime(bytes) !== 'image/png') return null;
	if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
