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

/**
 * Anima Turbo T2I — the light anime model (2 GB int8). Same distilled recipe as the inpaint graph:
 * 8 steps, CFG 1, euler/simple, so the two share a CLIP (`qwen_3_06b_base`) and VAE.
 */
export const ANIMA_TURBO_DEFAULTS: GraphValues = {
	MODEL: 'anima-turbo-v1.1-int8convrot.safetensors',
	CLIP: 'qwen_3_06b_base.safetensors',
	CLIP_TYPE: 'stable_diffusion',
	VAE: 'qwen_image_vae.safetensors',
	SAMPLER: 'euler',
	SCHEDULER: 'simple',
	STEPS: 8,
	CFG: 1,
	WIDTH: 832,
	HEIGHT: 1216,
	SEED: 1,
	FILENAME_PREFIX: 'AnimaTurbo'
};

/**
 * FLUX.2 Klein 4B — guidance-distilled (4 steps, CFG 1). The CLIP is the 2.3 GB GGUF quant on purpose:
 * the full `qwen_3_4b` safetensors is 7.5 GB, which does not sit beside a resident LLM on an 8 GB card.
 */
export const FLUX2_KLEIN_DEFAULTS: GraphValues = {
	MODEL: 'flux-2-klein-4b-fp8.safetensors',
	CLIP: 'flux2-klein-4b-uncensored-q4_k_m.gguf',
	CLIP_TYPE: 'flux2',
	VAE: 'flux2-vae.safetensors',
	SAMPLER: 'euler',
	STEPS: 4,
	CFG: 1,
	WIDTH: 1024,
	HEIGHT: 1024,
	SEED: 1,
	FILENAME_PREFIX: 'Flux2Klein'
};

/**
 * The same anima turbo model in fp16 rather than int8-convrot. Identical recipe; the fp16 weights need
 * ~4 GB instead of ~2 GB but render cleaner fine detail (faces, hair strands).
 */
export const ANIMA_FP16_DEFAULTS: GraphValues = {
	...ANIMA_TURBO_DEFAULTS,
	MODEL: 'anima-turbo-v1.1.safetensors',
	FILENAME_PREFIX: 'AnimaFp16'
};

/** Krea2's anime fine-tune, int4-quantised (8 GB). Same distilled recipe as Krea2 Turbo. */
export const KREA2_ANIME_DEFAULTS: GraphValues = {
	...KREA2_DEFAULTS,
	MODEL: 'krea2Anime_v14_int4.safetensors',
	FILENAME_PREFIX: 'Krea2Anime'
};

/**
 * Anima **base** v1.0 — the undistilled model. It needs what distillation removes: many steps, a real
 * CFG weight and an actual negative prompt, which the turbo graphs cannot express (their unconditional
 * branch is zeroed). Hence `t2i_cfg.json`, the one graph with a `{{NEGATIVE}}` slot.
 */
export const ANIMA_BASE_DEFAULTS: GraphValues = {
	MODEL: 'anima-base-v1.0.safetensors',
	CLIP: 'qwen_3_06b_base.safetensors',
	CLIP_TYPE: 'stable_diffusion',
	VAE: 'qwen_image_vae.safetensors',
	SAMPLER: 'euler',
	SCHEDULER: 'simple',
	STEPS: 24,
	CFG: 4.5,
	NEGATIVE:
		'worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, watermark, text',
	WIDTH: 832,
	HEIGHT: 1216,
	SEED: 1,
	FILENAME_PREFIX: 'AnimaBase'
};

/**
 * Z-Image Turbo (6B, int8-convrot) — Tongyi's distilled model, 8 steps / CFG 1, decodes through the
 * Flux VAE (`ae.safetensors`), so its graph uses `EmptySD3LatentImage`.
 *
 * CLIP type is `qwen_image` for a non-obvious reason: ComfyUI keys the encoder off the *file's* text
 * model (Qwen3-4B → Z-Image tokenizer) and only `flux`/`flux2` would mis-route it, so any other label in
 * this CLIPLoader's enum behaves the same. `qwen_image` is simply the least misleading one on offer.
 */
