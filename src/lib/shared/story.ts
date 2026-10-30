/**
 * The per-chat scene record — everything an image prompt needs that the transcript does not say.
 *
 * A diffusion model has no memory: "she waits" is a picture of *a* woman unless something outside the
 * prose remembers who she is, where the story is, and what it should look like. That something is this
 * record, stored as JSON in `chats.story` and mirrored into `data/chats/<id>/story.json`.
 *
 * Three fields today:
 *
 * - `look` — where and when this story happens. Location, light, weather: the part that rarely changes
 *   and that every scene prompt must carry.
 * - `style` — how it should be rendered (photograph, anime, illustration). A chat is one kind of picture
 *   from beginning to end, so asking per picture is a question with the same answer every time.
 * - `seed` — the noise the picture starts from. Consistency, not variety: reusing one seed is what keeps
 *   a face recognisable between scenes, which is the single hardest thing to get from a text prompt.
 *
 * **Shared** code: the panel that edits it is a component, and `$lib/server` cannot be imported into a
 * component. The prompt builder imports the same list, so a style can never mean two different things on
 * the two sides.
 *
 * Forward compatibility: `parseStory` accepts anything. A chat written before this record existed has
 * `{ look }` or `{}` or `null`, and it must load, not throw — the record gains fields over time and old
 * chats cannot be migrated by hand.
 */
import { z } from 'zod';

/** The seed ComfyUI accepts; beyond `2^31-1` some nodes wrap and repeat earlier pictures. */
export const STORY_SEED_MAX = 2 ** 31 - 1;

/** A `look` is one line of place-and-light, not a paragraph: 400 characters is already generous. */
export const STORY_LOOK_MAX = 400;

export const STORY_STYLES = [
	{
		id: 'none',
		label: 'No style hint',
		// Empty on purpose: an empty style contributes nothing to the prompt, so "no style" must not
		// leave a dangling comma or a stray adjective behind.
		tags: '',
		prose: ''
	},
	{
		id: 'photo',
		label: 'Photograph',
		tags: 'photograph, photorealistic, natural color, shallow depth of field',
		prose: 'Photorealistic, natural color grading, shallow depth of field'
	},
	{
		id: 'anime',
		label: 'Anime',
		tags: 'anime screenshot, cel shading, clean lineart, vivid color',
		prose: 'Anime illustration, cel shading, clean lineart, vivid color'
	},
	{
		id: 'illustration',
		label: 'Illustration',
		tags: 'digital illustration, painterly, soft brushwork, muted color',
		prose: 'Digital illustration, painterly brushwork, soft muted color'
	}
] as const;

export type StoryStyleId = (typeof STORY_STYLES)[number]['id'];

export type StoryStyle = (typeof STORY_STYLES)[number];

export const STORY_STYLE_IDS = STORY_STYLES.map((style) => style.id) as [
	StoryStyleId,
	...StoryStyleId[]
];

/**
 * The fields, declared once. `storySchema` adds defaults on top of them; the patch does not, which is the
 * difference between "save the look" and "save the look **and** reset the seed to nothing".
 */
const lookField = z.string().max(STORY_LOOK_MAX);
const styleField = z.enum(STORY_STYLE_IDS);
const seedField = z.number().int().min(0).max(STORY_SEED_MAX).nullable();
/** `null` means "inherit": draw markers automatically in a chat whose card is a storyboard utility. */
const autoField = z.boolean().nullable();
/**
 * The image model this chat draws with (a graph id). Not cosmetic: a caption-trained model and a
 * Danbooru-tag model need different prompt shapes, and the storyboard card is told which one it is
 * writing for. `null` means "whatever the picker last used".
 */
const imageWorkflowField = z.string().max(64).nullable();

/**
 * What the pictures have established so far: place, what is worn, who is in frame, what was taken off.
 *
 * Derived mechanically from each completed prompt (`server/prompts/state.ts`) and handed back to the
 * storyboard writer, which otherwise paraphrases its own prose and drifts — a sundress reappearing over a
 * bikini, a woman walking back to her car on the "towards the sand" beat.
 */
const shotStateField = z
	.object({
		place: z.array(z.string()).default([]),
		wardrobe: z.array(z.string()).default([]),
		cast: z.array(z.string()).default([]),
		removed: z.array(z.string()).default([])
	})
	.nullable();

export const storySchema = z.object({
	look: lookField.default(''),
	style: styleField.default('none'),
	seed: seedField.default(null),
	autoImages: autoField.default(null),
	imageWorkflow: imageWorkflowField.default(null),
	shotState: shotStateField.default(null)
});

