/**
 * "Make a picture of this moment."
 *
 * The legacy app had 672 lines of `sceneprompt.js` for this, most of it repairing model output. The
 * rewrite inverts that: the browser sends the recent transcript, this module turns it into a prompt with
 * rules that are short enough to read, and the model never writes the prompt at all. Fewer moving parts,
 * and the same picture quality because the tags come from the character card the user already curated.
 *
 * Three renderers, because the models do not agree on what a prompt is: Anima wants Danbooru-style tag
 * soup with its own safety/subject vocabulary, Z-Image (CFG 1, no negative prompt) wants one prose
 * paragraph with the constraints stated positively, and everything else takes the flat tag list.
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
	/** Which graph will draw this. Decides the prompt dialect, not the picture size. */
	workflow?: string | null;
}

export interface ScenePrompt {
	prompt: string;
	width: number;
	height: number;
}

export type SceneTarget = 'anima' | 'zimage' | 'flux2' | 'krea2' | 'generic';

/** Portrait by default: a chat is a person-shaped story. */
const SHOT_TAGS: Record<NonNullable<SceneInput['shot']>, string> = {
	wide: 'wide shot, full body, environment visible',
	medium: 'medium shot, upper body',
	// Measured: `close-up, portrait, detailed face` gave face fillers for explicit and fight scenes —
	// the model reads "detailed face" as the subject and crops to it. Framing only; nothing about faces.
	close: 'close-up'
};

/**
 * A framing the user already asked for. A prompt with two framings ("medium shot … wide shot from the
 * side") averages them into a muddy crop, so the user's words win and the shot tag is dropped entirely.
 */
const FRAMING_RE =
	/\b(wide(?:\s+shot)?|close[-\s]?up|full[-\s]?body|from behind|portrait|over[-\s]the[-\s]shoulder|cowboy shot|upper body|medium shot|mid[-\s]shot)\b/i;

const QUALITY_TAGS = 'masterpiece, best quality, detailed lighting, cinematic composition';

/** Anima-Aesthetic was trained with the quality labels stripped, so no `score_*` tags here. */
const ANIMA_QUALITY = 'masterpiece, best quality, highres';

/** How much of the conversation describes the scene. Two turns is enough for "what is happening now". */
const CONTEXT_MESSAGES = 2;
const CONTEXT_WORDS = 45;

const FEMALE_CUES = [
	'girl',
	'woman',
	'she',
	'her',
	'hers',
	'lady',
	'female',
	'mother',
	'sister',
	'queen',
	'princess',
	'wife',
	'girlfriend',
	'daughter',
	'witch',
	'goddess'
];

const MALE_CUES = [
	'boy',
	'man',
	'he',
	'him',
	'his',
	'male',
	'father',
	'brother',
	'king',
	'prince',
	'husband',
	'boyfriend',
	'son',
	'wizard',
	'god'
];

/** Whole words only: "hero" contains "her", and a ship is not a she. */
const wordCount = (text: string, word: string) =>
	text.match(new RegExp(`\\b${word}\\b`, 'gi'))?.length ?? 0;

// `\b` keeps `sex` from matching `sexy`; the trailing `\w*` on the stems is there because Anima's own
// vocabulary is inflected (`kissing`, `undressing`) and a safety tag that misses the tense is useless.
const EXPLICIT_RE =
	/\b(sex|nudes?|naked|topless|bottomless|penetration|penis|cock|vagina|pussy|cum|orgasm|nipples?|areola|undress\w*|masturbat\w*|blowjob|creampie|foreskin|thighs spread)\b/i;

const NSFW_RE =
	/\b(kiss\w*|lingerie|bra|panties|underwear|bed|intimate|embrace|caress|thong|bikini|groping|lap)\b/i;

/**
 * Which prompt dialect to emit, decided from the graph id the picker sent.
 *
 * A prefix match, not an exact id, because the registry gains variants (`anima-turbo-t2i`,
 * `anima-fp16-t2i`) and every one of them must speak the same dialect. An unknown or missing id gets the
 * flat tag list, which every checkpoint reads acceptably.
 */