export const Z_IMAGE_DEFAULTS: GraphValues = {
	MODEL: 'z_image_turbo_int8_convrot.safetensors',
	CLIP: 'qwen_3_4b.safetensors',
	CLIP_TYPE: 'qwen_image',
	VAE: 'ae.safetensors',
	SAMPLER: 'euler',
	SCHEDULER: 'simple',
	STEPS: 8,
	CFG: 1,
	WIDTH: 1024,
	HEIGHT: 1024,
	SEED: 1,
	FILENAME_PREFIX: 'ZImageTurbo'
};

/**
 * Z-Image Turbo + the Civitai LoRA that unlocks its explicit content
 * (`Mystic-XXX-ZIT-V7`, trained on ZImageTurbo, 0.2 GB, no trigger word).
 *
 * The author's own workflow runs `LoraLoader` at strength 1 / 1 on both the model and the clip, so the
 * style tags it learned also reach the text encoder. It sits after the UNET loader, exactly there.
 */
export const Z_IMAGE_LORA_DEFAULTS: GraphValues = {
	...Z_IMAGE_DEFAULTS,
	LORA: 'Mystic-XXX-ZIT-V7.safetensors',
	LORA_STRENGTH: 1,
	FILENAME_PREFIX: 'ZImageMystic'
};

export const GRAPHS = {
	'krea2-t2i': {
		file: 'krea2_turbo_t2i',
		label: 'Krea2 Turbo (T2I)',
		kind: 't2i',
		defaults: KREA2_DEFAULTS
	},
	'anima-turbo-t2i': {
		file: 'anima_turbo_t2i',
		label: 'Anima Turbo (anime T2I)',
		kind: 't2i',
		defaults: ANIMA_TURBO_DEFAULTS
	},
	'flux2-klein-t2i': {
		file: 'flux2_klein_t2i',
		label: 'FLUX.2 Klein (T2I)',
		kind: 't2i',
		defaults: FLUX2_KLEIN_DEFAULTS
	},
	'anima-fp16-t2i': {
		file: 'anima_turbo_t2i',
		label: 'Anima Turbo fp16 (anime)',
		kind: 't2i',
		defaults: ANIMA_FP16_DEFAULTS
	},
	'krea2-anime-t2i': {
		file: 'krea2_turbo_t2i',
		label: 'Krea2 Anime v14 (int4)',
		kind: 't2i',
		defaults: KREA2_ANIME_DEFAULTS
	},
	'anima-base-t2i': {
		file: 't2i_cfg',
		label: 'Anima Base (quality, slow)',
		kind: 't2i',
		defaults: ANIMA_BASE_DEFAULTS
	},
	'z-image-turbo-t2i': {
		file: 'z_image_turbo_t2i',
		label: 'Z-Image Turbo',
		kind: 't2i',
		defaults: Z_IMAGE_DEFAULTS
	},
	'z-image-mystic-t2i': {
		file: 'z_image_turbo_lora_t2i',
		label: 'Z-Image Turbo + Mystic XXX',
		kind: 't2i',
		defaults: Z_IMAGE_LORA_DEFAULTS
	},
	'anima-inpaint': {
		file: 'anima_lllite_inpaint',
		label: 'Anima LLLite (inpaint)',
		kind: 'inpaint',
		defaults: ANIMA_INPAINT_DEFAULTS
	}
} as const satisfies Record<string, GraphDefinition>;

export type GraphId = keyof typeof GRAPHS;

/** The graphs that generate a picture from text alone — what the image picker offers. */
export const T2I_WORKFLOWS = (Object.keys(GRAPHS) as GraphId[]).filter(
	(id) => GRAPHS[id].kind === 't2i'
);

export const DEFAULT_WORKFLOW: GraphId = 'krea2-anime-t2i';

export function isT2iWorkflow(id: string): id is GraphId {
	return id in GRAPHS && GRAPHS[id as GraphId].kind === 't2i';
}
