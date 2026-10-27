# chatchat rewrite — build plan (LLM-maintainable first)

_Supersedes the phase list in `REWRITE_RESEARCH.md` §5. Companion notes: `REWRITE_RESEARCH.md` (why these libraries)._

The plan below is ordered by one extra requirement added on 2026-10-26: **an LLM agent should be able to read,
change, and verify this codebase without human translation.** That constraint changes several picks from the
research doc — those are flagged **[revised]**.

---

## 0. Decisions locked

| Area | Decision | Note |
| --- | --- | --- |
| Framework | **SvelteKit 2.70.3 + adapter-node 5.5.7 + Svelte 5 + Vite 6** | **[revised]** from Kit 3.1 — see §1.4 |
| Language | TypeScript, `strict: true`, `checkJs` on for anything ported | compiler = free agent review |
| LLM transport | `ai@7` + `@ai-sdk/openai-compatible` + `@ai-sdk/svelte`, behind our own `LlmBackend` | pinned exactly |
| Image transport | `@stable-canvas/comfyui-client` server-side | official SDK needs a Python proxy |
| Storage | `node:sqlite` (WAL) + hand-written SQL, images on disk | ORM omitted deliberately |
| UI | shadcn-svelte + bits-ui + Tailwind 4 | copy-in components (agent-readable source) |
| Markdown | `svelte-streamdown` | |
| Cards | `@lenml/char-card-reader` | incl. lorebooks |
| Tests | vitest (unit + fixtures) + playwright (e2e) against **fake backends** | verifiable with no GPU |
| Browser↔backend | **never** direct; all backends behind `+server.ts` | one invariant, easy to check |

---

## 1. The LLM-maintainability rubric

Every technical choice is scored on these six axes. Record the score when something new is proposed.

1. **Type feedback** — does a wrong edit fail `npm run check`, or fail silently at runtime?
2. **Corpus presence of the *pinned version*** — does the model already know this API? Kit 3 / AI SDK 7 / Svelte 5
   are all cases where training data lags; the answer is *pin + write the local delta doc*, not "hope".
3. **Blast radius** — how many files does a typical change touch? Lower wins even when it costs duplication.
4. **Verifiability without the GPU** — can an agent prove the change works with `npm run verify` on a laptop with
   no llama.cpp and no ComfyUI running?
5. **Greppability** — can you find the answer by searching one symbol, one route, one table name?
6. **Literalness** — plain functions, plain SQL, plain objects. No decorators, no DI container, no barrel files,
   no metaprogramming, no clever generics.

### 1.1 Coding rules (these go in `CLAUDE.md`, not just in your head)

- **150–350 lines per file, one concept per file**, named after the concept (`llamacpp.ts`, not `utils2.ts`).
- **No barrel/index re-export files.** They hide where a symbol lives and break grep. Import the real path.
- **Explicit duplication beats premature abstraction.** Three ~120-line backend adapters that each read plainly are
  better than one generic adapter + config. Cap: duplicate up to ~25 lines before extracting.
- **One source of truth for shapes**: `src/lib/shared/*.ts` zod schemas. Server and client both import them.
  An agent cannot invent a message shape that "mostly works".
- **Data lives in data files, not code**: `workflows/*.json`, `data/cards/index.json`, `model-overrides.json`.
  Tables that ship inside `.ts` are hostile to diff review.
