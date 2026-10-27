/**
 * llama.cpp backend (single-model server *or* router with `--models-dir`).
 *
 * spike 0.2 findings that still hold:
 * - `/v1/chat/completions` only. llama.cpp's `/v1/responses` implementation is incomplete and the
 *   AI SDK's schemas reject its stream (ggml-org/llama.cpp#20607).
 * - Extra body fields (`top_k`, `min_p`, `repeat_penalty`, `chat_template_kwargs`) ride through
 *   `providerOptions.llamacpp`, which the openai-compatible provider spreads into the request body.
 * - Sampler defaults are **not** readable from `/props` in router mode (it describes the router:
 *   `role: "router"`, `params: null`, and `?model=` is ignored). They come from `models-router.ini`;
 *   `/props` is only the fallback for a plain single-model server.
 */
import { statSync } from 'node:fs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider } from '$lib/shared/provider.js';
import type { Samplers } from '$lib/shared/chat-request.js';
import { readRouterIni, samplersForModel, type RouterIni } from './ini.js';
import { fetchJson, normalizeBaseUrl, type LlmBackend, type LlmCaps } from './types.js';

export interface BackendOptions {
	provider: Provider;
	/** Override for tests. */
	fetch?: typeof globalThis.fetch;
	/** How long `listModels` may wait before giving up. */
	timeoutMs?: number;
}

/** Re-reading a 2 KB file per request is wasteful; keep it until mtime/size changes. */
const iniCache = new Map<string, { mtimeMs: number; size: number; ini: RouterIni }>();

function cachedIni(path: string): RouterIni | null {
	try {
		const stats = statSync(path);
		const hit = iniCache.get(path);
		if (hit && hit.mtimeMs === stats.mtimeMs && hit.size === stats.size) return hit.ini;
		const ini = readRouterIni(path);
		if (ini) iniCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, ini });
		return ini;
	} catch {
		return null;
	}
}

/** `default_generation_settings` shapes across llama.cpp versions (nested `params` or flat). */
export function samplersFromProps(props: unknown): Partial<Samplers> {
	const settings = (props as { default_generation_settings?: Record<string, unknown> })
		?.default_generation_settings;
	if (!settings) return {};
	const params = (
		settings.params && typeof settings.params === 'object' ? settings.params : settings
	) as Record<string, unknown>;
	const out: Partial<Samplers> = {};
	const pick = (key: string, field: keyof Samplers, round = false) => {
		const value = params[key];
		if (typeof value !== 'number' || !Number.isFinite(value)) return;
		out[field] = round ? Math.round(value) : value;
	};
	pick('temperature', 'temperature');
	pick('top_p', 'top_p');
	pick('top_k', 'top_k', true);
	pick('min_p', 'min_p');
	pick('repeat_penalty', 'repeat_penalty');
	pick('seed', 'seed', true);
	return out;
}

export function createLlamacppBackend(options: BackendOptions): LlmBackend {
	const { provider } = options;
	const baseUrl = normalizeBaseUrl(provider.baseUrl);
	// `/v1/models` lives under the versioned base; `/props` is served from the server root.
	const root = baseUrl.replace(/\/v1$/, '');
	const routerIni = provider.routerIni;

	const client = createOpenAICompatible({
		name: provider.id,
		baseURL: baseUrl,
		apiKey: provider.apiKey || 'local',
		includeUsage: true,
		headers: provider.headers,
		...(options.fetch ? { fetch: options.fetch } : {})
	});

	const caps: LlmCaps = {
		llamacppSamplers: true,
		thinkingToggle: true,
		modelList: true,
		samplerDefaults: routerIni ? 'ini' : 'props',
		unload: false
	};

	return {
		provider,
		caps,
		chatModel: (modelId) => client.chatModel(modelId),

		async listModels(signal) {
			const data = (await fetchJson(
				`${baseUrl}/models`,
				{ signal },
				options.timeoutMs ?? 8000
			)) as { data?: Array<{ id?: string }> };
			return (data.data ?? [])
				.map((model) => model.id)
				.filter((id): id is string => typeof id === 'string' && id.length > 0);
		},

		async samplerDefaults(modelId) {
			if (routerIni) {
				const ini = cachedIni(routerIni);
				// An unreadable preset is a misconfiguration, not an error: send no overrides and
				// let llama.cpp apply the server-side defaults.
				if (ini) return samplersForModel(ini, modelId);
			}
			try {
				return samplersFromProps(await fetchJson(`${root}/props`, {}, options.timeoutMs ?? 3000));
			} catch {
				return {};
			}
		},

		// llama.cpp has no load/unload endpoints; a request naming a model *is* the load.
		async unload() {}
	};
}
