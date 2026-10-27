/**
 * `POST /api/unload { model, provider? }` — ask the backend to release VRAM.
 *
 * Only providers with an unload lifecycle (LM Studio) do anything; llama.cpp has no such endpoint,
 * where a request naming a model *is* the load. The client calls this on an idle timer, so it must
 * never fail loudly: an unreachable server just means the memory stays claimed.
 */
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBackend } from '$lib/server/backends/registry.js';

const bodySchema = z.object({
	model: z.string().min(1),
	provider: z.string().min(1).optional()
});

export async function POST({ request }) {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) return json({ ok: false, error: 'model is required' }, { status: 400 });

	try {
		const backend = getBackend(parsed.data.provider);
		if (!backend.caps.unload) {
			return json({ ok: false, reason: 'provider has no unload lifecycle' });
		}
		await backend.unload(parsed.data.model);
		return json({ ok: true });
	} catch (cause) {
		return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
	}
}
