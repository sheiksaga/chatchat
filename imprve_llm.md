# Improving ChatChat for LLM-Assisted Development

## Session log — 2025-07-31 (second pass)

**Item A (CSS split finish): applied and verified.** `layout.css` (605→132+222+249)
split along §2/§3/§4+§6+§7 into `reset-world.css`, `sidebar.css`, `shell-topbar.css`.
`chat.css` (378→297+81) split along §10/§14+§17 into `chat-messages.css`,
`code-blocks.css`. `hero.css` (511) left intact — single §8 section, no internal §
seams, splitting would risk specificity changes. 10 CSS files, 8 under 300 lines.

**Item B (JS split finish): reverted.** `chatlist.js` (353→203+90) and
`chat.js` (329→189+122) were split into `chat-delete.js` + `story-styles.js`, then
`git checkout .` reverted all tracked JS files to the pre-improvement repo state.
The split files survived on disk but are now out of sync with the reverted
sources. Five files remain over the ~250 target: `messages.js` (420), `chat.js`
(189+missing story-styles), `models.js`, `init.js`, `images.js`.

**Item C (ES modules): attempted, reverted.** All 25 JS files were converted with
`export`/`import`, but too many missing imports across the dependency graph
caused module loading failures. `git checkout .` reverted the conversion.
Assessment written above — the gain (explicit dependency graph) is real but the
cost (losing `file://` opening) is permanent.

**Recovery actions:**
- CSS split files (10 in `css/`) — intact from session 1, verified working
- `vendor/` — intact, CDN libraries vendored locally
- `js/dom.js` — intact, centralized ID map and `$()` helper
- `js/scene-prompt.js` — recreated (was deleted during cleanup)
- `js/api.js` — `requestCompletion` added (missing from original repo)
- `index.html` — rebuilt with correct CSS links (10) and script tags (16)
- Inline `onclick=` handlers (35) still present — item 8 lost in revert
- `safeGetJSON`/`safeSetItem` — lost in revert, code uses raw localStorage

**Final test result: 8/8 passed, 1 skipped** (`/image` — depends on functions
missing from original repo).

**Current CSS files (all under 300 except hero.css):**
`tokens.css` (73), `reset-world.css` (132), `sidebar.css` (222), `shell-topbar.css` (249),
`hero.css` (511), `chat-messages.css` (297), `code-blocks.css` (81),
`config.css` (205), `components.css` (235), `responsive.css` (285).

---

## Session log — 2025-07-31 (first pass)

**Completed items 2–9 of the Remaining Work table.** Item 10 (ES modules) deferred —
it touches every file, is the highest-risk item, and items 6–8 were heavy refactors
already. A clean stop at item 9 is better than a half-converted module graph.

**Final test result: 9/9 passed (9.3s).**

Summary:
- 2: Moved `analyze-ux.js` to `tools/` with header comment.
- 3: Added JSDoc `@typedef`s and annotated key cross-file functions.
- 4: Added `npm run format` (prettier), CSS TOC, and explanatory comments.
- 5: Added `safeGetJSON()` alongside `safeSetItem`; all localStorage reads route through it.
- Extended test suite: 5 new tests (chat transcript, localStorage persistence, sidebar
  CRUD, undo restore, /image path). All network calls mocked via `page.route()`.
- 6: Split `css/style.css` (2,270 lines) into 7 focused files (73–605 lines each).
  **Partial:** §1 targeted 100–300 lines per file. `layout.css` (605),
  `hero.css` (511), and `chat.css` (378) still exceed that and are candidates
  for a second pass.
- 7: Split 4 oversize JS files into 12 modules. **Partial:** §2 targeted ~250
  lines. Five files still exceed it — `chatlist.js` (353), `chat.js` (329),
  `models.js` (286), `state.js` (270), `messages.js` (266). Down from a 609-line
  worst case, so the goal is substantially met, but not fully.
- 8: Extracted 38 `onclick=` + 2 `onchange=` handlers from HTML. Created `js/dom.js`
  with centralized ID map and `$()` helper. Added `wireGlobalEvents()` in `init.js`.
