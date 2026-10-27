/**
 * Roleplay prompt assembly.
 *
 * Pure functions, no I/O, no database: given a card, a chat history and settings, produce the
 * message list and the sampler overrides. Everything here is unit-tested (`rp.spec.ts`), which is
 * the point — this is where a chat stops feeling like the character and starts feeling like a
 * chatbot, and it is impossible to eyeball that from the UI.
 *
 * Ported from `legacy/js/rp.js`, with the same ordering, because ordering is the whole design:
 *
 *   1. system  — card system prompt, then character block, then scenario/example dialogue
 *   2. lorebook — entries whose keys appear in the recent history (or are marked constant)
 *   3. history — as many recent messages as the context budget allows
 *   4. post-history instructions — always last, so the model reads them immediately before replying
 */
import type { Character, LorebookEntry } from '$lib/shared/character.js';

export interface PromptMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface PromptSettings {
	/** Name substituted for `{{user}}`. */
	userName: string;
	/** Name substituted for `{{char}}`; defaults to the card name. */
	charName?: string;
	/** Extra system text the user typed (the "system prompt" box), appended after the card's. */
	extraSystem?: string;
	/** Messages kept regardless of budget. */
	minHistory?: number;
	/** Rough context allowance for history, in tokens. */
	contextTokens?: number;
	/** How far back the lorebook looks for keywords, in messages. */
	scanDepth?: number;
	/** Hard cap on injected lorebook entries (0 = no cap). */
	maxLoreEntries?: number;
}

const DEFAULTS = {
	minHistory: 6,
	contextTokens: 4096,
	scanDepth: 6,
	maxLoreEntries: 8
} as const;

/** ~4 characters per token is the usual English approximation; good enough for budgeting. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Replace `{{char}}`, `{{user}}` and the `<BOT>` / `<USER>` spellings some cards use.
 * `{{original}}` is left alone on purpose: it is rare enough that silently guessing is worse.
 */
export function substitute(text: string, userName: string, charName: string): string {
	return text
		.replace(/\{\{char\}\}/gi, charName)
		.replace(/\{\{user\}\}/gi, userName)
		.replace(/<BOT>/g, charName)
		.replace(/<USER>/g, userName);
}

/**
 * Assemble the character block: description, personality, scenario.
 *
 * Kept as flat labelled paragraphs rather than prose, because models follow labelled sections far
 * more reliably than a run-on paragraph, and cards are written expecting this layout.
 */
