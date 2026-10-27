# chatchat → SvelteKit rewrite: library research, critique, plan

_Research date: 2026-10-26. Target: local-only, LAN-accessible, offline-at-runtime, GPL-3.0, free deps._

> **The build plan lives in `PLAN.md`.** Two picks below were revised there after adding the "an LLM agent must be able
> to maintain this" requirement: **SvelteKit 2.70 + adapter-node 5.5.7 instead of Kit 3** (training-data/corpus lag), and an
> explicit coding-rules + docs + verify-harness regime. Everything else stands.

Current tree: 22,392 lines of HTML/CSS/JS (`index.html` 1,395 + `css/style.css` 2,961 + `js/*` ~13,400 + `tools/*` ~2,000 + generated card/workflow data).
Runtime today: Node static+JSON server (`tools/serve.js`, 685 lines) on 127.0.0.1:8765, browser talks directly to
llama.cpp `:8081`, LM Studio `:1234`, ComfyUI `:8188`, and cloud providers.

---

## 1. Verified environment facts (checked on this machine)

| Fact | Value | Why it matters |
| --- | --- | --- |
| Node | v24.19.0 | Kit 3 / AI SDK 7 / `node:sqlite` all need ≥22 ✔ |
| `node:sqlite` | works; SQLite **3.53.3**; **FTS5 OK**; WAL OK | usable with zero native build ✔ |
| llama.cpp | `llama-server` (router + single), `:8081`, `/props` presets | keep `/props` sampler-source behaviour |
| ComfyUI | **0.42.0**, has `/api/jobs/{id}` + `/api/jobs/{id}/cancel`, **no `/api/v2`** | official `@comfyorg/sdk` needs `/api/v2` → **not usable without a proxy** |
| ComfyUI CORS | only with `--enable-cors-header` | argument for moving ComfyUI calls server-side |
| Tailscale | already used (`100.x:8081` in `start-llama.bat`) | phone access already solved, don't invent LAN auth twice |
| Google Fonts | `index.html` loads Inter from `fonts.googleapis.com` | **already violates the "no CDN / no telemetry" rule** |

---

## 2. Library decisions

### 2.1 App framework — SvelteKit (**revised: 2.70, not 3.1**, see `PLAN.md` §1.4)

`@sveltejs/kit` **2.70.3** + `@sveltejs/adapter-node` **5.5.7**, Svelte **5.57.3**, Vite 6.
Kit 3.1.0 is stable (2026-10-01) and would be the pick for a human-only team; it is deliberately **not** the pick here
because model training data does not contain it yet. Migration later is `npx sv migrate sveltekit-3`.

- Kit 3 breaking changes that affect us: config moves into `vite.config.ts` (no `svelte.config.js`), `$lib` → `#lib` + explicit file extensions, adapter-node replaced `ORIGIN` env with `kit.paths.origin`, `sv` CLI is 1.0.
- **Remote functions** (`query`/`command`/`form` in `.remote.ts`) are still **experimental** in Kit 3 and need async-Svelte. Use them **only** as later sugar for CRUD; do not build the foundation on them.
- Rejected: Next.js/Nuxt (React/Vue UI ecosystem gives nothing chatchat needs and loses the Svelte chat-UI packages below); bare Vite SPA + Hono (two pieces, no typed server boundary); Tauri/Electron (kills the "phone over LAN" requirement).

### 2.2 LLM transport — Vercel AI SDK 7 (wrapped)

`ai` **7.0.154** (Apache-2.0), `@ai-sdk/openai-compatible` **3.0.79**, `@ai-sdk/svelte` **5.0.154** (peer `svelte ^5.31`), `zod` 4.

Why: one `streamText` path covers llama.cpp / LM Studio / OpenAI / OpenRouter / nano-gpt; `UIMessage` parts + `toUIMessageStreamResponse()` + `Chat` class replace `js/api.js` streaming, abort, usage, and message state; arbitrary non-OpenAI body fields (`min_p`, `top_k`, `repeat_penalty`, `chat_template_kwargs`) can be injected through `providerOptions`/`extraBody` (documented on the openai-compatible provider page).