- **No `fetch` in components**, no `$effect` for derivable state, no new module-level `let` that is mutated across
  files. (These are the three habits that produced today's codebase.)
- **Every rule above has a lint or a test** where that is cheap: `eslint` `no-restricted-imports` for
  `$lib/server/**` in components, a vitest "no global mutation" check is overkill — instead the PR checklist says it.

### 1.2 Documentation set (small, mandatory, agent-facing)

| File | Contents | Why an agent needs it |
| --- | --- | --- |
| `CLAUDE.md` | 1 page: stack, invariants, **where to change what** index, banned patterns, verify commands | every agent session reads this first |
| `docs/ARCHITECTURE.md` | data flow diagram (browser → route → backend → db), 1 page | prevents invented layers |
| `docs/PARITY.md` | checklist of today's features with `legacy/js/<file>` reference + status | the port is mechanical, not creative |
| `docs/DEPS.md` | each dep: why, pinned version, **one worked code example of the pinned API** | defeats training-data lag |
| `docs/TROUBLESHOOTING.md` | symptom → probe → fix (ports, CORS, props, model eviction) | stops the agent from guessing |

### 1.3 Verify harness (the single most important artifact)

```
npm run verify   # svelte-check && eslint && vitest run   (must pass before any phase is "done")
npm run e2e      # playwright against fake backends
npm run doctor   # probes llama.cpp /props, ComfyUI /system_stats, db, port, LAN address
```

Fake backends make 90% of the app testable with zero hardware:
`src/lib/server/backends/llm/fake.ts` (canned token stream, scriptable delay/error) and `.../image/fake.ts`
(writes a fixture PNG, emits fake progress). Selected by `provider= fake` in the test config only.

### 1.4 Why this reverses the Kit 3 recommendation

Kit 3.1 shipped 2026-10-01. Nobody's training data contains it, the migration guide is three weeks old, and
shadcn-svelte's own setup docs still describe `$lib`. An agent editing a Kit 3 app will confidently emit Kit 2
idioms (`svelte.config.js`, `$lib`, `ORIGIN` env) every session — that is a permanent tax on exactly the
maintenance model you want. Kit 2.70 + adapter-node 5.5.7 are the versions every model, every tutorial and every
component library doc agrees on. Migration later is one command (`npx sv migrate sveltekit-3`).

**Mitigation if you prefer Kit 3 anyway:** still viable, but `docs/DEPS.md` must then contain the four Kit 3 deltas
(`#lib` + file extensions, config in `vite.config.ts`, `kit.paths.origin`, adapter-node 6) and *every* agent task
must start with a Kit-3 sanity read. I would not choose that fight during a rewrite.

---

## 2. Repo layout (designed for grep)

```
chatchat/
  CLAUDE.md                     docs/{ARCHITECTURE,PARITY,DEPS,TROUBLESHOOTING}.md
  svelte.config.js  vite.config.ts  tsconfig.json  eslint.config.js
  src/
    routes/
      +layout.svelte            # sidebar + theme
      +page.svelte              # hero
      chat/[id]/+page.svelte    # transcript, composer, image rail
      settings/+page.svelte
      api/llm/+server.ts        # streamText -> UI message stream
      api/images/[id]/+server.ts
      api/comfy/progress/+server.ts
      api/health/+server.ts
    lib/
      shared/                   # zod schemas + types ONLY (no logic, no imports from server)
        chat.ts  message.ts  story.ts  settings.ts  backend.ts
      server/
        db/index.ts  db/migrations.ts  db/chats.ts  db/messages.ts  db/images.ts  db/search.ts
        backends/llm/{types,index,llamacpp,openai-compat,lmstudio,fake}.ts
        backends/image/{types,index,comfyui,openai-images,fake}.ts
        comfy/{client,workflows,progress}.ts
        prompts/{assemble,rp,scene}.ts
        config.ts  auth.ts  doctor.ts
      components/chat/*.svelte  components/cards/*.svelte  components/image/*.svelte
      components/settings/*.svelte  components/ui/*.svelte        # shadcn copies
  data/            # gitignored: chatchat.db, images/, cards/, exports/
  legacy/          # today's app, READ-ONLY reference for porting
```

**`CLAUDE.md` "where to change what" index** (this table is the whole navigation layer — keep it current):

| Task | Touch |
| --- | --- |
| Add an LLM provider | `backends/llm/<new>.ts` + one line in `backends/llm/index.ts` + `shared/backend.ts` enum |
| Change a sampler default | `server/config.ts` (defaults) / `backends/llm/llamacpp.ts` (`/props` merge) |
| Change prompt assembly | `server/prompts/rp.ts` (+ `rp.test.ts`) |
| Add an image workflow | `workflows/<name>.json` + `comfy/workflows.ts` mapping |
| Change DB shape | `db/migrations.ts` (append-only, bump `user_version`) |
| Change a message shape | `shared/message.ts` — then `npm run check` finds every caller |
| Change styling | component's own `<style>`/Tailwind classes, `app.css` tokens only |

---

## 3. Phases

Each phase ends with **`npm run verify` green + parity checklist rows updated + one line in `docs/DEPS.md` if a
dependency was added.** A phase is not done because the feature "works on my machine".

### Phase 0 — spikes (each ≤150 lines, throwaway branch, delete after)

| # | Spike | Pass condition | Fallback |
| --- | --- | --- | --- |
| 0.1 | `sv create` (Kit 2.70, TS, tailwind) + shadcn-svelte init + adapter-node 5.5.7 | `npm run dev`, `npm run build`, `node build` all work; one shadcn button renders | Kit 3 + docs delta |
| 0.2 | `streamText(createOpenAICompatible({baseURL:'http://127.0.0.1:8081/v1'}))` → `Chat` in a Svelte component | tokens stream; `stop` honoured; `min_p`/`top_k`/`repeat_penalty` reach llama-server (check its log); thinking suppressed via `chat_template_kwargs`; `/props` read server-side | hand-rolled SSE `LlmBackend` |
| 0.3 | `@stable-canvas/comfyui-client` from Node against 0.42.0: run `workflows/krea2_turbo_t2i.json` with an injected prompt, WS progress, save `/view` bytes; then `/upload/image` + mask for inpaint | image on disk + progress events; inpaint graph completes | port `legacy/js/comfy.js` to TS as-is |
| 0.4 | `node:sqlite` repo module + importer for the existing `chats/` folder + FTS5 search | every existing chat imports losslessly; boot no longer needs `GET /api/all` | `better-sqlite3` via same module |
| 0.5 | LAN: bind `0.0.0.0`, token gate in `hooks.server.ts`, phone over Tailscale, streaming while a long answer generates | phone streams with no buffering; 401 without token | Tailscale-only + loopback |

**Gate 0:** all five green. Any red → change the corresponding library now, not in Phase 3.

### Phase 1 — skeleton + the two documents that keep it maintainable
- [ ] create project (0.1 output), `tsconfig` strict, eslint, prettier, vitest, `npm run verify` wired
- [ ] `shared/{chat,message,story,settings}.ts` zod schemas (ported from today's implicit shapes)
- [ ] `db/migrations.ts` (chats, messages, generations, story, images, providers, meta) + FTS5
- [ ] `db/chats.ts`, `db/messages.ts` with tests
- [ ] importer `tools/import-legacy.mjs` (0.4) — **run it on your real `chats/` before writing any UI**
- [ ] layout: sidebar chat list (query via `+page.server.ts` load), chat route, composer
- [ ] one hardcoded provider end-to-end (`api/llm/+server.ts` → `Chat`)
- [ ] `CLAUDE.md` + `docs/ARCHITECTURE.md` + `docs/PARITY.md` (skeleton filled in) + `docs/DEPS.md`
- [ ] `legacy/` moved to read-only; `.gitignore` for `data/`
- **Done when:** send + receive on the phone over Tailscale; two tabs don't clobber; `npm run verify` green.

### Phase 2 — backend layer (the boundary everything else leans on)
- [ ] `backends/llm/types.ts`: `LlmBackend` interface + capability flags (`samplers`, `prefill`, `thinking`, `vision`, `modelList`, `props`)
- [ ] `llamacpp.ts` (samplers from `/props`, `chat_template_kwargs`, router aliases, `/v1/chat/completions` only)
- [ ] `openai-compat.ts` (OpenAI, OpenRouter, nano-gpt), `lmstudio.ts`, `fake.ts`
- [ ] `backends/image/types.ts` + `comfyui.ts` (graphs from `workflows/`) + `openai-images.ts` + `fake.ts`
- [ ] `server/config.ts`: provider registry + secrets in `data/config.json` (0600); **keys leave `localStorage`**
- [ ] `api/health/+server.ts` + `server/doctor.ts` + `npm run doctor`
- [ ] golden fixtures: recorded request bodies → adapter output, asserted in `*.test.ts`
- **Done when:** switching llama.cpp → LM Studio → cloud is one config change; adapter tests run without hardware.

### Phase 3 — chat parity
- [ ] `svelte-streamdown` rendering + code copy + KaTeX opt-in; drop marked/hljs/DOMPurify where possible
- [ ] regenerate + generation cycling (port `legacy/js/generations.js`), edit/delete/branch message
- [ ] composer: autosize, Enter/Shift+Enter, stop button, disabled-while-streaming, quick actions
- [ ] scroll: stick-to-bottom, "jump to latest", per-message gen stats
- [ ] virtualized transcript (`@tanstack/svelte-virtual`) once a chat exceeds N messages
- [ ] e2e: streaming, regenerate, multi-tab, phone viewport — all against `fake.ts`
- **Done when:** `docs/PARITY.md` chat rows all ☑ and a side-by-side with `legacy/` on a real chat shows nothing missing.

### Phase 4 — characters, cast, story, lorebook
- [ ] `@lenml/char-card-reader` in `cards/parse.ts` (+ tests with a v2 and a v3 fixture PNG, no network)
- [ ] card library on disk `data/cards/` + `tools/sync-cards.js` (keep, but write JSON not JS)
- [ ] card editor (port `legacy/js/cardeditor.js`), cast picker
- [ ] `prompts/rp.ts`: pure functions + tests first, ported from `legacy/js/rp.js`; then wire it
- [ ] `story` as a zod-validated JSON column + `prompts/scene.ts` (port `sceneprompt.js`)
- [ ] **lorebook / world-info** support (new capability via `CharacterBook`)
- **Done when:** a real v3 card + lorebook imports, plays, and drives an image; `docs/PARITY.md` story rows ☑.

### Phase 5 — images
- [ ] workflow registry: typed node maps for the 5 graphs in `workflows/` (+ `sync-workflows.js` emits JSON)
- [ ] queue + progress SSE (`api/comfy/progress`), interrupt, queue position, ETA from remembered durations
- [ ] image store on disk + `api/images/[id]` (Range, immutable cache), prune
- [ ] image viewport (port `imageview.js`), regenerate, size/steps/LoRA controls
- [ ] inpaint: mask editor + `/upload/image` + LLLite graph
- [ ] `/image` command + scene→prompt (`prompts/scene.ts`)
- **Done when:** chat → `/image` → picture → regenerate → inpaint, all from the phone.

### Phase 6 — hardening, packaging, deletion
- [ ] error boundaries + toasts; structured logs; `api/health` surfaced on a diagnostics page
- [ ] PWA (manifest, icons, cached shell); self-hosted Inter (kill the Google Fonts tag)
- [ ] `docs/TROUBLESHOOTING.md` written from real failures encountered in Phases 1–5
- [ ] packaging: esbuild-bundle `build/index.js` → `server.mjs` + `start-chatchat.bat` (option 2 in research §5);
      release zip for "just try it"
- [ ] GPL headers + `THIRD_PARTY.md`; README rewrite
- [ ] delete `legacy/` only after `PARITY.md` is fully ☑ and one week of real use

### Effort
0: 2–4 evenings · 1: 3–4 · 2: 4–6 · 3: 6–8 · 4: 5–7 · 5: 8–12 · 6: 4–5. Phases 0–2 are the ones that decide
whether the rest is pleasant; if you stall, stall there rather than mid-Phase 5.

---

## 4. Risks (updated)

| Risk | Mitigation |
| --- | --- |
| Agent emits Kit 2 idioms into a Kit 3 app | **[resolved by revised decision]** stay on Kit 2.70 |
| AI SDK 7 training-data lag (docs mostly describe v5 shapes) | `docs/DEPS.md` worked example + pin exact versions; `LlmBackend` isolates it |
| llama.cpp quirks (thinking, prefill, samplers) | capability flags + `/props` server-side; fixtures pin behaviour |
| `node:sqlite` experimental | one `db/index.ts`; `better-sqlite3` swap path tested by interface only |
| Scope creep during rewrite | `PARITY.md` is the contract; anything not on it goes to `docs/IDEAS.md` |
| Second from-scratch restart | importer + `legacy/` reference + phase gates mean progress is never thrown away |
| Windows-only realities (paths, ports, .bat) | `doctor`, `.bat` tested each phase, no POSIX-only scripts |

---

## 5. Next 10 concrete actions

1. `git checkout -b rewrite` and move today's app to `legacy/` (keep it runnable; it's your reference implementation).
2. Write `CLAUDE.md` (invariants + where-to-change index) — before code, so every later agent session inherits it.
3. Run spike 0.1 (scaffold + shadcn + adapter-node) and commit the toolchain.
4. Run spike 0.2 (llama.cpp streaming + samplers). If red, decide `LlmBackend` shape immediately.
5. Run spike 0.3 (ComfyUI from Node, incl. inpaint upload).
6. Run spike 0.4 (SQLite + importer) against your real `chats/` folder.
7. Run spike 0.5 (LAN + token + phone).
8. Freeze features on `legacy/`; open `docs/IDEAS.md` for anything that would otherwise delay the port.
9. Write `shared/*.ts` schemas + `db/migrations.ts`; `npm run verify` green.
10. Build Phase 1 skeleton; ship the first phone-usable build, then start Phase 2.