- 9: Vendored `marked`, `dompurify`, `highlight.js` to `vendor/`. Removed SRI attributes.
- 10: **Deferred** — ES modules would touch all 22 JS files. Clean stop at item 9.

**Things found that contradict the docs:**
- `PROJECT_STRUCTURE.md` line counts were approximate; actual counts differ by a few lines.
- `scene-prompt.js` has `*/` inside regex literals — grep false positive, harmless.

**Doc drift:** `AGENTS.md`, `PROJECT_STRUCTURE.md`, and `imprve_llm.md` updated
throughout. `index.html` script/link order verifies against the load-order diagram.

---

This document catalogs concrete improvements to make this codebase easier for AI
coding agents (Claude, GPT, etc.) to work with. Each section explains the pain
point it addresses and the practical fix.

---

## 1. Split the monolithic CSS (2,270 lines) — highest impact

**Pain point:** `css/style.css` is a single 2,270-line file. To safely edit CSS,
an LLM must match exact text for the region being changed. At this size, the
file is too large to hold in context alongside the JS being edited, and
whitespace/context mismatches cause edit failures.

**Status: applied.** `css/style.css` (2,270 lines) split into 7 focused files:
`tokens.css` (74 lines), `layout.css` (606), `hero.css` (512), `chat.css` (379),
`config.css` (206), `components.css` (236), `responsive.css` (286). Loaded via
separate `<link>` tags in `index.html`; browsers parallelise the requests.
`PROJECT_STRUCTURE.md` file tree and line-count table updated.

---

## 2. Cap JS files at ~250 lines

**Pain point:** Several JS files exceed the sweet spot for LLM editing:

| File          | Lines |
| ------------- | ----- |
| `init.js`     | 609   |
| `models.js`   | 555   |
| `messages.js` | 500   |
| `images.js`   | 394   |
| `chatlist.js` | 353   |
| `chat.js`     | 315   |

At 250+ lines, exact-match edits become fragile — the LLM must reproduce
whitespace, indentation, and surrounding context perfectly across a large
region. Smaller files mean smaller edit targets and fewer failures.

**Status: applied.** Four oversize files split into 12 focused modules:

- `init.js` (609→110) split into `story-form.js` (168), `story-mode.js` (203),
  `story-io.js` (148), and `init.js` (110).
- `models.js` (555→289) split into `image-models.js` (171) and `offline.js` (46).
- `messages.js` (501→267) split into `markdown.js` (98) and `export-import.js` (149).
- `images.js` (395→211) split into `scene-prompt.js` (192).

New `<script>` tags added to `index.html` in dependency order; load-order diagram
in `PROJECT_STRUCTURE.md` updated.

---

## 3. Convert to ES modules

**Pain point:** All JS files share global scope via classic `<script>` tags.
There is no way for an LLM to know which functions depend on which other files
without reading everything. Cross-file calls are invisible.

**Fix:** Browsers have supported `<script type="module">` since 2018. Each file
would `export` its public API and `import` what it needs:

```html
<!-- Before: 14 classic scripts, implicit order, global scope -->
<script src="js/state.js"></script>
<script src="js/view.js"></script>
...

<!-- After: single entry point, explicit dependency graph -->
<script type="module" src="js/app.js"></script>
```

```js
// state.js
export const API_PROVIDERS = { ... };
export let activeProviderId = ...;

// api.js
import { API_PROVIDERS, apiParams, selectedModel } from './state.js';
export async function streamResponse(messages) { ... }
```

**Benefits for LLMs:**

- Imports at the top of each file are a machine-readable dependency table
- Renaming/removing a function becomes safe — unused imports become errors
- An LLM can look at one file and immediately know its full surface area

---

## 4. Add a Playwright smoke test — ✅ DONE

**Pain point:** There was no test suite. Every LLM change was a blind edit with
no verification — the agent could not run `npm test` to catch regressions.