Known limits to design around:
- llama.cpp's `/v1/responses` implementation is incomplete for AI SDK tool schemas (ggml-org/llama.cpp#20607) → **stay on `/v1/chat/completions`**, do not use the Responses API.
- AI SDK is a fast-moving abstraction (v5→v6→v7 in ~18 months) and has a documented "content-marketing" feel on HN. Mitigation: **one thin `LlmBackend` interface in our own code**, AI SDK used only inside it. A raw `fetch` + SSE implementation for llama.cpp `/completion` must remain a 100-line drop-in fallback.
- RP needs things chat-SDKs dislike: trailing assistant prefill, server stop strings (`rpStopStrings`), sampler autopilot from `/props`. Treat these as **first-class adapter capabilities**, not app-level special cases (today they are smeared across `api.js`, `config.js`, `models.js`).

### 2.3 UI kit / shell

- **shadcn-svelte** (copy-in components) on **bits-ui 2.20.2** + **tailwindcss 4.3.3**. Caveat: shadcn-svelte docs still assume `$lib`; with Kit 3's `#lib` verify the alias step once during setup.
- **Svelte AI Elements** (unofficial Vercel-AI-Elements port on shadcn-svelte; Message / Conversation / Prompt Input / Response / Reasoning, ~44 components, installed by *copying* via a jsrepo registry) — good accelerator for chat chrome; we own the copies, so it can't "die on us". Not a dependency risk, only a taste risk.
- `paneforge` 1.0.2 for the sidebar/transcript resize; `@tanstack/svelte-virtual` 3.13.49 for very long transcripts; `@lucide/svelte` for icons; `mode-watcher`/`svelte-sonner` if wanted.
- **Markdown**: `svelte-streamdown` **5.0.0** (Svelte port of Vercel Streamdown; handles unterminated code fences/bold/links, Shiki highlighting, opt-in KaTeX). Replaces the bespoke `marked` + `DOMPurify` + `hljs` pipeline in `messages.js` (882 lines) — keep DOMPurify as a belt-and-braces sanitiser for any `{@html}` we still own.
- **PWA**: `vite-plugin-pwa` 2.0.0 → installable on the phone, cached shell; keeps "no CDN" honest (all assets local).
- Self-host Inter's woff2 (OFL) instead of Google Fonts.

### 2.4 Storage — SQLite via `node:sqlite` (no ORM), images stay as files

Current model: `chats/index.json` + `chats/<id>/chat.json` + `story.json` + `images/<id>.bin/.json`, all loaded at boot through `GET /api/all` (32 MiB cap). Problems: full-corpus boot payload, write races between tabs, no search, no transactions, three-way schema duplication (`serve.js` routes ↔ `chatstore.js` bridge ↔ `storyfile.js`).

Proposal: `data/chatchat.db` (WAL) with `chats`, `messages`, `generations`, `story` (JSON column), `images` (metadata rows; bytes on disk), `providers` (server-side config/secrets), `meta`; FTS5 virtual table over message text for search. Hand-written SQL in `src/lib/server/db/*.ts` + `PRAGMA user_version` migrations (~200 lines, 6 tables).

- `node:sqlite` is **still flagged experimental** (stability 1.1). Isolate all access behind `db/index.ts` so swapping to `better-sqlite3` 13.0.3 is a ~50-line change. `drizzle-orm` 0.45.4 has **no `node:sqlite` driver** (only better-sqlite3/libsql/bun-sqlite) — for 6 tables an ORM buys little.
- Keep images as files (`data/images/<id>.webp|png` + row) — no DB bloat, trivial backup, and `+server.ts` can serve them with `Cache-Control` + `Range`.
- Keep a JSON export/import path (`npm run export-chats`) so "chats are just files" survives — plus a one-shot importer for the existing `chats/` folder.

### 2.5 ComfyUI client

