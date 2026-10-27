/**
 * The seam between "a chat request" and "a server that can generate text".
 *
 * Everything provider-specific lives behind this interface, so `/api/chat` never learns which
 * backend it is talking to and a new provider means a new file in this folder — nothing else.
 */
import type { LanguageModel } from 'ai';
import type { Samplers } from '$lib/shared/chat-request.js';
import type { Provider } from '$lib/shared/provider.js';

/** What a provider can actually do. The UI reads these to hide controls it must not offer. */
export interface LlmCaps {
	/** Accepts `top_k` / `min_p` / `repeat_penalty` (llama.cpp extensions to the OpenAI schema). */
	llamacppSamplers: boolean;
	/** `chat_template_kwargs` is understood, i.e. thinking can be suppressed per request. */
	thinkingToggle: boolean;
	/** `GET {baseUrl}/models` lists models. */
	modelList: boolean;
	/** Where per-model sampler defaults come from. */
	samplerDefaults: 'ini' | 'props' | 'none';
	/** Can free VRAM on demand (`/models/unload`). */
	unload: boolean;
}

export interface LlmBackend {
	readonly provider: Provider;
	readonly caps: LlmCaps;
	/** Model ids as the server spells them; used directly as the `model` field. */
	listModels(signal?: AbortSignal): Promise<string[]>;
	chatModel(modelId: string): LanguageModel;
	/** Per-model defaults that the request body should not clobber. `{}` when unknown. */
	samplerDefaults(modelId: string): Promise<Partial<Samplers>>;
	/** Best-effort VRAM release; no-op for providers without a lifecycle. */
	unload(modelId: string): Promise<void>;
}

/** Trim trailing slashes so `${base}/models` never becomes `${base}//models`. */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/** `GET` with a timeout: a dead backend must not hang a page render. */
export async function fetchJson(
	url: string,
	init: RequestInit = {},
	timeoutMs = 8000
): Promise<unknown> {
	const signal = AbortSignal.any(
		[init.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean) as AbortSignal[]
	);
	const response = await fetch(url, { ...init, signal });
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText} from ${url}`);
	}
	return await response.json();
}