export function sceneTarget(workflow?: string | null): SceneTarget {
	const id = (workflow ?? '').trim().toLowerCase();
	if (id.startsWith('anima')) return 'anima';
	if (id.startsWith('z-image')) return 'zimage';
	if (id.startsWith('flux2')) return 'flux2';
	if (id.startsWith('krea2')) return 'krea2';
	return 'generic';
}

export function buildScenePrompt(input: SceneInput): ScenePrompt {
	const shot = input.shot ?? 'medium';
	const target = sceneTarget(input.workflow);
	const moment = momentTags(input.messages);

	// Width/height are the picker's business, not the prompt dialect's: a scene is a scene.
	const size = shot === 'wide' ? { width: 1216, height: 832 } : { width: 832, height: 1216 };

	if (target === 'anima') {
		return { prompt: animaPrompt(input, shot, moment), ...size };
	}
	if (target === 'zimage') {
		return { prompt: zimagePrompt(input, shot, moment), ...size };
	}

	// generic / krea2 / flux2: the flat tag list, appearance first because that is what a card author tuned.
	const parts: string[] = [];

	// 1. Who.
	const appearance = appearanceTags(input.character);
	if (appearance) parts.push(appearance);

	// 2. Where. The chat's look, then whatever the last turns said about the surroundings.
	if (input.look?.trim()) parts.push(input.look.trim());
	if (moment) parts.push(moment);

	// 3. How it is framed and rendered. The user's own tags go last so they win.
	parts.push(SHOT_TAGS[shot]);
	if (input.extra?.trim()) parts.push(dropNegations(input.extra));
	parts.push(QUALITY_TAGS);

	return { prompt: dedupe(parts.join(', ')), ...size };
}

/**
 * Anima's official hybrid order: quality labels, then its own safety and subject vocabulary, then tags,
 * then one prose sentence for the action — the Anima authors' T2I recipe, which trains the tag half on
 * Danbooru counts and the sentence half on captions.
 */
function animaPrompt(
	input: SceneInput,
	shot: NonNullable<SceneInput['shot']>,
	moment: string
): string {
	// The safety word has to cover every source of explicit content, not just the last two turns: a
	// chat's own `look` carries wardrobe and anatomy tags, and a scene tagged `safe` while the look says
	// `completely nude` fights itself. Measured on a round-2 chat exactly like that.
	const parts: string[] = [
		ANIMA_QUALITY,
		safetyTag(`${moment} ${input.extra ?? ''} ${input.look ?? ''}`)
	];
	const subject = subjectTag(input.character, moment);
	if (subject) parts.push(subject);

	const appearance = appearanceTags(input.character);
	if (appearance) parts.push(appearance);
	if (moment) parts.push(moment);

	const extra = input.extra?.trim() ? dropNegations(input.extra) : '';
	if (!hasFraming(extra)) parts.push(SHOT_TAGS[shot]);
	if (input.look?.trim()) parts.push(input.look.trim());

	parts.push('detailed lighting');
	if (extra) parts.push(extra);

	return dedupe(parts.join(', '));
}

/**
 * Z-Image runs at CFG 1, where a negative prompt is ignored — so "no watermark" has to live in the
 * positive prompt as a constraint sentence. Prose, not tags: it was trained on long captions.
 */