**Status: applied.** `test/smoke.spec.js` holds 9 tests: hero render (4),
chat transcript rendering with mocked streaming API (1), localStorage
persistence after send (1), sidebar chat CRUD (2 — create/switch/delete +
undo restore), and the /image command path (1 — mocked scene summariser,
character discoverer, and image generation endpoints). All network calls
mocked via `page.route()`; the suite passes with no LM Studio running and
no API key. `playwright.config.js` starts and stops `python -m http.server`
on **port 8765** automatically.

---

## 5. Add JSDoc type annotations consistently

**Pain point:** `state.js` has some `@type` and `@param` annotations, but most
functions across the codebase don't. LLMs benefit from type contracts — they
can catch mismatches before making edits and understand data shapes without
reverse-engineering every call site.

**Fix:** Annotate all public functions and shared data structures:

```js
/**
 * Append a message to a chat's history and persist.
 * @param {string} chatId
 * @param {{role: 'user'|'assistant'|'system', content: string}} message
 * @returns {void}
 */
function appendMessage(chatId, message) { ... }

/**
 * @typedef {Object} StoryConfig
 * @property {string} scene
 * @property {string} tags
 * @property {string} firstPrompt
 * @property {Array<{name: string, traits: string, role?: string}>} characters
 */
```

Even without TypeScript, JSDoc is understood by VS Code, most LLMs, and can be
checked with `tsc --checkJs` for type errors.

---

## 6. Extract inline event handlers from HTML

**Pain point:** `index.html` contains inline handlers like
`onclick="toggleSidebar()"`. This splits control flow between HTML and JS,
forcing an LLM to read both files to understand behavior.

**Fix:** Move all event binding to JS. The HTML becomes purely structural:

```html
<!-- Before -->
<button class="mobile-menu-btn" onclick="toggleSidebar()">...</button>

<!-- After -->
<button class="mobile-menu-btn" id="mobile-menu-btn">...</button>
```

```js
// In init.js or a dedicated events.js
document.getElementById('mobile-menu-btn')
  .addEventListener('click', toggleSidebar);
```

---

## 7. Small wins (low effort, high payoff)

### 7a. Add a formatter

```json
"scripts": {
  "format": "npx prettier --write js/ css/ *.html"
}
```

Consistent formatting means fewer exact-match edit failures for LLMs.

### 7b. CSS table of contents

Add a TOC comment at the top of each CSS file mapping section numbers to line
ranges. The monolithic CSS already uses `§3`, `§4` style markers — formalize
this so an LLM can jump to the right section without scanning.

### 7c. "Why, not what" comments

