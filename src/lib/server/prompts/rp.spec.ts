/**
 * Prompt assembly tests.
 *
 * These read like a spec of the *behaviour* of a roleplay chat, which is the only way to keep the
 * ordering and the budget honest: a model cannot tell you that the post-history instructions ended
 * up in the wrong place until the character has already broken character.
 */
import { describe, expect, it } from 'vitest';
import { normalizeCardJson } from '../cards/parse.js';
import {
	assemblePrompt,
	characterBlock,
	estimateTokens,
	greetingFor,
	selectLoreEntries,
	substitute
} from './rp.js';

const card = normalizeCardJson({
	spec: 'chara_card_v3',
	data: {
		name: 'Seraphina',
		description: '{{char}} guards the woods of Eldoria.',
		personality: 'Kind, watchful',
		scenario: 'A glade at dusk',
		first_mes: 'Welcome, {{user}}.',
		mes_example: '<START>\n{{user}}: Hi\n{{char}}: *nods*',
		system_prompt: 'Write in third person.',
		post_history_instructions: 'Always end with an action.',
		character_book: {
			entries: [
				{ keys: ['eldoria'], content: 'Eldoria is the wood.', insertion_order: 20 },
				{ keys: ['shadowfang'], content: 'Shadowfangs are wolves.', insertion_order: 10 },
				{ keys: [], content: 'Always true lore.', constant: true, insertion_order: 30 },
				{ keys: ['never'], content: 'Never fires.', enabled: false, insertion_order: 5 }
			]
		}
	}
});

const say = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('substitute', () => {
	it('replaces all placeholder spellings', () => {
		expect(substitute('{{char}} greets {{user}} <BOT>/<USER>', 'Sam', 'Jess')).toBe(
			'Jess greets Sam Jess/Sam'
		);
	});

	it('is case-insensitive about the braces', () => {
		expect(substitute('{{CHAR}}', 'Sam', 'Jess')).toBe('Jess');
	});
});

describe('characterBlock', () => {
	it('labels each non-empty field and skips empty ones', () => {
		const block = characterBlock(card, 'Sam');
		expect(block).toContain('Name: Seraphina');
		expect(block).toContain('Description: Seraphina guards the woods of Eldoria.');
		expect(block).toContain('Scenario: A glade at dusk');
		expect(block).not.toContain('Appearance');
	});
});

describe('selectLoreEntries', () => {
	const history = [say('user', 'Tell me about Eldoria'), say('assistant', 'It is old.')];

	it('fires keyword entries present in recent history', () => {
		const lore = selectLoreEntries(card, history, { userName: 'Sam' });
		expect(lore.map((entry) => entry.content)).toContain('Eldoria is the wood.');
	});

	it('always fires constant entries, even with no keywords', () => {
		const lore = selectLoreEntries(card, history, { userName: 'Sam' });
		expect(lore.map((entry) => entry.content)).toContain('Always true lore.');
	});

	it('never fires disabled entries', () => {
		const lore = selectLoreEntries(card, [say('user', 'never mention it')], { userName: 'Sam' });
		expect(lore.map((entry) => entry.content)).not.toContain('Never fires.');
	});

	it('orders by insertionOrder, not by keyword position', () => {
		const both = [say('user', 'eldoria and shadowfang')];
		const lore = selectLoreEntries(card, both, { userName: 'Sam' });
		const contents = lore.map((entry) => entry.content);
		expect(contents.indexOf('Shadowfangs are wolves.')).toBeLessThan(
			contents.indexOf('Eldoria is the wood.')
		);
	});

	it('respects maxLoreEntries', () => {
		expect(selectLoreEntries(card, history, { userName: 'Sam', maxLoreEntries: 1 })).toHaveLength(
			1
		);
	});

	it('only scans the configured depth', () => {
		const deep = [say('user', 'Eldoria'), say('assistant', 'a'), say('assistant', 'b')];
		expect(selectLoreEntries(card, deep, { userName: 'Sam', scanDepth: 1 })).toHaveLength(1); // constant only
	});

	it('needs both keys for a selective entry', () => {
		const selective = normalizeCardJson({
			name: 'Sel',
			description: '',
			character_book: {
				entries: [
					{
						keys: ['alpha'],
						secondary_keys: ['beta'],
						selective: true,
						content: 'Both keys fired.'
					}
				]
			}
		});
		expect(
			selectLoreEntries(selective, [say('user', 'alpha only')], { userName: 'Sam' })
		).toHaveLength(0);
		expect(
			selectLoreEntries(selective, [say('user', 'alpha and beta')], { userName: 'Sam' })
		).toHaveLength(1);
	});
});

