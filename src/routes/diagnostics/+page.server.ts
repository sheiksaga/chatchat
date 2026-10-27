/**
 * `/diagnostics` — the same probes as `npm run doctor`, in the browser, so a phone can answer
 * "why is nothing working" without a terminal. Read-only: it never rewrites config or data.
 */
import { db } from '$lib/server/db/index.js';
import { schemaVersion } from '$lib/server/db/index.js';
import { getConfig } from '$lib/server/config-store.js';
import { backendFor } from '$lib/server/backends/registry.js';
import { comfyHealth } from '$lib/server/comfy/client.js';
import { CHATS_DIR, DATA_DIR, COMFYUI_URL } from '$lib/server/config.js';
import fs from 'node:fs';
import path from 'node:path';

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
		// One folder per chat: transcript, story and pictures together, so `ls` answers "where is it".
		const folders = fs
			.readdirSync(CHATS_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory());
		let pictures = 0;
		for (const folder of folders) {
			try {
				pictures += fs.readdirSync(path.join(CHATS_DIR, folder.name, 'images')).length;
			} catch {
				// chat without pictures
			}
		}
		checks.push({
			name: 'chat folders',
			ok: true,
			detail: `${folders.length} chats · ${pictures} pictures · ${CHATS_DIR}`
		});
	} catch {
		checks.push({ name: 'chat folders', ok: true, detail: `not created yet · ${CHATS_DIR}` });
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
