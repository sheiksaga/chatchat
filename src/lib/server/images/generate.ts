/**
 * One image, start to finish: fill a graph, queue it, download the bytes, store both halves (file +
 * row), return what the UI needs.
 *
 * Kept out of the route so the same call can be made after a chat reply (image markers) and from tests,
 * so the route stays a thin translation of HTTP into this function.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { insertImage, type ImageRow } from '../db/images.js';
import { COMFYUI_URL } from '../config.js';
import { fetchImage, runGraph, uploadImage, type ComfyProgress } from '../comfy/client.js';
import { GRAPHS, EDIT_WORKFLOW, fillGraph, loadGraph, type GraphId } from '../comfy/workflows.js';
import { randomSeed } from '../../shared/image.js';
import { pngSize, sniffMime, writeImageFile } from './store.js';

export interface GenerateInput {
	prompt: string;
	chatId?: string | null;
	messageId?: string | null;
	workflow?: GraphId;
	width?: number;
	height?: number;
	steps?: number;
	seed?: number;
	/** ComfyUI base URL; tests point this at the fake. */
	comfyUrl?: string;
	onProgress?: (progress: ComfyProgress) => void;
}

export interface GenerateResult {
	image: ImageRow;
	elapsedMs: number;
	url: string;
}

export async function generateImage(input: GenerateInput): Promise<GenerateResult> {
	const workflowId = input.workflow ?? 'krea2-t2i';
	const definition = GRAPHS[workflowId];
	if (!definition || definition.kind !== 't2i') {
		throw new Error(`Not a text-to-image workflow: ${workflowId}`);
	}

	const seed = input.seed ?? randomSeed();
	const graph = fillGraph(await loadGraph(definition.file), {
		...definition.defaults,
		PROMPT: input.prompt,
		SEED: seed,
		...(input.width ? { WIDTH: snap(input.width) } : {}),
		...(input.height ? { HEIGHT: snap(input.height) } : {}),
		...(input.steps ? { STEPS: input.steps } : {})
	});

	const run = await runGraph(graph, {
		comfyUrl: input.comfyUrl,
		onProgress: input.onProgress,
		// A cold start has to load the model onto an 8 GB card beside the LLM.
		timeoutMs: 5 * 60 * 1000
	});
	const output = run.images[0];
	if (!output) throw new Error('ComfyUI finished but produced no image');

	const bytes = await fetchImage(output, input.comfyUrl ?? COMFYUI_URL);
	const image = persist({
		bytes,
		prompt: input.prompt,
		seed,
		workflow: workflowId,
		chatId: input.chatId,
		messageId: input.messageId,
		meta: { promptId: run.promptId, elapsedMs: run.elapsedMs, source: output.filename }
	});

	return { image, elapsedMs: run.elapsedMs, url: `/api/images/${image.id}` };
}

/** Inpaint: two uploaded files (source + mask) and the LLLite graph. */
export async function generateInpaint(input: {
	prompt: string;
	source: Buffer;
	mask: Buffer;
	chatId?: string | null;
	messageId?: string | null;
	steps?: number;
	seed?: number;
	comfyUrl?: string;
	onProgress?: (progress: ComfyProgress) => void;
}): Promise<GenerateResult> {
	const definition = GRAPHS['anima-inpaint'];
	const seed = input.seed ?? randomSeed();
	const url = input.comfyUrl ?? COMFYUI_URL;

	const initImage = await uploadImage(input.source, 'chatchat-source.png', { url });
	const maskImage = await uploadImage(input.mask, 'chatchat-mask.png', { url });

	const graph = fillGraph(await loadGraph(definition.file), {
		...definition.defaults,
		INSTRUCTION: input.prompt,
		INIT_IMAGE: initImage,
		MASK_IMAGE: maskImage,
		SEED: seed,
		...(input.steps ? { STEPS: input.steps } : {})
	});

	const run = await runGraph(graph, {
		comfyUrl: input.comfyUrl,
		onProgress: input.onProgress,
		timeoutMs: 5 * 60 * 1000
	});
	const output = run.images[0];
	if (!output) throw new Error('ComfyUI finished but produced no image');

	const bytes = await fetchImage(output, url);
	const image = persist({
		bytes,
		prompt: input.prompt,
		seed,
		workflow: 'anima-inpaint',
		chatId: input.chatId,
		messageId: input.messageId,
		meta: { promptId: run.promptId, elapsedMs: run.elapsedMs, inpaint: true }
	});

	return { image, elapsedMs: run.elapsedMs, url: `/api/images/${image.id}` };
}

/**
 * Instruction edit: "change this picture".
 *
 * The source bytes go up to ComfyUI as an input image and the instruction becomes the *only* text in the
 * graph, so the model edits what it was given instead of inventing a new scene. Dimensions come from the
 * source image when the caller does not pass them, because the empty latent has to match the encoded one.
 */
export async function generateEdit(input: {
	instruction: string;
	source: Buffer;
	/** Source image id, recorded so the row says which picture this came from. */
	sourceId?: string | null;
	width?: number;
	height?: number;
	chatId?: string | null;
	messageId?: string | null;
	steps?: number;
	seed?: number;
	comfyUrl?: string;
	onProgress?: (progress: ComfyProgress) => void;
}): Promise<GenerateResult> {
	const definition = GRAPHS[EDIT_WORKFLOW];
	const seed = input.seed ?? randomSeed();
	const url = input.comfyUrl ?? COMFYUI_URL;

	const source = pngSize(input.source);
	const width = snap(input.width ?? source?.width ?? 832);
	const height = snap(input.height ?? source?.height ?? 1216);

	const initImage = await uploadImage(input.source, 'chatchat-edit-source.png', { url });

	const graph = fillGraph(await loadGraph(definition.file), {
		...definition.defaults,
		INIT_IMAGE: initImage,
		INSTRUCTION: input.instruction,
		WIDTH: width,
		HEIGHT: height,
		SEED: seed,
		...(input.steps ? { STEPS: input.steps } : {})
	});

	const run = await runGraph(graph, {
		comfyUrl: input.comfyUrl,
		onProgress: input.onProgress,
		timeoutMs: 5 * 60 * 1000
	});
	const output = run.images[0];
	if (!output) throw new Error('ComfyUI finished but produced no image');

	const bytes = await fetchImage(output, url);
	const image = persist({
		bytes,
		prompt: input.instruction,
		seed,
		workflow: EDIT_WORKFLOW,
		chatId: input.chatId,
		messageId: input.messageId,
		meta: { promptId: run.promptId, elapsedMs: run.elapsedMs, edit: true, sourceId: input.sourceId }
	});

	return { image, elapsedMs: run.elapsedMs, url: `/api/images/${image.id}` };
}

function persist(input: {
	bytes: Buffer;
	prompt: string;
	seed: number;
	workflow: string;
	chatId?: string | null;
	messageId?: string | null;
	meta: unknown;
}): ImageRow {
	const id = randomUUID();
	const mime = sniffMime(input.bytes);
	const file = writeImageFile(id, input.bytes, mime, input.chatId);
	const size = pngSize(input.bytes);
	return insertImage(db(), {
		id,
		chatId: input.chatId ?? null,
		messageId: input.messageId ?? null,
		file,
		mime,
		width: size?.width,
		height: size?.height,
		prompt: input.prompt,
		seed: input.seed,
		workflow: input.workflow,
		meta: input.meta
	});
}

/** Dimensions must be multiples of 64 so the VAE sees a sane latent shape. */
function snap(value: number): number {
	return Math.min(2048, Math.max(256, Math.round(value / 64) * 64));
}