describe('assemblePrompt', () => {
	const history = [
		say('user', 'Hello'),
		say('assistant', 'Welcome.'),
		say('user', 'Tell me about Eldoria')
	];

	it('orders system → history → post-history instructions', () => {
		const prompt = assemblePrompt(card, history, { userName: 'Sam' });
		expect(prompt.messages[0].role).toBe('system');
		expect(prompt.messages[0].content).toContain('Write in third person.');
		expect(prompt.messages.slice(-1)[0]).toEqual({
			role: 'system',
			content: 'Always end with an action.'
		});
		expect(prompt.messages.slice(1, -1).map((m) => m.content)).toEqual([
			'Hello',
			'Welcome.',
			'Tell me about Eldoria'
		]);
	});

	it('puts lore into the system block and reports which entries fired', () => {
		const prompt = assemblePrompt(card, history, { userName: 'Sam' });
		expect(prompt.messages[0].content).toContain('Eldoria is the wood.');
		expect(prompt.lore.length).toBeGreaterThan(0);
	});

	it('keeps the newest message even when it alone blows the budget', () => {
		const huge = [say('user', 'x'.repeat(40_000))];
		const prompt = assemblePrompt(card, huge, { userName: 'Sam', contextTokens: 256 });
		expect(prompt.messages.at(-2)).toMatchObject({ role: 'user' });
		expect(prompt.droppedHistory).toBe(0);
	});

	it('drops older history first when the budget is tight', () => {
		const long = Array.from({ length: 20 }, (_, index) =>
			say('user', `message ${index} `.repeat(40))
		);
		const prompt = assemblePrompt(card, long, {
			userName: 'Sam',
			contextTokens: 400,
			minHistory: 2
		});
		expect(prompt.droppedHistory).toBeGreaterThan(0);
		// The tail survives; the head does not.
		expect(prompt.messages.at(-2)?.content).toContain('message 19');
		expect(prompt.messages.some((m) => m.content.includes('message 0 '))).toBe(false);
	});

	it('works without a card (plain chat)', () => {
		const prompt = assemblePrompt(null, [say('user', 'hi')], { userName: 'Sam' });
		expect(prompt.messages).toEqual([{ role: 'user', content: 'hi' }]);
		expect(prompt.lore).toEqual([]);
	});

	it("appends the user's extra system text after the card system prompt", () => {
		const prompt = assemblePrompt(card, history, {
			userName: 'Sam',
			extraSystem: 'Be brief.'
		});
		const system = prompt.messages[0].content;
		expect(system.indexOf('Write in third person.')).toBeLessThan(system.indexOf('Be brief.'));
	});

	it('estimates tokens for the assembled prompt', () => {
		const prompt = assemblePrompt(card, history, { userName: 'Sam' });
		expect(prompt.estimatedTokens).toBeGreaterThan(0);
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('abcde')).toBe(2);
	});
});

describe('greetingFor', () => {
	const withGreetings = { ...card, alternateGreetings: ['Evening, {{user}}.', 'Turn back.'] };

	it('uses the first message by default', () => {
		expect(greetingFor(withGreetings, 'Sam')).toBe('Welcome, Sam.');
	});

	it('uses an alternate greeting when asked', () => {
		expect(greetingFor(withGreetings, 'Sam', 0)).toBe('Evening, Sam.');
		expect(greetingFor(withGreetings, 'Sam', 1)).toBe('Turn back.');
	});

	it('falls back to the first message for an out-of-range index', () => {
		expect(greetingFor(withGreetings, 'Sam', 9)).toBe('Welcome, Sam.');
	});
});

describe('the previous shot block', () => {
	// A storyboard card has no memory of its own pictures. Handing it the last prompt verbatim is what
	// stops it re-deriving (and drifting) the scene every turn.
	const card = {
		id: 'card_storyboard',
		name: 'Storyboard',
		spec: 'chara_card_v2',
		description: 'engine',
		personality: '',
		scenario: '',
		firstMessage: '',
		exampleMessages: '',
		systemPrompt: '',
		postHistoryInstructions: 'One marker only.',
		alternateGreetings: [],
		tags: ['utility', 'image-generation'],
		creator: '',
		characterVersion: '',
		creatorNotes: '',
		appearance: '',
		avatar: null,
		book: null
	} as unknown as Parameters<typeof assemblePrompt>[0];

	it('is appended last, verbatim, so it is the freshest thing the model reads', () => {
		const built = assemblePrompt(card, [], {
			userName: 'You',
			previousShot: '1man, blue business suit, bus interior'
		});
		const last = built.messages[built.messages.length - 1];
		expect(last.role).toBe('system');
		expect(last.content).toContain('PREVIOUS SHOT');
		expect(last.content).toContain('1man, blue business suit, bus interior');
		// After the card's own rules, not before them.
		expect(last.content.indexOf('One marker only.')).toBeLessThan(
			last.content.indexOf('PREVIOUS SHOT')
		);
	});

	it('is absent when there is no previous picture', () => {
		const built = assemblePrompt(card, [], { userName: 'You' });
		expect(JSON.stringify(built.messages)).not.toContain('PREVIOUS SHOT');
	});
});
