# chatchat rewrite — living TODO

**How to use:** this file is the single source of truth for progress. Mark items `[x]` as they land, add `~~struck~~`
items with a short reason when dropped, and append a line to §7 Log every session. Update the phase status table
first — it is what a fresh agent (or you in three weeks) reads before touching anything.

Phase plan details: `PLAN.md`. Library rationale: `REWRITE_RESEARCH.md`.

---

## 1. Phase status

| Phase | Status | Gate (must be objectively true) |
| --- | --- | --- |
| 0 — spikes | ✅ **done 2026-10-26** | all 5 spikes green (0.1–0.5) |
| 1 — skeleton | 🟡 in progress | phone-usable; two tabs don't clobber; `npm run verify` green |
| 2 — backends | ⬜ not started | switch providers by config; adapter tests need no GPU |
| 3 — chat parity | ✅ done | `docs/PARITY.md` chat rows ☑ |
| 4 — cards/story | ⬜ not started | real v3 card + lorebook drives a scene and an image |
| 5 — images | ✅ done (verified on the GPU) | chat → `/image` → regenerate → inpaint, from the phone |
| 6 — hardening | ✅ done except legacy deletion (needs a week of use) | release zip starts with double-click |

Legend: ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked · ❌ dropped

---

## 2. Phase 0 — spikes (throwaway; delete branch after)

- [x] **0.1 Toolchain** — `sv create` (Kit **2.70.3**, Svelte 5, TS strict) in `rewrite/`, Tailwind 4 via
      `@tailwindcss/vite`, shadcn-svelte init + one `button`, `adapter-node 5.5.7`.
      *Pass:* `npm run dev` works, `npm run build` works, `node build` serves the page, one shadcn button renders.
      **✅ 2026-10-26** — verify green (svelte-check 0 errors, prettier+eslint clean, 1 test), `node build` serves
      HTTP 200, dark tokens applied, 3 shadcn button variants render. See §9 findings.
- [ ] **0.2 llama.cpp streaming** — `streamText(createOpenAICompatible({ baseURL: 'http://127.0.0.1:8081/v1' }))`
      → `Chat` from `@ai-sdk/svelte`.
      *Pass:* tokens stream; `stop` honoured; `min_p`/`top_k`/`repeat_penalty` visible in llama-server log;
      thinking suppressed via `chat_template_kwargs`; `/props` read server-side.
      **✅ 2026-10-26** — streamed a 52-token reply from `L3-8B-Stheno-v3.2` through the router in the browser.
      `stop` ✓, samplers + `chat_template_kwargs` proven in the request body by a no-GPU echo-server test
      (`src/lib/server/backends/llm/llamacpp.spec.ts`). **`/props` goal was wrong — see finding 11** (router mode
      returns no params); sampler source re-decided below.
- [x] **0.3 ComfyUI from Node** — `@stable-canvas/comfyui-client` vs 0.42.0: run `workflows/krea2_turbo_t2i.json`
      with injected prompt, WS progress, save `/view` bytes; then `/upload/image` + mask for inpaint.
      **✅ 2026-10-26** — krea2 768²/6 steps → 651 KB PNG in 28.5 s with live progress events; anima LLLite inpaint
      with uploaded source+mask → PNG. Opt-in test: `CHATCHAT_COMFY_SMOKE=1 npx vitest run src/lib/server/comfy`.
- [x] **0.4 SQLite + importer** — `node:sqlite` repo module, migrations, importer for existing `chats/`, FTS5 search.
      **✅ 2026-10-26** — schema v1 (chats/messages/generations/images/providers/app_meta + FTS5), 15 tests on
      `:memory:`, importer handles the legacy folder format and is idempotent. **The real `chats/` folder does not
      exist on this machine** (nothing to import), so the importer is validated against a synthetic fixture.
- [x] **0.5 LAN + token** — bind `0.0.0.0`, token gate in `hooks.server.ts`, phone over Tailscale.
      **✅ 2026-10-26** — loopback 200 / LAN IP 401 / `?token=` → 303 + HMAC cookie → 200; `curl -N` through the
      LAN IP: first byte 0.11 s, total 6.9 s, 40 SSE chunks (no buffering); full Chat round-trip in a real browser
      over `http://192.168.0.17:4173`.

---

## 3. Phase 1 — skeleton + documents

