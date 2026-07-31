# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

ChatChat is a single-page, no-build, client-only chat UI for OpenAI-compatible
chat completion APIs. It's built for [LM Studio](https://lmstudio.ai) running
locally (`http://localhost:1234/v1`) but also supports a cloud provider
(NanoGPT) via a Bearer API key. There is no backend and no bundler — the app
itself is plain HTML/CSS/JS loaded directly by the browser.

## Running / developing

- Just open `index.html` in a browser, or serve the directory statically
  (e.g. `python3 -m http.server`) — either works since there's no build step.
  Keep it that way: the app must stay openable as a bare `file://` page.
- For the default "Local" provider, [LM Studio](https://lmstudio.ai)'s local
  server must be running at `http://localhost:1234` with a model available.
- **The app has no build step, but the repo does have a `package.json`.** It
  exists only for dev tooling (Playwright, prettier) — nothing in
  `node_modules/` is loaded by the app, ever.
- Third-party libraries (`marked`, `DOMPurify`, `highlight.js`) are **vendored
  into `vendor/`** and loaded by relative path — not from a CDN, not from
  `node_modules/`. So the app has no network dependency for its own code.
  Do **not** add SRI `integrity` attributes to those tags: SRI is for
  cross-origin resources, and a hash on a same-origin file silently fails and
  blocks the library. To upgrade, replace the file and note the new version.
- The only remote asset left is the Google Fonts stylesheet (`index.html:10`),
  which degrades to a system font.
- There is no linter. `npm run format` runs prettier.

## Verifying a change

`npm test` runs 9 Playwright smoke tests covering the hero view, chat
transcript rendering (markdown + sanitization), `localStorage` persistence,
sidebar chat CRUD, delete-undo, and the `/image` path. `playwright.config.js`
starts and stops `python -m http.server` on **port 8765** itself — you do not
need to run a server. `npm run test:ui` opens the interactive runner.

**Every network call is mocked with `page.route()`.** The suite must keep
passing with no LM Studio running and no API key. A test that needs a live
backend does not belong here.

Because the app is client-only, the browser console is still the primary
signal for anything the suite doesn't cover.

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

**Everything persists client-side — there is no server-side storage.** Two
stores are in play, and picking the wrong one is a common mistake:

*`localStorage`* holds all text and settings. Key schema:
- `chat_index` — array of chat IDs
- `chat_meta` — `{ [chatId]: { createdAt, name?, lastMode, storyConfig, imageProfile } }`
- `chat_<id>` — that chat's message history
- `chat_gen_<id>` — that chat's generation alternates
- `selectedModel`, `active_provider`, `provider_cfg_<id>` (baseUrl/key overrides)
- `pref_content_width`, `pref_font_size` — appearance prefs
- `rp_profile_<modelId>` — cached sampling params scraped from a model's HF README
- `image_model`, `image_size`, `image_resolutions`, `image_style`,
  `image_negative_prompt`, `image_steps`, `image_guidance_scale`,
  `image_explicit` — global image defaults, mirrored into `imageParams`
  (`state.js`). `image_explicit` is stored as a string and read as
  `!== 'false'`, so *absent* means enabled.
- `data_version` — bumped in `migrateData()` (`state.js`) when the stored
  shape changes; add a migration step there rather than a one-off script

*IndexedDB* (`js/imagestore.js`) holds generated image **blobs**, in database
`chatchat-images`, object store `images`. Images are far too large for
`localStorage`'s ~5MB budget, so they live here and messages reference them by
id (`msg.image.id`). Cleanup is the `pruneOrphanImages()` sweep `init.js` runs
at startup; deleting a chat does *not* free its images until the next reload.
`deleteImagesForChats()` exists for eager cleanup but nothing calls it yet.

**Never touch `localStorage` directly. Two helpers in `state.js` own it:**
- `safeSetItem(key, value)` — catches `QuotaExceededError` and shows a toast.
  A raw `setItem` throws and aborts its caller mid-save, which is a realistic
  failure here: long chats plus generation alternates fill the quota.
- `safeGetJSON(key, fallback)` — catches corrupt/malformed JSON and returns
  the fallback. A raw `JSON.parse` of a bad key throws at boot and
  white-screens the app.

There are currently **zero** raw `localStorage.setItem` or
`JSON.parse(localStorage.getItem(...))` calls outside the `safeSetItem`
wrapper itself. Keep it that way. `getChatIndex`/`setChatIndex` and
`getChatMeta`/`setChatMeta` (also `state.js`) wrap the two structured keys.

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

**Image generation (`images.js`, `scene-prompt.js`, `imageprofile.js`,
`imagestore.js`).** Typing `/image` or `/img` in the composer generates a
picture instead of a chat reply. `sendMessage()` (`chat.js`) dispatches on
`parseImageCommand()`; with no argument, `buildScenePrompt()` asks the *chat*
model to describe the current scene from recent messages, so the image follows
the story. `/img` skips the summariser and uses the text verbatim.

This pipeline is **always NanoGPT**, regardless of the active chat provider —
`imageApiBase()`/`imageApiHeaders()` (`state.js`) resolve `IMAGE_PROVIDER_ID`
independently. LM Studio does not serve images, so `/image` while the chat
provider is `local` is expected, not a bug.

`imageprofile.js` holds the *per-chat* look on `chat_meta[chatId].imageProfile`
(not a top-level key): a fixed random seed, a style string, and a map of
character name → locked appearance. `composeImagePrompt()` substitutes each
known name for its appearance before sending — that substitution is what keeps
a character recognisable across generations, since names mean nothing to a
diffusion model.

Rendering goes through `renderImageMessage()` (`messages.js`), which reads the
blob from IndexedDB and expects the CSS contract `.message-image`,
`.generated-image`, and `.generated-image-missing` for the case where the blob
is gone but the message survives.

**Views (`view.js`).** Only two top-level views exist — the hero/landing
screen and the chat transcript — toggled via `showHeroView()`/`showChatView()`.

## Known rough edges

- `index.html` still has **35 inline `onclick=` handlers**. Extracting them is
  planned (§6/§10 of `imprve_llm.md`) but not done.
- `js/dom.js` exists and is loaded, but **nothing uses it yet** — it's the id
  map for that extraction. Don't assume ids are centralized; grep
  `index.html`.
- `chatlist.js` (282), `models.js` (321), `messages.js` (~470), `init.js` (578)
  are still over the ~250-line target.
