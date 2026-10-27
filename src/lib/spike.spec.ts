import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
	it('runs unit tests', () => {
		expect([1, 2, 3].map((n) => n * 2)).toEqual([2, 4, 6]);
	});
});
