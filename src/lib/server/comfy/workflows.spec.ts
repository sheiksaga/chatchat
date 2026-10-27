/**
 * The image-model registry, checked without a GPU.
 *
 * The invariant that keeps the picker honest: every graph in `GRAPHS` must be fillable from its own
 * defaults. A graph added without a default for one of its placeholders fails here, in `npm run verify`,
 * instead of failing at generation time on the GPU.
 */
import { describe, expect, it } from 'vitest';
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

	it('offers three text-to-image models plus the inpaint graph', () => {
		expect(T2I_WORKFLOWS).toEqual(['krea2-t2i', 'anima-turbo-t2i', 'flux2-klein-t2i']);
		expect(GRAPHS['anima-inpaint'].kind).toBe('inpaint');
		expect(isT2iWorkflow('anima-inpaint')).toBe(false);
		expect(isT2iWorkflow('not-a-graph')).toBe(false);
		expect(T2I_WORKFLOWS).toContain(DEFAULT_WORKFLOW);
	});

	it('keeps every t2i default at a distilled recipe: CFG 1, 4-8 steps', () => {
		for (const id of T2I_WORKFLOWS) {
			const values = GRAPHS[id].defaults;
			expect(Number(values.CFG), id).toBe(1);
			expect(Number(values.STEPS), id).toBeGreaterThanOrEqual(4);
			expect(Number(values.STEPS), id).toBeLessThanOrEqual(8);
		}
	});

	it('picks a CLIP type each graph actually uses', () => {
		// These are the strings ComfyUI's CLIPLoader accepts; a typo here is a 400 from ComfyUI.
		const allowed = new Set(['krea2', 'flux2', 'stable_diffusion']);
		for (const [id, definition] of Object.entries(GRAPHS)) {
			expect(allowed.has(String(definition.defaults.CLIP_TYPE)), id).toBe(true);
		}
	});
});
