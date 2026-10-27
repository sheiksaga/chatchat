/**
 * `GET /api/images/[id]` — the bytes. `DELETE` — forget them.
 *
 * Immutable cache headers are safe because an image id is the content: regenerating writes a new id, so
 * browsers and the service worker can keep old bytes forever without ever showing a stale picture.
 * Range requests are honoured so a large image can start painting before it has fully arrived.
 */
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { deleteImage, getImage } from '$lib/server/db/images.js';
import { deleteImageFile, imageFileExists, readImageFile } from '$lib/server/images/store.js';

export function GET({ params, request }) {
	const row = getImage(db(), params.id);
	if (!row) error(404, 'No such image');
	if (!imageFileExists(row.file)) error(410, 'The image file is gone (deleted outside the app?)');

	const bytes = readImageFile(row.file);
	const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);

	if (range) {
		const start = range[1] ? Number(range[1]) : 0;
		const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
		if (start > end || start >= bytes.length) {
			return new Response(null, {
				status: 416,
				headers: { 'content-range': `bytes */${bytes.length}` }
			});
		}
		const slice = bytes.subarray(start, end + 1);
		return new Response(new Uint8Array(slice), {
			status: 206,
			headers: {
				'content-type': row.mime,
				'content-length': String(slice.length),
				'content-range': `bytes ${start}-${end}/${bytes.length}`,
				'accept-ranges': 'bytes',
				'cache-control': 'public, max-age=31536000, immutable'
			}
		});
	}

	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': row.mime,
			'content-length': String(bytes.length),
			'accept-ranges': 'bytes',
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
}

export function DELETE({ params }) {
	const row = getImage(db(), params.id);
	if (!row) error(404, 'No such image');
	deleteImage(db(), row.id);
	deleteImageFile(row.file);
	return json({ ok: true });
}
