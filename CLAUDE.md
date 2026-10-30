# CLAUDE.md — chatchat (rewrite)

Read this first. It is written for an AI agent picking up work in this repo. It is short on purpose: the details
live in `docs/` and `_notes/`, and this file says where.

**Progress lives in `_notes/TODO.md`.** Update the phase status table and append to its log when you finish anything.

---

## What this app is

A **local-only** AI roleplay chat app. Single user, runs on the user's Windows PC, reached from a phone/tablet over
LAN or Tailscale. It talks to a local `llama.cpp` server (`:8081`) for text and a local **ComfyUI** (`:8188`) for
images, with optional cloud providers. Character cards follow the SillyTavern spec (v1/v2/v3).

Non-negotiables (they are product requirements, not preferences):

1. **Nothing leaves the machine** unless the user configured a cloud provider. No telemetry, no analytics, no accounts.
2. **No CDN at runtime.** Fonts, icons, grammars, CSS are bundled. (The old app violated this with Google Fonts — do not repeat it.)
3. **Double-click start** must keep working: `start-chatchat.bat` → a server on `127.0.0.1`, and the LAN address when enabled.
4. **GPL-3.0.** Dependencies must be MIT/Apache/BSD-compatible. Do not copy SillyTavern (AGPL) source.

---

## Stack (pinned — do not bump without asking)

| Thing      | Version                                                   | Why this one                                                                                      |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| SvelteKit  | **2.70.3** (`@sveltejs/kit`)                              | Kit 3 exists but no model/training data knows it; every agent edit would emit Kit 2 idioms anyway |
| adapter    | `@sveltejs/adapter-node` **5.5.7**                        | plain Node server, needed for `+server.ts` routes and LAN binding                                 |
| Svelte     | 5.x (runes)                                               |                                                                                                   |
| Vite       | 6.4.5                                                     | the combination every tutorial/doc agrees on                                                      |
| TypeScript | 5.9.3, `strict`                                           | the compiler is your review loop                                                                  |
| Tailwind   | 4.x via `@tailwindcss/vite`                               | no `tailwind.config.js` in v4                                                                     |
| UI         | shadcn-svelte (copy-in) + bits-ui                         | source you own, no version skew                                                                   |
| LLM        | `ai` 7.x + `@ai-sdk/openai-compatible` + `@ai-sdk/svelte` | see `docs/DEPS.md` for the _pinned_ API shape                                                     |
| ComfyUI    | `@stable-canvas/comfyui-client`                           | the official SDK needs a Python v2 proxy — do not add it                                          |
| Markdown   | `svelte-streamdown`                                       | handles unterminated fences while streaming                                                       |
| Cards      | `@lenml/char-card-reader`                                 | v1/v2/v3 + lorebooks, zero deps                                                                   |
| DB         | `node:sqlite` (in Node 24)                                | no native module, no build step for downloads                                                     |
| Tests      | vitest (unit) + playwright (e2e, later)                   | must run with **no GPU and no llama.cpp**                                                         |

Rationale for each: `_notes/REWRITE_RESEARCH.md`. Phase plan: `_notes/PLAN.md`.
Feature-by-feature status: `docs/PARITY.md`. Data flow + decisions: `docs/ARCHITECTURE.md`.
Pinned dependency usage: `docs/DEPS.md`. Symptom → fix: `docs/TROUBLESHOOTING.md`.
UI rules — type scale, motion, primitives, layout contract: `docs/UI.md`.

---

## Invariants — breaking these is a bug

1. **The browser never calls a model backend.** No `fetch('http://localhost:8081')`, no ComfyUI URL, no API key in
   the browser. Everything goes through `src/routes/api/*` or a server `load`. This is what makes LAN/phone work and
   keeps secrets out of `localStorage`.
2. **All writes to chats/messages go through `src/lib/server/db/*.ts`.** No `fs.writeFile` on `data/` anywhere else.
3. **Shapes are zod schemas in `src/lib/shared/*.ts`.** Server and client import the same schema. If you need a new
   field, add it there first — then let `npm run check` show you every caller.
4. **`src/lib/server/**` must never be imported by a `.svelte` file.** typescript/svelte-check will not always catch
   it; the lint config bans it by path.
5. **No barrel files.** Import `$lib/components/ui/button/button.svelte`, not an `index.ts` re-export pile.
   (The one exception: `src/lib/components/ui/*/index.ts` files that shadcn-svelte itself generates — leave them.)
6. **No `$effect` for values you can derive.** Use `$derived`. `$effect` is for the DOM and subscriptions only.
7. **No new module-level mutable state.** State lives in a component or an explicit class/store module.

---

## Where to change what

