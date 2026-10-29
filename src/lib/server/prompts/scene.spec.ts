/** Scene prompts: the "picture of this moment" path. No GPU, no network — just text rules. */
import { describe, expect, it } from 'vitest';
import { buildScenePrompt, sceneTarget, safetyTag, subjectTag } from './scene.js';
import type { Character } from '$lib/shared/character.js';

const character = {
	id: 'card_x',
	name: 'Seraphina',
	// "She" is the whole gender signal: the count line is inferred from the card's own words, never from
	// its name, so a card with no pronoun at all is treated as "no cue" (see the emptyCharacter case).
	description: 'Guardian of the forest. She is tall, calm, watchful.',
	appearance: 'long silver hair, green eyes, moss-green cloak',
	personality: 'gentle, protective',
	scenario: 'An old forest shrine.',
	firstMessage: 'Hello.',
	exampleDialogue: '',
	systemPrompt: '',
	postHistoryInstructions: '',
	creatorNotes: '',
	tags: [],
	alternateGreetings: [],
	book: null,
	avatar: null,
	createdAt: 0,
	updatedAt: 0
} as unknown as Character;

const maleCharacter = {
	...character,
	id: 'card_y',
	name: 'Corin',
	description: 'A wandering swordsman. He keeps his word.',
	appearance: 'short black hair, grey eyes, worn leather coat'
} as unknown as Character;

const emptyCharacter = {
	...character,
	id: 'card_z',
	name: 'Shrine',
	description: '',
	appearance: '',
	tags: []
} as unknown as Character;

describe('buildScenePrompt', () => {
	it('puts appearance, setting, framing and quality in one prompt', () => {
		const scene = buildScenePrompt({
			messages: [{ role: 'user', content: 'I step into the shrine.' }],
			character,
			look: 'moonlit forest shrine, floating dust',
			shot: 'medium'
		});

		expect(scene.prompt).toContain('long silver hair');
		expect(scene.prompt).toContain('moonlit forest shrine');
		expect(scene.prompt).toContain('medium shot');
		expect(scene.prompt).toContain('masterpiece');
		expect(scene.width).toBe(832);
		expect(scene.height).toBe(1216);
	});

	it('drops dialogue quotes and markdown, which describe nothing visible', () => {
		const scene = buildScenePrompt({
			messages: [
				{ role: 'assistant', content: 'She smiles. "You are late," *she says*, quietly.' },
				{ role: 'user', content: 'I sit down.' }
			],
			character,
			shot: 'close'
		});

		expect(scene.prompt).not.toContain('"');
		expect(scene.prompt).not.toContain('*');
		expect(scene.prompt).toContain('close-up');
	});

	it('uses only the recent tail of a long conversation', () => {
		const messages = [
			{ role: 'user', content: 'FORTY WORDS AGO should not appear at all in the prompt text here' },
			{
				role: 'assistant',
				content: 'also ancient history that is irrelevant to the current picture'
			},
			{ role: 'user', content: 'now we stand on the cliff' },
			{ role: 'assistant', content: 'the wind pulls at her cloak' }
		];
		const scene = buildScenePrompt({ messages, shot: 'wide' });
		expect(scene.prompt).not.toContain('FORTY WORDS AGO');
		expect(scene.prompt).toContain('cliff');
		expect(scene.width).toBe(1216);
	});

	it('dedupes repeated tags and appends the user’s own tags last', () => {
		const scene = buildScenePrompt({
			messages: [{ role: 'user', content: 'rain, rain, rain' }],
			look: 'rain',
			extra: 'blue hour, rain',
			shot: 'wide'
		});
		const tags = scene.prompt.split(',').map((tag) => tag.trim());
		expect(tags.filter((tag) => tag === 'rain')).toHaveLength(1);
		// The user's own tag survives even when the earlier context already mentioned it once.
		expect(scene.prompt).toContain('blue hour');
	});

	it('drops questions, which are not pictures', () => {
		const scene = buildScenePrompt({
			messages: [
				{ role: 'user', content: 'What is Eldoria?' },
				{ role: 'assistant', content: 'She points at the ruined gate.' }
			]
		});
		expect(scene.prompt).not.toContain('Eldoria');
		expect(scene.prompt).toContain('ruined gate');
	});

	it('drops negations, which diffusion models cannot express', () => {
		// Measured: "no cloak" produced a picture *with* a cloak. Removing the phrase is the only
		// honest option until the graph carries a negative prompt.
		const scene = buildScenePrompt({
			messages: [],
			extra: 'plain linen dress, no cloak, without armour, calm face'
		});
		expect(scene.prompt).toContain('plain linen dress');
		expect(scene.prompt).toContain('calm face');
		expect(scene.prompt).not.toMatch(/cloak|armour/i);
	});

	it('works with no character and no messages', () => {
		const scene = buildScenePrompt({ messages: [] });
		expect(scene.prompt).toContain('masterpiece');
		expect(scene.width).toBe(832);
	});

	it('keeps the generic tag order and only names the shot, not the face', () => {
		const scene = buildScenePrompt({
			messages: [{ role: 'user', content: 'the wind pulls at her cloak' }],
			character,
			look: 'moonlit shrine',
			shot: 'close'
		});
		const tags = scene.prompt.split(',').map((tag) => tag.trim());
		expect(tags[0]).toBe('long silver hair');
		expect(tags).toContain('close-up');
		expect(tags).not.toContain('portrait');
		expect(tags).not.toContain('detailed face');
	});
});