| Option | Verdict |
| --- | --- |
| `@comfyorg/sdk` 0.5.0 (official, MIT) | **Not now.** Speaks only Comfy API **v2**; self-hosted needs `pip install comfy-api-proxy` (Python, port 8189). Your ComfyUI 0.42.0 exposes `/api/jobs` but no `/api/v2`. Adds a third daemon to a double-click start. Revisit if ComfyUI ships v2 natively. |
| **`@stable-canvas/comfyui-client` 1.5.9** (MIT, zero deps, Node+browser, all REST+WS, programmable workflow, image upload/fetch) | **Recommended.** Direct `/prompt` + `/ws` + `/history` + `/view` + `/upload/image`; matches the graphs in `workflows/`. |
| `@saintno/comfyui-sdk` 0.3.1 | Viable alternative (WS events, multi-instance pool, reconnection). Larger surface than needed. |
| `comfyui-sdk` 0.0.5 | Too young (0.0.x). |

Design: ComfyUI calls live **server-side** (no CORS flag needed, images can be written straight to `data/images/`, phone only ever talks to one origin). WS progress is relayed to the browser as SSE from `+server.ts`. Keep `workflows/*.json` + `tools/sync-workflows.js`; add a typed `Workflow` wrapper with per-graph input/output node IDs instead of stringly-typed injection.

### 2.6 Character cards

`@lenml/char-card-reader` **1.1.1** — zero dependencies, spec **v1/v2/v3**, PNG **and** JPEG/WEBP **and** JSON, browser + Node, plus `CharacterBook` (lorebook) extraction and `book.scan(text)` trigger matching. Replaces the hand-rolled PNG tEXt/base64 parser in `js/cards.js` (570 lines) and unlocks lorebooks for free. Keep `cards/cards.js` usable as a bundled seed library, but move to `data/cards/` on disk.

### 2.7 Testing, linting, ops

`vitest` + `@testing-library/svelte` (unit: prompt assembly, sampler resolution, workflow injection, card parsing, repo layer), `playwright` (e2e against **fake backends**, see §5), `eslint` + `prettier` (already used), `svelte-check`.

---

## 3. Critique of the current design

**Architecture**
1. **28 ordered `<script>` tags + ~300 globals, typed only by JSDoc comments.** `js/dom.js` exists purely to make the HTML↔JS contract survivable. Every feature edit requires reconstructing load order and implicit state in your head — this is the main "not robust" driver, not any single library.
2. **Everything bespoke**: SSE parsing, thinking-tag stripping (`stripThinkTags`, 8 regexes), ComfyUI polling, PNG tEXt parsing, markdown, atomic writes, HTTP server. Each is individually reasonable and collectively a bug farm with no tests.
3. **No adapter boundary.** llama.cpp quirks (`/props` sampler source, `chat_template_kwargs`, router aliases), OpenAI-compat, and cloud providers are interleaved through `state.js`/`config.js`/`api.js`. Adding one backend touches five files.
4. **Boot is all-or-nothing** (`GET /api/all`, 32 MiB cap) and writes are last-write-wins across tabs — a scaling cliff and a data-loss path that the phone-on-LAN use case makes *more* likely, not less.
5. **Image-model knowledge is a hand-curated 480-line table** (`imagemodels.js`) that drifts from reality; ComfyUI's `/object_info` plus llama/LM Studio `/models` can be the source of truth with a tiny override file.
6. **Security posture is implicit.** Bound to loopback with Origin checks, but API keys sit in `localStorage`, and the moment it binds the LAN there is no auth. (Today Tailscale is doing the auth work — make that explicit instead of accidental.)
7. **The "local-only / no CDN" promise is already broken** by the Google Fonts `<link>`.

**Process**
8. **A full rewrite already happened once** (commit `6c041d7` "remove image subsystem and test suite for a from-scratch restart"). The plan below exists to avoid a third pass: parity checklist per phase, old app kept runnable, data importer written *before* the UI moves.
9. **No test seam for the expensive parts.** Any e2e today needs a GPU, the right GGUF, and ComfyUI warm. Fake backends are a design requirement, not a nice-to-have.

---

## 4. Target architecture

