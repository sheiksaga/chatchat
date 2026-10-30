/**
 * The `[[IMG]]` grammar — the vocabulary character cards are written against.
 *
 * These cases come from the shipped Storyboard card's own examples and from ComfyInject's parser, which
 * is what taught models to write `| PORTRAIT | MEDIUM | LOCK |`. Getting this wrong is not cosmetic: it
 * put the word MEDIUM inside generated pictures and turned every LOCK into a fresh face.
 */
import { describe, expect, it } from 'vitest';
import { findImageMarkers, parseMarkerBody, stripImageMarkers } from './image.js';

describe('parseMarkerBody: the plain form', () => {
	it('reads prompt, explicit size and integer seed', () => {
		expect(parseMarkerBody('a knight, plate armor | 832x1216 | close-up | 42')).toEqual({
			prompt: 'a knight, plate armor, close-up',
			width: 832,
			height: 1216,
			seed: 42,
			lock: undefined
		});
	});

	it('keeps a free-text shot segment as tags', () => {
		const parsed = parseMarkerBody('a cat | SQUARE | sitting on a mat, warm light');
		expect(parsed?.prompt).toBe('a cat, sitting on a mat, warm light');
		expect(parsed?.width).toBe(1024);
		expect(parsed?.height).toBe(1024);
	});

	it('rejects an empty prompt but keeps a marker with only a shot word', () => {
		expect(parseMarkerBody('  | PORTRAIT | CLOSE | RANDOM ')).toBeNull();
		expect(parseMarkerBody('a man |  |  |  ')?.prompt).toBe('a man');
	});
});

describe('parseMarkerBody: the card vocabulary', () => {
	it('understands every aspect word', () => {
		expect(parseMarkerBody('x | PORTRAIT | MEDIUM | RANDOM')).toMatchObject({
			width: 832,
			height: 1216
		});
		expect(parseMarkerBody('x | SQUARE | MEDIUM | RANDOM')).toMatchObject({
			width: 1024,
			height: 1024
		});
		expect(parseMarkerBody('x | LANDSCAPE | MEDIUM | RANDOM')).toMatchObject({
			width: 1216,
			height: 832
		});
		// CINEMA is in the card vocabulary but not in ComfyInject's parser, which fell back to square and
		// left the word in the prompt. It means the Wide preset.
		expect(parseMarkerBody('x | CINEMA | WIDE | RANDOM')).toMatchObject({
			width: 1344,
			height: 768
		});
	});

	it('turns a shot word into framing tags instead of leaking it into the prompt', () => {
		const parsed = parseMarkerBody('1man, blue suit | PORTRAIT | MEDIUM | RANDOM');
		expect(parsed?.prompt).toBe('1man, blue suit, medium shot, upper body');
		expect(parsed?.prompt).not.toMatch(/\bMEDIUM\b/);
	});

	it('reads every shot word, including the concatenated spellings models write', () => {
		const shot = (value: string) => parseMarkerBody(`a man | SQUARE | ${value} | RANDOM`)?.prompt;
		expect(shot('CLOSE')).toBe('a man, close-up');
		expect(shot('close-up')).toBe('a man, close-up');
		expect(shot('WIDE')).toContain('full body');
		expect(shot('DUTCH')).toBe('a man, dutch angle');
		expect(shot('LOWANGLE')).toBe('a man, from below, low angle');
		expect(shot('low angle')).toBe('a man, from below, low angle');
		expect(shot('OVERHEAD')).toContain('from above');
		expect(shot('BACKVIEW')).toContain('from behind');
		expect(shot('PROFILE')).toBe('a man, profile view');
		expect(shot('POV')).toBe('a man, pov');
	});

	it('reads RANDOM as "no seed" and LOCK as a request to reuse the chat seed', () => {
		expect(parseMarkerBody('a man | PORTRAIT | MEDIUM | RANDOM')).toMatchObject({
			seed: undefined,
			lock: undefined
		});
		expect(parseMarkerBody('a man | PORTRAIT | MEDIUM | LOCK')).toMatchObject({
			seed: undefined,
			lock: true
		});
	});

	it('classifies the segments by content, not by position', () => {
		// Models shuffle the order, and refusing the marker over it just produces no picture.
		expect(parseMarkerBody('a man | CLOSE | SQUARE | 7')).toMatchObject({
			prompt: 'a man, close-up',
			width: 1024,
			height: 1024,
			seed: 7
		});
	});

	it('does not eat a year as a seed', () => {
		// ComfyInject's parser turned "a woman, 1985, in a diner" into seed 1985. A bare number is only a
		// seed in the seed slot, and `1985` is never the last segment here.
		const parsed = parseMarkerBody('a woman, 1985, in a diner | LANDSCAPE | MEDIUM | RANDOM');
		expect(parsed?.prompt).toContain('1985');
		expect(parsed?.seed).toBeUndefined();
	});
});