describe('sceneTarget', () => {
	it('maps each graph family, case-insensitively, and falls back to generic', () => {
		expect(sceneTarget('anima-turbo-t2i')).toBe('anima');
		expect(sceneTarget('ANIMA-fp16-t2i')).toBe('anima');
		expect(sceneTarget('z-image-turbo-t2i')).toBe('zimage');
		expect(sceneTarget('flux2-klein-t2i')).toBe('flux2');
		expect(sceneTarget('krea2-anime-t2i')).toBe('krea2');
		expect(sceneTarget('  krea2-t2i  ')).toBe('krea2');
		expect(sceneTarget('some-custom-graph')).toBe('generic');
		expect(sceneTarget(undefined)).toBe('generic');
		expect(sceneTarget(null)).toBe('generic');
	});
});

describe('buildScenePrompt for Anima', () => {
	const anima = (extra: Parameters<typeof buildScenePrompt>[0]) =>
		buildScenePrompt({ workflow: 'anima-turbo-t2i', ...extra }).prompt;

	it('opens with the quality labels and never repeats a score tag', () => {
		const prompt = anima({ messages: [{ role: 'user', content: 'she waits' }], character });
		expect(prompt.startsWith('masterpiece, best quality')).toBe(true);
		expect(prompt).toContain('highres');
		expect(prompt).not.toContain('score_');
	});

	it('puts the subject count before the appearance tags', () => {
		const prompt = anima({
			messages: [{ role: 'user', content: 'she waits' }],
			character
		});
		const tags = prompt.split(',').map((tag) => tag.trim());
		expect(prompt).toContain('1girl');
		expect(tags.indexOf('1girl')).toBeLessThan(tags.indexOf('long silver hair'));
	});

	it('names the close shot without the face tags that cropped action scenes', () => {
		const prompt = anima({
			messages: [{ role: 'user', content: 'she waits' }],
			character,
			shot: 'close'
		});
		expect(prompt).toContain('close-up');
		expect(prompt).not.toContain('detailed face');
		expect(prompt).not.toMatch(/\bportrait\b/);
	});

	it('drops our shot tag when the user already named a framing', () => {
		const prompt = anima({
			messages: [{ role: 'user', content: 'she waits by the fire' }],
			character,
			shot: 'medium',
			extra: 'wide shot from the side'
		});
		expect(prompt).toContain('wide shot from the side');
		expect(prompt).not.toContain('medium shot');
		expect(prompt).not.toContain('upper body');
	});

	it('tags explicit content as explicit', () => {
		const prompt = anima({
			messages: [{ role: 'assistant', content: 'She is naked and straddles him.' }],
			character
		});
		expect(prompt.split(',').map((tag) => tag.trim())).toContain('explicit');
	});

	it('tags a kiss as nsfw, not explicit', () => {
		const prompt = anima({
			messages: [{ role: 'assistant', content: 'She kissed her under the lantern.' }],
			character
		});
		const tags = prompt.split(',').map((tag) => tag.trim());
		expect(tags).toContain('nsfw');
		expect(tags).not.toContain('explicit');
	});

	it('tags a neutral scene as safe', () => {
		const prompt = anima({
			messages: [{ role: 'assistant', content: 'She reads by the window.' }],
			character
		});
		expect(prompt.split(',').map((tag) => tag.trim())).toContain('safe');
	});

	it('still strips negations from the user’s tags', () => {
		const prompt = anima({
			messages: [],
			extra: 'plain linen dress, no cloak'
		});
		expect(prompt).toContain('plain linen dress');
		expect(prompt).not.toMatch(/cloak/i);
	});
});