| Task                                          | File(s)                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Add an LLM provider                           | `src/lib/server/backends/llm/<name>.ts`, register in `backends/llm/index.ts`, add id to `src/lib/shared/backend.ts` |
| Change sampler defaults / `/props` handling   | `src/lib/server/backends/llm/llamacpp.ts`, `src/lib/server/config.ts`                                               |
| Change RP prompt assembly                     | `src/lib/server/prompts/rp.ts` (+ `rp.test.ts`)                                                                     |
| Add a ComfyUI graph                           | `workflows/<name>.json` + mapping in `src/lib/server/comfy/workflows.ts`                                            |
| Change DB shape                               | `src/lib/server/db/migrations.ts` — append only, bump `user_version`                                                |
| Change a message/chat shape                   | `src/lib/shared/message.ts` / `chat.ts` → run `npm run check`                                                       |
| Change chat UI                                | `src/routes/chat/[id]/ChatView.svelte`, `src/lib/components/chat/*.svelte`                                          |
| Change the scene record (look/style/seed)     | `src/lib/shared/story.ts` (shape) + `src/lib/components/chat/ScenePanel.svelte` (drawer, prompt preview)            |
| The shipped character card                    | `src/lib/server/cards/shipped.ts`                                                                                   |
| Add a picture block / change where images sit | `src/lib/components/images/ImageBlock.svelte` + `placeImages()` in `src/lib/shared/image.ts`                        |
| Styles / theme tokens                         | `src/app.css` (`:root`, `.dark`, `@theme` — the type scale and animations live there)                               |
| Add a UI primitive (dialog, toast, …)         | `src/lib/components/ui/<name>/`, see `docs/UI.md` §3                                                                |
| Server routes                                 | `src/routes/api/**/+server.ts`                                                                                      |

---

## Commands

```bash
npm run dev        # vite dev server
npm run build      # adapter-node -> build/
npm start          # node build  (production server)
npm run verify     # svelte-check + eslint + vitest   <-- must be green before you say "done"
npm run format     # prettier (safe to run any time)
npm run doctor     # probe every configured provider, models-router.ini, ComfyUI, db, LAN token
npm run dev:fake   # stub OpenAI-compatible LLM on :8899 — the whole app with no GPU
npm run import:legacy -- --from ../chats   # one-way import of the old folder format
```

Never report success on a change that leaves `npm run verify` red. If it cannot be made green, say so and why.

---

## Project layout

```
src/routes/            pages + api endpoints (SvelteKit conventions)
src/lib/shared/        zod schemas + types. NO logic, NO server imports.
src/lib/server/        db/, backends/, comfy/, prompts/, config.ts  (server-only)
src/lib/components/    chat/, cards/, image/, settings/, ui/ (shadcn copies)
src/app.css            Tailwind 4 + shadcn theme tokens
components.json        shadcn-svelte config (baseColor: zinc)
data/                  runtime data (gitignored): chatchat.db, config.json, cards/,
                       chats/<chatId>/{chat.json,story.json,images/}  ← one folder per chat
docs/                  ARCHITECTURE, PARITY (legacy → rewrite), DEPS, TROUBLESHOOTING, UI
_notes/                PLAN.md, TODO.md, REWRITE_RESEARCH.md, model notes
```

## Verified gotchas (do not relearn these)

- `convertToModelMessages` is **async** in AI SDK 7 — always `await` it.
- llama.cpp sampler/thinking fields (`top_k`, `min_p`, `repeat_penalty`, `chat_template_kwargs`) go through
  `providerOptions: { llamacpp: { … } }`, which lands **verbatim** in the request body. Guarded by
  `src/lib/server/backends/llm/llamacpp.spec.ts` (no GPU needed) — keep that test green.
- **Router mode has no `/props`**: `chat_image.bat` runs `llama-server --models-dir … --models-max 1`, and `/props`
  reports `role: router` with `params: null`. Per-model defaults live in `models-router.ini`. Read that file, not `/props`.
- Never use llama.cpp's `/v1/responses` (incomplete; AI SDK schemas reject it). `/v1/chat/completions` only.
- `@ai-sdk/svelte`: read `chat.status` / `chat.messages`; destructuring them kills reactivity.
- Internal links must go through `resolve()` from `$app/paths` — the lint rule
  `svelte/no-navigation-without-resolve` fails the build otherwise (`href={resolve('/chat/[id]', { id })}`).
- **A Svelte `class:` directive cannot contain `/`**: `class:bg-card/60={x}` is a compile error. Use a
  template expression — `class="… {x ? 'bg-card/60' : ''}"`.
- `@tailwindcss/forms` paints its own blue focus ring on every field from a rule late in the base layer.
  The override is in `src/app.css` under `@layer components`; putting it in base loses on source order.
  Reset **both** halves — the plugin sets `--tw-ring-color` _and_ `border-color` on `:focus`, and the border
  is the visible one.