/**
 * What a save may change: any subset, so editing the look never touches the seed.
 *
 * Written out rather than `storySchema.partial()` on purpose: a partial of a schema whose fields carry
 * `.default()` still *applies* those defaults, so a PATCH `{ look }` would arrive as `{ look, style:
 * 'none', seed: null }` and quietly clear the seed. The sibling test pins that.
 */
export const storyPatchSchema = z.object({
	look: lookField.optional(),
	style: styleField.optional(),
	seed: seedField.optional(),
	autoImages: autoField.optional(),
	imageWorkflow: imageWorkflowField.optional(),
	shotState: shotStateField.optional()
});

export type Story = z.infer<typeof storySchema>;

export type StoryPatch = z.infer<typeof storyPatchSchema>;

/** The empty record: a chat that has never had a scene prompt still has a well-shaped story. */
export function emptyStory(): Story {
	return {
		look: '',
		style: 'none',
		seed: null,
		autoImages: null,
		imageWorkflow: null,
		shotState: null
	};
}

/**
 * Read a stored record, tolerating anything.
 *
 * Never throws and never returns a partial object. Unknown keys are dropped (a field the app no longer
 * has must not linger and be re-saved forever), and a value of the wrong type falls back to its default
 * rather than failing the whole page — a chat is more valuable than its metadata.
 */
export function parseStory(raw: unknown): Story {
	const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const look = typeof source.look === 'string' ? source.look.slice(0, STORY_LOOK_MAX) : '';
	const style = STORY_STYLE_IDS.find((id) => id === source.style) ?? 'none';

	let seed: number | null = null;
	if (typeof source.seed === 'number' && Number.isFinite(source.seed) && source.seed >= 0) {
		seed = Math.min(STORY_SEED_MAX, Math.floor(source.seed));
	}

	const autoImages = typeof source.autoImages === 'boolean' ? source.autoImages : null;
	const imageWorkflow = typeof source.imageWorkflow === 'string' ? source.imageWorkflow : null;

	let shotState: Story['shotState'] = null;
	if (source.shotState && typeof source.shotState === 'object') {
		const raw = source.shotState as Record<string, unknown>;
		const list = (value: unknown) =>
			Array.isArray(value)
				? value.filter((entry): entry is string => typeof entry === 'string')
				: [];
		shotState = {
			place: list(raw.place),
			wardrobe: list(raw.wardrobe),
			cast: list(raw.cast),
			removed: list(raw.removed)
		};
	}

	return { look, style, seed, autoImages, imageWorkflow, shotState };
}

/** One style entry, with `none` as the fallback so an unknown id can never break a prompt. */
/**
 * The style a chat actually draws with.
 *
 * An anime fine-tune with the style set to `none` renders like a photograph — measured on a Krea2 chat
 * whose every prompt was correct and whose picture came back photoreal, because nothing in it said
 * "anime". The picker's `none` therefore means "no extra hint for models that need none", not "strip the
 * one hint this model needs".
 */
export function effectiveStyle(
	style: StoryStyleId | string | null | undefined,
	workflow: string | null | undefined
): StoryStyleId {
	if (style && style !== 'none') return style as StoryStyleId;
	const id = (workflow ?? '').trim().toLowerCase();
	if (id.startsWith('krea2') || id.startsWith('anima')) return 'anime';
	return 'none';
}

export function storyStyle(id: StoryStyleId | string | null | undefined): StoryStyle {
	return STORY_STYLES.find((style) => style.id === id) ?? STORY_STYLES[0];
}

/**
 * Put the chat's render style on the end of a prompt, if it is not already there.
 *
 * The storyboard writer is asked to keep the style tags in every prompt and mostly does — but "mostly" is
 * exactly what produced the round-7 flip: three anime frames, then a painted semi-realistic one, then back.
 * The style is a chat-level decision, so the server pins it instead of trusting the model to remember.
 */
export function pinStyle(prompt: string, style: StoryStyleId | string | null | undefined): string {
	const { tags } = storyStyle(style);
	const body = prompt.trim().replace(/[,\s]+$/, '');
	if (!tags) return body;
	if (!body) return tags;
	// Already pinned (some writers do include it) — the first tag is the marker for "this prompt has a style".
	const first = tags.split(',')[0].trim().toLowerCase();
	if (body.toLowerCase().includes(first)) return body;
	return `${body}, ${tags}`;
}
