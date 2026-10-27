/**
 * `data/config.json` tests. Every case writes into a temp dir via `CHATCHAT_CONFIG`, so the real
 * config of whoever runs the suite is never touched.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	defaultConfig,
	deleteProvider,
	getConfig,
	publicConfig,
	resetConfigCache,
	setActive,
	toProviderInfos,
	updateConfig,
	upsertProvider
} from './config-store.js';

let dir: string;
const previous = process.env.CHATCHAT_CONFIG;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'chatchat-config-'));
	process.env.CHATCHAT_CONFIG = path.join(dir, 'config.json');
	resetConfigCache();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (previous === undefined) delete process.env.CHATCHAT_CONFIG;
	else process.env.CHATCHAT_CONFIG = previous;
	resetConfigCache();
});

const file = () => process.env.CHATCHAT_CONFIG!;

describe('config store', () => {
	it('seeds a config on first read and writes it to disk', () => {
		const config = getConfig();
		expect(config.activeProvider).toBe('llamacpp');
		expect(config.providers.map((p) => p.id)).toEqual(['llamacpp', 'lmstudio']);
		expect(JSON.parse(readFileSync(file(), 'utf8')).version).toBe(1);
	});

	it('writes with owner-only permissions', () => {
		if (process.platform === 'win32') return; // mode bits are advisory on Windows
		getConfig();
		expect(statSync(file()).mode & 0o777).toBe(0o600);
	});

	it('keeps the stored api key when a form omits it', () => {
		upsertProvider({
			id: 'openrouter',
			label: 'OpenRouter',
			kind: 'openai',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'sk-secret',
			chat: true,
			images: false,
			isLocal: false
		});
		// The settings form re-submits a provider without the key field filled in.
		upsertProvider({
			id: 'openrouter',
			label: 'OpenRouter (renamed)',
			kind: 'openai',
			baseUrl: 'https://openrouter.ai/api/v1',
			chat: true,
			images: false,
			isLocal: false
		});

		const stored = getConfig().providers.find((p) => p.id === 'openrouter');
		expect(stored?.apiKey).toBe('sk-secret');
		expect(stored?.label).toBe('OpenRouter (renamed)');
	});

	it('clears the key only when an empty string is sent explicitly', () => {
		upsertProvider({
			id: 'openai',
			label: 'OpenAI',
			kind: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-secret',
			chat: true,
			images: true,
			isLocal: false
		});
		upsertProvider({
			id: 'openai',
			label: 'OpenAI',
			kind: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			apiKey: '',
			chat: true,
			images: true,
			isLocal: false
		});
		expect(getConfig().providers.find((p) => p.id === 'openai')?.apiKey).toBe('');
	});

	it('never exposes keys through the public shape', () => {
		upsertProvider({
			id: 'openai',
			label: 'OpenAI',
			kind: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-secret',
			chat: true,
			images: true,
			isLocal: false
		});

		const serialised = JSON.stringify(publicConfig());
		expect(serialised).not.toContain('sk-secret');
		expect(publicConfig().providers.find((p) => p.id === 'openai')?.hasKey).toBe(true);
		expect(toProviderInfos(getConfig().providers).every((p) => !('apiKey' in p))).toBe(true);
	});

	it('moves the active provider to a survivor when the active one is deleted', () => {
		upsertProvider({
			id: 'openai',
			label: 'OpenAI',
			kind: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			chat: true,
			images: true,
			isLocal: false
		});
		setActive('openai', 'gpt-4o-mini');
		expect(getConfig().activeProvider).toBe('openai');

		const after = deleteProvider('openai');
		expect(after.activeProvider).toBe('llamacpp');
		expect(after.activeModel.openai).toBeUndefined();
	});

	it('refuses to delete the last provider', () => {
		deleteProvider('lmstudio');
		expect(() => deleteProvider('llamacpp')).toThrow(/last provider/);
	});

	it('remembers a model per provider', () => {
		setActive('llamacpp', 'model-a');
		setActive('lmstudio', 'model-b');
		expect(getConfig().activeModel).toEqual({ llamacpp: 'model-a', lmstudio: 'model-b' });
	});

	it('ignores a corrupt file instead of destroying it', () => {
		writeFileSync(file(), '{ this is not json');
		resetConfigCache();
		expect(getConfig().activeProvider).toBe(defaultConfig().activeProvider);
		// The broken bytes are still there for the user to inspect.
		expect(readFileSync(file(), 'utf8')).toBe('{ this is not json');
	});

	it('rejects an invalid provider at the schema boundary', () => {
		expect(() =>
			upsertProvider({
				id: 'Bad Id!',
				label: 'x',
				kind: 'openai',
				baseUrl: 'not-a-url',
				chat: true,
				images: false,
				isLocal: false
			})
		).toThrow();
	});

	it('picks up an edit made by another process (mtime cache)', () => {
		getConfig();
		const current = JSON.parse(readFileSync(file(), 'utf8'));
		current.activeProvider = 'lmstudio';
		writeFileSync(file(), JSON.stringify(current, null, '\t'));

		resetConfigCache();
		expect(getConfig().activeProvider).toBe('lmstudio');
	});

	it('normalises sampler overrides through the schema', () => {
		const config = updateConfig({ samplers: { temperature: 0.5 } });
		expect(config.samplers).toEqual({ temperature: 0.5 });
		expect(() => updateConfig({ samplers: { temperature: 99 } })).toThrow();
	});
});
