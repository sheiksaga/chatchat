/**
 * `data/config.json` — providers, keys and the active selection.
 *
 * Before the rewrite these were `localStorage` entries, which meant any page script (and any XSS)
 * could read a paid API key. Now the file lives on the server, is written with mode 0600, and only
 * the `hasKey` flag ever reaches the browser.
 *
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave an unparsable config.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DEFAULT_MODEL, LLAMACPP_URL } from '$lib/server/config.js';
import {
	appConfigSchema,
	providerSchema,
	type AppConfig,
	type Provider,
	type ProviderInfo,
	type ProviderInput
} from '$lib/shared/provider.js';

const FILE_MODE = 0o600;

/** Overridable so tests (and a future `--config` flag) do not touch the real file. */
export function configPath(): string {
	return process.env.CHATCHAT_CONFIG ?? path.join(DATA_DIR, 'config.json');
}

interface Cache {
	path: string;
	mtimeMs: number;
	size: number;
	config: AppConfig;
}

let cache: Cache | undefined;

/** First-run defaults: the two local servers, nothing that needs an account. */
export function defaultConfig(): AppConfig {
	const providers: Provider[] = [
		providerSchema.parse({
			id: 'llamacpp',
			label: 'llama.cpp (local)',
			kind: 'llamacpp',
			baseUrl: `${LLAMACPP_URL}/v1`,
			isLocal: true,
			routerIni: process.env.CHATCHAT_ROUTER_INI || undefined
		}),
		providerSchema.parse({
			id: 'lmstudio',
			label: 'LM Studio (local)',
			kind: 'lmstudio',
			baseUrl: 'http://127.0.0.1:1234/v1',
			isLocal: true
		})
	];
	return appConfigSchema.parse({
		version: 1,
		providers,
		activeProvider: 'llamacpp',
		activeModel: { llamacpp: DEFAULT_MODEL },
		samplers: {},
		userName: 'You',
		appearance: { contentWidth: 72, fontSize: 18 }
	});
}

function writeAtomic(file: string, config: AppConfig): void {
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(config, null, '\t')}\n`, { mode: FILE_MODE });
	// `writeFileSync`'s mode is subject to the umask; chmod is explicit and also fixes an existing
	// file that was created with looser permissions.
	try {
		chmodSync(tmp, FILE_MODE);
	} catch {
		// Windows: mode bits are mostly advisory. Not fatal.
	}
	renameSync(tmp, file);
}

/**
 * Read the config, seeding it on first run.
 *
 * A corrupt file is not fatal: the app falls back to defaults and *does not* overwrite the broken
 * file, so the user can inspect what they lost instead of it silently vanishing.
 */
export function getConfig(): AppConfig {
	const file = configPath();

	let stats: { mtimeMs: number; size: number } | undefined;
	try {
		const s = statSync(file);
		stats = { mtimeMs: s.mtimeMs, size: s.size };
	} catch {
		stats = undefined;
	}

	if (!stats) {
		const config = defaultConfig();
		writeAtomic(file, config);
		cache = { path: file, mtimeMs: 0, size: 0, config };
		return config;
	}

	if (
		cache &&
		cache.path === file &&
		cache.mtimeMs === stats.mtimeMs &&
		cache.size === stats.size
	) {
		return cache.config;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return defaultConfig();
	}

	const parsed = appConfigSchema.safeParse(raw);
	if (!parsed.success) {
		// Keep the file as-is; the next write would drop whatever we could not understand.
		return defaultConfig();
	}

	cache = { path: file, ...stats, config: parsed.data };
	return parsed.data;
}

export interface ConfigPatch {
	providers?: Provider[];
	activeProvider?: string;
	activeModel?: Record<string, string>;
	samplers?: AppConfig['samplers'];
	userName?: string;
	appearance?: Partial<AppConfig['appearance']>;
}

/** Merge a patch into the current config, normalise it, persist atomically, and return it. */
export function updateConfig(patch: ConfigPatch): AppConfig {
	const current = getConfig();
	const merged = appConfigSchema.parse({
		...current,
		...patch,
		// appearance merges field by field: the settings form sends only what the user moved.
		appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
		version: 1
	});

	// Never persist a selection that points at a provider which is not there.
	if (!merged.providers.some((p) => p.id === merged.activeProvider)) {
		const fallback = merged.providers[0];
		if (!fallback) throw new Error('config: refusing to save a config with no providers');
		merged.activeProvider = fallback.id;
	}

	writeAtomic(configPath(), merged);
	cache = undefined;
	return merged;
}

/**
 * Create or replace a provider.
 *
 * `apiKey: undefined` keeps the stored key, so the settings form can submit without ever holding
 * it; an explicit `''` clears it.
 */
export function upsertProvider(input: ProviderInput): AppConfig {
	const current = getConfig();
	const existing = current.providers.find((p) => p.id === input.id);
	const provider = providerSchema.parse({
		...existing,
		...input,
		apiKey: input.apiKey ?? existing?.apiKey ?? ''
	});

	const providers = existing
		? current.providers.map((p) => (p.id === provider.id ? provider : p))
		: [...current.providers, provider];

	return updateConfig({ providers });
}

export function deleteProvider(id: string): AppConfig {
	const current = getConfig();
	const providers = current.providers.filter((p) => p.id !== id);
	if (providers.length === 0) throw new Error('config: cannot delete the last provider');

	const activeModel = { ...current.activeModel };
	delete activeModel[id];
	return updateConfig({ providers, activeModel });
}

export function setActive(providerId: string, modelId?: string): AppConfig {
	const current = getConfig();
	const activeModel = { ...current.activeModel };
	if (modelId) activeModel[providerId] = modelId;
	return updateConfig({ activeProvider: providerId, activeModel });
}

/** Resolve a provider by id, defaulting to the active one. Throws for unknown ids. */
export function resolveProvider(id?: string): Provider {
	const config = getConfig();
	const wanted = id ?? config.activeProvider;
	const provider = config.providers.find((p) => p.id === wanted);
	if (!provider) throw new Error(`unknown provider: ${wanted}`);
	return provider;
}

/** Strip keys for the browser. Every route that returns providers must use this. */
export function toProviderInfos(providers: Provider[]): ProviderInfo[] {
	return providers.map(({ apiKey, ...rest }) => ({ ...rest, hasKey: apiKey.length > 0 }));
}

/** What `/api/settings` returns. */
export function publicConfig() {
	const config = getConfig();
	return {
		providers: toProviderInfos(config.providers),
		activeProvider: config.activeProvider,
		activeModel: config.activeModel,
		samplers: config.samplers,
		userName: config.userName,
		appearance: config.appearance
	};
}

/** Tests only: drop the mtime cache so the next read hits disk. */
export function resetConfigCache(): void {
	cache = undefined;
}
