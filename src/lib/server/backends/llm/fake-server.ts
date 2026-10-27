/**
 * A stub OpenAI-compatible LLM server.
 *
 * Purpose: let the whole app — chat route, streaming, persistence, UI — run and be tested without a
 * GPU, and give adapter tests a server that records exactly what was sent. It speaks the same three
 * endpoints the real backends use (`/v1/models`, `/v1/chat/completions`, `/props`), so the code path
 * under test is the *production* one, not a mocked SDK model.
 *
 * Used by `src/lib/server/backends/llm/*.spec.ts` and by `tools/fake-llm.ts` (`npm run dev:fake`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface CapturedRequest {
	path: string;
	method: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown> | null;
}

export interface FakeLlmOptions {
	/** 0 picks a free port, which is what tests want. */
	port?: number;
	/** Model ids listed by `GET /v1/models`. */
	models?: string[];
	/**
	 * Reply text given the parsed request body and the 1-based number of this chat-completion call.
	 * The counter lets a test (or a human) tell a regenerated reply from the original one.
	 */
	reply?: (body: Record<string, unknown>, callIndex: number) => string;
	/** Delay between streamed chunks, so tests can observe incremental rendering. */
	chunkDelayMs?: number;
}

export interface FakeLlm {
	url: string;
	port: number;
	requests: CapturedRequest[];
	/** Most recent chat-completions body — the assertion target for adapter tests. */
	lastBody(): Record<string, unknown> | null;
	close(): Promise<void>;
}

export const STUB_MODELS = ['fake-instruct-8b', 'fake-coder-3b'];

function lastUserText(body: Record<string, unknown>): string {
	const messages = Array.isArray(body.messages) ? body.messages : [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; content?: unknown };
		if (message?.role !== 'user') continue;
		if (typeof message.content === 'string') return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.map((part) => (part as { text?: string }).text ?? '')
				.join(' ')
				.trim();
		}
	}
	return '';
}

function defaultReply(body: Record<string, unknown>, callIndex: number): string {
	const text = lastUserText(body).trim();
	const answer = text ? `Stub reply to: "${text}".` : 'Stub reply.';
	// Two sentences so streaming visibly splits into several chunks. The call number makes each
	// regeneration visibly distinct, which is what makes the version arrows testable.
	return `${answer} No GPU was harmed. (call ${callIndex})`;
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function json(response: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(body)
	});
	response.end(body);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Split into word-sized deltas, the way a real tokenizer would. */
function chunksOf(text: string): string[] {
	return text.match(/\s*\S+/g) ?? [text];
}

export async function startFakeLlm(options: FakeLlmOptions = {}): Promise<FakeLlm> {
	const models = options.models ?? STUB_MODELS;
	const requests: CapturedRequest[] = [];
	const reply = options.reply ?? defaultReply;
	const chunkDelayMs = options.chunkDelayMs ?? 0;

	const server = createServer(async (request, response) => {
		const path = (request.url ?? '/').split('?')[0];
		const method = request.method ?? 'GET';

		if (method === 'GET' && path === '/v1/models') {
			requests.push({ path, method, headers: request.headers, body: null });
			return json(response, 200, {
				object: 'list',
				data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'chatchat-stub' }))
			});
		}

		// llama.cpp's single-model metadata endpoint, used to test the `/props` sampler fallback.
		if (method === 'GET' && path === '/props') {
			return json(response, 200, {
				role: 'model',
				default_generation_settings: {
					params: { temperature: 0.71, top_p: 0.94, top_k: 41, min_p: 0.06, repeat_penalty: 1.07 }
				}
			});
		}

		if (method === 'POST' && path === '/v1/chat/completions') {
			const raw = await readBody(request);
			let body: Record<string, unknown>;
			try {
				body = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				return json(response, 400, { error: { message: 'invalid JSON' } });
			}
			requests.push({ path, method, headers: request.headers, body });

			const callIndex = requests.filter((entry) => entry.path === '/v1/chat/completions').length;
			const text = reply(body, callIndex);
			const created = Math.floor(Date.now() / 1000);
			const id = `chatcmpl-stub-${requests.length}`;
			const model = typeof body.model === 'string' ? body.model : models[0];
			const wantsStream =
				body.stream === true ||
				(body.stream === undefined &&
					/\btext\/event-stream\b/.test(String(request.headers.accept)));

			if (!wantsStream) {
				return json(response, 200, {
					id,
					object: 'chat.completion',
					created,
					model,
					choices: [
						{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }
					],
					usage: {
						prompt_tokens: 12,
						completion_tokens: 7,
						total_tokens: 19,
						prompt_tokens_details: { cached_tokens: 0 }
					}
				});
			}

			response.writeHead(200, {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive'
			});
			const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
			const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
				id,
				object: 'chat.completion.chunk',
				created,
				model,
				choices: [{ index: 0, delta, finish_reason: finish }]
			});

			send(chunk({ role: 'assistant', content: '' }));
			for (const piece of chunksOf(text)) {
				if (chunkDelayMs) await sleep(chunkDelayMs);
				send(chunk({ content: piece }));
			}
			send(chunk({}, 'stop'));

			const streamOptions = body.stream_options as { include_usage?: boolean } | undefined;
			if (streamOptions?.include_usage) {
				send({
					id,
					object: 'chat.completion.chunk',
					created,
					model,
					choices: [],
					usage: {
						prompt_tokens: 12,
						completion_tokens: 7,
						total_tokens: 19,
						prompt_tokens_details: { cached_tokens: 0 }
					}
				});
			}
			response.write('data: [DONE]\n\n');
			return response.end();
		}

		requests.push({ path, method, headers: request.headers, body: null });
		return json(response, 404, { error: { message: `stub has no route for ${method} ${path}` } });
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port ?? 0, '127.0.0.1', () => {
			const address = server.address();
			resolve(typeof address === 'object' && address ? address.port : 0);
		});
	});

	return {
		url: `http://127.0.0.1:${port}/v1`,
		port,
		requests,
		lastBody: () => {
			for (let i = requests.length - 1; i >= 0; i--) {
				if (requests[i].path === '/v1/chat/completions') return requests[i].body;
			}
			return null;
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}
