#!/usr/bin/env node
/**
 * `npm run dev:fake` — run a stub OpenAI-compatible LLM so the app can be used and tested with no
 * GPU and no model download.
 *
 * Point a provider at the printed URL (settings page → new provider → kind "openai"), then chat
 * normally: streaming, persistence and the UI all exercise the real code path.
 */
import { startFakeLlm } from '../src/lib/server/backends/llm/fake-server.js';

const port = Number(process.env.PORT ?? 8899);
// A delay makes streaming observable (and the Stop button testable) on a fast stub.
const chunkDelayMs = Number(process.env.CHATCHAT_FAKE_DELAY_MS ?? 0);
const stub = await startFakeLlm({ port, chunkDelayMs });

console.log(`stub LLM listening on ${stub.url}`);
console.log(
	`models: fake-instruct-8b, fake-coder-3b${chunkDelayMs ? `, ${chunkDelayMs} ms per chunk` : ''}`
);
console.log('Add it in chatchat → Settings → "+" with kind "openai-compatible" and that base URL.');
console.log('Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		void stub.close().then(() => process.exit(0));
	});
}
