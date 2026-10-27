/**
 * Image bytes on disk, metadata in SQLite.
 *
 * One file per image, named `<image id>.<ext>`, so a backup is "copy `data/`" and a deleted row can
 * never leave an orphan that another row points at. The id is a UUID, never a user-visible name, so a
 * prompt cannot escape the directory.
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR } from '../config.js';

const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};

export function imagePath(file: string): string {
	// `file` is our own `<uuid>.<ext>`; resolving still guards against a corrupted database row.
	const resolved = path.resolve(IMAGES_DIR, file);
	if (!resolved.startsWith(path.resolve(IMAGES_DIR))) {
		throw new Error(`Refusing to read outside the image directory: ${file}`);
	}
	return resolved;
}

export function extensionFor(mime: string): string {
	const extension = EXTENSIONS[mime];
	if (!extension) throw new Error(`Unsupported image type: ${mime} (expected PNG, JPEG or WebP)`);
	return extension;
}

/** Write bytes for an image id. Returns the file name stored in the database. */
export function writeImageFile(id: string, bytes: Buffer, mime: string): string {
	fs.mkdirSync(IMAGES_DIR, { recursive: true });
	const file = `${id}.${extensionFor(mime)}`;
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
