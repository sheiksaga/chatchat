/**
 * Turning text into images: the marker syntax the model writes, and the `/image` command the user types.
 *
 * **Shared** code (no I/O, no server imports): the browser needs the same grammar to offer "make this
 * image" buttons under a reply, and the tests need it without a GPU.
 *
 * Grammar: `[[IMG: prompt | AR | SHOT | SEED]]`
 *   prompt  free text; commas are tags, exactly like an SD prompt
 *   AR      optional `WxH` (`832x1216`) **or** a word: `PORTRAIT`, `SQUARE`, `LANDSCAPE`, `CINEMA`
 *   SHOT    optional camera word: `CLOSE`, `MEDIUM`, `WIDE`, `DUTCH`, `OVERHEAD`, `LOWANGLE`,
 *           `HIGHANGLE`, `PROFILE`, `BACKVIEW`, `POV` — or free tags, appended as before
 *   SEED    optional integer, or `RANDOM`, or `LOCK` (reuse the chat's seed)
 *
 * The word forms are not decoration: they are the vocabulary character cards are written against
 * (the ComfyInject extension taught models exactly this), and a card that says `| PORTRAIT | MEDIUM |
 * LOCK |` must mean what it says. Before, `PORTRAIT` was dropped, `MEDIUM` was appended to the prompt as
 * a junk tag and `LOCK` vanished — a "storyboard" card produced pictures with the word MEDIUM in them and
 * a different face every time. Segment order is a convention, not a requirement: each of segments 2–4 is
 * classified by what it contains, so `| SQUARE | CLOSE |` and `| CLOSE | SQUARE |` both work.
 */
import { z } from 'zod';

export interface ImageRequest {
	prompt: string;
	width?: number;
	height?: number;
	seed?: number;
	/** `LOCK` was in the marker: reuse the chat's seed instead of picking a new one. */
	lock?: boolean;
}

/**
 * One picture, as the browser sees it.
 *
 * The database row (`ImageRow` in `server/db/images.ts`) is a superset: it also carries `file`, `mime`
 * and the raw ComfyUI `meta`. A component must not import `$lib/server/**`, so this is the shape the
 * page load and the SSE `done` event are typed as — and the one `ImageRow` is checked against.
 *
 * `message_id` is what makes a picture belong somewhere in the transcript: it is the message it was
 * drawn under. Rows written before that column was used have `null`, which the chat page resolves by
 * timestamp.
 */
export const imageRecordSchema = z.object({
	id: z.string(),
	chat_id: z.string().nullable().default(null),
	message_id: z.string().nullable().default(null),
	width: z.number().nullable().default(null),
	height: z.number().nullable().default(null),
	prompt: z.string().nullable().default(null),
	seed: z.number().nullable().default(null),
	workflow: z.string().nullable().default(null),
	created_at: z.number()
});

export type ImageRecord = z.infer<typeof imageRecordSchema>;

/** Aspect ratios the UI offers; the marker accepts any `WxH`. */
export const SIZE_PRESETS = [
	{ label: 'Square', value: '1024x1024', width: 1024, height: 1024 },
	{ label: 'Portrait', value: '832x1216', width: 832, height: 1216 },
	{ label: 'Landscape', value: '1216x832', width: 1216, height: 832 },
	{ label: 'Wide', value: '1344x768', width: 1344, height: 768 }
] as const;

/**
 * The image models the UI offers.
 *
 * **Shared** because the browser needs the list for its picker and the server needs it to validate the
 * request; `$lib/server` cannot be imported into a component (SvelteKit fails the build). The server's
 * `GRAPHS` registry is checked against this list by a test, so adding a graph without its label — or
 * the other way round — breaks `npm run verify` rather than the picker.
 */
export const IMAGE_MODELS = [
	// Ordered by what usually wins a story scene; the time is on a laptop 8 GB card, so a phone user
	// knows what they are waiting for before they tap. Z-Image leads: ~5 s and it keeps a scene's props.
	{ id: 'z-image-turbo-t2i', label: 'Z-Image Turbo 6B (~5 s)' },
	{ id: 'krea2-anime-t2i', label: 'Krea2 Anime v14 (~14 s)' },
	{ id: 'krea2-anime-nsfw-t2i', label: 'Krea2 Anime Unlocked (~10 s)' },
	// "Unlocked" is the shop-window word for "no content filter"; the ids keep `nsfw`/`mystic` because
	// they are stored in every image row that was ever drawn with them.
	{ id: 'z-image-mystic-t2i', label: 'Z-Image + Mystic XXX Unlocked (~5 s)' },
	{ id: 'flux2-klein-t2i', label: 'FLUX.2 Klein photoreal (~4 s)' },
	{ id: 'flux2-klein-nsfw-t2i', label: 'FLUX.2 Klein Unlocked (~4 s)' },
	// Anima Base is absent on purpose: CFG + ~35 steps costs 20-35 s and Z-Image beats it, but the graph
	// stays registered so `POST /api/images` and the `[[IMG]]` marker can still reach it.
	{ id: 'anima-turbo-t2i', label: 'Anima Turbo + detail (~5 s)' },
	{ id: 'anima-fp16-t2i', label: 'Anima Turbo fp16 (~8 s)' },
	{ id: 'krea2-t2i', label: 'Krea2 Turbo painterly (~43 s)' }
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];

