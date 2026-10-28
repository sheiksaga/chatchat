/**
 * The image-model registry, checked without a GPU.
 *
 * The invariant that keeps the picker honest: every graph in `GRAPHS` must be fillable from its own
 * defaults. A graph added without a default for one of its placeholders fails here, in `npm run verify`,
 * instead of failing at generation time on the GPU.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '$lib/shared/image.js';
import {
	DEFAULT_WORKFLOW,
	GRAPHS,
	T2I_WORKFLOWS,
	fillGraph,
	isT2iWorkflow,
	loadGraph
} from './workflows.js';

/**
 * The placeholders a caller supplies at run time rather than the defaults: what to draw, and (for the
 * inpaint graph) the two uploaded files. Every other placeholder must come from the defaults.
 */
const RUNTIME_VALUES = {
	PROMPT: 'a lighthouse, painterly',
	INSTRUCTION: 'a red boat',
	INIT_IMAGE: 'uploaded-source.png',
	MASK_IMAGE: 'uploaded-mask.png'
};

describe('registered graphs', () => {
	for (const [id, definition] of Object.entries(GRAPHS)) {
		it(`${id} fills completely from its defaults`, async () => {
			const filled = fillGraph(await loadGraph(definition.file), {
				...RUNTIME_VALUES,
				...definition.defaults
			});
			const serialised = JSON.stringify(filled);

			expect(serialised).not.toContain('{{');
			// The model file must survive into the payload, otherwise ComfyUI loads nothing.
			expect(serialised).toContain(String(definition.defaults.MODEL));
		});
	}

	it('offers a graph per text-to-image checkpoint plus the inpaint graph', () => {
		expect(T2I_WORKFLOWS).toEqual([
			'krea2-t2i',
			'anima-turbo-t2i',
			'flux2-klein-t2i',
			'anima-fp16-t2i',
			'krea2-anime-t2i',
			'anima-base-t2i',
			'z-image-turbo-t2i',
			'z-image-mystic-t2i'
		]);
		expect(GRAPHS['anima-inpaint'].kind).toBe('inpaint');
		expect(isT2iWorkflow('anima-inpaint')).toBe(false);
		expect(isT2iWorkflow('not-a-graph')).toBe(false);
		expect(T2I_WORKFLOWS).toContain(DEFAULT_WORKFLOW);
	});

	/**
	 * Two recipes, and mixing them up ruins a picture: a distilled checkpoint wants CFG 1 (its
	 * unconditional branch is zeroed, so any CFG above 1 amplifies noise), an undistilled one wants a real
	 * CFG and a negative prompt. The graph file — not a variable — decides which one a model can do.
	 */
	it('keeps each model on the recipe its graph can express', () => {
		for (const id of T2I_WORKFLOWS) {
			const values = GRAPHS[id].defaults;
			const distilled = GRAPHS[id].file !== 't2i_cfg';

			if (distilled) {
				expect(Number(values.CFG), id).toBe(1);
				expect(Number(values.STEPS), id).toBeGreaterThanOrEqual(4);
				expect(Number(values.STEPS), id).toBeLessThanOrEqual(9);
				expect(values.NEGATIVE, id).toBeUndefined();
			} else {
				expect(Number(values.CFG), id).toBeGreaterThan(1);
				expect(Number(values.STEPS), id).toBeGreaterThanOrEqual(15);
				expect(String(values.NEGATIVE ?? ''), id).toMatch(/quality/);
			}
		}
	});

	it('agrees with the shared picker list, so the UI cannot offer a missing graph', () => {
		// Same ids, any display order: the picker's order is a UX choice, the registry's is not.
		expect([...T2I_WORKFLOWS].sort()).toEqual(IMAGE_MODELS.map((model) => model.id).sort());
		expect(DEFAULT_WORKFLOW).toBe(DEFAULT_IMAGE_MODEL);
		for (const model of IMAGE_MODELS) {
			expect(GRAPHS[model.id].label).toBeTruthy();
		}
	});

	it('names its output after the model, not after the graph it was copied from', () => {
		// ComfyUI's output folder is how a user tells two runs apart, so a hardcoded prefix is a real bug:
		// FLUX.2 shipped writing `ComfyInject_*.png` because the template it came from said so.
		for (const id of T2I_WORKFLOWS) {
			const template = JSON.parse(
				readFileSync(join('workflows', `${GRAPHS[id].file}.json`), 'utf8')
			) as Record<string, { inputs?: { filename_prefix?: string } }>;
			const prefixes = Object.values(template)
				.map((node) => node.inputs?.filename_prefix)
				.filter((value): value is string => typeof value === 'string');
			expect(prefixes, id).toEqual(['{{FILENAME_PREFIX}}']);
		}
	});

	it('picks a CLIP type each graph actually uses', () => {
		// These are the strings ComfyUI's CLIPLoader accepts; a typo here is a 400 from ComfyUI.
		// `qwen_image` is what Z-Image uses: ComfyUI routes by the encoder file's own text model, and only
		// flux/flux2 would send a Qwen3-4B encoder to the wrong tokenizer, so the label is a free choice.
		const allowed = new Set(['krea2', 'flux2', 'stable_diffusion', 'qwen_image', 'lumina2']);
		for (const [id, definition] of Object.entries(GRAPHS)) {
			expect(allowed.has(String(definition.defaults.CLIP_TYPE)), id).toBe(true);
		}
	});
});
