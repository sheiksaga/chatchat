/**
 * ComfyUI graph registry.
 *
 * The graphs in `workflows/*.json` are ComfyInject-style API-format JSON with `{{PLACEHOLDER}}`
 * slots. This module is the only place that knows how to fill them, so a graph can be edited
 * without touching TypeScript and a default can be changed without touching JSON.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WORKFLOWS_DIR } from '../config.js';

export type GraphInputValue = string | number | boolean;
export type GraphNode = { class_type: string; inputs: Record<string, unknown> };
export type Graph = Record<string, GraphNode>;

/** A value set large enough to fill any bundled graph. Extra keys are ignored per graph. */
export type GraphValues = Record<string, GraphInputValue>;

export interface GraphDefinition {
	/** File stem in `workflows/`, e.g. `krea2_turbo_t2i`. */
	file: string;
	/** Human label, used by the settings UI. */
	label: string;
	/** Which capability the graph provides. */
	kind: 't2i' | 'edit' | 'inpaint';
	defaults: GraphValues;
}

const cache = new Map<string, Graph>();

/** Read one graph from disk (cached; graphs are immutable at runtime). */
export async function loadGraph(file: string): Promise<Graph> {
	const cached = cache.get(file);
	if (cached) return cached;

	const raw = await readFile(path.join(WORKFLOWS_DIR, `${file}.json`), 'utf8');
	const graph = JSON.parse(raw) as Graph;
	cache.set(file, graph);
	return graph;
}

/** Template values that stay numbers when the whole input is one placeholder. */
const NUMERIC = new Set([
	'SEED',
	'STEPS',
	'CFG',
	'WIDTH',
	'HEIGHT',
	'LORA_STRENGTH',
	'UNLOCKED_LORA_STRENGTH'
]);

/**
 * Fill `{{PLACEHOLDER}}` slots in a graph. Returns a new graph; the cached template is untouched.
 * Unfilled placeholders throw, because ComfyUI would otherwise accept the literal `{{PROMPT}}`
 * and generate a picture of a placeholder — a silent failure that costs a GPU minute.
 */
export function fillGraph(template: Graph, values: GraphValues): Graph {
	const missing = new Set<string>();
	const fill = (input: unknown): unknown => {
		if (typeof input === 'string') {
			const whole = /^\{\{([A-Z0-9_]+)\}\}$/.exec(input);
			if (whole) {
				const key = whole[1];
				if (!(key in values)) {
					missing.add(key);
					return input;
				}
				const value = values[key];
				return NUMERIC.has(key) ? Number(value) : value;
			}
			return input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
				if (!(key in values)) {
					missing.add(key);
					return match;
				}
				return String(values[key]);
			});
		}
		if (Array.isArray(input)) return input.map(fill);
		if (input && typeof input === 'object') {
			// Node inputs nest: `{ image: '{{INIT_IMAGE}}' }`, link tuples `["4", 0]`, etc.
			const out: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
				out[key] = fill(value);
			}
			return out;
		}
		return input;
	};

	const out: Graph = {};
	for (const [id, node] of Object.entries(template)) {
		out[id] = {
			class_type: node.class_type,
			inputs: fill(node.inputs) as Record<string, unknown>
		};
	}

	if (missing.size) {
		throw new Error(`Graph has unfilled placeholders: ${[...missing].join(', ')}`);
	}
	return out;
}

/**
 * Per-model defaults, ported from `legacy/js/imagemodels.js` (the curated table that the rewrite
 * replaces with ComfyUI's own `/object_info` + these defaults).
 */
export const KREA2_DEFAULTS: GraphValues = {
	MODEL: 'krea2_turbo_fp8_scaled.safetensors',
	CLIP: 'qwen3vl_4b_fp8_scaled.safetensors',
	CLIP_TYPE: 'krea2',
	VAE: 'qwen_image_vae.safetensors',
	LORA_NAME: 'fedor_bypass.safetensors',
	LORA_STRENGTH: 0,
	UNLOCKED_LORA_NAME: 'snofs_krea_v1_nostrip.safetensors',
	UNLOCKED_LORA_STRENGTH: 0,
	SAMPLER: 'euler',
	SCHEDULER: 'simple',
	STEPS: 8,
	CFG: 1,
	WIDTH: 1024,
	HEIGHT: 1024,
	SEED: 1,
	FILENAME_PREFIX: 'Krea2'
};

export const ANIMA_INPAINT_DEFAULTS: GraphValues = {
	MODEL: 'anima-turbo-v1.1-int8convrot.safetensors',
	CLIP: 'qwen_3_06b_base.safetensors',
	CLIP_TYPE: 'stable_diffusion',
	VAE: 'qwen_image_vae.safetensors',
	MODEL_PATCH: 'anima-lllite-inpainting-v2.safetensors',
	SAMPLER: 'euler',
	STEPS: 8,
	CFG: 1,
	SEED: 1
};

export const GRAPHS = {
	'krea2-t2i': {
		file: 'krea2_turbo_t2i',
		label: 'Krea2 Turbo (T2I)',
		kind: 't2i',
		defaults: KREA2_DEFAULTS
	},
	'anima-inpaint': {
		file: 'anima_lllite_inpaint',
		label: 'Anima LLLite (inpaint)',
		kind: 'inpaint',
		defaults: ANIMA_INPAINT_DEFAULTS
	}
} as const satisfies Record<string, GraphDefinition>;

export type GraphId = keyof typeof GRAPHS;
