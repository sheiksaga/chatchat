/**
 * A ComfyUI that answers the four endpoints this app uses, so image generation can be tested without a
 * GPU. Mirrors `backends/llm/fake-server.ts`: a real HTTP server, not a mocked module, because the bugs
 * we care about live in the request/response shapes.
 *
 * Served: `POST /prompt`, `GET /queue`, `GET /history`, `GET /view`, `GET /system_stats`,
 * `POST /upload/image`. No websocket — progress is optional and the client only connects for it.
 */
import { Buffer } from 'node:buffer';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** 1×1 transparent PNG; stands in for a generated picture. */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
	'base64'
);

export interface FakeComfy {
	url: string;
	/** Every graph that was queued, in order — assert on prompts/samplers without a model. */
	queued: Array<{ prompt_id: string; graph: unknown }>;
	uploads: string[];
	close: () => Promise<void>;
}

export interface FakeComfyOptions {
	/** Port to listen on; 0 (the default) lets the OS pick one. */
	port?: number;
	/** How long a job stays "running" before its history entry appears. */
	delayMs?: number;
	/** Reject the next queue call with ComfyUI's `node_errors` shape. */
	failWith?: string;
}

export async function startFakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
	const { port = 0, delayMs = 0, failWith } = options;
	const queued: Array<{ prompt_id: string; graph: unknown }> = [];
	const uploads: string[] = [];
	const finished = new Map<string, { at: number; promptId: string }>();
	let counter = 0;

	const server = http.createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://fake');
		const send = (status: number, body: unknown) => {
			const text = typeof body === 'string' ? body : JSON.stringify(body);
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(text);
		};

		if (request.method === 'POST' && url.pathname === '/prompt') {
			let body = '';
			request.on('data', (chunk) => (body += chunk));
			request.on('end', () => {
				if (failWith) return send(200, { node_errors: { 1: failWith } });
				const graph = JSON.parse(body || '{}') as { prompt?: unknown };
				const promptId = `fake-${++counter}`;
				queued.push({ prompt_id: promptId, graph: graph.prompt });
				finished.set(promptId, { at: Date.now() + delayMs, promptId });
				send(200, { prompt_id: promptId, number: counter, node_errors: {} });
			});
			return;
		}

		if (request.method === 'POST' && url.pathname === '/upload/image') {
			request.on('data', () => {});
			request.on('end', () => {
				const name = `uploaded-${uploads.length + 1}.png`;
				uploads.push(name);
				send(200, { name, subfolder: '', type: 'input' });
			});
			return;
		}

		if (url.pathname === '/queue') {
			const now = Date.now();
			const running = [...finished.values()]
				.filter((job) => job.at > now)
				.map((job) => ({ prompt: [0, job.promptId] }));
			return send(200, { queue_running: running, queue_pending: [] });
		}

		if (url.pathname === '/history') {
			// ComfyUI answers a **map keyed by prompt id**, not an array — the client does Object.values().
			const now = Date.now();
			const wanted = url.searchParams.get('prompt_id');
			const history: Record<string, unknown> = {};
			for (const job of finished.values()) {
				if (job.at > now) continue;
				if (wanted && job.promptId !== wanted) continue;
				history[job.promptId] = {
					prompt: [0, job.promptId, {}, {}, ['9']],
					status: { status_str: 'success', completed: true },
					outputs: {
						'9': { images: [{ filename: `${job.promptId}.png`, subfolder: '', type: 'output' }] }
					}
				};
			}
			return send(200, history);
		}

		if (url.pathname === '/view') {
			response.writeHead(200, { 'content-type': 'image/png' });
			return response.end(TINY_PNG);
		}

		if (url.pathname === '/system_stats') {
			return send(200, {
				system: { comfyui_version: 'fake-0.0.0' },
				devices: [{ name: 'Fake GPU', vram_total: 8 * 1024 ** 3 }]
			});
		}

		send(404, { error: `fake ComfyUI has no ${request.method} ${url.pathname}` });
	});

	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
	const actual = (server.address() as AddressInfo).port;

	return {
		url: `http://127.0.0.1:${actual}`,
		queued,
		uploads,
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}
