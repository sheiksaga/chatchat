/**
 * The wire shape between the browser and `POST /api/chat`.
 *
 * This is the only definition of the request. If it needs to change, change it here —
 * `npm run check` will then point at every caller on both sides.
 */
import { z } from 'zod';

export const samplersSchema = z.object({
	temperature: z.number().min(0).max(5).optional(),
	top_p: z.number().min(0).max(1).optional(),
	top_k: z.number().int().min(0).max(1000).optional(),
	min_p: z.number().min(0).max(1).optional(),
	repeat_penalty: z.number().min(0).max(4).optional(),
	seed: z.number().int().optional()
});

/**
 * A UI message as produced by `@ai-sdk/svelte`'s `Chat`. Kept permissive on purpose:
 * the SDK owns this shape and adds part kinds over time; we only require the fields
 * we actually read on the server.
 */
export const uiMessageSchema = z.object({
	id: z.string(),
	role: z.enum(['system', 'user', 'assistant']),
	parts: z.array(z.record(z.string(), z.unknown()))
});

export const chatRequestSchema = z.object({
	messages: z.array(uiMessageSchema).min(1),
	model: z.string().min(1),
	/** Provider id; omitted means "whichever provider is active on the server". */
	provider: z.string().min(1).optional(),
	/** When set, the server persists the user turn and the assistant reply to this chat. */
	chatId: z.string().min(1).optional(),
	/**
	 * Regenerate instead of append: the id of the assistant message being replaced. Its previous
	 * text is kept in `generations`, so the UI can cycle back to it.
	 */
	regenerateMessageId: z.string().min(1).optional(),
	samplers: samplersSchema.optional()
});

export type Samplers = z.infer<typeof samplersSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