function zimagePrompt(
	input: SceneInput,
	shot: NonNullable<SceneInput['shot']>,
	moment: string
): string {
	const extra = input.extra?.trim() ? dropNegations(input.extra) : '';
	const sentences: string[] = [];

	const opening =
		shot === 'wide'
			? 'A wide establishing shot of'
			: shot === 'close'
				? 'A close-up of'
				: 'A medium shot of';
	const appearance = appearanceTags(input.character);
	const subject = `${opening} ${personNoun(input.character, moment)}`;
	sentences.push(asSentence(appearance ? `${subject}, ${appearance}` : subject));

	if (moment) sentences.push(asSentence(moment));
	if (input.look?.trim()) sentences.push(asSentence(input.look.trim()));

	sentences.push('Soft natural lighting, detailed background.');
	sentences.push('Sharp focus, clean detailed image, no text, no watermark.');

	const body = sentences.join(' ').replace(/\s+/g, ' ').trim();
	// The user's tags are their own clause, not a new sentence — and no trailing comma when they are absent.
	return extra ? `${body.replace(/\.$/, '')}, ${extra}.` : body;
}

/** One sentence: capitalised, single terminal period, never an empty sentence of punctuation. */
function asSentence(text: string): string {
	const trimmed = text
		.replace(/\s+/g, ' ')
		.replace(/[.\s]+$/, '')
		.trim();
	if (!trimmed) return '';
	return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

/** True when the user's own tags already name a framing, so ours would fight it. */
function hasFraming(extra: string): boolean {
	return Boolean(extra) && FRAMING_RE.test(extra);
}

/**
 * The subject count line — Anima was trained with it and reads a scene very differently without it.
 *
 * Two named people beat any gender guess, because "two women argue" is a fact while a pronoun count is
 * an inference. Returns `''` rather than guessing: a wrong `1girl` on a landscape is worse than none.
 */
export function subjectTag(character?: Character | null, momentText?: string): string {
	const moment = momentText ?? '';
	if (/\b(two|both|pair of)\s+(women|girls|ladies)\b/i.test(moment)) return '2girls';
	if (/\b(two|both|pair of)\s+(men|boys)\b/i.test(moment)) return '2boys';
	if (/\b(man and (a )?woman|woman and (a )?man)\b/i.test(moment)) return '1girl, 1boy';

	const gender = genderCues(character);
	if (gender === 'female') return '1girl, solo';
	if (gender === 'male') return '1boy, solo';
	return '';
}

/**
 * Female wins ties and a zero score, because a card that says nothing about gender is far more often a
 * woman in this app's genre than not — but a card with *only* male cues must not be flipped.
 */
function genderCues(character?: Character | null): 'female' | 'male' | 'none' {
	if (!character) return 'none';
	const text = [character.appearance, character.description, (character.tags ?? []).join(' ')]
		.filter(Boolean)
		.join(' ');
	if (!text.trim()) return 'none';
	const female = FEMALE_CUES.reduce((total, word) => total + wordCount(text, word), 0);
	const male = MALE_CUES.reduce((total, word) => total + wordCount(text, word), 0);
	if (male > female) return 'male';
	// Ties go to female (this app's genre), but a card with *no* cue at all must not invent one: an
	// object-only card tagged `1girl` is exactly the "face in an empty room" failure.
	if (female > 0) return 'female';
	return 'none';
}

/** The noun Z-Image prose needs where tags would put `1girl`. */
function personNoun(character?: Character | null, momentText?: string): string {
	const moment = momentText ?? '';
	if (/\b(two|both|pair of)\s+(women|girls|ladies)\b/i.test(moment)) return 'two adult women';
	if (/\b(two|both|pair of)\s+(men|boys)\b/i.test(moment)) return 'two adult men';
	if (/\b(man and (a )?woman|woman and (a )?man)\b/i.test(moment))
		return 'an adult woman and an adult man';
	const gender = genderCues(character);
	if (gender === 'female') return 'an adult woman';
	if (gender === 'male') return 'an adult man';
	return 'a person';
}

/**
 * Anima's safety vocabulary, which it expects at the front of a prompt. Word boundaries matter: without
 * them `sex` matches `sexy` and a flirtatious line is tagged explicit.
 */
export function safetyTag(text: string): 'safe' | 'nsfw' | 'explicit' {
	if (EXPLICIT_RE.test(text)) return 'explicit';
	if (NSFW_RE.test(text)) return 'nsfw';
	return 'safe';
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
