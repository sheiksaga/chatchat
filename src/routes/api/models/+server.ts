/**
 * `GET /api/models?provider=<id>` — model ids for the model selector.
 *
 * A dead backend is a normal state (the user has not started llama.cpp yet), so this returns
 * `ok: false` with a readable message instead of a 5xx the UI would have to guess about.
 */
import { json } from '@sveltejs/kit';
import { getBackend } from '$lib/server/backends/registry.js';

export async function GET({ url }) {
	const providerId = url.searchParams.get('provider') ?? undefined;
	try {
		const backend = getBackend(providerId);
		const models = await backend.listModels();
		return json({
			ok: true,
			provider: backend.provider.id,
			models,
			caps: backend.caps
		});
	} catch (cause) {
		return json({
			ok: false,
			provider: providerId ?? null,
			models: [] as string[],
			error: cause instanceof Error ? cause.message : String(cause)
		});
	}
}
