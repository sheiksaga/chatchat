/**
 * `GET  /api/settings` — providers (keys stripped) plus the active selection.
 * `POST /api/settings` — change the active provider/model or the global sampler overrides.
 */
import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { settingsPatchSchema } from '$lib/shared/provider.js';
import { publicConfig, updateConfig } from '$lib/server/config-store.js';

export function GET() {
	return json(publicConfig());
}

export async function POST({ request }) {
	const parsed = settingsPatchSchema.safeParse(await request.json());
	if (!parsed.success)
		error(400, `Invalid settings: ${parsed.error.issues[0]?.message ?? 'bad body'}`);
	updateConfig(parsed.data);
	return json(publicConfig());
}
