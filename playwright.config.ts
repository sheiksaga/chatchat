/**
 * Playwright config: browser-level tests against the real app, with the stub LLM.
 *
 * No GPU, no network, no keys: the app is started with its own throwaway data directory
 * (`.e2e-data/`) and a provider pointed at `tools/fake-llm.ts`. `global-setup.ts` writes that config.
 */
import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 4174;
const STUB_PORT = 8899;
const DATA_DIR = '.e2e-data';

export default defineConfig({
	testDir: './e2e',
	// Each test writes chats to the same database, and they are fast; serial keeps failures readable.
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: process.env.CI ? 'line' : [['list']],
	timeout: 30_000,
	expect: { timeout: 10_000 },

	use: {
		baseURL: `http://127.0.0.1:${APP_PORT}`,
		trace: 'retain-on-failure'
	},

	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
		// The point of this app is a phone on the same LAN, so one project must *be* a phone.
		{ name: 'mobile', use: { ...devices['Pixel 7'] } }
	],

	globalSetup: './e2e/global-setup.ts',

	webServer: [
		{
			// A stub OpenAI-compatible model: deterministic text, no GPU, ~10 ms per token so
			// streaming is observable.
			command: 'npx tsx tools/fake-llm.ts',
			env: { PORT: String(STUB_PORT), CHATCHAT_FAKE_DELAY_MS: '10' },
			url: `http://127.0.0.1:${STUB_PORT}/v1/models`,
			reuseExistingServer: !process.env.CI,
			stdout: 'ignore',
			stderr: 'pipe'
		},
		{
			command: 'npm run build && node build',
			env: {
				PORT: String(APP_PORT),
				HOST: '127.0.0.1',
				CHATCHAT_DATA_DIR: DATA_DIR,
				CHATCHAT_CONFIG: `${DATA_DIR}/config.json`,
				// No ComfyUI in the e2e stack: point at a dead port so /image fails fast instead of
				// queueing real GPU work on the developer's machine.
				CHATCHAT_COMFYUI_URL: 'http://127.0.0.1:1',
				BODY_SIZE_LIMIT: '32M'
			},
			url: `http://127.0.0.1:${APP_PORT}/`,
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
			stdout: 'ignore',
			stderr: 'pipe'
		}
	]
});
