/** `DELETE /api/providers/<id>` — remove a provider (the last one cannot be removed). */
import { error, json } from '@sveltejs/kit';
import { deleteProvider, getConfig, publicConfig } from '$lib/server/config-store.js';

export function DELETE({ params }) {
	if (!getConfig().providers.some((p) => p.id === params.id)) error(404, 'Provider not found');
	try {
		deleteProvider(params.id);
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : String(cause));
	}
	return json(publicConfig());
}