```
chatchat/
  vite.config.ts                 # Kit 3 config lives here
  src/
    app.html  app.css  hooks.server.ts (LAN token, origin, logging)
    routes/
      +layout.svelte             # sidebar, theme, diagnostics link
      +page.svelte               # hero
      chat/[id]/+page.ts|svelte  # transcript + composer + image rail
      settings/…                 # providers, samplers, appearance, cards
      api/llm/+server.ts         # streamText → UI message stream
      api/comfy/progress/+server.ts   # SSE relay of WS progress
      api/images/[id]/+server.ts      # bytes, Range, immutable cache
      api/health/+server.ts      # llama.cpp /props, ComfyUI /system_stats, db
    lib/
      components/{chat,cards,image,settings,ui}/
      server/
        db/{index,migrate,chats,messages,images,search}.ts
        backends/llm/{types,index,llamacpp,openai-compat,lmstudio}.ts
        backends/image/{types,index,comfyui,openai-images}.ts
        comfy/{client,workflows,progress}.ts
        prompts/{assemble,rp,scene}.ts
        config.ts   # server-side provider registry + secrets (file, 0600)
        auth.ts     # optional bearer token when bound past loopback
      shared/{schemas,types,settings}.ts     # zod, used by server + client
  data/            # gitignored: chatchat.db, images/, exports/
  legacy/          # current app, read-only reference + importer source
```

**One rule that carries most of the robustness:** the browser never talks to llama.cpp, ComfyUI, or a cloud API.
All backend calls go through SvelteKit server routes → single origin, no CORS, keys never reach the client, one
URL for the phone, one place to log/retry. Streaming is `ReadableStream` passthrough with `Cache-Control: no-store`
and `X-Accel-Buffering: no`.

---

## 5. Plan

### Phase 0 — de-risk spikes (do these before writing app code)

Each spike is a throwaway branch, ≤150 lines, and must be **green or it changes the plan**.

| # | Spike | Pass condition | Fallback if red |
| --- | --- | --- | --- |
| A | Kit 3 + `sv create` + Tailwind 4 + shadcn-svelte + adapter-node; `streamText(createOpenAICompatible(llama.cpp :8081))` → `Chat` renders tokens | tokens stream in the browser, `stop` strings honoured, `min_p`/`top_k`/`repeat_penalty` visible in llama-server log, thinking suppressed via `chat_template_kwargs`, `/props` read server-side | Kit 2.57 + adapter-node 5; or hand-rolled SSE `LlmBackend` |
| B | `@stable-canvas/comfyui-client` from Node against 0.42.0: inject `workflows/krea2_turbo_t2i.json`, WS progress, `/view` bytes to disk; `/upload/image` + mask for inpaint | image lands on disk with progress events; inpaint graph runs | keep current `comfy.js` logic, port as-is to TS |
| C | `node:sqlite` repo + importer from existing `chats/`; FTS5 search over messages | all current chats import losslessly; app boots without `GET /api/all` | `better-sqlite3` + `drizzle-orm` |
| D | LAN: `HOST=0.0.0.0`, `kit.paths.origin`, token gate, phone over Tailscale; streaming over LAN | streaming works from the phone, no buffering, 401 without token | Tailscale-only + loopback bind (status quo) |

### Phase 1 — walking skeleton
Layout + sidebar chat list + one chat + composer; SQLite persistence; one hardcoded provider; dark theme; `start-chatchat.bat` updated.
**Gate:** send/receive on the phone over Tailscale, reload preserves history, no data loss with two tabs open.

### Phase 2 — provider layer
`LlmBackend` capability model (`samplers`, `prefill`, `thinking`, `vision`, `modelList`, `props`), llama.cpp + OpenAI-compat + LM Studio adapters, sampler autopilot from `/props`, server-side provider registry + secrets, health/model discovery, diagnostics page.
**Gate:** the three providers you actually use switch without touching chat code; unit tests on adapter payloads from recorded fixtures.

