/**
 * Any OpenAI-compatible chat endpoint: OpenAI itself, OpenRouter, and the long tail of
 * self-hosted proxies. Speaks exactly the OpenAI schema — no llama.cpp extensions.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetchJson, normalizeBaseUrl, type LlmBackend, type LlmCaps } from './types.js';
import type { BackendOptions } from './llamacpp.js';

export function createOpenAICompatBackend(options: BackendOptions): LlmBackend {
	const { provider } = options;
	const baseUrl = normalizeBaseUrl(provider.baseUrl);

	const client = createOpenAICompatible({
		name: provider.id,
		baseURL: baseUrl,
		// Some providers (OpenRouter, OpenAI) require a key; local proxies ignore it.
		apiKey: provider.apiKey || 'none',
		includeUsage: true,
		headers: provider.headers,
		...(options.fetch ? { fetch: options.fetch } : {})
	});

	const caps: LlmCaps = {
		llamacppSamplers: false,
		thinkingToggle: false,
		modelList: true,
		samplerDefaults: 'none',
		unload: false
	};

	return {
		provider,
		caps,
		chatModel: (modelId) => client.chatModel(modelId),

		async listModels(signal) {
			const data = (await fetchJson(
				`${baseUrl}/models`,
				{
					signal,
					headers: {
						...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
						...provider.headers
					}
				},
				options.timeoutMs ?? 8000
			)) as { data?: Array<{ id?: string }> };
			return (data.data ?? [])
				.map((model) => model.id)
				.filter((id): id is string => typeof id === 'string' && id.length > 0);
		},

		// OpenAI-compatible APIs expose no sampler defaults; the user's sliders are authoritative.
		async samplerDefaults() {
			return {};
		},

		async unload() {}
	};
}