- [x] project created (spike 0.1) with `tsconfig` strict, eslint, prettier, vitest, `npm run verify` wired
- [x] `src/lib/shared/{chat,chat-request}.ts` zod schemas (story still `unknown` until Phase 4)
- [x] `src/lib/server/db/*` — migrations (schema v1), chats/messages/images repos, FTS5, 15 tests
- [x] `src/lib/server/db/import-legacy.ts` + `tools/import-legacy.ts` (`npm run import:legacy`); fixture-tested.
      **The real `chats/` folder does not exist on this machine** — nothing to import.
- [x] `src/routes/+page.*` chat list + `?/newChat` action; `src/routes/chat/[id]/*` transcript + composer
- [x] `POST /api/chat` persists both turns, auto-titles the chat from its first message, streams over LAN
- [x] `npm run doctor` (llama.cpp, ComfyUI, db, LAN token)
- [x] `CLAUDE.md` + `docs/{ARCHITECTURE,PARITY,DEPS,TROUBLESHOOTING}.md`
- [x] `.gitignore` for `rewrite/{node_modules,build,.svelte-kit}`
- [x] LAN token gate + HMAC cookie (spike 0.5), verified from a real browser over `192.168.0.17`
- [ ] **promote `rewrite/` to the repo root; move today's app to `legacy/`** — needs a human decision, it
      rewrites paths for `start-chatchat.bat` and the `.gitignore` rules
- [ ] sidebar shell + chat rename/delete (Phase 3 UI work)
- [ ] two-tab safety check (WAL is on; verify with two browsers before ticking)

## 4. Phase 2 — backends ✅ (2026-10-26)

- [x] `backends/llm/types.ts`: `LlmBackend` + `LlmCaps` (`llamacppSamplers`, `thinkingToggle`, `modelList`,
      `samplerDefaults: 'ini'|'props'|'none'`, `unload`)
