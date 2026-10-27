import { DEFAULT_MODEL } from '$lib/server/config.js';

/** The browser must not import `$lib/server/**`, so server facts arrive through `load`. */
export function load() {
	return { model: DEFAULT_MODEL };
}
