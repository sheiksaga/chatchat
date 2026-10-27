/**
 * Provider id → backend instance.
 *
 * One place answers "which backend generates this reply", so `/api/chat`, `/api/models` and the
 * health check cannot drift apart. Backends are cheap objects, but caching keeps a single
 * `createOpenAICompatible` client (and its keep-alive pool) per provider/config combination.
 */
import { createHash } from 'node:crypto';
import { getConfig, resolveProvider } from '$lib/server/config-store.js';
import type { Provider } from '$lib/shared/provider.js';
import { createLlamacppBackend } from './llm/llamacpp.js';
import { createLmstudioBackend } from './llm/lmstudio.js';
import { createOpenAICompatBackend } from './llm/openai-compat.js';
import type { LlmBackend } from './llm/types.js';

const cache = new Map<string, LlmBackend>();

/** The key includes the secret, hashed: editing a key must produce a new client. */
function cacheKey(provider: Provider): string {
	const fingerprint = createHash('sha256')
		.update(
			JSON.stringify([
				provider.id,
				provider.kind,
				provider.baseUrl,
				provider.apiKey,
				provider.headers,
				provider.routerIni ?? ''
			])
		)
		.digest('hex')
		.slice(0, 16);
	return `${provider.id}:${fingerprint}`;
}

export function backendFor(provider: Provider): LlmBackend {
	const key = cacheKey(provider);
	const hit = cache.get(key);
	if (hit) return hit;

	const backend =
		provider.kind === 'llamacpp'
			? createLlamacppBackend({ provider })
			: provider.kind === 'lmstudio'
				? createLmstudioBackend({ provider })
				: createOpenAICompatBackend({ provider });

	cache.set(key, backend);
	return backend;
}

/** Backend for a provider id, or for the active provider when id is omitted. */
export function getBackend(providerId?: string): LlmBackend {
	return backendFor(resolveProvider(providerId));
}

/** Model id to use when the request does not name one. */
export function activeModelFor(providerId?: string): string {
	const config = getConfig();
	const id = providerId ?? config.activeProvider;
	return config.activeModel[id] ?? '';
}

/** Tests only. */
export function resetBackends(): void {
	cache.clear();
}
