# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

ChatChat is a single-page, no-build, client-only chat UI for OpenAI-compatible
chat completion APIs. It's built for [LM Studio](https://lmstudio.ai) running
locally (`http://localhost:1234/v1`) but also supports a cloud provider
(NanoGPT) via a Bearer API key. There is no backend, no bundler, and no
package manager — it's plain HTML/CSS/JS loaded directly by the browser.

## Running / developing

- Just open `index.html` in a browser, or serve the directory statically
  (e.g. `python3 -m http.server`) — either works since there's no build step.
- For the default "Local" provider, [LM Studio](https://lmstudio.ai)'s local
  server must be running at `http://localhost:1234` with a model available.
- There is no test suite, linter, or build/bundle command in this repo —
  nothing to run before committing beyond manually exercising the UI.
- Third-party libraries (`marked`, `DOMPurify`, `highlight.js`) are loaded
  from CDN `<script>`/`<link>` tags in `index.html`, not installed locally.

## Architecture

See `PROJECT_STRUCTURE.md` for the file-by-file breakdown, script load order,
and cross-file dependency table. The notes below cover concepts that span
multiple files and aren't obvious from reading any single one.

**Global scope, no modules.** All `js/*.js` files are loaded as classic
`<script>` tags (not ES modules) and share one global scope. Functions and
`let`/`const` declared at top level in one file are directly callable/visible
from every other file. Cross-file calls work regardless of load order because
they only actually fire after `DOMContentLoaded`, by which point every script
has executed — not because of hoisting across files.

**State lives in `js/state.js`.** Key globals: `currentChatId`, `chatHistory`
(array of `{role, content}`), `generationStore`/`generationIdx` (regenerate
alternates, keyed by message index), `storyConfig`, `currentMode`
(`'chat'|'story'`), `apiParams` (temperature/repetitionPenalty/topP/topK),
and `activeProviderId`.

**Everything persists to `localStorage` — there is no server-side storage.**
Key schema:
- `chat_index` — array of chat IDs
- `chat_meta` — `{ [chatId]: { createdAt, name?, lastMode, storyConfig } }`
- `chat_<id>` — that chat's message history
- `chat_gen_<id>` — that chat's generation alternates
- `selectedModel`, `active_provider`, `provider_cfg_<id>` (baseUrl/key overrides)
- `pref_content_width`, `pref_font_size` — appearance prefs
- `rp_profile_<modelId>` — cached sampling params scraped from a model's HF README
- `data_version` — bumped in `migrateData()` (`state.js`) when the stored
  shape changes; add a migration step there rather than a one-off script

**Provider abstraction (`state.js`).** `API_PROVIDERS` registers `local`
(LM Studio) and `nanogpt` (cloud). `getProviderConfig`/`currentProvider`
resolve the active provider's `baseUrl`/`key`; `apiHeaders()` adds an
`Authorization: Bearer` header only when the active provider has a key.
Switching providers (`config.js`'s `switchProvider`) clears the selected
model since model lists aren't shared across providers.

**Two conversation modes.** `chat` mode uses the freeform `#system-prompt`
textarea. `story` mode (`chat.js`) builds its system prompt from
`STORY_STYLES` — a registry of `cyoa`/`roleplay`/`gm` styles, each owning its
own instructions but sharing the `storyConfigLines()` scaffold (scene,
characters, tags, first prompt) and a shared dialogue/action/thought
formatting convention. Adding a new story style means adding an entry to
`STORY_STYLES` plus UI wiring (style pill, hints) in `init.js`.

**Streaming (`api.js`).** `streamResponse()` POSTs to `${API_BASE}/chat/completions`
with `stream: true` and parses the `data: {...}` SSE-style lines itself
(no SDK). Renders are throttled to ~30fps during streaming to avoid layout
thrash. Aborting mid-stream (via `stopGeneration()`/`AbortController`) keeps
whatever text streamed so far rather than discarding it.

**Regeneration (`generations.js`).** `generationStore[msgIndex]` holds *every*
generation ever produced for that message slot (not just alternates);
`regenerateMessage`/`cycleGeneration` truncate/restore `chatHistory` and
re-stream via `chat.js`'s `streamAssistantResponse()`. `compressHistory()`
(`chat.js`) replaces older turns with a single LLM-generated summary message
and remaps `generationStore`/`generationIdx` keys to match the new indices.

**Rendering (`messages.js`).** Assistant content is markdown rendered via
`marked` then sanitized with `DOMPurify` before being set via `innerHTML`.
Because DOMPurify strips inline event handlers, interactive bits inside
rendered content (e.g. the code-block copy button) use a single
document-level delegated `click` listener rather than inline `onclick`.

**Views (`view.js`).** Only two top-level views exist — the hero/landing
screen and the chat transcript — toggled via `showHeroView()`/`showChatView()`.