### Phase 3 — chat UX parity
`svelte-streamdown` rendering, code copy, regenerate/cycle generations, edit/delete/branch, autosizing composer, keyboard shortcuts, scroll anchoring + "jump to latest", per-message gen stats, virtualized list.
**Gate:** side-by-side with legacy on the same chat — nothing missing from the parity checklist.

### Phase 4 — characters, cast, story
`char-card-reader`, card library on disk (`data/cards/`), card editor, cast picker, RP prompt assembly (port `rp.js` as pure functions first, tests second), story file as a zod-schema'd JSON column, **lorebook support (new)**.
**Gate:** import a real SillyTavern v2/v3 card + its lorebook, play a scene, images still know the cast.

### Phase 5 — images
ComfyUI adapter, workflow registry (typed node maps), queue/progress SSE, image store, viewport zoom, regenerate, inpaint mask editor, scene→prompt builder (port `sceneprompt.js`), prune, OpenAI-images path.
**Gate:** full loop on the phone: chat → `/image` → picture → regenerate → inpaint.

### Phase 6 — hardening + distribution
Playwright e2e against fake backends (no GPU), error boundaries + toasts, structured logs + `npm run doctor`, PWA manifest/icons, GPL headers + `THIRD_PARTY.md`, release packaging (below), README rewrite, delete `legacy/` only when parity is signed off.

**Distribution (this is the phase that decides whether "double-click start" survives a build step):**
1. `npm ci && npm run build` locally, then ship a **release zip** containing `build/`, `data/` skeleton, `node_modules` pruned to production, and `start-chatchat.bat` → `node build`. Biggest zip (~40-80 MB), zero setup.
2. **Bundle the server**: `esbuild build/index.js --bundle --platform=node --outfile=server.mjs` (plus `build/client/` assets) → small zip, `node server.mjs`, no `node_modules` at all.
3. **Node SEA** (`--build-sea`, Node 25.5+ / postject) → single `chatchat.exe`. Nicest UX, most build plumbing.
   Recommend (2) for the repo, (1) for people who "just want to try it", (3) only if you feel like it.

### Rough effort
Phase 0: 2–4 evenings · 1: 2–3 · 2: 3–5 · 3: 5–8 · 4: 4–6 · 5: 6–10 · 6: 3–5. Phases 1–3 alone already give a better app than today for the core chat path; images (5) is the expensive one and can wait.

---

## 5b. Build vs adopt (the question worth answering honestly)

- **SillyTavern** (AGPL-3.0) is the reference implementation and the origin of the card format — and its frontend is *also* untyped globals + a monolithic script bundle. Adopting it means inheriting exactly the maintenance model you're trying to escape, plus its license.
- **RisuAI** is the closest competitor for your use case (phone-first RP, character cards, image generation) and is **Svelte + TypeScript** — independent confirmation that this stack fits the domain.
- **Open WebUI** is **SvelteKit** + Python; **LibreChat** is React. Both are general chat, not story/image-centric.
- Nothing in that field does what chatchat does: *ComfyUI workflow graphs driven by a per-chat story record, on your own llama.cpp and your own card library.* Keep the product, replace the plumbing.

## 6. What NOT to add

- **No Electron/Tauri** — the phone-over-LAN requirement is the whole point of a web UI.
- **No Postgres/Redis/Docker requirement** — single user, one machine.
- **No accounts / auth provider** — one optional bearer token for LAN, nothing else.
- **No LangChain/LlamaIndex** — prompt assembly is domain logic you already own and understand.
- **No tRPC/GraphQL** — Kit server routes + zod already give typed boundaries.
- **No official Comfy SDK yet** — needs a Python proxy daemon.
- **No ORM for six tables** (`drizzle` has no `node:sqlite` driver anyway).
- **No CDN anything** — fonts, icons, grammars, KaTeX CSS all bundled.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Kit 3 is 3 weeks old; shadcn-svelte docs lag (`#lib` alias, Vite 8/Rolldown) | **Resolved: stay on Kit 2.70.3 + adapter-node 5.5.7**, migrate once the corpus catches up |
| AI SDK major-version churn | own `LlmBackend` interface; pin; raw-SSE fallback path kept working in a test |
| llama.cpp OpenAI-compat quirks (thinking, prefill, samplers) | adapter capability flags; server-side `/props`; keep `/completion` path |
| `node:sqlite` experimental | single DB module; better-sqlite3 swap ready |
| Scope: 22k lines, one restart already | parity checklists per phase, legacy stays runnable, importer first, feature freeze on legacy |
| Build step breaks the "double-click" promise | release packaging decided in Phase 6, not after |
| GPL-3.0 + third-party content | all chosen deps MIT/Apache; do **not** copy SillyTavern (AGPL) code; keep `cards/avatars/` gitignored |

