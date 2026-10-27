/**
 * ComfyUI transport (server-side only).
 *
 * Why this library: `@stable-canvas/comfyui-client` is MIT, zero-dependency, and speaks the
 * plain HTTP+WS API that a self-hosted ComfyUI actually serves. The official `@comfyorg/sdk`
 * needs the Comfy API **v2**, which self-hosted ComfyUI only exposes through a Python proxy
 * (`comfy-api-proxy`) — an extra daemon we do not want in a double-click start.
 *
 * Images are fetched from `/view` directly instead of through the client so that the byte path
 * is obvious: one GET, one Buffer, written by the caller.
 */
import { Buffer } from 'node:buffer';
import { Client } from '@stable-canvas/comfyui-client';
import { COMFYUI_URL } from '../config.js';
import type { Graph } from './workflows.js';

export interface ComfyProgress {
	value: number;
	max: number;
	node?: string;
}

export interface ComfyImageRef {
	filename: string;
	subfolder: string;
	type: string;
}

export interface RunGraphOptions {
	onProgress?: (progress: ComfyProgress) => void;
	/** ComfyUI base URL; tests point this at `fake-comfy.ts`. */
	comfyUrl?: string;
	/** Hard cap for one generation. Model loads on an 8 GB card can take a minute. */
	timeoutMs?: number;
	/** How often to ask ComfyUI whether the job finished. */
	pollMs?: number;
}

export interface RunGraphResult {
	promptId: string;
	images: ComfyImageRef[];
	/** How long the generation actually took, from queue to output. */
	elapsedMs: number;
}

/** Build a client for the configured ComfyUI (or an explicit URL, for tests). */
export function createComfyClient(url: string = COMFYUI_URL) {
	const parsed = new URL(url);
	return new Client({
		api_host: `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? 443 : 80)}`,
		ssl: parsed.protocol === 'https:'
	});
}

/** Collect every `SaveImage`-style image reference out of a ComfyUI history entry. */
export function collectImages(outputs: Record<string, unknown>): ComfyImageRef[] {
	const refs: ComfyImageRef[] = [];
	for (const nodeOutput of Object.values(outputs)) {
		if (!nodeOutput || typeof nodeOutput !== 'object') continue;
		const images = (nodeOutput as { images?: unknown }).images;
		if (!Array.isArray(images)) continue;
		for (const image of images) {
			if (!image || typeof image !== 'object') continue;
			const { filename, subfolder, type } = image as Partial<ComfyImageRef>;
			if (typeof filename !== 'string') continue;
			refs.push({ filename, subfolder: subfolder ?? '', type: type ?? 'output' });
		}
	}
	return refs;
}

/**
 * Queue a graph and wait for it. Progress comes from ComfyUI's websocket `progress` messages,
 * which the client turns into callback invocations. Failures reject with the client's error type.
 */
export async function runGraph(
	graph: Graph,
	options: RunGraphOptions = {}
): Promise<RunGraphResult> {
	const { onProgress, comfyUrl, timeoutMs = 10 * 60 * 1000, pollMs = 500 } = options;
	const started = Date.now();
	const client = createComfyClient(comfyUrl);

	// Progress only arrives over the websocket; `waitForPrompt` by itself polls and reports nothing.
	// A blocked websocket (firewall, proxy, older ComfyUI) must not stop the picture from being made:
	// progress is cosmetic, so wait briefly and carry on without it.
	if (onProgress) {
		await Promise.race([
			client.connect({ websocket: { enabled: true } }).catch(() => undefined),
			new Promise((resolve) => setTimeout(resolve, 2000))
		]);
	}

	const queued = await client.queuePrompt(0, { prompt: graph, workflow: {} });
	if (!('prompt_id' in queued)) {
		// ComfyUI answers 200 with `node_errors` when a graph references a missing model/file.
		throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(queued).slice(0, 400)}`);
	}
	const promptId = queued.prompt_id;

	const unsubscribe = onProgress
		? client.on_progress((progress) => {
				onProgress({ value: progress.value, max: progress.max, node: progress.node });
			}, promptId)
		: undefined;

	try {
		await client.waitForPrompt(promptId, pollMs, timeoutMs);
		const outputs = await client.getPromptOutputs(promptId);
		return {
			promptId,
			images: collectImages(outputs),
			elapsedMs: Date.now() - started
		};
	} finally {
		unsubscribe?.();
		client.disconnect();
	}
}

/** Download one output image. Returns the raw bytes. */
export async function fetchImage(ref: ComfyImageRef, url: string = COMFYUI_URL): Promise<Buffer> {
	const query = new URLSearchParams({
		filename: ref.filename,
		subfolder: ref.subfolder,
		type: ref.type
	});
	const response = await fetch(`${url}/view?${query}`);
	if (!response.ok) {
		throw new Error(`ComfyUI /view failed: ${response.status} ${await response.text()}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

/** Upload source image or mask bytes; returns the filename ComfyUI stored it under. */
export async function uploadImage(
	data: Buffer,
	filename: string,
	options: { url?: string; overwrite?: boolean; subfolder?: string } = {}
): Promise<string> {
	const url = options.url ?? COMFYUI_URL;
	const form = new FormData();
	form.append('image', new Blob([new Uint8Array(data)]), filename);
	form.append('overwrite', String(options.overwrite ?? true));
	if (options.subfolder) form.append('subfolder', options.subfolder);

	const response = await fetch(`${url}/upload/image`, { method: 'POST', body: form });
	if (!response.ok) {
		throw new Error(`ComfyUI /upload/image failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as { name?: string; subfolder?: string };
	const name = body.name ?? filename;
	return body.subfolder ? `${body.subfolder}/${name}` : name;
}

/** Cheap liveness probe used by `/api/health` and `npm run doctor`. */
export async function comfyHealth(url: string = COMFYUI_URL) {
	const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) throw new Error(`ComfyUI /system_stats returned ${response.status}`);
	const stats = (await response.json()) as {
		system?: { comfyui_version?: string };
		devices?: Array<{ name?: string; vram_total?: number }>;
	};
	return {
		version: stats.system?.comfyui_version ?? 'unknown',
		device: stats.devices?.[0]?.name ?? 'unknown'
	};
}
