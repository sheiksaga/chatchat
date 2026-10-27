/**
 * Card parsing: any card-shaped input → `Character`.
 *
 * Three inputs exist in practice:
 *  - a PNG/JPEG with base64 JSON in a `chara` (v2) or `ccv3` (v3) tEXt chunk — what SillyTavern exports;
 *  - a `.json` card (v1 flat, or v2/v3 `{spec, data}`);
 *  - this repo's old `cards/cards.js` manifest, which is the same JSON with a `window.` assignment.
 *
 * `@lenml/char-card-reader` owns the image metadata reading (PNG + JPEG EXIF, both spec keywords,
 * v1/v2/v3 discrimination). This module only normalises its output, so the mapping is auditable in
 * one place and a library upgrade cannot silently change what the app stores.
 */
import { CharacterCard } from '@lenml/char-card-reader';
import {
	characterBookSchema,
	characterSchema,
	type Character,
	type LorebookEntry
} from '$lib/shared/character.js';

/** Deterministic id so re-importing the same card updates it instead of duplicating it. */
export function cardId(name: string, description: string): string {
	// FNV-1a over name+description: the same inputs the old app hashed, so ids stay comparable.
	const input = `${name}\u0000${description}`;
	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `card_${hash.toString(36)}`;
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function strArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

interface RawBookEntry {
	keys?: unknown;
	secondary_keys?: unknown;
	secondaryKeys?: unknown;
	content?: unknown;
	enabled?: unknown;
	constant?: unknown;
	selective?: unknown;
	insertion_order?: unknown;
	insertionOrder?: unknown;
	name?: unknown;
	case_sensitive?: unknown;
	priority?: unknown;
}

function normalizeEntry(raw: RawBookEntry): LorebookEntry {
	const insertion = raw.insertion_order ?? raw.insertionOrder;
	return {
		keys: strArray(raw.keys),
		secondaryKeys: strArray(raw.secondary_keys ?? raw.secondaryKeys),
		content: str(raw.content),
		enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
		insertionOrder: typeof insertion === 'number' ? insertion : 100,
		constant: Boolean(raw.constant),
		selective: Boolean(raw.selective),
		name: str(raw.name),
		caseSensitive: Boolean(raw.case_sensitive),
		priority: typeof raw.priority === 'number' ? raw.priority : null
	};
}

/**
 * v3 wraps entries in `{entries: {…}}` (an object keyed by index) while this repo's old manifest
 * stores a bare array. Both are accepted; anything else becomes `null` rather than an empty book,
 * because "no book" and "empty book" mean different things in the UI.
 */
export function normalizeBook(raw: unknown): Character['book'] {
	if (!raw) return null;

	let entries: RawBookEntry[] | undefined;
	let name = '';
	let tokenBudget = 0;
	let scanDepth: number | null = null;

	if (Array.isArray(raw)) {
		entries = raw as RawBookEntry[];
	} else if (typeof raw === 'object') {
		const book = raw as {
			name?: unknown;
			entries?: unknown;
			token_budget?: unknown;
			extensions?: { scan_depth?: unknown };
		};
		name = str(book.name);
		tokenBudget = typeof book.token_budget === 'number' ? book.token_budget : 0;
		const depth = book.extensions?.scan_depth;
		scanDepth = typeof depth === 'number' ? depth : null;

		if (Array.isArray(book.entries)) entries = book.entries as RawBookEntry[];
		else if (book.entries && typeof book.entries === 'object') {
			entries = Object.values(book.entries as Record<string, RawBookEntry>);
		}
	}

	if (!entries) return null;
	return characterBookSchema.parse({
		name,
		tokenBudget,
		scanDepth,
		entries: entries.map(normalizeEntry).filter((entry) => entry.content.trim().length > 0)
	});
}

/**
 * Normalise raw card JSON (already decoded) into a `Character`.
 *
 * Handles v1 (flat), v2/v3 (`{spec, spec_version, data}`) and this repo's flattened manifest
 * (camelCase, `firstMes`/`mesExample`), because all three exist in the wild today.
 */
export function normalizeCardJson(raw: unknown): Character {
	const root = (raw ?? {}) as Record<string, unknown>;
	const nested = (root.data ?? {}) as Record<string, unknown>;
	// v1 keeps everything at the root; v2/v3 keep it under `data`.
	const data = Object.keys(nested).length > 0 ? nested : root;

	const name = str(data.name || root.name).trim();
	if (!name) throw new Error('card has no name');
	const description = str(data.description ?? root.description);

	const spec =
		str(root.spec) || (Object.keys(nested).length > 0 ? 'chara_card_v2' : 'chara_card_v1');

	return characterSchema.parse({
		id: cardId(name, description),
		name,
		spec,
		description,
		personality: str(data.personality),
		scenario: str(data.scenario),
		firstMessage: str(data.first_mes ?? root.firstMes ?? root.first_mes),
		exampleMessages: str(data.mes_example ?? root.mesExample ?? root.mes_example),
		systemPrompt: str(data.system_prompt ?? root.systemPrompt ?? root.system_prompt),
		postHistoryInstructions: str(
			data.post_history_instructions ??
				root.postHistoryInstructions ??
				root.post_history_instructions
		),
		alternateGreetings: strArray(data.alternate_greetings ?? root.alternateGreetings),
		tags: strArray(data.tags ?? root.tags),
		creator: str(data.creator ?? root.creator),
		characterVersion: str(data.character_version ?? root.characterVersion),
		creatorNotes: str(data.creator_notes ?? root.creatorNotes),
		appearance: str(data.appearance ?? root.appearance),
		book: normalizeBook(data.character_book ?? root.characterBook),
		// A hint only: cards exported by SillyTavern carry no path, this repo's old manifest does
		// (`cards/avatars/x.png`). The importer resolves it and stores the copied file name.
		avatar: str(root.avatar) || null
	});
}

/**
 * Parse card bytes. PNG/JPEG metadata is read by the library; a JSON payload is accepted as well,
 * which is what "import a card file" means for hand-edited cards.
 */
export async function parseCardFile(bytes: Uint8Array): Promise<Character> {
	// JSON first: a `.json` card is common, and `CharacterCard.from_file` would throw on it.
	const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart();
	if (head.startsWith('{')) {
		return normalizeCardJson(JSON.parse(new TextDecoder().decode(bytes)));
	}

	const card = await CharacterCard.from_file(bytes);
	// `toSpecV3()` renders every spec into one shape, so the mapping above stays single-path.
	return normalizeCardJson(card.toSpecV3());
}

/** Parse a SillyTavern `CharacterCard` object (used by tests and the v3 export path). */
export function parseCharacterCard(card: CharacterCard): Character {
	return normalizeCardJson(card.toSpecV3());
}

/**
 * Parse this repo's `cards/cards.js` manifest: the same JSON with a `window.CHATCHAT_CARDS =`
 * assignment around it, kept as a script so the old app could open from `file://`.
 */
export function parseCardsManifest(source: string): Character[] {
	const withoutComment = source.replace(/^\s*\/\*[\s\S]*?\*\//, '');
	const json = withoutComment
		.replace(/^\s*window\.[A-Z_]+\s*=\s*/, '')
		.trim()
		.replace(/;\s*$/, '');
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) throw new Error('manifest is not an array');
	return parsed.map((entry) => normalizeCardJson(entry));
}
