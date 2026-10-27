/**
 * `POST /api/providers` — create or update a provider.
 *
 * `apiKey` absent keeps the stored key, `apiKey: ""` clears it. That is what lets the settings form
 * work without the browser ever holding a secret.
 */
import { error, json } from '@sveltejs/kit';
import { providerInputSchema } from '$lib/shared/provider.js';
import { publicConfig, upsertProvider } from '$lib/server/config-store.js';

export async function POST({ request }) {
	const parsed = providerInputSchema.safeParse(await request.json());
	if (!parsed.success) {
		error(
			400,
			`Invalid provider: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
		);
	}
	upsertProvider(parsed.data);
	return json(publicConfig());
}
