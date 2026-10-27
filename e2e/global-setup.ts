/**
 * Writes the throwaway config the tests run against.
 *
 * Plain JSON, no app imports: Playwright's loader does not resolve the `$lib` alias, and this file
 * only needs to produce what `config-store.ts` would produce on first run — with the stub provider
 * active instead of llama.cpp.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = '.e2e-data';
const STUB = 'http://127.0.0.1:8899/v1';

export default function globalSetup() {
	const dir = path.join(process.cwd(), DATA_DIR);
	mkdirSync(dir, { recursive: true });

	const config = {
		version: 1,
		providers: [
			{
				id: 'stub',
				label: 'Stub LLM',
				kind: 'openai',
				baseUrl: STUB,
				apiKey: '',
				headers: {},
				chat: true,
				images: false,
				isLocal: true
			}
		],
		activeProvider: 'stub',
		activeModel: { stub: 'fake-instruct-8b' },
		samplers: {},
		userName: 'Sam'
	};

	writeFileSync(path.join(dir, 'config.json'), `${JSON.stringify(config, null, '\t')}\n`);
}
