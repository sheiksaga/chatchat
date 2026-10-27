/**
 * `GET /api/health` — one probe per provider, so the settings page can show availability without
 * hammering every backend from the browser.
 */
import { json } from '@sveltejs/kit';
import { getConfig } from '$lib/server/config-store.js';
import { backendFor } from '$lib/server/backends/registry.js';

export async function GET() {
	const config = getConfig();

	const checks = await Promise.all(
		config.providers.map(async (provider) => {
			const started = Date.now();
			try {
				const models = await backendFor(provider).listModels(AbortSignal.timeout(4000));
				return {
					id: provider.id,
					label: provider.label,
					ok: true,
					modelCount: models.length,
					models: models.slice(0, 40),
					ms: Date.now() - started
				};
			} catch (cause) {
				return {
					id: provider.id,
					label: provider.label,
					ok: false,
					modelCount: 0,
					models: [] as string[],
					ms: Date.now() - started,
					error: cause instanceof Error ? cause.message : String(cause)
				};
			}
		})
	);

	return json({ activeProvider: config.activeProvider, providers: checks });
}
