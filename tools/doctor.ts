#!/usr/bin/env node
/**
 * `npm run doctor` — the fastest way to answer "why is nothing working?".
 *
 * Probes the parts the app actually uses *through the app's own code* (config store, backends), so a
 * passing doctor means the configured providers work, not just that some default URL is up. No GPU
 * work: `/v1/models`, `/props` and ComfyUI's `/system_stats` are cheap.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COMFYUI_URL, DATA_DIR, WORKFLOWS_DIR } from '../src/lib/server/config.js';
import { getConfig } from '../src/lib/server/config-store.js';
import { backendFor } from '../src/lib/server/backends/registry.js';
import { readRouterIni, samplersForModel } from '../src/lib/server/backends/llm/ini.js';
import { comfyHealth } from '../src/lib/server/comfy/client.js';

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
	checks.push({ name, ok, detail });
}

/** Every configured provider, probed concurrently with a short timeout. */
async function probeProviders() {
	const config = getConfig();
	const results = await Promise.all(
		config.providers.map(async (provider) => {
			const started = Date.now();
			try {
				const models = await backendFor(provider).listModels(AbortSignal.timeout(4000));
				const active = provider.id === config.activeProvider;
				const chosen = config.activeModel[provider.id];
				const missing = chosen && !models.includes(chosen);
				return {
					name: `provider ${provider.id}`,
					ok: !missing,
					detail: missing
						? `${provider.baseUrl} — ${models.length} models, but selected model "${chosen}" is missing`
						: `${provider.baseUrl} — ${models.length} models${active ? ' (active)' : ''}${
								chosen ? `, using ${chosen}` : ''
							} [${Date.now() - started} ms]`
				};
			} catch (error) {
				// The inactive providers are frequently down (LM Studio not started); only the active
				// one failing is worth a non-zero exit.
				return {
					name: `provider ${provider.id}`,
					ok: provider.id !== config.activeProvider,
					detail: `${provider.baseUrl} unreachable: ${(error as Error).message}${
						provider.id === config.activeProvider ? ' (active provider)' : ''
					}`
				};
			}
		})
	);
	for (const result of results) record(result.name, result.ok, result.detail);
}

function probeRouterIni() {
	const provider = getConfig().providers.find((p) => p.kind === 'llamacpp');
	if (!provider) return;
	if (!provider.routerIni) {
		record(
			'models-router.ini',
			true,
			'not configured — set it on the provider (settings page) or CHATCHAT_ROUTER_INI so per-model samplers apply'
		);
		return;
	}

	const ini = readRouterIni(provider.routerIni);
	if (!ini) {
		record('models-router.ini', false, `unreadable: ${provider.routerIni}`);
		return;
	}

	const chosen = getConfig().activeModel[provider.id];
	const samplers = samplersForModel(ini, chosen);
	const keys = Object.keys(samplers);
	record(
		'models-router.ini',
		keys.length > 0 || !chosen,
		`${ini.sections.length} sections — ${chosen || 'no model'} ${
			keys.length ? `→ ${JSON.stringify(samplers)}` : '(no sampler section matched)'
		}`
	);
}

async function probeComfy() {
	try {
		const health = await comfyHealth();
		record('ComfyUI', true, `${COMFYUI_URL}, v${health.version} on ${health.device}`);
	} catch {
		record('ComfyUI', true, `${COMFYUI_URL} unreachable (only needed for image generation)`);
	}
}

function probeFiles() {
	record('workflows dir', existsSync(WORKFLOWS_DIR), WORKFLOWS_DIR);
	record('data dir', existsSync(DATA_DIR), DATA_DIR);

	const dbFile = path.join(DATA_DIR, 'chatchat.db');
	if (!existsSync(dbFile)) {
		record('database', false, 'not created yet (run the app or `npm run import:legacy`)');
		return;
	}
	try {
		const db = new DatabaseSync(dbFile);
		const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
			.user_version;
		const chats = db.prepare('SELECT COUNT(*) AS n FROM chats').get() as { n: number };
		const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
		db.close();
		record('database', true, `schema v${version}, ${chats.n} chats, ${messages.n} messages`);
	} catch (error) {
		record('database', false, `unreadable: ${(error as Error).message}`);
	}
}

function probeLan() {
	const token = process.env.CHATCHAT_TOKEN;
	record(
		'LAN auth',
		true,
		token ? 'CHATCHAT_TOKEN set — non-loopback requests need it' : 'no token — loopback only'
	);
}

await probeProviders();
probeRouterIni();
await probeComfy();
probeFiles();
probeLan();

const width = Math.max(...checks.map((c) => c.name.length));
for (const check of checks) {
	console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name.padEnd(width)}  ${check.detail}`);
}

const failures = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) process.exitCode = 1;
