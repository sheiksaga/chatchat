/**
 * Turning text into images: the marker syntax the model writes, and the `/image` command the user types.
 *
 * **Shared** code (no I/O, no server imports): the browser needs the same grammar to offer "make this
 * image" buttons under a reply, and the tests need it without a GPU.
 *
 * Grammar: `[[IMG: prompt | AR | SHOT | SEED]]`
 *   prompt  free text; commas are tags, exactly like an SD prompt
 *   AR      optional `WxH` (`832x1216`), else the model default
 *   SHOT    optional camera/quality tag, appended to the prompt
 *   SEED    optional integer; `-1` or absent means random
 */
export interface ImageRequest {
	prompt: string;
	width?: number;
	height?: number;
	seed?: number;
}

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
	// knows what they are waiting for before they tap.
	{ id: 'krea2-anime-t2i', label: 'Krea2 Anime v14 (~18 s)' },
	{ id: 'z-image-turbo-t2i', label: 'Z-Image Turbo 6B (~16 s)' },
	{ id: 'z-image-mystic-t2i', label: 'Z-Image + Mystic XXX NSFW (~15 s)' },
	{ id: 'flux2-klein-t2i', label: 'FLUX.2 Klein photoreal (~22 s)' },
	{ id: 'anima-base-t2i', label: 'Anima Base obedient (~27 s)' },
	{ id: 'anima-turbo-t2i', label: 'Anima Turbo fastest (~7 s)' },
	{ id: 'anima-fp16-t2i', label: 'Anima Turbo fp16 (~8 s)' },
	{ id: 'krea2-t2i', label: 'Krea2 Turbo painterly (~43 s)' }
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];

// Measured best of the six for a chat scene at 832x1216: keeps wardrobe and props, ~18 s.
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'krea2-anime-t2i';

export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((model) => model.id) as [
	ImageModelId,
	...ImageModelId[]
];

const MARKER = /\[\[\s*IMG\s*:([^\]]*)\]\]/gi;

/** Parse one marker body. Never throws: a half-broken marker yields null instead of killing a reply. */
export function parseMarkerBody(body: string, defaults: { width?: number; height?: number } = {}) {
	const [rawPrompt, rawSize, rawShot, rawSeed] = body.split('|').map((part) => part.trim());
	const prompt = [rawPrompt, rawShot].filter(Boolean).join(', ');
	if (!prompt) return null;

	let width = defaults.width;
	let height = defaults.height;
	const size = rawSize?.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
	if (size) {
		width = clampSize(Number(size[1]));
		height = clampSize(Number(size[2]));
	}

	const seed = rawSeed && /^-?\d+$/.test(rawSeed) ? Number(rawSeed) : undefined;

	return { prompt, width, height, seed: seed !== undefined && seed >= 0 ? seed : undefined };
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