describe('the shipped Storyboard card', () => {
	// Verbatim from the card's own examples. If these ever stop parsing into a usable request, the card
	// and the app have drifted apart and the storyboard chat is broken again.
	const first =
		'[[IMG: 1man, adult, short brown hair, brown eyes, blue business suit, white shirt, brown leather shoes, holding black suitcase in left hand, waving right hand at approaching bus, city bus stop sign, urban street, buildings, daytime, overcast sky | PORTRAIT | MEDIUM | RANDOM ]]';
	const second =
		'[[IMG: 1man, adult, short brown hair, brown eyes, blue business suit, white shirt, brown leather shoes, black suitcase in left hand, climbing bus steps, right hand gripping bus handrail, open bus door, bus interior visible behind him, urban street, daytime, overcast sky | PORTRAIT | MEDIUM | LOCK ]]';

	it('parses the first beat into a portrait with no fixed seed', () => {
		expect(findImageMarkers(first)).toEqual([
			{
				prompt:
					'1man, adult, short brown hair, brown eyes, blue business suit, white shirt, brown leather shoes, holding black suitcase in left hand, waving right hand at approaching bus, city bus stop sign, urban street, buildings, daytime, overcast sky, medium shot, upper body',
				width: 832,
				height: 1216,
				seed: undefined,
				lock: undefined
			}
		]);
	});

	it('parses the second beat as a lock, so the character keeps the same seed', () => {
		const [marker] = findImageMarkers(second);
		expect(marker.lock).toBe(true);
		expect(marker.prompt).not.toMatch(/LOCK/);
	});

	it('finds a marker that is wrapped in prose', () => {
		// An RP tune answers around the marker; the marker still has to be found and nothing else drawn.
		expect(findImageMarkers(`Sure.\n${first}\nHope that helps.`)).toHaveLength(1);
	});
});

describe('spacing a model actually emits', () => {
	// Measured with an RP tune: `[ [IMG: 1man, ... ] ]` — one space, and the whole marker stopped being a
	// marker. It rendered as a wall of tags in the transcript, which is what "it just spits out Danbooru
	// tags" looks like from the reader's side.
	const spaced = '[ [IMG: 1man, blue suit ]  ]';

	it('finds a marker whose brackets are spaced out', () => {
		expect(findImageMarkers(spaced)).toHaveLength(1);
	});

	it('finds one that also spaces the colon', () => {
		expect(findImageMarkers('[[ IMG : 1man, blue suit ]]')).toHaveLength(1);
	});

	it('strips it from the transcript text', () => {
		expect(stripImageMarkers(`She waits.\n${spaced}`)).toBe('She waits.');
	});
});

describe('storyboard shot vocabulary', () => {
	// The two words a shot sheet uses that the original list could not say, and the ones that decide
	// whether a second character is in frame at all.
	const shot = (value: string) => parseMarkerBody(`a man | LANDSCAPE | ${value} | RANDOM`)?.prompt;

	it('reads shot sizes', () => {
		expect(shot('EWS')).toContain('extreme wide');
		expect(shot('FS')).toContain('head to toe');
		expect(shot('MCU')).toContain('chest up');
		expect(shot('ECU')).toContain('extreme close-up');
	});

	it('reads shot types that put two people in frame', () => {
		expect(shot('OTS')).toContain('over-the-shoulder');
		expect(shot('2SHOT')).toContain('two people in frame');
		expect(shot('TWOSHOT')).toContain('two people in frame');
	});

	it('reads angle shorthand', () => {
		expect(shot('HA')).toContain('high angle');
		expect(shot('LA')).toContain('low angle');
		expect(shot('EYELEVEL')).toContain('eye level');
	});
});