- **Never give a native `<select>` a small fixed height.** The same plugin puts `padding: 0.5rem 0.75rem`
  on every `select`, so `h-5`/`h-7` leaves a 4–12px content box and the 13px label is clipped to a slice of
  glyphs. Use `src/lib/components/ui/select-menu/SelectMenu.svelte` for every one-of-N choice.
- **SvelteKit reuses a page component when only the route parameter changes.** A `$state` initializer in
  `/chat/[id]` therefore runs once, for the first chat — which is how one chat's pictures followed you into
  the next. `+page.svelte` is a `{#key data.chat.id}` wrapper around `ChatView.svelte`; keep per-chat state
  inside that key rather than resetting it by hand.
- **`storySchema.partial()` applies the `.default()`s**, so a PATCH of just the look arrives as
  `{ look, style: 'none', seed: null }` and silently clears the seed. `storyPatchSchema` is written out by
  hand for that reason; its test pins it.
- **The per-chat seed belongs to "of this moment" only.** Regenerate must not use it, or every retry
  returns the identical picture and the button looks broken.
- A picture belongs to a turn via `images.message_id`. Every generation path must send one (chip → its own
  message, "of this moment"/`/image` → the newest reply, edit/inpaint → the source picture's message), or
  the picture has to be placed by `created_at` in `placeImages()`.
- **The marker's AR/SHOT/SEED words are a real token set, not free text.** `PORTRAIT`/`SQUARE`/
  `LANDSCAPE`/`CINEMA`, `CLOSE`…`POV` and `SEED: RANDOM|LOCK` are the ComfyInject vocabulary cards are
  written against; `shared/image.ts` classifies segments 2–4 by content (so order does not matter) and
  maps each word to a framing tag. Before that, `MEDIUM` was pasted into the prompt as a junk tag. When
  adding a word, add it to `src/lib/shared/marker.spec.ts`, which pins the shipped card's own examples.
- **Icon-button accessible names are the e2e contract.** `getByRole(..., { name })` matches a substring, so
  `aria-label="Rename chat"` makes a sidebar row match `{ name: 'chat' }`. Keep names short, put the
  sentence in `title` (see `docs/UI.md` §6).
- **CSRF**: SvelteKit's built-in origin check is disabled in `svelte.config.js`, because adapter-node
  reports the request as `https` even on a plain-http LAN address. Our check lives in `hooks.server.ts`
  (compares `Origin` to the request's `Host`). Do not "restore" the built-in one without testing a LAN IP.
- adapter-node's `event.url.protocol` is not trustworthy on this setup; do not branch on it (see the
  cookie comment in `hooks.server.ts`).
- `tsconfig` targets ES2023 (so `Array.findLast` types resolve); don't lower it.
- Tests must not need a GPU. Use `src/lib/server/backends/llm/fake-server.ts` (real HTTP stub) rather than
  mocking SDK model classes — see `src/routes/api/chat/chat-route.spec.ts`. Browser flows use
  `e2e/*.spec.ts` with the same stub (`tools/fake-llm.ts`).
- Keep the client `Chat` instance for the life of a conversation: rebuilding it from page data on
  `invalidateAll()` drops in-flight replies. `syncFromServer()` is the explicit way to refresh it.
- The AI SDK UI-message stream is chunked JSON: assertions on `response.text()` must reassemble `text-delta`
  chunks, not `toContain('a whole sentence')`.
- A `/** */` block above `<script>` in a `.svelte` file renders as page text. Keep `//` headers inside the script.
- Windows: `pkill` does not kill node.exe. `netstat -ano` → `taskkill //PID <pid> //F`. A stale server on the test
  port serves an old build and will make a good build look broken.

## Looking at the pre-rewrite app

`legacy/` was **deleted on 2026-10-27**; the code is still in git history and the rewrite is the only
implementation. Read it only when a parity question is genuinely open:

```bash
git show 2499e95:js/rp.js            # prompt assembly
git show 2499e95:js/comfy.js         # ComfyUI quirks (history polling, /upload/image)
git show 2499e95:js/sceneprompt.js   # scene → image prompt
git ls-tree -r --name-only 2499e95   # the full old tree
```

Behaviour that mattered is already encoded in tests: `prompts/rp.spec.ts`, `prompts/scene.spec.ts`,
`backends/llm/*.spec.ts`, `db/import-legacy.spec.ts`. Importing old data still works — point
`npm run import:legacy -- --from <dir>` and `CHATCHAT_LEGACY_DIR=<dir> npm run import:cards` at a copy.

## Banned patterns (each one caused bugs in the old codebase)

- `innerHTML` / `{@html}` for model output — use `svelte-streamdown`; sanitise anything you must inject.
- `localStorage` for API keys, chat data, or provider config — those belong server-side (`data/config.json`, 0600).
- Regex-stripping model output at the render layer — normalise in the backend adapter, test it there.
- Hand-rolled SSE/WebSocket parsing — use the SDK or `eventsourced`-style one-liners already present.
- Magic numbers for ports/hosts scattered around — `src/lib/server/config.ts` is the only place.
- `try { } catch { }` that swallows — either recover, or log with context and rethrow.

## Images (Phase 5): the rules that keep it simple

- `images/generate.ts` is the **only** place that turns a request into a file + row. Routes are thin.
- `POST /api/images` answers with SSE on the same request: `progress`, then `done` or `error`. There is
  no job registry, so a closed tab cannot leave a stuck job in the app (ComfyUI finishes on its own).
- `shared/image.ts` holds the marker + `/image` grammar because **both** the browser and the server parse
  it. Anything server-only (running graphs) must not leak into it.
- `fake-comfy.ts` mirrors ComfyUI's real shapes, including the easy-to-get-wrong ones: `/history` is a
  **map keyed by prompt id**, `/queue` returns `{queue_running, queue_pending}`, `/prompt` returns
  `{prompt_id}`. Update the fake whenever the real API surprises you, then write the test.
- GPU work must be opt-in. `CHATCHAT_COMFY_SMOKE=1` for the real path; `npm run verify` and
  `npm run test:e2e` must pass with the GPU busy and ComfyUI down (the e2e config points at a dead port
  on purpose).

## Data layout (do not scatter files again)

`data/chats/<chatId>/` holds `chat.json` (transcript mirror), `story.json` (scene state) and
`images/` (the chat's pictures). The database stays authoritative; the JSON files are mirrors written by
`mirrorChat()` in `src/lib/server/db/layout.ts` after every write. Consequences:

- **Any new write path must call `mirrorChat(db, chatId)`** or the folder drifts from the app.
- Image paths in the database are **relative to `data/`** (forward slashes) and resolved by
  `dataPath()`; never join `DATA_DIR` by hand and never store an absolute path.
- `openDb()` prepares the layout (relocate old flat images, prune rows with missing bytes, rewrite
  mirrors). It runs from the `init` hook, so `data/` is correct before the first request.
- Tests get their own scratch `data/` from `vitest.setup.ts`. Do not remove it: without it a test that
  calls `db()` writes into the developer's real chats.
- `npx playwright test` **rebuilds `build/`** (its webServer command is `npm run build && node build`).
  A long-lived `node build` on another port then answers 500 with `ERR_MODULE_NOT_FOUND: ...chunks/...`
  because its manifest describes the previous build. Restart the app after running e2e.
- A diffusion prompt has no negation: `no cloak` adds a cloak. `prompts/scene.ts#dropNegations` strips
  those phrases; the correct way to remove something is an inpaint or a negative prompt in the graph.
- SvelteKit's request body limit is **512 KB** unless `BODY_SIZE_LIMIT` is set. The inpaint route takes two
  PNGs (~1-2 MB), so `start-chatchat.bat` and the Playwright webServer both set `32M`; a bare `node build`
  answers "Expected a multipart form" instead. `e2e/images.spec.ts` guards it.
- FLUX.2 Klein's clip is a **GGUF** (`flux2-klein-4b-uncensored-q4_k_m.gguf`) and needs the
  `CLIPLoaderGGUF` node — the plain `CLIPLoader` rejects the file ("Value not in list"). The safetensors
  alternative (`qwen_3_4b`, 7.5 GB) does not fit beside the model on 8 GB.
- Z-Image's text encoder loads with a **CLIPLoader type that does not exist** in ComfyUI's enum. ComfyUI
  routes by the encoder file's own text model (Qwen3-4B → Z-Image tokenizer) and only `flux`/`flux2` would
  mis-route it, so the graph uses `qwen_image` as the least misleading label. Its latent is Flux-format
  (16-channel), so the graph needs `EmptySD3LatentImage`, and the VAE is the Flux `ae.safetensors`.
- **Three picker entries depend on LoRA files that live in `ComfyUI/models/loras/`** —
  `Zed_Turbo_Lightning.safetensors`, `FLUX_NSFW_Fix.safetensors`, `Mystic-XXX-ZIT-V7.safetensors`, plus the
  Anima quality pair (`anima-highres-aesthetic-boost`, `rendering_detailer_base10`). `npm run doctor` names
  any the registry references but ComfyUI cannot see. A missing LoRA is a **hard ComfyUI error on purpose**:
  there is no silent fallback, because a picture quietly drawn without the LoRA you asked for is worse than
  a failed request.
- **ComfyUI caches by graph hash.** Re-submitting the same prompt with the same seed and the same graph
  returns in ~0.4 s — that is a cache hit, not a fast model. Vary the seed (or the graph) when timing, or
  you will record 0.4 s for every recipe you bench.
