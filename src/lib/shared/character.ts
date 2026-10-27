/**
 * Character cards (SillyTavern `chara_card_v1` / `v2` / `v3`) in one normalised shape.
 *
 * The three specs differ in nesting, not in meaning: v1 is flat, v2/v3 wrap the same fields in
 * `data`, and v3 adds lorebooks (`character_book`). `cards/parse.ts` flattens whatever it is given
 * into this shape, so the rest of the app never branches on the spec version.
 *
 * `{{char}}` / `{{user}}` placeholders are kept verbatim — substituting them happens at prompt
 * assembly time (`prompts/rp.ts`), never on the stored card.
 */
import { z } from 'zod';

export const lorebookEntrySchema = z.object({
	/** Primary trigger words. Case-insensitive comparison happens at match time. */
	keys: z.array(z.string()).default([]),
	/** v3 `secondary_keys`: when non-empty, an entry needs one of these too (selective). */
	secondaryKeys: z.array(z.string()).default([]),
	content: z.string().default(''),
	enabled: z.boolean().default(true),
	/** Lower insertion order = earlier in the prompt. Cards ship arbitrary numbers. */
	insertionOrder: z.number().default(100),
	/** Always injected, regardless of keywords (`constant` in the ST UI). */
	constant: z.boolean().default(false),
	selective: z.boolean().default(false),
	name: z.string().default(''),
	caseSensitive: z.boolean().default(false),
	/** Token budget hint; unused for now, kept so a re-export does not lose data. */
	priority: z.number().nullable().default(null)
});

export const characterBookSchema = z.object({
	name: z.string().default(''),
	entries: z.array(lorebookEntrySchema).default([]),
	/** How many entries may be injected per request (0 = unlimited). */
	tokenBudget: z.number().default(0),
	scanDepth: z.number().nullable().default(null)
});

export const characterSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	/** `chara_card_v1` | `chara_card_v2` | `chara_card_v3`, or `unknown` for hand-written cards. */
	spec: z.string().default('unknown'),
	description: z.string().default(''),
	personality: z.string().default(''),
	scenario: z.string().default(''),
	firstMessage: z.string().default(''),
	/** `mes_example`: few-shot dialogue, `{{user}}:` / `{{char}}:` prefixed. */
	exampleMessages: z.string().default(''),
	systemPrompt: z.string().default(''),
	postHistoryInstructions: z.string().default(''),
	alternateGreetings: z.array(z.string()).default([]),
	tags: z.array(z.string()).default([]),
	creator: z.string().default(''),
	characterVersion: z.string().default(''),
	creatorNotes: z.string().default(''),
	/** Not part of any spec: this repo's cards carry an appearance block for image prompts. */
	appearance: z.string().default(''),
	book: characterBookSchema.nullable().default(null),
	/** File name inside `data/cards/`, served by `/api/characters/[id]/avatar`. */
	avatar: z.string().nullable().default(null)
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterBook = z.infer<typeof characterBookSchema>;
export type LorebookEntry = z.infer<typeof lorebookEntrySchema>;

/**
 * Fields a user may edit. Everything is optional so `PATCH` can carry one field; `upsertCharacter`
 * re-validates against the full schema, which is where required values are enforced.
 */
export const characterInputSchema = characterSchema
	.omit({ id: true, spec: true, avatar: true })
	.partial();

export type CharacterInput = z.infer<typeof characterInputSchema>;
