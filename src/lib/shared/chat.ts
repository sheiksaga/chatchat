/**
 * Shared chat shapes (zod), used by server loads, server routes and components.
 *
 * Rule: a shape is declared here once. Everything that serialises or parses a chat imports it,
 * so `npm run check` finds every caller when a field changes.
 */
import { z } from 'zod';

export const roleSchema = z.enum(['system', 'user', 'assistant']);

/** Per-reply generation stats, shown under a message. All optional: an old row may have none. */
export const messageStatsSchema = z.object({
	model: z.string().optional(),
	provider: z.string().optional(),
	ms: z.number().optional(),
	promptTokens: z.number().optional(),
	completionTokens: z.number().optional(),
	/** The reader pressed Stop (or the connection dropped) before the reply finished. */
	aborted: z.boolean().optional()
});

export const messageSchema = z.object({
	id: z.string(),
	role: roleSchema,
	content: z.string(),
	createdAt: z.number(),
	/**
	 * Alternate replies for an assistant message, oldest first; `generations[0]` is the original.
	 * Empty for user/system messages.
	 */
	generations: z.array(z.string()).default([]),
	/** Generation stats for assistant replies; `null` for user/system messages and old rows. */
	stats: messageStatsSchema.nullable().default(null)
});

export const chatSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	updatedAt: z.number(),
	messageCount: z.number()
});

export const chatDetailSchema = chatSummarySchema.extend({
	messages: z.array(messageSchema),
	/** Parsed scene record, opaque to most of the UI (Phase 4 gives it a real schema). */
	story: z.unknown().nullable()
});

export type Role = z.infer<typeof roleSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type ChatDetail = z.infer<typeof chatDetailSchema>;
export type MessageStats = z.infer<typeof messageStatsSchema>;
