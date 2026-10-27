/**
 * Upload limits, as a regression test.
 *
 * The inpaint route takes two PNGs. SvelteKit's built-in body limit is 512 KB, which is *smaller than one
 * mask*: the feature silently answered "Expected a multipart form" instead of reading the upload. The app
 * therefore ships `BODY_SIZE_LIMIT=32M` (start-chatchat.bat, playwright.config.ts). This test fails if
 * that setting ever gets dropped, because the body below is ~1.5 MB.
 */
import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

test('a real-sized inpaint upload is accepted, not truncated by the body limit', async ({
	request
}) => {
	// 1.5 MB of bytes: enough to exceed the 512 KB default, cheap to generate.
	const big = Buffer.alloc(1_500_000, 7);

	const response = await request.post('/api/images/inpaint', {
		multipart: {
			source: { name: 'source.png', mimeType: 'image/png', buffer: big },
			mask: { name: 'mask.png', mimeType: 'image/png', buffer: big },
			prompt: 'a glowing pendant',
			chatId: ''
		}
	});

	const body = (await response.json()) as { error?: string };

	// ComfyUI is unreachable in this stack, so the route is allowed to fail *after* reading the body.
	expect(body.error ?? '').not.toMatch(/exceeds limit|multipart form/i);
	expect(response.status()).not.toBe(413);
});
