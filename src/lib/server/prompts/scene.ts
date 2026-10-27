/**
 * "Make a picture of this moment."
 *
 * The legacy app had 672 lines of `sceneprompt.js` for this, most of it repairing model output. The
 * rewrite inverts that: the browser sends the recent transcript, this module turns it into a prompt with
 * rules that are short enough to read, and the model never writes the prompt at all. Fewer moving parts,
 * and the same picture quality because the tags come from the character card the user already curated.
 *
 * Pure: no I/O, no config. The caller decides which messages to pass and where the image goes.
 */
import type { Character } from '$lib/shared/character.js';

export interface SceneInput {
	/** Recent messages, oldest first. Only the tail is used — the scene is "now". */
	messages: Array<{ role: string; content: string }>;
	character?: Character | null;
	/** Free-text location/style stored with the chat (the legacy "story look"). */
	look?: string | null;
	shot?: 'wide' | 'medium' | 'close';
	/** Extra tags the user typed, appended last so they win. */
	extra?: string;
}

export interface ScenePrompt {
	prompt: string;
	width: number;
	height: number;
}

/** Portrait by default: a chat is a person-shaped story. */
const SHOT_TAGS: Record<NonNullable<SceneInput['shot']>, string> = {
	wide: 'wide shot, full body, environment visible',
	medium: 'medium shot, upper body',
	close: 'close-up, portrait, detailed face'
};

const QUALITY_TAGS = 'masterpiece, best quality, detailed lighting, cinematic composition';

/** How much of the conversation describes the scene. Two turns is enough for "what is happening now". */
const CONTEXT_MESSAGES = 2;
const CONTEXT_WORDS = 45;

export function buildScenePrompt(input: SceneInput): ScenePrompt {
	const shot = input.shot ?? 'medium';
	const parts: string[] = [];

	// 1. Who. Appearance first: it is the part a card author actually tuned for images.
	const appearance = appearanceTags(input.character);
	if (appearance) parts.push(appearance);

	// 2. Where. The chat's look, then whatever the last turns said about the surroundings.
	if (input.look?.trim()) parts.push(input.look.trim());
	const moment = momentTags(input.messages);
	if (moment) parts.push(moment);

	// 3. How it is framed and rendered. The user's own tags go last so they win.
	parts.push(SHOT_TAGS[shot]);
	if (input.extra?.trim()) parts.push(dropNegations(input.extra));
	parts.push(QUALITY_TAGS);

	return {
		prompt: dedupe(parts.join(', ')),
		width: shot === 'wide' ? 1216 : 832,
		height: shot === 'wide' ? 832 : 1216
	};
}

/**
 * A card's `personality`/`scenario` are prose written for an LLM, and prose makes a muddy image prompt.
 * Keep the appearance line, drop sentences, and let commas become tag separators.
 */
function appearanceTags(character?: Character | null): string {
	if (!character) return '';
	const source = [character.appearance, character.description].filter(Boolean).join('. ');
	return firstClause(source, 18);
}

/**
 * The last turns as a scene description, minus everything that describes nothing visible: quoted
 * dialogue, markdown, and questions ("what is Eldoria?" is not a picture).
 */
function momentTags(messages: SceneInput['messages']): string {
	const text = messages
		.filter((message) => message.role !== 'system')
		.slice(-CONTEXT_MESSAGES)
		.map((message) => message.content.replace(/[*_`#>]/g, ' '))
		.join(' ')
		.replace(/"[^"]*"/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.filter((sentence) => !sentence.trim().endsWith('?'))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return firstClause(text, CONTEXT_WORDS);
}

/** Take whole words up to `maxWords`, stop at a sentence end if one comes first. */
function firstClause(text: string, maxWords: number): string {
	const cleaned = text.replace(/\s+/g, ' ').trim();
	if (!cleaned) return '';
	const sentence = cleaned.split(/(?<=[.!?])\s/)[0];
	const words = (sentence || cleaned).split(' ').slice(0, maxWords);
	return words
		.join(' ')
		.replace(/[.,;:!?]+$/, '')
		.trim();
}

/**
 * Remove negations, because a diffusion prompt has no grammar for them.
 *
 * Measured on a real run: `no cloak` produced a picture *with* a cloak draped over the shoulder —
 * "cloak" is a token, "no" is decoration. A negative prompt or an inpaint is the correct way to remove
 * something; here the safe move is to drop the phrase rather than add the thing it names.
 */
export function dropNegations(text: string): string {
	return text
		.replace(/(?:^|[\s,])(?:no|without|not|never)\s+[\w-]+/gi, ' ')
		.replace(/\s*,\s*(?=,|$)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** SD weights repeated tags, so `1girl, 1girl` is not the same prompt as `1girl`. */
function dedupe(prompt: string): string {
	const seen = new Set<string>();
	return prompt
		.split(',')
		.map((tag) => tag.trim())
		.filter((tag) => {
			if (!tag) return false;
			const key = tag.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.join(', ');
}
