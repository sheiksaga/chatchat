import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Origin checking happens in `src/hooks.server.ts` instead of here.
		// Reason: adapter-node defaults the request protocol to `https` unless ORIGIN/PROTOCOL_HEADER
		// is set, so on a plain-http LAN address SvelteKit's own check compares against
		// `https://<host>` and rejects every form post. Our check compares Origin against the
		// request's own Host header, which works for loopback and LAN at the same time.
		// Deprecated in Kit 2.70 (`csrf.trustedOrigins` replaces it) but still the only way to *disable*
		// Kit's origin check, which adapter-node breaks on plain-http LAN: it reports the protocol as
		// https, so same-origin fetches look cross-origin. `hooks.server.ts` does the real check.
		csrf: { checkOrigin: false }
	}
};

export default config;
