/**
 * LM Studio: OpenAI-compatible chat plus a model lifecycle (`/models/unload`), which is how this app
 * frees VRAM when the idle timer fires — the one thing llama.cpp cannot do.
 */
import { createOpenAICompatBackend } from './openai-compat.js';
import { normalizeBaseUrl, type LlmBackend } from './types.js';
import type { BackendOptions } from './llamacpp.js';

export function createLmstudioBackend(options: BackendOptions): LlmBackend {
	const base = createOpenAICompatBackend(options);
	const baseUrl = normalizeBaseUrl(options.provider.baseUrl);

	return {
		...base,
		caps: { ...base.caps, unload: true },

		async unload(modelId) {
			// Not fatal by design: unloading is an optimisation, and older LM Studio builds do not
			// expose the route at all. The idle timer must never throw into the UI.
			try {
				await fetch(`${baseUrl}/models/unload`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						...(options.provider.apiKey
							? { authorization: `Bearer ${options.provider.apiKey}` }
							: {}),
						...options.provider.headers
					},
					body: JSON.stringify({ model: modelId }),
					signal: AbortSignal.timeout(options.timeoutMs ?? 5000)
				});
			} catch {
				/* ignore */
			}
		}
	};
}
