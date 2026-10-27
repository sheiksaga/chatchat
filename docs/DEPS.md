# Dependencies — why each one exists, and how to use the pinned version

Every entry is pinned in `package.json`. Upgrading a major here is a deliberate change, not a
`npm update` side effect: the point of this file is that an agent reads _our_ usage instead of
guessing from documentation that describes a different major version.

## `ai@7` + `@ai-sdk/openai-compatible` + `@ai-sdk/svelte`

Streaming, message parts, abort, usage, and the Svelte chat state machine.

```ts
// server: src/routes/api/chat/+server.ts
const result = streamText({
	model: chatModel(modelId),
	messages: await convertToModelMessages(messages), // async in v7
	stopSequences: [...STOP_SEQUENCES],
	providerOptions: {
		llamacpp: { top_k: 50, min_p: 0.075, chat_template_kwargs: { enable_thinking: false } }
	},
	onEnd: ({ text }) => {
		/* persist */
	}
});
return result.toUIMessageStreamResponse();
```

```svelte
<!-- client -->
const chat = new Chat({ messages: seed, transport: new DefaultChatTransport({ api: '/api/chat', body: { model } }) });
await chat.sendMessage({ text });          // chat.status, chat.messages, chat.error
```

Traps: `convertToModelMessages` is **async**; do not destructure `chat.messages`; use `/v1/chat/completions`
(never `/v1/responses` with llama.cpp). Guarded by `backends/llm/llamacpp.spec.ts`.

## `@stable-canvas/comfyui-client@1.5.9`

Self-hosted ComfyUI over plain HTTP + WS (the official SDK needs a v2 proxy daemon).

```ts
const client = new Client({ api_host: '127.0.0.1:8188' });
await client.connect({ websocket: { enabled: true } }); // required for progress events
const queued = await client.queuePrompt(0, { prompt: graph, workflow: {} });
if (!('prompt_id' in queued)) throw new Error(JSON.stringify(queued)); // node_errors come back as 200
await client.waitForPrompt(queued.prompt_id, 500, 10 * 60_000);
const outputs = await client.getPromptOutputs(queued.prompt_id);
```

Image bytes are fetched straight from `GET /view?filename=…`. Opt-in test:
`CHATCHAT_COMFY_SMOKE=1 npx vitest run src/lib/server/comfy`.

## `node:sqlite` (built in, Node ≥22.5)

```ts
const db = new DatabaseSync(path);
db.exec('PRAGMA journal_mode = WAL');
const row = oneRow<ChatRow>(db.prepare('SELECT * FROM chats WHERE id = ?'), id); // see db/index.ts
```

Traps: rows are `Record<string, SQLOutputValue>` (cast once in `allRows`/`oneRow`); the parameter type is
`SQLInputValue`; still flagged experimental upstream, so all access goes through `src/lib/server/db`.

## First-party infrastructure (no dependency, but pinned by convention)

- `src/lib/server/backends/llm/fake-server.ts` — stub OpenAI-compatible server (HTTP + SSE). Used by
  `*.spec.ts` and `npm run dev:fake`. If a new adapter needs an endpoint the stub lacks, add it there rather
  than mocking the SDK.
- `src/lib/server/config-store.ts` — `data/config.json`, written atomically with mode 0600. `apiKey` is never
  returned to the browser; `hasKey` is.
- `src/lib/server/backends/llm/ini.ts` — `models-router.ini` reader. Router-mode `/props` reports
  `role: "router"` with `params: null`, so this file is the only source of per-model sampler defaults.

## `svelte-streamdown@5`

Markdown rendering built for token-by-token output: it heals unterminated fences/tables instead of
mangling them, and `static` tells it the message is complete.

```svelte
<Streamdown {content} static={!streaming} />
```

Trap: pass `static` for finished messages only. With `static` unset it keeps re-parsing the tail, which is
fine while streaming and wasteful afterwards.

## `@lenml/char-card-reader@1.1`

Reads SillyTavern cards out of PNG/JPEG metadata (`chara`/`ccv3`) and discriminates v1/v2/v3.

```ts
const card = await CharacterCard.from_file(bytes); // PNG or JPEG
return normalizeCardJson(card.toSpecV3()); // our single shape
```

Traps: `from_file` throws on a `.json` card, so `parseCardFile` sniffs `{` first; `toSpecV3()` is the only
safe accessor when the source spec is unknown. The library is not used for v3 _groups_ (not supported by
the app yet).

## Pending (Phase 5–6)

`svelte-streamdown` (markdown while streaming), `@lenml/char-card-reader` (cards + lorebooks),
`@tanstack/svelte-virtual` (long transcripts), `vite-plugin-pwa` (phone install).

## `@stable-canvas/comfyui-client@3`

ComfyUI transport: queue, websocket progress, `/history`, `/view`, `/upload/image`.

```ts
// src/lib/server/comfy/client.ts
const client = createComfyClient(url); // parses host:port out of the base URL
if (onProgress) await client.connect({ websocket: { enabled: true } }); // nested object, not a boolean
const queued = await client.queuePrompt(0, { prompt: graph, workflow: {} });
await client.waitForPrompt(queued.prompt_id, 500, timeoutMs);
const outputs = await client.getPromptOutputs(queued.prompt_id); // reads /history (a map, not an array)
```

`fake-comfy.ts` implements exactly the endpoints above, so tests never need a GPU. The real
GPU-path check is `CHATCHAT_COMFY_SMOKE=1 npx vitest run src/lib/server/comfy`.

## `@lenml/char-card-reader@1`

Parses SillyTavern cards (PNG `tEXt`, v2/v3 JSON) including lorebooks.

```ts
// src/lib/server/cards/parse.ts
const card = readCharacterCard(bytes); // -> { name, description, book: { entries: [...] } }
```

We normalise its output into `shared/character.ts` so the rest of the app never sees the library's
shape; that is what makes a library swap a one-file change.
