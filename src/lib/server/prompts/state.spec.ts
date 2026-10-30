/**
 * The scene state, pinned against the prompts that actually failed in round 6.
 *
 * These strings are verbatim markers from the runs, not invented fixtures — the bug is only fixed if the
 * state reads correctly for the exact prose that produced the bad pictures.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, deriveShotState, mergeShotState, renderShotState } from './state.js';

// Round 6, Z-Image / beach.
const BEACH_WALK =
	'A woman, adult, long dark hair, wearing a yellow sundress and white sandals, walks with a beach bag in hand towards the sand. She leaves the silver sedan in the parking lot which is paved with dark gray stones and surrounded by tall green palm trees.';
const BEACH_STRIP =
	'The woman, adult, long dark hair, standing in the sandy area between the parking lot and the ocean, completely exposes herself, her yellow sundress fallen to her feet as she puts on a red thong bikini. One man, mid-thirties, wearing a bright blue t-shirt, stands near her, showing surprise.';
// Round 6, Anima / store.
const STORE_WALK =
	'1girl, long dark hair, wearing a long winter coat, walking, into a changing room, clothing store interior, brightly lit, day';
const STORE_COAT_OFF =
	'A woman, adult, long brown hair, standing near the changing room curtain, holding a selection of silk and lace lingerie in her hands, the woman has removed her black winter coat revealing her naked body, the changing room is open';
const STORE_BYSTANDERS =
	'Several people walking by in shock, a woman, adult, long brown hair, standing near the changing room curtain, holding a selection of silk and lace lingerie in her hands';

describe('deriveShotState', () => {
	it('reads the place out of a caption', () => {
		const state = deriveShotState(BEACH_WALK);
		expect(state.place.join(' ').toLowerCase()).toContain('sand');
		expect(state.place.join(' ').toLowerCase()).toContain('parking lot');
	});

	it('reads the outfit that is still on', () => {
		const state = deriveShotState(BEACH_WALK);
		// The block stores the canonical garment, not the caption clause: the shade is PREVIOUS SHOT's job.
		expect(state.wardrobe.join(' ').toLowerCase()).toContain('sundress');
		expect(state.removed).toHaveLength(0);
	});

	it('marks a garment taken off as taken off, and keeps the one that replaced it', () => {
		const state = deriveShotState(BEACH_STRIP);
		expect(state.removed.join(' ').toLowerCase()).toContain('sundress');
		expect(state.wardrobe.join(' ').toLowerCase()).toContain('bikini');
		expect(state.wardrobe.join(' ').toLowerCase()).not.toContain('sundress');
	});

	it('sees the people in frame', () => {
		// The caption says "One man", so the plain noun is what matches — count tags only appear in tag lists.
		expect(deriveShotState(BEACH_STRIP).cast.join(' ').toLowerCase()).toContain('man');
		expect(deriveShotState(STORE_BYSTANDERS).cast.join(' ').toLowerCase()).toContain('people');
	});

	it('marks a coat removed when the prompt says it came off', () => {
		const state = deriveShotState(STORE_COAT_OFF);
		expect(state.removed.join(' ').toLowerCase()).toContain('coat');
		expect(deriveShotState(STORE_WALK).removed).toHaveLength(0);
	});
});

describe('mergeShotState', () => {
	it('never brings back a garment the story took off', () => {
		// The exact failure: beat 3 has the sundress falling, beat 4's writer put it back on. Merging must
		// make that impossible — the removed list wins over anything a later prompt says.
		const afterStrip = mergeShotState(deriveShotState(BEACH_WALK), deriveShotState(BEACH_STRIP));
		const afterLater = mergeShotState(
			afterStrip,
			deriveShotState(`${BEACH_STRIP} the woman wears a yellow sundress`)
		);
		expect(afterLater.wardrobe.join(' ').toLowerCase()).not.toContain('sundress');
		expect(afterLater.removed.join(' ').toLowerCase()).toContain('sundress');
	});

	it('keeps the place when a later prompt is a close-up with no place in it', () => {
		const merged = mergeShotState(
			deriveShotState(BEACH_WALK),
			deriveShotState('1woman, adult, close-up of her hand in a red bikini')
		);
		expect(merged.place.join(' ').toLowerCase()).toContain('sand');
	});

	it('takes the newest cast, so bystanders do not follow her home', () => {
		const withCrowd = mergeShotState(deriveShotState(BEACH_WALK), deriveShotState(BEACH_STRIP));
		expect(withCrowd.cast.join(' ').toLowerCase()).toContain('man');
		const alone = mergeShotState(
			withCrowd,
			deriveShotState('1woman, adult, long dark hair, standing in the sand')
		);
		expect(alone.cast.join(' ').toLowerCase()).toContain('woman');
	});

	it('accumulates the outfit across beats', () => {
		const first = mergeShotState(
			null,
			deriveShotState('1woman, adult, wearing a long winter coat, clothing store')
		);
		const second = mergeShotState(
			first,
			deriveShotState('1woman, adult, black lace lingerie, changing room')
		);
		expect(second.wardrobe.join(' ').toLowerCase()).toContain('coat');
		expect(second.wardrobe.join(' ').toLowerCase()).toContain('lingerie');
	});

	it('starts from empty without throwing', () => {
		expect(mergeShotState(undefined, EMPTY_STATE)).toEqual(EMPTY_STATE);
	});
});

describe('renderShotState', () => {
	const state = mergeShotState(deriveShotState(BEACH_WALK), deriveShotState(BEACH_STRIP));
	const block = renderShotState(state);

	it('says where, what is worn, what is not, and who is there', () => {
		expect(block).toContain('SCENE STATE');
		expect(block).toContain('place:');
		expect(block).toContain('worn:');
		expect(block).toContain('taken off (never draw these again):');
		expect(block).toContain('in frame:');
	});

	it('renders nothing at all for an empty record', () => {
		expect(renderShotState(null)).toBe('');
		expect(renderShotState(EMPTY_STATE)).toBe('');
	});
});