## 8. Quick wins available today (independent of the rewrite)

1. Self-host Inter → removes the only runtime CDN call and the Google telemetry.
2. `GET /api/chats/<id>` lazy loading instead of `GET /api/all` at boot.
3. Serialize writes server-side (single-writer queue) to stop cross-tab clobbering.
4. Read sampler/model facts from `/props` + `/object_info` instead of the curated tables.
5. Add a `doctor` script: probes llama.cpp `/props`, ComfyUI `/system_stats`, DB, port, Tailscale address — the single most useful debugging tool for this app.

---

## Sources

- AI SDK: [openai-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers), [Svelte getting started](https://ai-sdk.dev/docs/getting-started/svelte), [AI SDK 7 changelog](https://vercel.com/changelog/ai-sdk-7), [7.0 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
- llama.cpp + AI SDK: [ggml-org/llama.cpp#20607](https://github.com/ggml-org/llama.cpp/issues/20607) (Responses SSE gaps)
- ComfyUI: [official TS SDK](https://github.com/Comfy-Org/comfy-typescript-sdk), [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy), [SDK docs](https://docs.comfy.org/development/api-development/sdks), [design notes](https://docs.comfy.org/development/api-development/sdks-design), [@stable-canvas/comfyui-client](https://github.com/StableCanvas/comfyui-client), [@saintno/comfyui-sdk](https://www.npmjs.com/package/@saintno/comfyui-sdk)
- Cards: [@lenml/char-card-reader](https://github.com/lenML/char-card-reader)
- Markdown: [svelte-streamdown](https://github.com/beynar/svelte-streamdown), [Streamdown](https://streamdown.ai/docs)
- UI: [shadcn-svelte](https://www.shadcn-svelte.com/docs), [bits-ui](https://www.bits-ui.com), [Svelte AI Elements (community port)](https://github.com/SikandarJODD/ai-elements), [paneforge](https://www.shadcn-svelte.com/docs/about)
- Framework: [SvelteKit 3 is here](https://svelte.dev/blog/sveltekit-3-is-here), [migrating to Kit 3](https://svelte.dev/docs/kit/migrating-to-sveltekit-3), [adapter-node](https://svelte.dev/docs/kit/adapter-node), [Svelte 3 release index](https://releases.sh/svelte), [remote functions (still experimental)](https://svelte.dev/docs/kit/remote-functions)
- Storage: [SQLite driver benchmark (better-sqlite3 vs node:sqlite)](https://sqg.dev/blog/sqlite-driver-benchmark), [built-in SQLite in Node](https://blog.logrocket.com/using-built-in-sqlite-module-node-js), [SvelteKit + SQLite + Drizzle](https://fullstacksveltekit.com/blog/sveltekit-sqlite-drizzle)
- Distribution: [Bundling a SvelteKit app into a single binary](https://gautier.dev/articles/sveltekit-sea)
- Community sentiment: [HN on AI SDK abstraction](https://news.ycombinator.com/item?id=43605279), [r/selfhosted Open WebUI vs LibreChat](https://www.reddit.com/r/selfhosted/comments/1jltdjq/openwebui_vs_librechat), [ST vs RisuAI vs Agnai 2026](https://blog.mini-tavern.com/blog/sillytavern-vs-risuai-vs-agnai-which-ai-roleplay-frontend-is-best-in-2026-6ca9d2)
