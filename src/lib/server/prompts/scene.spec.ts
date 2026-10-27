/** Scene prompts: the "picture of this moment" path. No GPU, no network — just text rules. */
import { describe, expect, it } from 'vitest';
import { buildScenePrompt } from './scene.js';
import type { Character } from '$lib/shared/character.js';

const character = {
	id: 'card_x',
	name: 'Seraphina',
	description: 'Guardian of the forest. Tall, calm, watchful.',
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

	it('works with no character and no messages', () => {
		const scene = buildScenePrompt({ messages: [] });
		expect(scene.prompt).toContain('masterpiece');
		expect(scene.width).toBe(832);
	});
});