// Measured best for a chat scene at 832x1216: keeps wardrobe and props at ~5 s, half of Krea2 Anime.
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'z-image-turbo-t2i';

export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((model) => model.id) as [
	ImageModelId,
	...ImageModelId[]
];

/** A workflow id as a caption reads it: the picker's label without the timing, or the raw id. */
export function imageModelLabel(workflow: string | null | undefined): string {
	const known = IMAGE_MODELS.find((model) => model.id === workflow);
	return known?.label.replace(/\s*\(~\d+ s\)$/, '') ?? workflow ?? 'image';
}

/**
 * `[[IMG: …]]`, tolerant of the spacing models actually emit.
 *
 * Measured: an RP tune wrote `[ [IMG: 1man, … ] ]` — one space, and the marker stopped being a marker.
 * It then rendered as a wall of Danbooru tags in the transcript, which is exactly what a reader reports as
 * "it spits out tags instead of pictures". Brackets are punctuation to a language model, not syntax.
 */
const MARKER = /\[\s*\[\s*IMG\s*:([^\]]*)\]\s*\]/gi;

/**
 * The aspect words a card may use, mapped to the same sizes `SIZE_PRESETS` offers.
 *
 * `CINEMA` is in the card vocabulary but not in ComfyInject's parser (it silently fell back to square and
 * left the word in the prompt — see `comfyinject-rea/REPORT.md`). Here it means the Wide preset.
 */
const ASPECT_TOKENS: Record<string, { width: number; height: number }> = {
	portrait: { width: 832, height: 1216 },
	square: { width: 1024, height: 1024 },
	landscape: { width: 1216, height: 832 },
	cinema: { width: 1344, height: 768 }
};

/**
 * Camera words, as the tag they become.
 *
 * A shot word is *framing*, and every model we run reads framing as a tag (`close-up`, `from below`).
 * Leaving the raw word in the prompt is what put `MEDIUM` in a picture — a token the texture-driven
 * encoders treat as noise.
 *
 * The two families come from the two vocabularies that exist: the words cards were written against
 * (`CLOSE`/`MEDIUM`/`WIDE`, `DUTCH`, `POV`…) and the shot-sheet shorthand a storyboard actually uses
 * (`EWS WS FS MS MCU CU ECU` for size, `OTS 2SHOT HA LA EYELEVEL` for type). A beat that says
 * "two people, over the shoulder" needs `OTS`, not a wider `MEDIUM` — that is how a second character
 * ends up in the same frame as the first instead of being cropped out.
 */
const SHOT_TOKENS: Record<string, string> = {
	close: 'close-up',
	medium: 'medium shot, upper body',
	wide: 'wide shot, full body, environment visible',
	dutch: 'dutch angle',
	overhead: 'from above, overhead view',
	lowangle: 'from below, low angle',
	highangle: 'from above, high angle',
	profile: 'profile view',
	backview: 'from behind, back view',
	pov: 'pov',
	// Shot sizes, widest to tightest.
	ews: 'extreme wide shot, tiny figures, environment dominant',
	ws: 'wide shot, full body, environment visible',
	fs: 'full shot, head to toe',
	ms: 'medium shot, waist up',
	mcu: 'medium close-up, chest up',
	cu: 'close-up',
	ecu: 'extreme close-up, detail',
	// Shot types.
	ots: 'over-the-shoulder shot, foreground shoulder and head, subject in focus',
	twoshot: 'two shot, two people in frame',
	'2shot': 'two shot, two people in frame',
	ha: 'from above, high angle',
	la: 'from below, low angle',
	eyelevel: 'eye level camera'
};

