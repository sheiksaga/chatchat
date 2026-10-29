/**
 * Which message a picture belongs under.
 *
 * The whole point of `placeImages` is that a picture can never drift: not to the bottom of the screen,
 * not under a later reply, not into another chat's transcript. It is pure, so these tests are the
 * contract the chat page renders against.
 */
import { describe, expect, it } from 'vitest';
import { placeImages, type ImageRecord } from './image.js';

function picture(over: Partial<ImageRecord> = {}): ImageRecord {
	return {
		id: 'img',
		chat_id: 'chat',
		message_id: null,
		width: 832,
		height: 1216,
		prompt: 'a lighthouse',
		seed: 1,
		workflow: 'krea2-anime-t2i',
		created_at: 0,
		...over
	};
}

const turns = [
	{ id: 'm1', createdAt: 1000 },
	{ id: 'm2', createdAt: 2000 }
];

describe('placeImages', () => {
	it('follows message_id over the clock', () => {
		// A picture attached to the first turn, drawn after the second one exists.
		const { byMessage, loose } = placeImages(
			[picture({ id: 'a', message_id: 'm1', created_at: 3000 })],
			turns
		);
		expect(loose).toEqual([]);
		expect(byMessage.get('m1')?.map((image) => image.id)).toEqual(['a']);
	});

	it('gives a legacy row (no message_id) to the turn that existed when it was drawn', () => {
		const { byMessage } = placeImages(
			[picture({ id: 'old', created_at: 1500 }), picture({ id: 'newer', created_at: 2500 })],
			turns
		);
		expect(byMessage.get('m1')?.map((image) => image.id)).toEqual(['old']);
		expect(byMessage.get('m2')?.map((image) => image.id)).toEqual(['newer']);
	});

	it('keeps a picture with no turn at all out of the transcript proper', () => {
		const { byMessage, loose } = placeImages([picture({ id: 'early', created_at: 10 })], turns);
		expect(byMessage.size).toBe(0);
		expect(loose.map((image) => image.id)).toEqual(['early']);
	});

	it('ignores a message_id that this transcript does not contain', () => {
		// Dead message (deleted turn, or a picture drawn while the reply was still streaming).
		const { byMessage, loose } = placeImages(
			[picture({ id: 'orphan', message_id: 'gone', created_at: 1500 })],
			turns
		);
		expect(loose).toEqual([]);
		expect(byMessage.get('m1')?.map((image) => image.id)).toEqual(['orphan']);
	});

	it('orders a turn’s pictures oldest first, whatever order they arrive in', () => {
		const { byMessage } = placeImages(
			[
				picture({ id: 'second', message_id: 'm2', created_at: 2200 }),
				picture({ id: 'first', message_id: 'm2', created_at: 2100 })
			],
			turns
		);
		expect(byMessage.get('m2')?.map((image) => image.id)).toEqual(['first', 'second']);
	});
});