- [x] `llamacpp.ts` — **`models-router.ini` parsing** (router mode's `/props` is useless), `/props` only as the
      single-model fallback, `chat_template_kwargs` gated by caps, **`/v1/chat/completions` only**
- [x] `openai-compat.ts` (OpenAI / OpenRouter / NanoGPT / any proxy) · `lmstudio.ts` (adds `/models/unload`)
- [x] **`fake-server.ts`** instead of a mocked SDK model: a real stub OpenAI-compatible HTTP server, so tests and
      `npm run dev:fake` exercise the production code path with no GPU
- [x] `config-store.ts` — `data/config.json` (mode 0600, atomic write, mtime cache, corrupt file preserved),
      **keys never leave the server**, `hasKey` instead
- [x] `backends/registry.ts` + `/api/providers`, `/api/providers/[id]`, `/api/settings`, `/api/models`, `/api/health`
- [x] `/settings` page: provider list, inline editor (blank key = keep stored key), test/model list, active switch
- [x] chat route: sampler precedence **ini → global → per-request**, provider from config not the browser
- [x] `npm run doctor` rewritten on top of the config store (inactive providers may be down; the active one may not)
- [x] tests: ini parser, config store (12), both adapters, and a **GPU-free integration test of `POST /api/chat`**
      (persistence, dedupe, sampler precedence, 404/400)
- [x] image backends — `comfy/client.ts` + `images/generate.ts` (Phase 5); OpenAI-images backend not planned
      spike 0.3, and there is nothing to assert without a GPU

## 5. Phase 3 — chat parity ✅ (except virtualisation, deliberately deferred)

- [x] `svelte-streamdown` markdown rendering (code copy, tables, math) — assistant messages markdown,
      user/system text verbatim; `streaming` flag stops it healing half-written blocks mid-stream
- [x] regenerate (`chat.regenerate({messageId})` → `regenerateMessageId`) + generation cycling (‹ › v2/3)
- [x] edit / delete message (`/api/messages/[id]`), with FTS kept in step
- [x] composer: autosize, Enter / Shift+Enter, Stop, disabled while streaming (`Composer.svelte`)
- [x] **Stop keeps the partial text**: `onChunk` accumulates, `onAbort` persists with `aborted: true`
- [x] scroll: stick-to-bottom + "jump to latest" when the reader scrolls up
- [x] per-message stats (model · seconds · tokens) stored in `messages.meta`
- [x] app shell: sidebar with chat list, rename (inline), delete, relative timestamps
- [x] idle VRAM unload after 10 min of inactivity, only for providers that can unload (LM Studio)
- [x] page titles per route
- [ ] virtualised transcript — **deferred on purpose**: no transcript on this machine is long enough to
      measure, and virtualising fights stick-to-bottom + streaming. Revisit when a real chat has 500+
      messages, with a measurement first.
- [ ] e2e automation (Playwright) — **needs a decision**: ~400 MB of browsers vs. the current
      route-level integration tests + manual browser checks

## 6. Phase 4 — characters / story / images / hardening

- [x] 4a `@lenml/char-card-reader` in `cards/parse.ts` — v1/v2/v3 PNG+JSON, lorebook normalisation,
      14 tests including a hand-built PNG with a `ccv3` tEXt chunk
- [x] 4b card library in `data/cards/` + `tools/import-cards.ts` (`npm run import:cards`) — imported the
      real library: 5 cards, 4 avatars, Seraphina's 4 lore entries intact
- [x] 4c card editor (`/characters/[id]`) — PATCH-based so a partial form cannot wipe fields;
      lorebook shown read-only for now
- [x] 4d `prompts/rp.ts` pure functions + 20 tests: `{{char}}`/`{{user}}`, character block, lorebook
      matching (constant/selective/insertion order/scan depth), token budget, greetings
- [x] chat wiring: a character chat builds the prompt **server-side from the card and the stored
      transcript**, so a browser cannot drop the system prompt or the lore
- [x] 4f lorebook **editing** in the card editor (keys, order, enabled/constant, add/remove)
- [x] 4g `/api/search` over FTS5 + a debounced search box in the sidebar (snippets, chat titles)
- [x] 4h appearance prefs: `{{user}}` name, content width, font size — config-backed, applied as CSS vars
- [x] 4e `prompts/scene.ts` — done in **Phase 5f**, where it has a consumer and tests
- [x] 4i story `look` editable from the chat header (persisted in `chats.story`, reused by scene prompts).
      A full scene-list panel is still open — the gallery is the record for now

### Phase 5 — images ✅ (verified on the GPU: 1024² lighthouse, then a 832×1216 scene, then an inpaint)

- [x] 5a workflow registry: `GRAPHS` + per-model defaults; graphs are `{{PLACEHOLDER}}` JSON
- [x] 5b progress streamed back on the POST itself (SSE `progress` → `done`/`error`); no job registry.
      Interrupt/queue-position/ETA intentionally not built — ComfyUI owns the queue and a local user is
      the only client.
- [x] 5c `data/images/<uuid>.<ext>` + `api/images/[id]` with Range + immutable cache; DELETE removes both
- [x] 5d viewport (arrows, seed, same-seed regenerate, delete), thumbnail strip, progress pill
- [x] 5e mask editor (canvas brush, `mix-blend-screen` so black stays invisible) → `/api/images/inpaint`
- [x] 5f `/image …` in the composer (never reaches the model) + "picture of this moment" (wide/medium/close)
      with `prompts/scene.ts`; `[[IMG: …]]` in a reply becomes a button instead of silent GPU work

### Phase 6 — hardening / packaging

- [x] 6a `/diagnostics` page (provider probes, ComfyUI, db schema, image folder) — a phone cannot run
      `npm run doctor`. Structured logs + toasts: deferred, inline errors cover the same ground today.
- [x] 6b installable PWA manifest + self-hosted icon + system font stack (no Inter download, no CDN)
- [x] 6c `start-chatchat.bat` (installs, builds when missing or `CHATCHAT_REBUILD=1`, LAN defaults) and
      `npm run release:zip` / `tools/release.bat` for the GitHub zip
- [x] 6d `THIRD_PARTY.md` (licence audit) + README rewrite
- [ ] 6e delete `legacy/` — **waiting on the user**: needs a week of real use first, and it is the only
      copy of the old app
- [ ] 6f in-app help walkthrough (`legacy/js/help.js`); `docs/TROUBLESHOOTING.md` + `/diagnostics` cover
      the same ground, so this is polish
- [ ] 6g service worker for full offline install (manifest only today)

---

## 7. Log

Newest first. One line per session: what moved, what broke, what's next.

- **2026-10-27 (later, 10)** — **desktop UI/UX pass.** Rewrote the shell, sidebar, chat transcript, composer,
  settings, home, characters, images and login against one design system in `src/app.css` (named type scale
  `text-label`/`text-ui`/`text-title`/`text-display`, 18px/72ch reading defaults, four named animations,
  `prefers-reduced-motion`, thin scrollbars, themed sliders). Everything below 13px is gone. Chat is now flat
  messages with a role gutter + tinted user turns (was a bordered card per turn); per-message actions are
  icon buttons on hover, `hover-none:` visible on touch. New primitives: `IconButton`, `ConfirmDialog`
  (replaces every `window.confirm()`), `Toaster` + `stores/toast.svelte.ts`. Indicators: backend status dot,
  queued dots → streaming caret + `Stop` → dismissible error banner, `v2/3` version chip, ResizeObserver
  scroll pinning with a `Jump to latest` pill, docked composer with a live hint row, in-place title rename,
  `Look` popover, live reading preview in settings. `appConfigSchema` defaults are now `fontSize: 18`,
  `contentWidth: 72`. Docs: new `docs/UI.md`; CLAUDE.md gotchas + `docs/UI.md` §6 cover the
  `@tailwindcss/forms` blue ring, `class:`-cannot-contain-`/`, and the icon-button accessible-name rule that
  broke `chat.spec.ts` (sidebar "Rename chat" matched `{ name: 'chat' }`). `npm run verify` green (112 tests),
  e2e 8 passed / 2 skipped. Not done: the sidebar is still a fixed 240px column on a phone (a drawer would be
  the next mobile win, but it moves the `New chat` button out of the mobile DOM and needs the e2e selector
  updated with it).

- **2026-10-27 (later, 9)** — **story `look` editor + final verification.** Chat header now edits the
  scene `look` (PATCH `story`, merged not replaced); `/api/images/scene` reads it, so a second picture
  matches the first without retyping. Verified live: PATCH → scene prompt contains the look. `npm run
  verify` green (112 tests), 8 e2e green (2 viewport-specific skips), `node build` serves `/` and
  `/diagnostics`. Stopped ComfyUI, llama-server and the app afterwards to free the GPU.
- **2026-10-27 (later, 8)** — **Phase 5 ✅ + Phase 6 ✅ (except deleting `legacy/`).** GPU was free, so the
  whole image path was verified for real: `/image a lighthouse at dusk` → **1.13 MB 1024² PNG in ~40 s**
  (llama-server resident), a 832×1216 "picture of this moment" from scene tags, and an inpaint through
  `/api/images/inpaint`. Built: `images/generate.ts`, `images/store.ts`, SSE progress on the POST,
  `api/images/[id]` (Range + immutable), thumbnail strip, full-screen viewport, mask editor, `/image`
  command, `[[IMG: …]]` → button, `prompts/scene.ts` (7 tests). Phase 6: `/diagnostics` page, PWA manifest
  + icon, `THIRD_PARTY.md`, `release:zip`, bat rebuild flag. GPU-free coverage: **`fake-comfy.ts`** (real
  HTTP stub) so the image pipeline is tested in `npm run verify` — 112 tests, plus 8 e2e (one new: `/image`
  must not reach the model). Next: use it for a week, then delete `legacy/` (6e) and add the help walkthrough.
- **2026-10-27 (later, 7)** — **repo reshuffle ✅, Playwright e2e ✅, Phase 4 finished.**
  The rewrite is now the repo root (`rewrite/` is gone), the old app lives in `legacy/` with its own
  `start-chatcchat.bat` equivalent (`legacy/start-legacy.bat`), and a new root `start-chatchat.bat` installs,
  builds and runs with LAN defaults. `tools/import-*` now read `./legacy`. Playwright added: 7 e2e specs
  (desktop + Pixel 7) against the stub LLM, run in ~17 s via `npm run test:e2e`. Finished Phase 4: FTS5 search
  with a sidebar search box, lorebook editing in the card editor, appearance prefs (user name, width, font
  size as CSS vars). `npm run verify` green (97 tests) and e2e green. Next: Phase 5 (images) — the store/queue/
  viewport work needs no GPU, only the two smoke tests do.
- **2026-10-27 (later, 6)** — **Phase 3 chat parity ✅ + Phase 4a–4d ✅** (GPU-free: the user had the GPU).
  Phase 3: Streamdown markdown, regenerate with generation cycling, edit/delete, composer with Stop,
  **partial replies survive Stop**, stick-to-bottom scroll, per-message stats, sidebar shell with
  rename/delete, idle VRAM unload, page titles. Phase 4a–4d: card parsing (v1/v2/v3 PNG+JSON, lorebooks),
  `data/cards/` storage, the **real** library imported (5 cards, 4 avatars), card library + editor UI,
  `prompts/rp.ts` (20 tests) and server-side character prompt assembly so the browser cannot drop the
  card's system prompt. Verified in the browser over the LAN with the stub provider: Seraphina chat opens
  with her greeting and replies with the card's system prompt + lore in place. `npm run verify` green
  (95 tests). Next: 4e story/scene, or Phase 5 images (needs the GPU for the smoke test only).
- **2026-10-26 (later, 5)** — **Phase 2 backends ✅**. `LlmBackend` + `LlmCaps`, llama.cpp (ini samplers,
  `/props` fallback), OpenAI-compatible, LM Studio (unload), `fake-server.ts` (stub HTTP LLM → GPU-free tests and
  `npm run dev:fake`), `config.json` store with 0600 + atomic writes + keys never leaving the server, registry,
  five API routes, a `/settings` page, and a GPU-free integration test of the chat route. Verified in a browser on
  the LAN with the stub provider: streaming, model picker, provider switch persisted. `npm run verify` green
  (49 tests). Next: Phase 3 (markdown, regenerate, edit/branch, composer, virtualised transcript).
- **2026-10-26 (later, 4)** — **Phase 1 walking skeleton ✅** (except the repo reshuffle). DB-backed chat list,
  new-chat action, chat route with streaming + persistence (verified: reply survived a reload), auto-title,
  `npm run doctor`, the four `docs/` files, `CLAUDE.md` updates. `npm run verify` green (17 tests).
  Next: promote `rewrite/` → root (needs a decision), or start Phase 2 (provider adapters).
- **2026-10-26 (later, 3)** — **Phase 0 complete.** 0.3 ComfyUI (krea2 t2i + anima inpaint via
  `@stable-canvas/comfyui-client`, progress over WS, `/view` bytes), 0.4 SQLite (`node:sqlite`, schema v1, FTS5,
  importer + 15 tests), 0.5 LAN+token (HMAC cookie, verified over `192.168.0.17`, streaming 0.11 s first byte).
  Added `npm run doctor`. Next: Phase 1 (skeleton: shared schemas → chat list → chat route).
- **2026-10-26 (later, 2)** — **spike 0.2 ✅**. `ai@7.0.154` + `@ai-sdk/openai-compatible` + `@ai-sdk/svelte`
  wired: `src/lib/server/config.ts`, `src/lib/shared/chat-request.ts` (zod), `backends/llm/llamacpp.ts`,
  `routes/api/chat/+server.ts`, `routes/spike/llm/*`. Proved live streaming through the **router** (`chat_image.bat`
  args) and proved sampler/thinking fields reach the wire with a no-GPU echo test. Decisions: **images → `data/images/`
  + DB metadata**; **samplers come from parsing `models-router.ini`**, not `/props` (finding 11). Next: **0.3**
  (ComfyUI from Node) — needs ComfyUI up on :8188.
- **2026-10-26 (later)** — **spike 0.1 ✅**. `rewrite/` created: Kit 2.70.3 + adapter-node 5.5.7 + Vite 6.4.5 +
  Svelte 5 + TS 5.9.3 strict + Tailwind 4 + shadcn-svelte (zinc). `npm run verify` green, `node build` serves,
  dark theme renders. `rewrite/CLAUDE.md` drafted. Next: **0.2** (stream llama.cpp through AI SDK 7).
- **2026-10-26** — research + plan written (`REWRITE_RESEARCH.md`, `PLAN.md`). Decisions: Kit 2.70.3 (not Kit 3,
  corpus lag), AI SDK 7 behind `LlmBackend`, `@stable-canvas/comfyui-client` (official SDK needs a v2 proxy),
  `node:sqlite` (verified FTS5/WAL on Node 24.19), `svelte-streamdown`, `@lenml/char-card-reader`.
  Found: `index.html` still loads Inter from Google Fonts (breaks the no-CDN promise); ComfyUI 0.42.0 has
  `/api/jobs` but no `/api/v2`. Started spike 0.1.
- **next** — finish 0.1, then 0.2 (llama.cpp streaming + samplers), 0.3 (ComfyUI), 0.4 (SQLite importer), 0.5 (LAN).

---

## 8. Open decisions

- [x] Kit 2.70 vs Kit 3 — **spike 0.1 confirms 2.70 works**; keep 2.70 unless a Kit 3-only feature is needed.
- [x] images: **`data/images/` + DB metadata** (decided 2026-10-26). Bytes on disk, rows in SQLite, served by
      `api/images/[id]` with `Cache-Control`/`Range`. `chats/images/*.bin` is imported once and then retired.
- [ ] sampler autopilot source (new, from finding 11): **parse `models-router.ini`** (recommended; path in config,
      fall back to built-in defaults) vs per-model table in our own config vs scraping the child-server port.
- [ ] keep `nano-gpt` provider? (only if actually used)
- [ ] keep `local-image-server/` (Python/MLX) as a backend adapter, or drop from the rewrite?

---

## 9. Findings from spike 0.1 (toolchain gotchas — save the next agent the hour)

1. **`sv@1.1.1 create` always scaffolds SvelteKit 3** (`kit ^3`, `adapter-node ^6`, Vite 8, config inside
   `vite.config.ts`, `#lib` imports, `tsconfig` extends `$app/tsconfig`). Downgrade recipe that worked:
   pin `@sveltejs/kit@2.70.3` + `@sveltejs/adapter-node@5.5.7` + `vite@6.4.5` + `@sveltejs/vite-plugin-svelte@^5.1.1`,
   add `svelte.config.js` (preprocess + adapter), revert `vite.config.ts` to `plugins: [tailwindcss(), sveltekit()]`,
   `tsconfig.json` extends `./.svelte-kit/tsconfig.json`, drop the `#lib` imports map, `#lib/…` → `$lib/…`.
   Kit 2.70's peer range accepts Vite 6–8 and plugin-svelte 5–7, so this is a supported combination.
2. **`shadcn-svelte@1.7.1 init` cannot be automated**: it demands a *preset code* (a base62 blob the website
   generates); `--preset default` is rejected and it falls back to an interactive prompt. Working path (used here):
   write `components.json` by hand, fetch the palette from
   `https://shadcn-svelte.com/registry/colors/<zinc|neutral|…>.json`, generate `src/app.css` from its `cssVars`
   (`:root` + `.dark` + `@theme inline` + `@layer base`), add `src/lib/utils.ts` with `cn()` **plus** the registry's
   `WithElementRef` / `WithoutChild(ren)` type helpers, install `tailwind-variants clsx tailwind-merge tw-animate-css`
   and `@lucide/svelte`, then `npx shadcn-svelte@latest add <component> --yes` works normally.
3. **`prettier-plugin-tailwindcss`** needs `tailwindStylesheet: './src/app.css'` — the template still points at
   `src/routes/layout.css` (which we moved), and prettier fails with ENOENT otherwise.
4. **Vendored shadcn components trip lint**: `ui/button/button.svelte` fails `svelte/no-navigation-without-resolve`.
   Rule is disabled for `src/lib/components/ui/**` (regenerating a component must not break the build).
5. **npm 11 gates install scripts**: `esbuild` postinstall is warned about by `allow-scripts`. Build worked anyway,
   but a fresh download on another machine may not — decide in Phase 6 (`npm approve-scripts esbuild` or ship a
   resolved lockfile + `allowScripts` config).
6. **Windows process hygiene**: `pkill` does not kill Windows nodes. Use
   `netstat -ano | grep :PORT` then `taskkill //PID <pid> //F`. A stale server on the test port silently serves an
   **old build** and makes a good build look broken.
7. `curl` is blocked by a hook unless output goes to a file: `curl -s -o /tmp/x.html -w '%{http_code}' URL`.

### Spike 0.2 additions (AI SDK 7 + llama.cpp router)

8. **`convertToModelMessages` is async in AI SDK 7** (`Promise<ModelMessage[]>`). Forgetting `await` fails with
   `messages.some is not a function` / `AI_NoOutputGeneratedError`. Docs examples still show it sync.
9. **`providerOptions: { [providerName]: {…} }` is spread verbatim into the request body** — proven by
   `src/lib/server/backends/llm/llamacpp.spec.ts` (local echo server, no GPU): `top_k`, `min_p`, `repeat_penalty`,
   `chat_template_kwargs`, and `stop` all arrive. `transformRequestBody` on the provider is the fallback hook if a
   future version stops spreading. Keep that test — it is the cheapest regression guard in the repo.
10. **`@ai-sdk/svelte` API (v5.0.154)**: `Chat` extends `AbstractChat` and takes `ChatInit`; you must pass
    `transport: new DefaultChatTransport({ api, body })`. Read `chat.status` / `chat.messages` — **destructuring
    (`let { messages } = chat`) snapshots the getter and kills reactivity**.
11. **⚠️ Router mode has no usable `/props`.** `GET :8081/props` always returns
    `{role:"router", model_path:"none", default_generation_settings:{params:null,n_ctx:0}}`, and `?model=<id>` is
    ignored (200 but same body). The **child** server on a random port (seen: `53418`) *does* expose the full preset
    sampler set (`temperature 1.17, top_k 50, min_p 0.075, repeat_penalty 1.1` — i.e. exactly what
    `models-router.ini` says). The old app's "read sampler defaults from `/props`" only ever worked against a
    single-model `start-llama.bat` server. **Phase 2 decision: parse `models-router.ini` server-side** (stable,
    no port discovery), with built-in defaults as fallback.
12. **Svelte gotcha**: a `/** … */` block placed *above* `<script>` in a `.svelte` file is rendered as page text;
    and nesting a comment terminator inside a header comment breaks the parse (90 bogus TS errors). Use `//` header
    lines inside `<script>`.
13. Browser verification: `snapshot -i` lists only interactive refs — rendered text needs `get text <sel>` or
    `wait --fn "() => …"`. `wait --text` is case-sensitive (`ASSISTANT`, not `assistant`).
14. Windows: Node scripts do not understand msys `/tmp/...` (`E:\tmp\...` instead); read such files with bash tools.
15. Process hygiene bit twice: a stale server on the test port serves an **old build**. Always
    `netstat -ano | grep :PORT` → `taskkill //PID <pid> //F` before starting a new one.

### Spikes 0.3–0.5 additions

16. **`fillGraph` must recurse into nested objects**, not just arrays: ComfyUI node inputs are objects
    (`{image: '{{INIT_IMAGE}}'}`) and link tuples. A shallow fill silently ships `{{VAE}}` to ComfyUI, which answers
    `400 prompt_outputs_failed_validation` — the *only* useful error message it gives. Our `fillGraph` now throws on
    any unfilled placeholder before the request leaves the process.
17. **ComfyUI progress needs the websocket.** `waitForPrompt()` alone polls and reports nothing; call
    `await client.connect({ websocket: { enabled: true } })` first. (The option shape is nested objects, not booleans.)
18. **`queuePrompt` returns either `{prompt_id}` or an error shape** — check `'prompt_id' in queued` before use.
19. **`node:sqlite` rows are `Record<string, SQLOutputValue>`**, so every read needs one cast. `db/index.ts` exposes
    `allRows<T>()` / `oneRow<T>()` so the cast lives in one place (`as unknown as T[]`). Also: the type is
    `SQLInputValue`, **not** `SupportedValueType`.
20. **SvelteKit `handle` cannot set cookies via `event.cookies` if it returns its own `Response`** — the framework
    serialises cookies only on responses it builds. Set `set-cookie` by hand (and note: throwing `redirect()` from
    `handle` also dropped it in this version).
21. **adapter-node reports `event.url.protocol === 'https:'` for plain http requests**, so a `Secure` cookie is
    emitted and then silently rejected by the browser — which looks exactly like "the login form does nothing".
    The LAN cookie is deliberately not `Secure`.
22. **ComfyUI must be started before llama-server** on an 8 GB card (it claims its CUDA context first);
    `chat_image.bat` already does this. Both were stopped after the spikes — VRAM is free.

### Phase 1 additions

23. **adapter-node defaults the request protocol to `https`** (`get_origin` in the adapter's handler) when
    `PROTOCOL_HEADER` is unset, and `host` comes from the Host header. Consequence: on `http://<lan-ip>:4173`
    SvelteKit's built-in CSRF check compares against `https://<lan-ip>:4173` and rejects every form POST with
    "Cross-site POST form submissions are forbidden". Fix used: `kit.csrf.checkOrigin: false` + our own
    `Origin` vs `Host` check in `hooks.server.ts`.
24. Same root cause broke `Set-Cookie`: `Secure` was added on plain http and the browser dropped the cookie.
    The LAN cookie is deliberately not `Secure`.
25. `svelte/no-navigation-without-resolve` is an **error** in this config: internal links must be
    `resolve('/chat/[id]', { id })` from `$app/paths`, not template strings.
26. `tsconfig` needed `target`/`lib` at **ES2023** for `Array.findLast` types (used in the chat route).
27. A `+page.server.ts` load that takes no arguments must be `() => …`, not `({}) => …`
    (`no-empty-pattern` lint error).

### Phase 2 additions

28. **A stub HTTP server beats a mocked SDK model.** `ai/test`'s mock language models are version-specific
    (`LanguageModelV4` chunk shapes) and would need care on every SDK bump; a 200-line stub that speaks
    `/v1/models` + `/v1/chat/completions` SSE tests *our* adapter code instead of the SDK's mock plumbing, and the
    same server powers `npm run dev:fake`. Side effect: the chat route, persistence and UI are now testable with
    no GPU at all.
29. **Counting words, not bytes:** the UI message stream JSON-escapes each delta, so `await response.text()`
    never contains a whole sentence. Tests must reassemble `text-delta` chunks (see `chat-route.spec.ts`).
30. `chmod 0o600` on Windows reports `-rw-r--r--` — mode bits are advisory there. The file is still
    owner-scoped by NTFS ACLs from the user profile; do not treat the mode check as portable.
31. **Inactive providers are supposed to be down.** `doctor` only fails when the *active* provider is
    unreachable, otherwise a stopped LM Studio would make every run red.
32. Svelte 5 warns "This reference only captures the initial value of `data`" when seeding local state from a
    load value; `untrack(() => data.model)` is the documented silence, not `$effect`.
33. `kit.csrf.checkOrigin: false` is **deprecated** in 2.70 in favour of `csrf.trustedOrigins`, which cannot express
    "any LAN IP". The warning is noise for now; revisit when Kit 3's `paths.origin` lands.

### Phase 3–4 additions

34. **AI SDK 7 refuses system messages inside `messages`** ("Use the instructions option instead") and
    silently turns the failure into a stream error. Character prompts need the post-history block *after*
    the transcript, so the route sets `allowSystemInMessages: true`; llama.cpp templates handle a trailing
    system turn, and SillyTavern sends prompts the same way. Do not remove that flag without re-testing a
    character chat.
35. `toUIMessageStreamResponse()` defaults every failure to "An error occurred." Always pass
    `onError` — otherwise a broken prompt looks like a hung model.
36. `chat.messages` is a **getter/setter pair** on the AI SDK chat, not `setMessages()`.
37. A form action lives on *its own route*: a form in `/characters` must post to `/?/newChat`, not
    `?/newChat` (which 405s). Same for the card editor.
38. Hover-only affordances are unusable on a phone and unclickable for automation. **Superseded by the
    desktop UI pass:** actions are `opacity-0`, revealed by `group-hover` / `group-focus-within`, and
    forced visible on touch by the `hover-none:` variant. Playwright can click `opacity-0` (it only skips
    `display:none` / `visibility:hidden`), so the reveal is cosmetic for automation. Do not go back to a
    permanent 40% opacity smear on every row.
39. `AbortController` on the fetch is not enough: `streamText` must receive `abortSignal: request.signal`
    or Stop leaves the model generating into the void and no partial text is saved.

### Reshuffle + e2e additions

40. **Deriving the `Chat` instance from page data rebuilds it on every `invalidateAll()`.** Seed from the
    server load *once*, keep the instance, and pull the canonical transcript back explicitly after
    edits/retries. A rebuild that lands before the server has committed the reply makes the reply vanish
    from the screen while it is safely in the database.
41. **Server-owns-the-id:** pass `generateMessageId` to `toUIMessageStreamResponse()` and persist the
    assistant row with that same id, otherwise the streamed message and the stored message are two
    different messages and version arrows/stats silently point at nothing.
42. **e2e must wait for the stream to finish** (`response.finished()`), not for text to appear: the client
    renders the last token before the server commits the row. Assert on the transcript container, which
    exists before the first token, not on a message element that may not be attached yet.
43. Playwright's `response.text()` in a `page.on('response')` listener **consumes the body** and starves
    the page's own reader — a debugging listener can turn a passing test into a failing one.
44. Prettier/eslint must ignore `legacy/`, `workflows/`, `_notes/`; otherwise `npm run verify` reports
    hundreds of files nobody intends to reformat.
45. Putting a literal `{{user}}` in Svelte markup is a parse error — write it as `<code>user</code>` or use
    a string expression.
