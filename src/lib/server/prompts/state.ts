/**
 * The scene state a storyboard accumulates: where it is, what the subject is wearing, who is in frame.
 *
 * Why this exists: a storyboard writer is asked to "copy what is still true and change one thing", and it
 * does that from its own previous sentence — which it paraphrases. Measured over three sequences, that
 * produced a woman walking back to her car on the "walks towards the sand" beat, a sundress reappearing
 * over a thong bikini, and a dropped pomegranate. None of those are model failures: the model had no
 * record, only prose.
 *
 * So the state is derived **mechanically** from the prompt of the picture that was actually drawn, merged
 * with what was already established, and stored on the chat. The writer is then handed a short, canonical
 * block instead of being trusted to remember.
 *
 * Deliberately not clever: a small lexicon of place and garment words, plus removal phrases. It can miss
 * things; what it must never do is invent a place or a garment that no prompt contained, and it must never
 * bring back something the prompt said was taken off.
 */

export interface ShotState {
	/** Where the scene is. The newest prompt wins; an empty derivation keeps the previous one. */
	place: string[];
	/** Garments currently worn. Union of everything seen, minus what was taken off. */
	wardrobe: string[];
	/** Subject counts and people in frame (`1woman`, `crowd`, `shopkeeper`). */
	cast: string[];
	/** Garments a prompt said were taken off, so they can be reported as "not worn" and never re-added. */
	removed: string[];
}

export const EMPTY_STATE: ShotState = { place: [], wardrobe: [], cast: [], removed: [] };

/** Environment words. Matched as whole words inside a comma tag. */
const PLACE_WORDS = [
	'beach',
	'sand',
	'sandy',
	'ocean',
	'sea',
	'shore',
	'water',
	'parking lot',
	'car park',
	'asphalt',
	'street',
	'road',
	'pavement',
	'sidewalk',
	'alley',
	'lane',
	'market',
	'stall',
	'bazaar',
	'store',
	'shop',
	'boutique',
	'changing room',
	'curtain',
	'fitting room',
	'room',
	'interior',
	'indoors',
	'kitchen',
	'counter',
	'hallway',
	'stairs',
	'bedroom',
	'village',
	'hamlet',
	'town',
	'city',
	'forest',
	'woods',
	'shrine',
	'temple',
	'garden',
	'field',
	'bus',
	'train',
	'car',
	'cafe',
	'restaurant',
	'bar'
];

/** Garment words. A tag containing one of these is wardrobe. */
const GARMENT_WORDS = [
	'coat',
	'jacket',
	'trench',
	'parka',
	'dress',
	'sundress',
	'gown',
	'kimono',
	'yukata',
	'robe',
	'apron',
	'shirt',
	'blouse',
	't-shirt',
	'tee',
	'sweater',
	'cardigan',
	'hoodie',
	// 'top' and 'cap' were here and had to go: they match "the top button", "on top of", "the cap of the
	// bottle" far more often than they name clothing, and the scene prompt substitutes garments it finds.
	'skirt',
	'shorts',
	'jeans',
	'trousers',
	'pants',
	'leggings',
	'bikini',
	'thong',
	'swimsuit',
	'lingerie',
	'bra',
	'panties',
	'underwear',
	'stockings',
	'thighhighs',
	'socks',
	'shoes',
	'sandals',
	'boots',
	'heels',
	'hat',
	'uniform',
	'scarf',
	'gloves',
	'belt'
];

/** Counts and job nouns — who is visible. */
const CAST_WORDS = [
	'1girl',
	'1boy',
	'1woman',
	'1man',
	'2girls',
	'2boys',
	'2women',
	'2men',
	'3people',
	'4people',
	// Captions write "one man" / "several people" instead of count tags, so the plain nouns are matched
	// too. Redundancy in this block is harmless; a missing subject is not.
	'crowd',
	'people',
	'group',
	'couple',
	'bystander',
	'onlooker',
	'spectator',
	'passenger',
	'man',
	'woman',
	'men',
	'women',
	'driver',
	'shopkeeper',
	'vendor',
	'clerk',
	'worker',
	'guard',
	'customer'
];

/** A garment that is no longer worn: "sundress on the ground", "coat removed", "no dress". */
const REMOVAL_PHRASES = [
	'on the ground',
	'fallen',
	'at her feet',
	'at his feet',
	'removed',
	'taken off',
	'took off',
	'dropped',
	'beside her',
	'beside him',
	'hanging on',
	'draped',
	'pulled down',
	'slid off',
	'off her shoulders'
];

const wordRegex = (word: string) =>
	new RegExp(`(^|[^a-z])${word.replace(/[-/]/g, '[-/ ]')}([^a-z]|$)`);

const PLACE_MATCHERS = PLACE_WORDS.map((word) => ({ word, regex: wordRegex(word) }));
const GARMENT_MATCHERS = GARMENT_WORDS.map((word) => ({ word, regex: wordRegex(word) }));
const CAST_MATCHERS = CAST_WORDS.map((word) => ({ word, regex: wordRegex(word) }));

const unique = (values: string[]) => [...new Set(values)];

/**
 * Every established garment named in a piece of text, in the order they appear.
 *
 * Exported because the scene prompt has to notice when the transcript names a garment that contradicts
 * what is actually being worn — the "unbutton your blouse" beat that turned a dress into a blouse and
 * jeans on the next picture.
 */
export function garmentsIn(text: string): string[] {
	const found: Array<{ word: string; index: number }> = [];
	for (const matcher of GARMENT_MATCHERS) {
		const match = matcher.regex.exec(text.toLowerCase());
		if (match) found.push({ word: matcher.word, index: match.index });
	}
	return found.sort((a, b) => a.index - b.index).map((entry) => entry.word);
}