describe('subjectTag', () => {
	it('reads a female card as one girl', () => {
		expect(subjectTag(character, 'she waits')).toBe('1girl, solo');
	});

	it('reads a male card as one boy', () => {
		expect(subjectTag(maleCharacter, 'he waits')).toBe('1boy, solo');
	});

	it('counts two women in the moment even when the card says nothing', () => {
		expect(subjectTag(character, 'Two women argue in the kitchen')).toBe('2girls');
		expect(subjectTag(character, 'Both men draw their blades')).toBe('2boys');
		expect(subjectTag(character, 'a man and a woman share the bench')).toBe('1girl, 1boy');
	});

	it('refuses to guess when there is no cue at all', () => {
		expect(subjectTag(emptyCharacter, 'the room is quiet')).toBe('');
		expect(subjectTag(null, 'the room is quiet')).toBe('');
	});
});

describe('safetyTag', () => {
	it('separates explicit from nsfw from safe on word boundaries', () => {
		expect(safetyTag('she undressing slowly')).toBe('explicit');
		expect(safetyTag('a sexy joke')).toBe('safe');
		expect(safetyTag('they kiss')).toBe('nsfw');
		expect(safetyTag('the lantern burns low')).toBe('safe');
		// Explicit beats nsfw when both appear.
		expect(safetyTag('kissing until they are naked')).toBe('explicit');
	});
});

describe('buildScenePrompt for Z-Image', () => {
	const zimage = (extra: Parameters<typeof buildScenePrompt>[0]) =>
		buildScenePrompt({ workflow: 'z-image-turbo-t2i', ...extra }).prompt;

	it('writes one prose paragraph with no tag soup and no quality labels', () => {
		const prompt = zimage({
			messages: [{ role: 'assistant', content: 'She reads by the window.' }],
			character,
			look: 'a candle-lit study'
		});
		expect(prompt).toContain('. ');
		expect(prompt).toContain('no watermark');
		expect(prompt).not.toContain('masterpiece');
		expect(prompt).toContain('A candle-lit study.');
		expect(prompt).not.toContain('Set in');
		expect(prompt).not.toMatch(/ {2}/);
	});

	it('never emits an empty sentence when there is no look', () => {
		const prompt = zimage({ messages: [] });
		expect(prompt).not.toMatch(/\.\s*\./);
		expect(prompt).not.toMatch(/ {2}/);
	});

	it('keeps the safety word honest when the explicit words live in the chat look', () => {
		// Round-2 chats store wardrobe/anatomy in `look`, so a safety tag read from the transcript alone
		// said `safe` on a nude scene — the prompt then argued with itself.
		const prompt = buildScenePrompt({
			workflow: 'anima-turbo-t2i',
			messages: [{ role: 'assistant', content: 'She kneels up and looks at him.' }],
			character,
			look: 'completely nude, kneeling on the bed, explicit'
		}).prompt;
		expect(prompt).toContain('explicit');
		expect(prompt).not.toContain('safe');
	});

	it('stays under 260 words', () => {
		const long =
			'She walks slowly through the ruined gate and the wind pulls at her cloak. '.repeat(6);
		const prompt = zimage({
			messages: [{ role: 'assistant', content: long }],
			character,
			look: 'a ruined gate at dusk'
		});
		expect(prompt.split(/\s+/).length).toBeLessThan(260);
	});

	it('appends the user’s tags as a clause, without a trailing comma', () => {
		const withExtra = zimage({ messages: [], extra: 'blue hour, rain' });
		expect(withExtra).toContain('blue hour, rain.');
		expect(withExtra).not.toContain(', .');
	});
});
