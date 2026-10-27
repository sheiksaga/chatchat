/**
 * llama.cpp adapter tests — no llama.cpp, no GPU, no network beyond 127.0.0.1.
 *
 * `fake-server.ts` speaks the real endpoints, so these tests pin what actually reaches the wire.
 * A future AI SDK upgrade that stops spreading `providerOptions` fails here instead of silently
 * dropping `min_p` / `top_k`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { startFakeLlm, type FakeLlm } from './fake-server.js';
import { createLlamacppBackend, samplersFromProps } from './llamacpp.js';
import { providerSchema } from '$lib/shared/provider.js';

let stub: FakeLlm;
let dir: string;
let iniPath: string;

const INI = `# a comment
[L3-8B-Stheno-v3.2-Q4_K_M-imat]
model = models\\L3-8B-Stheno-v3.2-Q4_K_M-imat.gguf
alias = stheno-8b
ctx-size = 8192
temp = 1.17
min-p = 0.075
top-k = 50
repeat-penalty = 1.1

[Ornith-1.5-9B-heretic.i1-Q4_K_M]
model = models\\Ornith-1.5-9B-heretic.i1-Q4_K_M.gguf
top-p = 0.95
min-p = 0.0
`;

beforeAll(async () => {
	stub = await startFakeLlm({ models: ['L3-8B-Stheno-v3.2-Q4_K_M-imat', 'gemma-4-e4b'] });
	dir = mkdtempSync(path.join(tmpdir(), 'chatchat-ini-'));
	iniPath = path.join(dir, 'models-router.ini');
	writeFileSync(iniPath, INI);
});

afterAll(async () => {
	await stub.close();
	rmSync(dir, { recursive: true, force: true });
});

function backend(routerIni?: string) {
	return createLlamacppBackend({
		provider: providerSchema.parse({
			id: 'llamacpp',
			label: 'llama.cpp',
			kind: 'llamacpp',
			baseUrl: stub.url,
			isLocal: true,
			routerIni
		})
	});
}

describe('llama.cpp request body', () => {
	it('sends sampler fields and chat_template_kwargs to /v1/chat/completions', async () => {
		const uiMessages = [
			{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }
		] as unknown as UIMessage[];

		const result = streamText({
			model: backend().chatModel('L3-8B-Stheno-v3.2-Q4_K_M-imat'),
			messages: await convertToModelMessages(uiMessages),
			stopSequences: ['<|end_of_turn|>'],
			providerOptions: {
				llamacpp: {
					temperature: 1.17,
					top_k: 50,
					min_p: 0.075,
					repeat_penalty: 1.1,
					chat_template_kwargs: { enable_thinking: false }
				}
			}
		});

		await result.text;

		const body = stub.lastBody() as Record<string, unknown>;
		expect(body.model).toBe('L3-8B-Stheno-v3.2-Q4_K_M-imat');
		expect(body.stream).toBe(true);
		expect(body).toMatchObject({
			temperature: 1.17,
			top_k: 50,
			min_p: 0.075,
			repeat_penalty: 1.1,
			chat_template_kwargs: { enable_thinking: false },
			stop: ['<|end_of_turn|>']
		});
		expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
	});

	it('streams the reply text', async () => {
		const result = streamText({
			model: backend().chatModel('gemma-4-e4b'),
			messages: [{ role: 'user', content: 'stream please' }]
		});
		expect(await result.text).toContain('stream please');
	});
});

describe('llama.cpp capabilities', () => {
	it('lists models from /v1/models', async () => {
		expect(await backend().listModels()).toEqual(['L3-8B-Stheno-v3.2-Q4_K_M-imat', 'gemma-4-e4b']);
	});

	it('reads per-model samplers from models-router.ini in router mode', async () => {
		const backendWithIni = backend(iniPath);
		expect(backendWithIni.caps.samplerDefaults).toBe('ini');
		expect(await backendWithIni.samplerDefaults('L3-8B-Stheno-v3.2-Q4_K_M-imat')).toEqual({
			temperature: 1.17,
			top_k: 50,
			min_p: 0.075,
			repeat_penalty: 1.1
		});
		// The alias spelling must resolve to the same section.
		expect(await backendWithIni.samplerDefaults('stheno-8b')).toMatchObject({ temperature: 1.17 });
		// `min-p = 0.0` is a real value, not "absent".
		expect(await backendWithIni.samplerDefaults('Ornith-1.5-9B-heretic.i1-Q4_K_M')).toEqual({
			top_p: 0.95,
			min_p: 0
		});
		// Unknown model: no overrides rather than a wrong guess.
		expect(await backendWithIni.samplerDefaults('not-in-the-ini')).toEqual({});
	});

	it('falls back to /props when no ini is configured', async () => {
		const noIni = backend();
		expect(noIni.caps.samplerDefaults).toBe('props');
		expect(await noIni.samplerDefaults('anything')).toEqual({
			temperature: 0.71,
			top_p: 0.94,
			top_k: 41,
			min_p: 0.06,
			repeat_penalty: 1.07
		});
	});

	it('survives a missing ini file', async () => {
		const broken = backend(path.join(dir, 'nope.ini'));
		expect(await broken.samplerDefaults('anything')).toMatchObject({ temperature: 0.71 });
	});

	it('reports no load lifecycle (a request *is* the load)', () => {
		expect(backend().caps.unload).toBe(false);
	});
});

describe('samplersFromProps', () => {
	it('handles the flat older shape', () => {
		expect(
			samplersFromProps({ default_generation_settings: { temperature: 0.9, top_k: 40.6 } })
		).toEqual({ temperature: 0.9, top_k: 41 });
	});

	it('returns {} for a router, which has no model settings', () => {
		expect(
			samplersFromProps({
				role: 'router',
				model_path: 'none',
				default_generation_settings: { params: null }
			})
		).toEqual({});
		expect(samplersFromProps(null)).toEqual({});
	});
});