export function characterBlock(card: Character, userName: string, charName = card.name): string {
	const part = (label: string, value: string) =>
		value.trim() ? `${label}: ${substitute(value.trim(), userName, charName)}` : '';

	return [
		part('Name', charName),
		part('Description', card.description),
		part('Personality', card.personality),
		part('Scenario', card.scenario),
		part('Appearance', card.appearance)
	]
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Which lorebook entries fire for this history.
 *
 * Matching is deliberately simple and predictable: a keyword matches when it appears as a substring
 * of the scanned text (case-insensitively unless the entry asks otherwise). That is what SillyTavern
 * does, and users tune their keyword lists against that behaviour — a cleverer matcher would
 * silently change which lore appears.
 */
export function selectLoreEntries(
	card: Character,
	history: PromptMessage[],
	settings: PromptSettings = { userName: 'You' }
): LorebookEntry[] {
	const entries = card.book?.entries ?? [];
	if (entries.length === 0) return [];

	const scanDepth = settings.scanDepth ?? card.book?.scanDepth ?? DEFAULTS.scanDepth;
	const max = settings.maxLoreEntries ?? DEFAULTS.maxLoreEntries;
	const scanned = history
		.slice(-scanDepth)
		.filter((message) => message.role !== 'system')
		.map((message) => message.content)
		.join('\n');

	const matched = entries.filter((entry) => {
		if (!entry.enabled) return false;
		if (entry.constant) return true;
		if (entry.keys.length === 0) return false;

		const haystack = entry.caseSensitive ? scanned : scanned.toLowerCase();
		const has = (needle: string) =>
			haystack.includes(entry.caseSensitive ? needle : needle.toLowerCase());

		if (!entry.keys.some(has)) return false;
		// `selective` entries need a primary *and* a secondary key.
		if (entry.selective && entry.secondaryKeys.length > 0) {
			return entry.secondaryKeys.some(has);
		}
		return true;
	});

	// Insertion order is the card author's intent for priority; a stable sort keeps ties in file order.
	const sorted = [...matched].sort((a, b) => a.insertionOrder - b.insertionOrder);
	return max > 0 ? sorted.slice(0, max) : sorted;
}

export interface AssembledPrompt {
	messages: PromptMessage[];
	/** Entries that fired, for the UI to show *why* the model said something. */
	lore: LorebookEntry[];
	/** Messages dropped from the front to fit the budget. */
	droppedHistory: number;
	estimatedTokens: number;
}

/**
 * Build the final message list.
 *
 * `history` is expected oldest-first and must already exclude any message that is being edited or
 * regenerated. The newest message is always kept even if it alone exceeds the budget: dropping the
 * question the user just asked would produce a reply to something else.
 */
export function assemblePrompt(
	card: Character | null,
	history: PromptMessage[],
	settings: PromptSettings
): AssembledPrompt {
	const userName = settings.userName || 'You';
	const charName = settings.charName || card?.name || 'Assistant';
	const contextTokens = settings.contextTokens ?? DEFAULTS.contextTokens;

	const lore = card ? selectLoreEntries(card, history, settings) : [];
	const loreText = lore.length
		? `Lore:\n${lore
				.map((entry) => substitute(entry.content.trim(), userName, charName))
				.filter(Boolean)
				.join('\n\n')}`
		: '';

	const systemParts: string[] = [];
	if (card?.systemPrompt.trim()) {
		systemParts.push(substitute(card.systemPrompt.trim(), userName, charName));
	}
	if (settings.extraSystem?.trim()) {
		systemParts.push(substitute(settings.extraSystem.trim(), userName, charName));
	}
	if (card) {
		systemParts.push(characterBlock(card, userName, charName));
		if (card.exampleMessages.trim()) {
			systemParts.push(
				`Example dialogue:\n${substitute(card.exampleMessages.trim(), userName, charName)}`
			);
		}
	}
	if (loreText) systemParts.push(loreText);

	const system: PromptMessage[] = systemParts.length
		? [{ role: 'system', content: systemParts.join('\n\n') }]
		: [];

	const postHistory = card?.postHistoryInstructions.trim()
		? substitute(card.postHistoryInstructions.trim(), userName, charName)
		: '';

	// Budget: system + post-history are mandatory; history gets what is left, newest first.
	const mandatory =
		estimateTokens(system.map((m) => m.content).join('\n')) + estimateTokens(postHistory) + 16; // headroom for the reply itself
	const available = Math.max(contextTokens - mandatory, 0);

	const kept: PromptMessage[] = [];
	let used = 0;
	let dropped = 0;
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const message = history[index];
		const cost = estimateTokens(message.content);
		const isNewest = index === history.length - 1;
		const mustKeep = history.length - kept.length <= (settings.minHistory ?? DEFAULTS.minHistory);
		if (!isNewest && !mustKeep && used + cost > available) {
			dropped = index + 1;
			break;
		}
		kept.unshift(message);
		used += cost;
	}

	const messages: PromptMessage[] = [...system, ...kept];
	if (postHistory) messages.push({ role: 'system', content: postHistory });

	return {
		messages,
		lore,
		droppedHistory: dropped,
		estimatedTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
	};
}

/**
 * Pick a greeting for a fresh chat: the card's first message, or one of the alternates.
 * `index = -1` (or out of range) means the first message, which is what a new chat expects.
 */
export function greetingFor(card: Character, userName: string, index = -1): string {
	const alternates = card.alternateGreetings;
	const text = index >= 0 && index < alternates.length ? alternates[index] : card.firstMessage;
	return substitute(text.trim(), userName, card.name);
}
