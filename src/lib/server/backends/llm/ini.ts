/**
 * `models-router.ini` parsing.
 *
 * Why this file exists: in router mode (`llama-server --models-dir … --models-preset …`)
 * `GET /props` describes the **router**, not a model:
 *
 *   { "role": "router", "model_path": "none", "default_generation_settings": { "params": null } }
 *
 * and `?model=<id>` is ignored. The only authoritative, always-available source of per-model
 * sampler defaults is the preset file itself, which is what this module reads.
 *
 * Key names in that file are llama.cpp CLI names (`temp`, `top-p`, `repeat-penalty`), not OpenAI
 * ones (`temperature`, `top_p`, `repeat_penalty`), so the mapping is explicit below.
 */
import { readFileSync } from 'node:fs';
import type { Samplers } from '$lib/shared/chat-request.js';

export interface IniSection {
	name: string;
	values: Record<string, string>;
	/** 1-based line number of the section header, for error messages. */
	line: number;
}

/**
 * Minimal INI reader: `[section]`, `key = value`, `#`/`;` comments, blank lines.
 * Deliberately not a general INI library — llama.cpp presets use nothing else, and a dependency
 * here would be one more thing that can disagree with the server.
 */
export function parseIni(text: string): IniSection[] {
	const sections: IniSection[] = [];
	let current: IniSection | undefined;

	text.split(/\r?\n/).forEach((raw, index) => {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith(';')) return;

		const header = /^\[(.+)\]$/.exec(line);
		if (header) {
			current = { name: header[1].trim(), values: {}, line: index + 1 };
			sections.push(current);
			return;
		}

		const eq = line.indexOf('=');
		if (eq === -1 || !current) return; // keys outside a section are not part of a preset
		const key = line.slice(0, eq).trim().toLowerCase();
		const value = line.slice(eq + 1).trim();
		if (!key) return;
		current.values[key] = value;
	});

	return sections;
}

/** llama.cpp CLI key → sampler field. Anything absent stays `undefined` (server default wins). */
const SAMPLER_KEYS: Record<string, keyof Samplers> = {
	temp: 'temperature',
	temperature: 'temperature',
	'top-p': 'top_p',
	top_p: 'top_p',
	'top-k': 'top_k',
	top_k: 'top_k',
	'min-p': 'min_p',
	min_p: 'min_p',
	'repeat-penalty': 'repeat_penalty',
	repeat_penalty: 'repeat_penalty',
	seed: 'seed'
};

/** Map an INI section's sampler keys. Unparsable numbers are skipped rather than thrown on. */
export function samplersFromSection(section: IniSection | undefined): Partial<Samplers> {
	const out: Partial<Samplers> = {};
	if (!section) return out;

	for (const [key, field] of Object.entries(SAMPLER_KEYS)) {
		const raw = section.values[key];
		if (raw === undefined || raw === '') continue;
		// `min-p = 0.0` and `temp = 1.17` are the only shapes seen in practice.
		const value = Number(raw);
		if (!Number.isFinite(value)) continue;
		out[field] = field === 'seed' || field === 'top_k' ? Math.round(value) : value;
	}
	return out;
}

/** Last path segment without a `.gguf`/`.safetensors` suffix — how a `model = …` value looks. */
function fileStem(value: string): string {
	return value
		.split(/[\\/]/)
		.pop()!
		.replace(/\.(gguf|safetensors|bin)$/i, '');
}

/**
 * Find the section describing `modelId`.
 *
 * Three spellings mean the same model, and all three are used in the wild: the section name, the
 * `alias =` value, and the `model =` file stem. The router names models by section, so name
 * matching is exact-first and case-insensitive after that.
 */
export function findSection(sections: IniSection[], modelId: string): IniSection | undefined {
	const wanted = modelId.trim().toLowerCase();
	if (!wanted) return undefined;

	const exact = sections.find((s) => s.name.toLowerCase() === wanted);
	if (exact) return exact;

	const byAlias = sections.find((s) => (s.values.alias ?? '').toLowerCase() === wanted);
	if (byAlias) return byAlias;

	return sections.find((s) => s.values.model && fileStem(s.values.model).toLowerCase() === wanted);
}

export interface RouterIni {
	path: string;
	sections: IniSection[];
}

/**
 * Read and parse a preset file. Never throws: a missing or unreadable file is a configuration
 * problem, and the app must still start (the chat route then simply sends no sampler overrides).
 */
export function readRouterIni(path: string): RouterIni | null {
	try {
		return { path, sections: parseIni(readFileSync(path, 'utf8')) };
	} catch {
		return null;
	}
}

/** Sampler defaults for one model, or `{}` when the file or section is missing. */
export function samplersForModel(ini: RouterIni | null, modelId: string): Partial<Samplers> {
	if (!ini) return {};
	return samplersFromSection(findSection(ini.sections, modelId));
}
