/**
 * OpenAI-compatible and LM Studio adapters: auth headers, body shape, model list, unload.
 * Runs against `fake-server.ts` — no network, no keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { startFakeLlm, type FakeLlm } from './fake-server.js';
import { createOpenAICompatBackend } from './openai-compat.js';
import { createLmstudioBackend } from './lmstudio.js';
import { providerSchema } from '$lib/shared/provider.js';

let stub: FakeLlm;

beforeAll(async () => {
	stub = await startFakeLlm({ models: ['gpt-test', 'gpt-test-mini'] });
});

afterAll(async () => {
	await stub.close();
});

const provider = (overrides: Record<string, unknown> = {}) =>
	providerSchema.parse({
		id: 'remote',
		label: 'Remote',
		kind: 'openai',
		baseUrl: stub.url,
		apiKey: 'sk-test',
		isLocal: false,
		...overrides
	});

describe('openai-compatible adapter', () => {
	it('streams text and sends a bearer token', async () => {
		const backend = createOpenAICompatBackend({ provider: provider() });
		const result = streamText({
			model: backend.chatModel('gpt-test'),
			messages: [{ role: 'user', content: 'ping' }]
		});

		expect(await result.text).toContain('ping');
		const request = stub.requests.at(-1)!;
		expect(request.headers.authorization).toBe('Bearer sk-test');
	});

	it('lists models from /v1/models with auth', async () => {
		const backend = createOpenAICompatBackend({ provider: provider() });
		expect(await backend.listModels()).toEqual(['gpt-test', 'gpt-test-mini']);

		const listRequest = stub.requests.at(-1)!;
		expect(listRequest.path).toBe('/v1/models');
		expect(listRequest.headers.authorization).toBe('Bearer sk-test');
	});

	it('sends no llama.cpp-only fields', async () => {
		const backend = createOpenAICompatBackend({ provider: provider() });
		const messages = [
			{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
		] as unknown as UIMessage[];

		await streamText({
			model: backend.chatModel('gpt-test'),
			messages: await convertToModelMessages(messages),
			// Even if a caller passes them, the adapter's capability flags tell the route not to.
			providerOptions: { remote: { temperature: 0.3 } }
		}).text;

		const body = stub.lastBody()!;
		expect(body.temperature).toBe(0.3);
		expect(body).not.toHaveProperty('top_k');
		expect(body).not.toHaveProperty('min_p');
		expect(body).not.toHaveProperty('chat_template_kwargs');
	});

	it('declares that it has no sampler defaults and cannot unload', () => {
		const backend = createOpenAICompatBackend({ provider: provider() });
		expect(backend.caps).toMatchObject({
			llamacppSamplers: false,
			thinkingToggle: false,
			samplerDefaults: 'none',
			unload: false
		});
	});

	it('sends extra headers from the provider config', async () => {
		const backend = createOpenAICompatBackend({
			provider: provider({ headers: { 'x-title': 'chatchat' } })
		});
		await backend.listModels();
		expect(stub.requests.at(-1)!.headers['x-title']).toBe('chatchat');
	});
});

describe('lmstudio adapter', () => {
	it('can unload, and a failing unload never throws', async () => {
		const backend = createLmstudioBackend({
			provider: provider({ kind: 'lmstudio', isLocal: true })
		});
		expect(backend.caps.unload).toBe(true);
		// The stub has no /models/unload route; that must be swallowed, not surfaced.
		await expect(backend.unload('gpt-test')).resolves.toBeUndefined();
	});
});