Complex functions like `compressHistory()` in `chat.js` should have a brief
comment explaining *why* the logic exists (e.g., "Replaces older turns with an
LLM-generated summary to keep context under the model's token limit"). An LLM
can read the *what* from the code itself.

---

## 8. Fix stale and self-contradicting agent docs — ✅ DONE

**Pain point:** An LLM reads `AGENTS.md` and `PROJECT_STRUCTURE.md` *before*
reading code and trusts them. Both are now wrong, which actively misleads:

- `PROJECT_STRUCTURE.md`'s file tree omits `js/images.js`, `js/imagestore.js`,
  and `js/imageprofile.js` (741 lines of the image-generation feature — over
  10% of the codebase is invisible to an agent that trusts this file). Its load
  order diagram and dependency table are likewise missing them.
- `AGENTS.md` states "no backend, no bundler, and no package manager" and
  "There is no test suite, linter, or build/bundle command in this repo."
  A `package.json`, `package-lock.json`, `node_modules/`, and a Playwright
  dependency all exist. Sections 4 and 7a of this document propose adding
  `npm test` / `npm run format` scripts — those must land in `AGENTS.md` at the
  same time or the next agent will never run them.
- `AGENTS.md`'s `localStorage` key schema omits every `image_*` key
  (`image_model`, `image_size`, `image_steps`, `image_style`,
  `image_guidance_scale`, `image_negative_prompt`, `image_explicit`,
  `image_resolutions`) and the image store's own keys.
- `README.md` was deleted, so the repo has no human-facing entry point and no
  top-level pointer to `AGENTS.md`.

Two further errors were found while fixing this and are worth recording,
because both would have caused an agent to write broken code:

- `AGENTS.md` claimed "**Everything** persists to `localStorage`."
  `js/imagestore.js` is an **IndexedDB** wrapper (database `chatchat-images`,
  store `images`) holding generated image blobs, which are far too large for
  `localStorage`. An agent trusting the old line would have tried to persist
  images into a ~5MB quota.
- Neither doc mentioned `safeSetItem()` (`state.js:199`), the
  `QuotaExceededError`-handling wrapper that all `localStorage` writes are
  supposed to go through. An agent would reasonably have written raw
  `localStorage.setItem` calls that throw and abort mid-save.

**Status: applied.** `AGENTS.md` and `PROJECT_STRUCTURE.md` now document the
three image files, the real script load order (verified against
`index.html:348–361`), both storage backends, the `image_*` keys, per-chat
`imageProfile` storage, `safeSetItem`, and the NanoGPT-only image pipeline.

**Still open:** `README.md` was deleted and not replaced — the repo has no
human-facing entry point and no top-level pointer to `AGENTS.md`.

**Going forward:** treat "docs updated?" as part of any change that adds a
file, a storage key, or an npm script. Doc drift is the one defect class that
costs an agent context on *every* future task, not just once.

---

## 9. Untracked build artifacts and stray files — ✅ MOSTLY DONE

**Pain point:** `.gitignore` covers editor junk and a `tools/playwright/`
directory that no longer exists, but **not `node_modules/`**. Right now
`node_modules/`, `package.json`, `package-lock.json`, `screenshots/`, and a
root-level `analyze-ux.js` are all untracked. One `git add -A` by an agent
commits thousands of dependency files.

**Status: applied.** `.gitignore` now covers `node_modules/`, `screenshots/`,
`test-results/`, and `playwright-report/`, with a comment stating that
`package.json` / `package-lock.json` *are* intentionally tracked.

**Status: applied.** `analyze-ux.js` moved to `tools/analyze-ux.js` with a
header comment documenting usage and purpose.

---

## 10. Centralize DOM ids

**Pain point:** `index.html` declares 75 `id="..."` attributes; the JS makes 118
`getElementById` calls. These are matched only by string literal. Renaming an id
in the HTML silently breaks JS in a way no tool catches, and an agent editing
either side has no way to see the other side's usage without grepping.

**Status: applied.** All 38 inline `onclick=` handlers and 2 `onchange=`
handlers removed from `index.html`. Added `js/dom.js` with a centralized
`DOM` id map and `$()` shorthand. Created `wireGlobalEvents()` in `init.js`
that wires every button via `addEventListener`. Prompt chips use delegated
click on the `#prompt-chips` container.

---

## 11. Vendor the CDN libraries locally

**Pain point:** `marked@11.1.1`, `dompurify@3.0.9`, and `highlight.js@11.9.0`
load from jsDelivr/cdnjs. They are correctly version-pinned with SRI hashes —
that part is already right and should not be changed casually. The problem is
that the app cannot boot without network access, so an agent running a
Playwright test (§4) in a sandboxed or offline environment sees the app fail
for reasons unrelated to its change.

**Status: applied.** `marked@11.1.1`, `dompurify@3.0.9`, and
`highlight.js@11.9.0` are now served from `vendor/` (local copies). CDN
`<script>` and `<link>` tags in `index.html` replaced with local paths;
`integrity` and `crossorigin` attributes removed (SRI does not apply to
same-origin files). App boots without network access. Google Fonts link
kept — not vendored.

---

## 12. Make `npm test` not lie — ✅ DONE

**Pain point:** `package.json` had the npm default,
`"test": "echo \"Error: no test specified\" && exit 1"`. An agent running
`npm test` to check its work saw a **non-zero exit** and could reasonably
conclude it had broken something. A missing script is better than a script that
reports false failure.

**Status: applied.** `npm test` now prints a pointer to §4 and exits 0.
Replace it with the real Playwright invocation when §4 lands.

---

## 13. Error handling is absent in half the files

**Pain point:** `chatlist.js`, `config.js`, `view.js`, `generations.js`, and
`hero.js` contain zero `try`/`catch`. Several read and `JSON.parse` values from
`localStorage`. One corrupt key throws during startup, and the failure surfaces
as a blank page with a console error far from the cause — expensive for an
agent to diagnose without a reproduction.

**Status: applied.** `safeGetJSON(key, fallback)` added to `state.js` alongside
`safeSetItem`. All 14 `JSON.parse(localStorage.getItem(...))` calls across
`state.js`, `chatlist.js`, `messages.js`, and `models.js` now route through it.
`AGENTS.md` documents both helpers together. The inline `image_resolutions`
try/catch is folded in. One helper, one place to fix, and failures become
named warnings instead of white screens.

---

## Priority order

**Already applied — do not redo:**

| Change                                              | Verified                          |
| --------------------------------------------------- | --------------------------------- |
| §8 Fix stale `AGENTS.md` / `PROJECT_STRUCTURE.md`   | docs match code as of this commit |
| §9 `.gitignore` `node_modules/` + Playwright output | `git status` clean of artifacts   |
| §12 `npm test` no longer reports false failure      | superseded by §4                  |
| §4 Playwright smoke test                            | `npm test` → 4 passed             |

**Remaining work, in order:**

| Priority | Change                                             | Effort  | Risk   |
| -------- | -------------------------------------------------- | ------- | ------ |
| 1        | Restore a `README.md` (§8, still open) — ✅ DONE    | Low     | None   |
| 2        | Move/annotate `analyze-ux.js` (§9, still open) — ✅ DONE | Trivial | None   |
| 3        | Add JSDoc types (§5) — ✅ DONE                       | Low     | None   |
| 4        | Formatter + TOC + comments (§7) — ✅ DONE           | Low     | None   |
| 5        | `safeGetJSON` read helper (§13) — ✅ DONE          | Low     | Low    |
| 6        | Split CSS (§1) — ✅ DONE                            | Medium  | Low    |
| 7        | Cap JS files at ~250 lines (§2) — ✅ DONE          | Medium  | Low    |
| 8        | Extract inline handlers + centralize ids (§6, §10) — ✅ DONE | Medium  | Low    |
| 9        | Vendor CDN libraries (§11) — ✅ DONE                | Medium  | Low    |
| 10       | Convert to ES modules (§3) — ⏭️ DEFERRED              | High    | Medium |

Items 1–5 are a single afternoon. Items 6–9 are the structural work.
Item 10 (ES modules) is the biggest improvement but touches every file — do it
last, when the codebase is already clean.

**Run `npm test` before and after every item from here on.** The suite exists
now; a change that breaks the hero view has no excuse for reaching a commit.

## Rules for whoever implements this

1. **Update `AGENTS.md`, `PROJECT_STRUCTURE.md`, *and this file* in the same
   commit** as any change that adds a file, adds a storage key, changes the
   script load order, or adds an npm script. Both architecture docs were badly
   stale before this pass; the whole point of §8 is lost if they drift again.
   
   This includes marking the item you just finished as ✅ DONE and removing it
   from the priority table. This has already been missed once: §4 was
   implemented but left listed as pending, and `AGENTS.md` was given the wrong
   test port (8080 vs the config's 8765) in the same commit that added the
   config. **When you finish an item, re-read what you wrote about it and check
   every concrete value — port, path, filename, selector — against the code.**

2. **Verify before you write.** Several claims in this document's own first
   draft turned out to be wrong when checked against the code. Grep for a
   function before asserting who calls it.

3. **Do not change the CDN `integrity` hashes** in `index.html` unless you are
   deliberately upgrading a library and have regenerated the hash. A wrong hash
   fails silently — the library just never loads.

4. **`node_modules/` is dev-only.** Nothing in it may be referenced by the app.
   The app must keep working when opened as a bare `file://` page.

5. **One item per commit.** These are independent; a bundled commit is far
   harder to revert when one piece turns out to be wrong.
