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

| Task                                        | File(s)                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Add an LLM provider                         | `src/lib/server/backends/llm/<name>.ts`, register in `backends/llm/index.ts`, add id to `src/lib/shared/backend.ts` |
| Change sampler defaults / `/props` handling | `src/lib/server/backends/llm/llamacpp.ts`, `src/lib/server/config.ts`                                               |
| Change RP prompt assembly                   | `src/lib/server/prompts/rp.ts` (+ `rp.test.ts`)                                                                     |
| Add a ComfyUI graph                         | `workflows/<name>.json` + mapping in `src/lib/server/comfy/workflows.ts`                                            |
| Change DB shape                             | `src/lib/server/db/migrations.ts` — append only, bump `user_version`                                                |
| Change a message/chat shape                 | `src/lib/shared/message.ts` / `chat.ts` → run `npm run check`                                                       |
| Change chat UI                              | `src/lib/components/chat/*.svelte`                                                                                  |
| Styles / theme tokens                       | `src/app.css` (`:root`, `.dark`, `@theme` — the type scale and animations live there)                               |
| Add a UI primitive (dialog, toast, …)       | `src/lib/components/ui/<name>/`, see `docs/UI.md` §3                                                                |
| Server routes                               | `src/routes/api/**/+server.ts`                                                                                      |

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
data/                  runtime data (gitignored): chatchat.db, images/, cards/, config.json
legacy/                the pre-rewrite app — READ ONLY reference for porting behaviour
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

## Porting from `legacy/`

`legacy/js/*.js` is the behavioural source of truth for anything that already works. When porting, read the legacy
file, write the TypeScript version, and **write a test that encodes the legacy behaviour** before wiring the UI.
Useful starts: `legacy/js/rp.js` (prompt assembly), `legacy/js/comfy.js` (ComfyUI quirks: `/object_info/<node>`,
history polling, `/upload/image`), `legacy/js/cards.js` (PNG tEXt parsing — now replaced by the card-reader lib),
`legacy/js/sceneprompt.js` (scene → image prompt), `legacy/js/generations.js` (response cycling).

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
