import { getConfig, publicConfig } from '$lib/server/config-store.js';
import { PROVIDER_TEMPLATES } from '$lib/shared/provider.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => {
	const config = getConfig();
	return {
		settings: publicConfig(),
		templates: PROVIDER_TEMPLATES,
		// Only for display of the router preset path — never the key.
		routerIni: config.providers.find((p) => p.kind === 'llamacpp')?.routerIni ?? null
	};
};