/** Parse one marker body. Never throws: a half-broken marker yields null instead of killing a reply. */
export function parseMarkerBody(body: string, defaults: { width?: number; height?: number } = {}) {
	const segments = body.split('|').map((part) => part.trim());
	const text: string[] = [];
	let width = defaults.width;
	let height = defaults.height;
	let seed: number | undefined;
	let lock: boolean | undefined;

	for (const [index, segment] of segments.entries()) {
		if (!segment) continue;

		// The last three segments are the convention; the first one is always the prompt.
		if (index > 0) {
			const size = segment.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
			if (size) {
				width = clampSize(Number(size[1]));
				height = clampSize(Number(size[2]));
				continue;
			}

			// `closeup` and `low angle` are how models actually write these words.
			const word = segment.toLowerCase().replace(/[\s_-]+/g, '');
			const aspect = ASPECT_TOKENS[word];
			if (aspect) {
				width = aspect.width;
				height = aspect.height;
				continue;
			}

			const shot = SHOT_TOKENS[word];
			if (shot) {
				text.push(shot);
				continue;
			}

			if (word === 'random' || word === 'none') continue;
			if (word === 'lock' || word === 'locked' || word === 'same') {
				lock = true;
				continue;
			}

			// A bare integer is a seed only in the seed slot; elsewhere it is scene text (`1985`, `1970s`).
			if (index === segments.length - 1 && /^-?\d+$/.test(segment)) {
				const value = Number(segment);
				if (value >= 0) seed = value;
				continue;
			}
		}

		text.push(segment);
	}

	const prompt = text
		.join(', ')
		.replace(/\s*,\s*(?=,|$)/g, '')
		.trim();
	// A marker's job is to describe a scene. `| PORTRAIT | CLOSE |` on its own describes nothing, and
	// drawing a picture of the word "close-up" wastes a minute of GPU — treat it as no marker at all.
	if (!prompt || !segments[0]) return null;

	return { prompt, width, height, seed, lock: lock || undefined };
}

/** ComfyUI will happily try to allocate a 9000 px image; keep it inside what an 8 GB card can do. */
function clampSize(value: number): number {
	return Math.min(2048, Math.max(256, Math.round(value / 64) * 64));
}

/** Every image marker in a reply, in order. */
export function findImageMarkers(
	text: string,
	defaults: { width?: number; height?: number } = {}
): Array<NonNullable<ReturnType<typeof parseMarkerBody>>> {
	const found: Array<NonNullable<ReturnType<typeof parseMarkerBody>>> = [];
	for (const match of text.matchAll(MARKER)) {
		const parsed = parseMarkerBody(match[1], defaults);
		if (parsed) found.push(parsed);
	}
	return found;
}

/** Strip markers so the transcript does not show the machinery. */
export function stripImageMarkers(text: string): string {
	return text
		.replace(MARKER, '')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

/**
 * `/image a moonlit harbour, lighthouse beam` → a request. Returns null for any other message, so the
 * composer can call this on every send without thinking about it.
 */
export function parseImageCommand(text: string): ImageRequest | null {
	const match = text.match(/^\s*\/image\b\s*([\s\S]*)$/i);
	if (!match) return null;
	const prompt = match[1].trim();
	if (!prompt) return null;
	return { prompt };
}

/** A stable seed for "regenerate": same prompt, different picture. */
export function randomSeed(): number {
	return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Put every picture under the message it was drawn with.
 *
 * `message_id` is authoritative. Rows written before pictures carried one fall back to time — the last
 * turn that existed when the picture was drawn, which is where it was made — so an old chat still reads
 * in order. Anything with no earlier turn at all (a picture drawn in an empty chat) goes in `loose`,
 * which the chat renders after the transcript rather than over it.
 *
 * Pure and shared: the browser derives from it, the tests pin it. A picture can therefore never appear
 * under a turn it has nothing to do with, which is what a docked strip could not promise.
 */
export function placeImages(
	images: ImageRecord[],
	messages: Array<{ id: string; createdAt: number }>
): { byMessage: Map<string, ImageRecord[]>; loose: ImageRecord[] } {
	const byMessage = new Map<string, ImageRecord[]>();
	const loose: ImageRecord[] = [];
	const known = new Set(messages.map((message) => message.id));

	for (const image of [...images].sort((a, b) => a.created_at - b.created_at)) {
		const explicit = image.message_id;
		let target = explicit && known.has(explicit) ? explicit : null;
		if (!target) {
			for (const message of messages) {
				if (message.createdAt > image.created_at) break;
				target = message.id;
			}
		}
		if (!target) {
			loose.push(image);
			continue;
		}
		const bucket = byMessage.get(target);
		if (bucket) bucket.push(image);
		else byMessage.set(target, [image]);
	}

	return { byMessage, loose };
}
