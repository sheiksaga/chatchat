/**
 * `/diagnostics` — the same probes as `npm run doctor`, in the browser, so a phone can answer
 * "why is nothing working" without a terminal. Read-only: it never rewrites config or data.
 */
import { db } from '$lib/server/db/index.js';
import { schemaVersion } from '$lib/server/db/index.js';
import { getConfig } from '$lib/server/config-store.js';
import { backendFor } from '$lib/server/backends/registry.js';
import { comfyHealth } from '$lib/server/comfy/client.js';
import { DATA_DIR, COMFYUI_URL, IMAGES_DIR } from '$lib/server/config.js';
import fs from 'node:fs';

export interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

export async function load() {
	const checks: Check[] = [];

	try {
		checks.push({
			name: 'database',
			ok: true,
			detail: `schema v${schemaVersion(db())} · ${DATA_DIR}`
		});
	} catch (cause) {
		checks.push({ name: 'database', ok: false, detail: message(cause) });
	}

	const config = getConfig();
	for (const provider of config.providers) {
		const started = Date.now();
		try {
			const models = await backendFor(provider).listModels();
			checks.push({
				name: `provider: ${provider.label}`,
				ok: true,
				detail: `${models.length} model${models.length === 1 ? '' : 's'} · ${provider.baseUrl} · ${
					Date.now() - started
				} ms`
			});
		} catch (cause) {
			checks.push({
				name: `provider: ${provider.label}`,
				ok: false,
				detail: `${message(cause)} · ${provider.baseUrl}`
			});
		}
	}

	try {
		const comfy = await comfyHealth();
		checks.push({
			name: 'ComfyUI',
			ok: true,
			detail: `${comfy.version} · ${comfy.device} · ${COMFYUI_URL}`
		});
	} catch (cause) {
		checks.push({ name: 'ComfyUI', ok: false, detail: `${message(cause)} · ${COMFYUI_URL}` });
	}

	try {
		const files = fs.readdirSync(IMAGES_DIR).length;
		checks.push({ name: 'image folder', ok: true, detail: `${files} files · ${IMAGES_DIR}` });
	} catch {
		checks.push({ name: 'image folder', ok: true, detail: `not created yet · ${IMAGES_DIR}` });
	}

	return {
		checks,
		activeProvider: config.activeProvider,
		model: config.activeModel[config.activeProvider] ?? ''
	};
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
