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

describe('the render style stored on the chat', () => {
	const messages = [{ role: 'user', content: 'she waits' }];

	it('adds nothing when the chat has no style', () => {
		// `none` must leave the prompt byte-identical: it is the default, so every prompt built before
		// this field existed has to keep working.
		const plain = buildScenePrompt({ messages, character, workflow: 'z-image-turbo-t2i' }).prompt;
		const none = buildScenePrompt({
			messages,
			character,
			workflow: 'z-image-turbo-t2i',
			style: 'none'
		}).prompt;
		expect(none).toBe(plain);
	});

	it('puts Anima style tags after the count line and before the attributes', () => {
		const prompt = buildScenePrompt({
			messages,
			character,
			workflow: 'anima-turbo-t2i',
			style: 'anime'
		}).prompt;
		const tags = prompt.split(',').map((tag) => tag.trim());
		expect(tags).toContain('anime screenshot');
		expect(tags.indexOf('1girl')).toBeLessThan(tags.indexOf('anime screenshot'));
		expect(tags.indexOf('anime screenshot')).toBeLessThan(tags.indexOf('long silver hair'));
	});

	it('puts Z-Image style as a sentence before the cleanup clause', () => {
		const prompt = buildScenePrompt({
			messages,
			character,
			workflow: 'z-image-turbo-t2i',
			style: 'photo'
		}).prompt;
		expect(prompt).toContain('Photorealistic, natural color grading');
		// The last sentence is the constraint most likely to break an image if it lands mid-paragraph.
		expect(prompt.trimEnd().endsWith('no watermark.')).toBe(true);
		expect(prompt.indexOf('Photorealistic')).toBeLessThan(prompt.indexOf('no watermark'));
	});

	it('puts style tags before the quality tail in the generic dialect', () => {
		const prompt = buildScenePrompt({
			messages,
			character,
			style: 'illustration'
		}).prompt;
		const tags = prompt.split(',').map((tag) => tag.trim());
		expect(tags).toContain('digital illustration');
		expect(tags.indexOf('digital illustration')).toBeLessThan(tags.indexOf('masterpiece'));
	});

	it('drops the SDXL quality tail on the models that were not trained on it', () => {
		// Measured: `masterpiece, best quality` crowded the subject and pushed a Krea2 *Anime* checkpoint
		// into a photoreal portrait. Z-Image never used this tail either.
		for (const workflow of ['krea2-anime-t2i', 'flux2-klein-t2i']) {
			const prompt = buildScenePrompt({ messages, character, workflow }).prompt;
			expect(prompt).not.toContain('masterpiece');
			expect(prompt).not.toContain('best quality');
		}
	});

	it('gives an anime fine-tune the anime style even when the chat says none', () => {
		// The Jess chat: every prompt was correct and the picture came back photoreal, because the style
		// picker was on `none` and nothing else said "anime".
		const prompt = buildScenePrompt({
			messages,
			character,
			workflow: 'krea2-anime-nsfw-t2i',
			style: 'none'
		}).prompt;
		expect(prompt).toContain('anime screenshot');
		// A non-anime model keeps `none` exactly as before.
		const zimage = buildScenePrompt({
			messages,
			character,
			workflow: 'z-image-turbo-t2i',
			style: 'none'
		}).prompt;
		expect(zimage).not.toContain('anime screenshot');
	});

	it('ignores a style id it does not know', () => {
		const prompt = buildScenePrompt({
			messages,
			character,
			workflow: 'anima-turbo-t2i',
			style: 'oil-painting'
		}).prompt;
		expect(prompt).not.toContain('oil-painting');
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

describe('what the picture is built from', () => {
	// Measured on a real roleplay beat: the reader's line was "At the mall, Jess gets bolder" and the reply
	// described a cardigan coming off. The prompt said only the reader's sentence and the picture had her
	// fully dressed — the action never reached the model.
	const reply =
		'I glance around and swallow hard. I let my cardigan drop to the floor, leaving me in just my thin white blouse. It clings to my breasts, heavy and sensitive.';
	const ask =
		'At the mall, Jess gets bolder. She hangs back behind a pillar and lets the crowd walk past.';

	it('keeps the action the reply describes, not just the reader line', () => {
		const prompt = buildScenePrompt({
			messages: [
				{ role: 'user', content: ask },
				{ role: 'assistant', content: reply }
			],
			character
		}).prompt;
		expect(prompt).toContain('cardigan');
		// The reader's sentence comes first (it states the beat); the reply's description follows and must
		// actually fit inside its own budget instead of being cut away.
		expect(prompt.indexOf('hangs back')).toBeLessThan(prompt.indexOf('cardigan'));
	});

	it('keeps the reader own line too, because it is often where the action is written', () => {
		const prompt = buildScenePrompt({
			messages: [
				{ role: 'user', content: ask },
				{ role: 'assistant', content: reply }
			],
			character
		}).prompt;
		expect(prompt).toContain('behind a pillar');
	});

	it('drops questions and quoted dialogue from both sides', () => {
		const prompt = buildScenePrompt({
			messages: [
				{ role: 'user', content: 'Should we really do this?' },
				{
					role: 'assistant',
					content: '"Not here," she whispers. She pushes the door open onto the roof.'
				}
			],
			character
		}).prompt;
		expect(prompt).not.toContain('Should we really');
		expect(prompt).not.toContain('Not here');
		expect(prompt).toContain('roof');
	});
});

describe('the card decides what the character looks like', () => {
	it('reads an `Appearance:` line instead of the first sentence of prose', () => {
		// The real failure: a card whose `appearance` field stops at eye colour, with the hair in an
		// `Appearance:` paragraph further down. The prompt had no hair, so every model invented a new one.
		const jess = {
			...character,
			appearance: '5\'2" tall, slender, grey-green eyes, pale skin',
			description:
				"{{char}} is {{user}}'s wife of five years and runs a bakery.\nAppearance: dark blonde hair kept in a low ponytail, flour on her apron"
		} as unknown as Character;
		const prompt = buildScenePrompt({ messages: [], character: jess }).prompt;
		expect(prompt).toContain('dark blonde hair');
		expect(prompt).not.toContain('wife of five years');
	});

	it('still falls back to the description when there is no Appearance line', () => {
		const prompt = buildScenePrompt({ messages: [], character }).prompt;
		expect(prompt).toContain('moss-green cloak');
	});
});

describe('prompt hygiene', () => {
	it('strips SillyTavern macros, which a diffusion model would render as noise', () => {
		const withMacro = {
			...character,
			appearance: 'dark blonde hair she lets down only for {{user}}'
		} as unknown as Character;
		const prompt = buildScenePrompt({ messages: [], character: withMacro }).prompt;
		expect(prompt).not.toContain('{{');
		expect(prompt).toContain('dark blonde hair');
	});

	it('drops hesitation speech, which showed up as a speech bubble in a picture', () => {
		const prompt = buildScenePrompt({
			messages: [
				{
					role: 'assistant',
					content: 'We should...um...look at some things for James soon. She walks to the window.'
				}
			],
			character
		}).prompt;
		expect(prompt).not.toContain('...um');
		expect(prompt).toContain('window');
	});
});

describe('the four bugs the Jess chat exposed', () => {
	// The real greeting, verbatim: the wardrobe line is the one a first-person camera monologue buries.
	const greeting = `*My family is coming over at ten. My parents. My father who calls me 'the perfect daughter' and my mom who thinks I can do no wrong.*

*The table's nearly done and you walk into the room. I am wearing the short dress like you asked me too. I think it's too short and inappropriate, but it also turns me on. Oh god, please don't let my parents think less of me, or the kids for that matter. I would just die of shame. Luckily I have stockings underneath.*`;

	const jess = {
		...character,
		name: 'Jess',
		appearance: '5\'2" tall, slender, grey-green eyes, pale skin',
		description:
			"{{char}} - Jessica, 35 - is {{user}}'s wife of five years.\nAppearance: 5'2\" tall, slender. Dark blonde hair she keeps in a practical low ponytail at work and lets down only for {{user}}, grey-green eyes, pale skin that blushes from her collarbones to her ears.\n\nTo the morning regulars she is the picture of respectability."
	} as unknown as Character;

	it('keeps a sentence that has an apostrophe in it', () => {
		const prompt = buildScenePrompt({
			messages: [{ role: 'assistant', content: greeting }],
			character: jess
		}).prompt;
		// `/'[^']{4,}'/` ate everything between "table's" and "it's" — which was the whole wardrobe line.
		expect(prompt).toContain('short dress');
		expect(prompt).toContain('stockings');
		expect(prompt).not.toContain('table s');
	});

	it('spends the word budget on what a camera can see, not on fretting', () => {
		const prompt = buildScenePrompt({
			messages: [{ role: 'assistant', content: greeting }],
			character: jess
		}).prompt;
		expect(prompt).not.toContain('die of shame');
		expect(prompt).not.toContain('thinks I can do no wrong');
		expect(prompt).toContain('walk into the room');
	});

	it('reads one appearance source, so nothing is said twice', () => {
		const prompt = buildScenePrompt({ messages: [], character: jess }).prompt;
		const slender = prompt
			.toLowerCase()
			.split(', ')
			.filter((tag) => tag.includes('slender'));
		expect(slender).toHaveLength(1);
		// The block must end on a whole tag: "…lets down only for" was a dangling preposition.
		expect(prompt).not.toMatch(/only for,/);
	});

	it('puts the card’s age in the prompt, because the model guesses young without it', () => {
		// Measured: card says 35, prompt said nothing, the picture was a teenager.
		const prompt = buildScenePrompt({ messages: [], character: jess }).prompt;
		expect(prompt).toContain('35 year old woman');
	});

	it('never invents an age, and never draws an under-18 one', () => {
		expect(buildScenePrompt({ messages: [], character }).prompt).not.toContain('year old');
		const young = { ...character, description: 'Elin, 16 - a schoolgirl.' } as unknown as Character;
		expect(buildScenePrompt({ messages: [], character: young }).prompt).not.toContain(
			'16 year old'
		);
	});
});
