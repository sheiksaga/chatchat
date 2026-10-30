import { describe, expect, it } from 'vitest';
import {
	STORY_LOOK_MAX,
	STORY_SEED_MAX,
	STORY_STYLES,
	emptyStory,
	parseStory,
	pinStyle,
	storyPatchSchema,
	storyStyle
} from './story.js';

describe('parseStory', () => {
	it('fills in every field for a chat that has never had a story', () => {
		expect(parseStory(null)).toEqual(emptyStory());
		expect(parseStory(undefined)).toEqual(emptyStory());
		expect(parseStory({})).toEqual(emptyStory());
	});

	it('reads the only field the old record had', () => {
		// Every chat drawn before this record existed looks exactly like this. It has to load, not throw.
		expect(parseStory({ look: 'moonlit forest shrine' })).toEqual({
			look: 'moonlit forest shrine',
			style: 'none',
			seed: null,
			autoImages: null,
			imageWorkflow: null,
			shotState: null
		});
	});

	it('survives a stored value that is not even an object', () => {
		expect(parseStory('nonsense')).toEqual(emptyStory());
		expect(parseStory([1, 2, 3])).toEqual(emptyStory());
	});

	it('drops fields the app no longer has', () => {
		const parsed = parseStory({ look: 'a bakery', present: ['Jess'], characters: { jess: {} } });
		expect(parsed).toEqual({
			look: 'a bakery',
			style: 'none',
			seed: null,
			autoImages: null,
			imageWorkflow: null,
			shotState: null
		});
		expect('present' in parsed).toBe(false);
	});

	it('ignores a style it does not know instead of failing the page', () => {
		expect(parseStory({ style: 'oil-painting' }).style).toBe('none');
		expect(parseStory({ style: 42 }).style).toBe('none');
	});

	it('keeps a usable seed and refuses the rest', () => {
		expect(parseStory({ seed: 1234 }).seed).toBe(1234);
		expect(parseStory({ seed: 12.7 }).seed).toBe(12);
		expect(parseStory({ seed: -5 }).seed).toBeNull();
		expect(parseStory({ seed: STORY_SEED_MAX + 1000 }).seed).toBe(STORY_SEED_MAX);
		expect(parseStory({ seed: '1234' }).seed).toBeNull();
		expect(parseStory({ seed: Number.NaN }).seed).toBeNull();
	});

	it('treats a missing auto-draw flag as "inherit", not as "off"', () => {
		// `null` means the card decides (a storyboard utility draws its own markers). Only an explicit
		// `false` turns it off, which is what the scene panel writes when the reader flips the switch.
		expect(parseStory({}).autoImages).toBeNull();
		expect(parseStory({ autoImages: false }).autoImages).toBe(false);
		expect(parseStory({ autoImages: true }).autoImages).toBe(true);
		expect(parseStory({ autoImages: 'yes' }).autoImages).toBeNull();
	});

	it('truncates an overlong look rather than storing it', () => {
		expect(parseStory({ look: 'x'.repeat(STORY_LOOK_MAX + 50) }).look).toHaveLength(STORY_LOOK_MAX);
	});
});

describe('storyPatchSchema', () => {
	it('accepts a single field, so saving the look cannot erase the seed', () => {
		expect(storyPatchSchema.parse({ look: 'a shrine' })).toEqual({ look: 'a shrine' });
	});

	it('accepts the auto-draw flag on its own', () => {
		expect(storyPatchSchema.parse({ autoImages: false })).toEqual({ autoImages: false });
	});

	it('accepts an explicit null seed, which is how "no fixed seed" is stored', () => {
		expect(storyPatchSchema.parse({ seed: null })).toEqual({ seed: null });
	});

	it('rejects a style outside the registry and a negative seed', () => {
		expect(storyPatchSchema.safeParse({ style: 'watercolour' }).success).toBe(false);
		expect(storyPatchSchema.safeParse({ seed: -1 }).success).toBe(false);
	});
});

describe('storyStyle', () => {
	it('has a unique id per style', () => {
		expect(new Set(STORY_STYLES.map((style) => style.id)).size).toBe(STORY_STYLES.length);
	});

	it('resolves the registry, and falls back to none', () => {
		expect(storyStyle('anime').label).toBe('Anime');
		expect(storyStyle('oil-painting').tags).toBe('');
		expect(storyStyle(null).id).toBe('none');
	});

	it('gives every real style both a tag and a prose form', () => {
		// Two prompt dialects read this record: tag lists take `tags`, Z-Image takes `prose`. A style that
		// only filled one of them would silently do nothing for half the picker.
		for (const style of STORY_STYLES.filter((entry) => entry.id !== 'none')) {
			expect(style.tags.length, style.id).toBeGreaterThan(0);
			expect(style.prose.length, style.id).toBeGreaterThan(0);
		}
	});
});

describe('pinStyle', () => {
	it('appends the style tags the writer left out', () => {
		expect(pinStyle('1woman, green sweater, cinema', 'anime')).toBe(
			'1woman, green sweater, cinema, anime screenshot, cel shading, clean lineart, vivid color'
		);
	});

	it('leaves a prompt that already carries the style alone', () => {
		const prompt = '1woman, cinema, anime screenshot, cel shading, clean lineart, vivid color';
		expect(pinStyle(prompt, 'anime')).toBe(prompt);
	});

	it('is a no-op when the chat has no style, and does not leave a dangling comma', () => {
		expect(pinStyle('1woman, cinema,', 'none')).toBe('1woman, cinema');
	});
});