/**
 * Split a prompt into clauses.
 *
 * Both dialects have to work: a tag list (`1woman, sundress, beach`) and a caption (`A woman in a
 * sundress walks towards the sand, leaving the car in the parking lot.`). Splitting only on commas left
 * whole sentences as "tags", so the state came back as an entire caption. Commas, sentence ends and the
 * conjunctions a caption joins things with are all separators.
 */
function clauses(prompt: string): string[] {
	return prompt
		.toLowerCase()
		.split(/[,;.!?\n]+|\band\b|\bwith\b|\bwhile\b|\bas\b|\bthen\b|\bbefore\b/)
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * Read the state out of one prompt.
 *
 * The unit of state is the **canonical word** (`sundress`, `parking lot`), not the clause that held it:
 * the block is a record, and the exact shade or cut is already carried by PREVIOUS SHOT. A garment in a
 * clause that also says it came off is taken off, not worn — that single rule is the sundress fix.
 */
export function deriveShotState(prompt: string): ShotState {
	const place: string[] = [];
	const cast: string[] = [];
	const garments: string[] = [];
	const removed: string[] = [];

	for (const clause of clauses(prompt)) {
		for (const matcher of PLACE_MATCHERS) {
			if (matcher.regex.test(clause) && !place.includes(matcher.word)) place.push(matcher.word);
		}
		for (const matcher of CAST_MATCHERS) {
			if (matcher.regex.test(clause) && !cast.includes(matcher.word)) cast.push(matcher.word);
		}

		const strips = REMOVAL_PHRASES.some((phrase) => clause.includes(phrase));
		for (const matcher of GARMENT_MATCHERS) {
			if (!matcher.regex.test(clause)) continue;
			if (!garments.includes(matcher.word)) garments.push(matcher.word);
			if (strips && !removed.includes(matcher.word)) removed.push(matcher.word);
		}
	}

	return {
		place: tightenPlace(place),
		wardrobe: garments.filter((word) => !removed.includes(word)),
		cast: tightenCast(cast),
		removed
	};
}

/**
 * Drop a place that another matched place already contains.
 *
 * `changing room` and `room` are one place; listing both wastes the writer's attention and reads like two
 * locations. The longer phrase wins because it is the specific one.
 */
function tightenPlace(place: string[]): string[] {
	const kept = place.filter(
		(word) =>
			!place.some((other) => other !== word && other.length > word.length && other.includes(word))
	);
	return kept.slice(0, 4);
}

/**
 * Say who is in frame once.
 *
 * A caption yields both `2men` and `men`, and a count tag makes the bare noun noise — "in frame: 1girl,
 * 2men, men, man, people" tells the writer less than "1girl, 2men". Job nouns (driver, shopkeeper) are
 * always kept: they are the ones a picture can be wrong about.
 */
function tightenCast(cast: string[]): string[] {
	const counts = cast.filter((word) => /^\d/.test(word));
	const jobs = cast.filter((word) =>
		/^(driver|shopkeeper|vendor|clerk|worker|guard|customer|passenger|bystander|onlooker|spectator)$/.test(
			word
		)
	);
	const groups = cast.filter((word) => /^(crowd|people|group|couple)$/.test(word));
	const bare = cast.filter((word) => /^(man|woman|men|women)$/.test(word));

	// A count tag already implies the bare noun; a group word is only interesting when no count exists.
	const parts = [...counts, ...jobs];
	if (!counts.length) parts.push(...groups, ...bare);
	return [...new Set(parts)].slice(0, 6);
}

/**
 * Fold a new prompt's state into what was established.
 *
 * - place: the newest one wins. A prompt that mentions no place is a close-up, not a teleport.
 * - wardrobe: the newest prompt's outfit, falling back to the previous one when it names none. A removed
 *   garment can never come back (that is exactly the sundress bug).
 * - cast: newest wins, so a beat with onlookers does not leave them in every later frame.
 */
export function mergeShotState(previous: ShotState | null | undefined, next: ShotState): ShotState {
	const before = previous ?? EMPTY_STATE;
	const removed = unique([...before.removed, ...next.removed]);
	const place = next.place.length ? next.place : before.place;
	const wardrobe = unique([...before.wardrobe, ...next.wardrobe]).filter(
		(tag) => !removed.includes(tag)
	);
	const cast = next.cast.length ? next.cast : before.cast;
	return { place, wardrobe, cast, removed };
}

/**
 * The block the writer reads, immediately before the reply.
 *
 * Short on purpose: it is a record, not instructions. The one instruction is the one that fixes the
 * observed failures — a garment that was taken off may not come back.
 */
export function renderShotState(state: ShotState | null | undefined): string {
	if (!state) return '';
	const lines: string[] = [];
	if (state.place.length) lines.push(`place: ${state.place.join(', ')}`);
	// Any garment the story kept from an earlier beat belongs here too: the writer needs the whole outfit,
	// not only what the last prompt happened to mention.
	if (state.wardrobe.length) lines.push(`worn: ${state.wardrobe.join(', ')}`);
	if (state.removed.length)
		lines.push(`taken off (never draw these again): ${state.removed.join(', ')}`);
	if (state.cast.length) lines.push(`in frame: ${state.cast.join(', ')}`);
	if (!lines.length) return '';
	return `SCENE STATE (established by the pictures already drawn — keep what is still true):\n${lines.join('\n')}`;
}
