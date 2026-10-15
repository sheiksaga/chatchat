# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

ChatChat is a single-page, no-build, client-only chat UI for OpenAI-compatible
chat completion APIs. It's built for [LM Studio](https://lmstudio.ai) running
locally (`http://localhost:1234/v1`) but also supports a cloud provider
(NanoGPT) via a Bearer API key. There is no backend and no bundler — the app
itself is plain HTML/CSS/JS loaded directly by the browser.

It also plays characters. Importing (or writing) a SillyTavern character card
puts the app in `character` story mode: the card's description, personality,
scenario, example dialogue, and embedded lorebook become the system prompt,
the transcript is speaker-prefixed, name stop strings keep the model out of
your half of the scene, and the card's greeting opens the chat as a swipeable
first message.

Text can come from [LM Studio](https://lmstudio.ai) (`local`) or
[llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama_cpp`); the two have
different model-lifecycle APIs and the app handles both — see the provider
notes under Architecture.

## Running / developing

- Just open `index.html` in a browser, or serve the directory statically
  (e.g. `node tools/serve.js 8765`) — either works since there's no build step.
  Keep it that way: the app must stay openable as a bare `file://` page.
- For the default "Local" provider, [LM Studio](https://lmstudio.ai)'s local
  server must be running at `http://localhost:1234` with a model available.
  The `llama.cpp` provider expects `llama-server` at
  `http://localhost:8081/v1` and needs no model preloaded — see the provider
  notes under Architecture for how the two differ.
- **The app has no build step, but the repo does have a `package.json`.** It
  exists only for dev tooling (Playwright, prettier) and `npm run sync-cards`
  — nothing in `node_modules/` is loaded by the app, ever.
- To pull characters out of a SillyTavern install:
  `npm run sync-cards "<path-to-sillytavern>"`. It accepts either the ST root
  or its `characters/` directory, writes `cards/cards.js` plus
  `cards/avatars/`, and prunes avatars no card refers to. To do it without a
  build step, use **Import Cards** in the cast picker.
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

`npm test` runs 92 Playwright tests in `test/`, all of them hermetic:

- `smoke.spec.js` (24) — hero view, chat transcript rendering (markdown +
sanitization), `localStorage` persistence, sidebar chat CRUD, delete-undo, the
`/image` path, independent text/image provider selection, the setup guide,
the bundled card manifest being loaded, and the `/image` discoverability
affordances (chip inserts rather than sends, no duplicate token, hidden in
image mode, shown in story mode).
- `character.spec.js` (15) — cast picker visibility, greeting seeding,
alternate-greeting swipes, the assembled character prompt (card fields,
speaker prefixes, the primed final turn, stop strings), PNG card parsing,
and the card editor. These use `mockEmptyCardLibrary()` to own the card
library they assert on.
- `comfyui.spec.js` (20) — the ComfyUI transport: graph posted to `/prompt` and
collected from `/history` + `/view`, no `/images/generations` call, locked seed
reuse within a chat, aspect presets, checkpoint discovery, both placeholder
conventions (over every bundled workflow), and img2img/editor-format error paths.
- `scenestate.spec.js` (15) — the per-chat scene record: parsing fenced,
padded and sloppy model replies, junk-proofing, merge semantics, chat
lifecycle, and an end-to-end assertion that the record's clothing and location
reach the workflow ComfyUI receives.
- `llamacpp.spec.js` (10) — the llama.cpp provider: no load/unload calls, hidden
eject button, samplers adopted from `/props`, `/props` cache, and graceful
degradation when `/props` is missing, erroring, or differently shaped.
- `offline.spec.js` (4) — what the app says when the configured server is
unreachable or returns an error status (`route.abort('connectionrefused')`).
- `sync-cards.spec.js` (4) — runs the same inputs through
`tools/sync-cards.js` and `js/cards.js` and requires identical output, so the
deliberately duplicated parser cannot drift.

Shared mocks live in `test/helpers.js` (`solidPng()` builds a real PNG of a
given size, which is what lets the image-layout test assert on aspect ratio
rather than on a 1x1 placeholder that no layout rule can fail;
`mockEmptyCardLibrary()` neutralises the synced manifest).

`captureChatRequest()` records only `stream: true` requests. Not every call to
`/v1/chat/completions` is the assistant reply — the app also makes one-shot
non-streaming calls to summarise a scene, lock character appearances, update the
scene record, and compress history. Capturing one of those would silently swap
the request under assertion for a helper call, which reads like the app sending
the wrong prompt.

**Every network call is mocked with `page.route()`.** The suite must keep
passing with no LM Studio running, no API key, and no SillyTavern install. A
test that needs a live backend — or a populated `cards/cards.js` — does not
belong here; `character.spec.js` injects synthetic cards through
`localStorage` instead of relying on whatever was last synced.

`playwright.config.js` starts and stops `node tools/serve.js` itself — you do
not need to run a server. Two things about it are deliberate:

- **Node, not `python -m http.server`.** Python is not reliably on PATH; on
  Windows `python3` is usually the Microsoft Store stub, which exits instantly
  and leaves Playwright waiting on a port that never opens.
- **`reuseExistingServer` is opt-in (`PW_REUSE_SERVER=1`), not on by default.**
  Reusing whatever already holds the port means an unrelated server squats it,
  every locator fails against the wrong app, and the run looks like a code
  breakage. A busy port now fails loudly instead. If the default port is taken,
  use `PORT=8799 npm test`.

`npm run test:ui` opens the interactive runner.

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
- `chat_scene_<id>` — that chat's scene record (scenestate.js): current scene,
  who is present, and each character's clothing/state. Part of the chat, so
  `deleteChat` removes it and undo restores it alongside the history.
- `chat_gen_<id>` — that chat's generation alternates
- `selectedModel`, `active_provider`, `provider_cfg_<id>` (baseUrl/key overrides)
- `pref_content_width`, `pref_font_size` — appearance prefs
- `rp_profile_<modelId>` — cached sampling params scraped from a model's HF README
- `image_model`, `image_size`, `image_resolutions`, `image_style`,
  `image_negative_prompt`, `image_steps`, `image_guidance_scale`,
  `image_explicit` — global image defaults, mirrored into `imageParams`
  (`state.js`). `image_explicit` is stored as a string and read as
  `!== 'false'`, so *absent* means enabled.
- `chatchat_cards` — the imported/created character card library (see
  *Character cards* below). Avatars are separate: an IndexedDB blob store,
  database `chatchat-cards`, object store `cards`, keyed by the same card id.
  The app always reads avatars from there, never from the manifest's inline
  data, so a card can be renamed without rewriting its image.
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

**Provider abstraction (`state.js`).** Text (chat) and image generation are
selected **independently** — a Mac can run text locally via LM Studio while
sending images to a cloud provider, or the reverse. `API_PROVIDERS` registers
`local` (LM Studio, text only), `llama_cpp` (llama.cpp, text only), `local_image`
(MLX Omni Server, image only — the wired-in local FLUX path for Apple Silicon),
and the cloud presets `nanogpt`/`openai`/`openrouter`, each flagged with
`chat`/`images` booleans. Custom providers (`getCustomProviders`/`addCustomProvider`)
carry the same flags plus `isLocal` (set via the "No API key required"
checkbox in the add-provider form — lets a LAN server skip the key
requirement).

**`getProviderConfig()` projects explicitly, so new registry flags must be
added in two places.** It whitelists `label`/`isLocal`/`chat`/`images`/
`baseUrl`/`key` over the registry entry (which is deliberate — saved overrides
must not be able to change behaviour), plus the behaviour flags
`loadLifecycle` and `samplerSource`. A flag added to `API_PROVIDERS` but not
listed there is **silently dropped**, and nothing fails loudly: it just stops
guarding what it guarded. This bit once already. Absent `loadLifecycle` means
`true` (has a lifecycle), which is the LM Studio default and the safe fallback
for user-added custom providers.

`loadLifecycle: false` marks a server with no `/v1/models/load` or
`/v1/models/unload`. **llama.cpp has neither** — confirmed by string-extracting
the shipped `llama-server-impl.dll`, which contains zero such route literals.
A request naming a model *is* the load: the router (`--models-dir`) spawns a
child `llama-server` on the first request for that model and proxies to it,
evicting the previous one under `--models-max 1`. So on `llama_cpp` the app
skips both calls, hides the eject button (a control that fires a 404 and leaves
the model resident is worse than no control), and warns that the first reply
can take ~10-30s.

`samplerSource: "props"` means read the model's sampler defaults from the
server rather than a Hugging Face README. `fetchPropsProfile()` (`api.js`) reads
`GET /props` — at the server **root**, not under `/v1`, which is what
`providerRoot()` is for — and pulls `default_generation_settings`. That matters
because llama.cpp's `--models-preset` sets per-model `temp`/`min-p`/`top-k`,
and **request-body values win**, so without reading `/props` the app would
silently clobber the tuning the user configured. Every field is optional and
the call is best-effort: a missing, differently-shaped, or erroring `/props`
must degrade to "no profile" rather than throw or wipe slider settings.

`apiParams.temperature` and `repetitionPenalty` have sliders;
`topP`/`topK`/`minP` have none and are carried straight into the request body.
The sliders use `step="0.01"` because real presets are not on a 0.1 grid
(Stheno's tuned temperature is 1.17, its min-p 0.075) — a 0.1 step would make
the slider display a value the label disagreed with.

`getProviderConfig`/`currentProvider` resolve the active **text** provider's
`baseUrl`/`key`; `apiHeaders()` adds an `Authorization: Bearer` header only
when it has a key. Switching text providers (`config.js`'s `switchProvider`)
clears the selected model since model lists aren't shared across providers.
`activeImageProviderId`/`currentImageProvider()` track the **image** provider
separately, defaulting to `"auto"` (see the image-generation section below).
`getChatCapableProviders()`/`getImageCapableProviders()` (`state.js`) list
providers for the two independent pill rows in the config panel
(`config.js`'s `PROVIDER_KIND`-driven `renderProviderRow`/`renderProviderDetail`,
generic over `'text'|'image'`).

**Two conversation modes.** `chat` mode uses the freeform `#system-prompt`
textarea. `story` mode (`chat.js`) builds its system prompt from
`STORY_STYLES` — a registry of `cyoa`/`roleplay`/`gm`/`character` styles, each
owning its own instructions but sharing the `storyConfigLines()` scaffold
(scene, characters, tags, first prompt) and a shared dialogue/action/thought
formatting convention. Adding a new story style means adding an entry to
`STORY_STYLES` plus UI wiring (style pill, hints) in `init.js`.

**Character cards (`cards.js`, `rp.js`, `cardeditor.js`).** The `character`
story style is the SillyTavern-compatible path. A card is loaded from
SillyTavern's PNG `tEXt`/`zTXt`/`iTXt` chunk (`chara` = v2, `ccv3` = v3, v3
wins) or from a v2/v3 JSON file, normalised by `normalizeCard()`, and kept in
the `chatchat_cards` library.

Two entry points put cards in that library, and they share one file format:

- **Import** — `importCardFiles()` reads `.png`/`.json` picked from disk or
dropped in. Works on `file://` because it uses the File API, not `fetch()`.
  `.charx` is not supported.
- **Sync** — `npm run sync-cards <sillytavern-dir>` (`tools/sync-cards.js`)
  reads a SillyTavern install's `characters/` directory and emits
  `cards/cards.js`, a `<script>`-loadable manifest assigning
  `window.CHATCHAT_CARDS`. It is a `.js` file and not JSON because `fetch()`
  is CORS-blocked on `file://`, so a manifest the app can read without a
  server has to be a script. Avatars go to `cards/avatars/` (gitignored).

The two sources merge in `getCards()`: the synced manifest first, then
`localStorage`, then tombstoned ids filtered out last. So a user-edited copy of
a synced card always wins, and a card the user deleted stays deleted across
re-syncs. Do not rewrite that ordering — it is the whole conflict-resolution
story.

`tools/sync-cards.js` deliberately duplicates `normalizeCard()` and
`extractAppearance()` from `js/cards.js` — that half has to run in Node at
build time. If you change one, change the other, or the synced manifest and
the runtime importer will disagree about the same card.

A card's **id is a hash of name + description only**. Not of
`creator_notes`, which SillyTavern rewrites on every re-export — keying on it
would mint a duplicate card each export. Renaming a card therefore changes its
id, which is why the editor calls `retireCardId()` to re-point the cast and
the avatar blob. Cards deleted by the user are **tombstoned**, not really
removed, so a later `sync-cards` run cannot resurrect them.

**The cast.** `storyConfig.castIds` is an ordered list; **position 0 is the
lead** — the character whose voice the model writes and whose greeting opens
the scene. Casting the lead into an empty chat calls `seedGreeting()`, which
lands `first_mes` as the first assistant turn and stores every
`alternate_greetings` entry in `generationStore[0]`, so the existing swipe UI
cycles them with no new code. Supporting cast members are described in the
system prompt but do not open the scene.

`rp.js` owns the prompt itself. `buildRPMessages()` emits one system block
carrying the card fields and example dialogue, a transcript whose turns are
prefixed `Name: `, and a **primed final turn** (`"<user's line>\n<Lead>:"`) so
the model continues the scene instead of replying to it. `rpStopStrings()`
returns `\n<Name>:` for every participant as `stop`, which is what actually
keeps the model out of the player's half — the prefixes alone do not.
`stripLeadingSpeaker()` removes a name the model echoed at the start of its
reply, and is tolerant of a leading `Name:` that arrived without the newline.

Lorebook support is limited on purpose: only a card's **embedded**
`character_book` is honoured, via `collectLorebookEntries()` (constant entries
always, keyword entries scanned against the last 4 messages, secondary keys
required when present). There is no World Info editor.

`{{user}}` resolves to `storyConfig.userName` (falling back to `"User"`), so
setting a name is what personalises every macro and stop string at once.

**Card → image appearance.** Casting a card calls `lockAppearanceForCard()`,
which writes the card's `appearance` into the per-chat `imageProfile`
character locks. That bypasses `addCharacterLock()`'s discovery guard, so a
character's look is fixed at cast time rather than inferred later from
transcript text.

**Network failures (`api.js`).** Every request to a user-configured server goes
through `fetchApi()`, not bare `fetch()`. A rejected fetch becomes an `Error`
whose message names the host and both possible causes, with
`err.networkUnreachable === true` so callers can tell "never got a response"
from "the server answered with an error status". `offline.spec.js` pins that.

Two things make this worth the ceremony, and both are easy to get wrong:

- **You cannot detect CORS from JavaScript.** A cross-origin fetch rejection is
deliberately opaque — the browser will not reveal whether the host refused the
connection or a CORS policy blocked the response, because that distinction
leaks information across origins. So the message names *both* causes instead
of guessing. Do not "improve" it into asserting one.
- **The browser console lies about the cause.** Firefox reports both cases as
  `Cross-Origin Request Blocked ... (Reason: CORS request did not succeed)`
  with status `(null)`. Per MDN that error is "not directly related to CORS,
  but is a fundamental network error" — it appears when the server is simply
  *not running*. Chrome is unhelpful differently ("Failed to fetch", vs
  Firefox's "NetworkError when attempting to fetch resource.").

This matters because "the local server isn't running" is the most likely
failure in this app. If a genuine CORS block *is* the cause, LM Studio disables
cross-origin requests unless you turn on **Enable CORS** in its server panel
(or pass `lms server start --cors`) — which is why `help.js` calls that step
out explicitly. A `file://` page sends `Origin: "null"`, which some local
servers reject outright; `networkErrorDetail()` names that case too.

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

**Discoverability.** `/image` is easy to miss: it is a typed command with no
button, and nothing about the app hints it exists. So `insertImageCommand()`
(`hero.js`) backs two controls — a chip above the hero composer and a button
beside Send in the chat bar — plus `updateComposerHints()`, which names
`/image` in the chat placeholder and hides both controls in image mode, where
every message is already an image request.

The controls **insert the command rather than sending it**, which is worth
keeping if you touch them. A bare `/image` only works once there is something to
illustrate, so a control that sent immediately would be a button that sometimes
just errors; and a control that sends `/image` for the user leaves them still not
knowing the command exists. Inserting shows them the syntax, leaves the caret
ready, and makes Enter or an appended subject equally immediate. Re-clicking is
safe, and a subject typed first gets the command hoisted in front, where the
parser expects it.

The chip sits in its own `#prompt-chips-image` row rather than joining
`#prompt-chips`, because `setMode()` hides the latter outside chat mode and the
starter prompts it holds are meaningless in story mode — while `/image` works in
every mode.

**Image generation (`images.js`, `comfy.js`, `scene-prompt.js`,
`imageprofile.js`, `imagestore.js`).** Typing `/image` or `/img` in the composer
generates a picture instead of a chat reply. `sendMessage()` (`chat.js`)
dispatches on `parseImageCommand()`; with no argument, `buildScenePrompt()` asks
the *chat* model to describe the current scene from recent messages, so the
image follows the story. `/img` skips the summariser and uses the text verbatim.

**Two request shapes, selected by `api`.** Everything except ComfyUI speaks the
OpenAI-compatible `/images/generations` request (prompt/model/size/n) and returns
`{data:[{b64_json|url}]}`. **ComfyUI has no such endpoint**: a request is a
*node graph* posted to `POST /prompt`, and the result is collected out of band.
`requestImage()` branches on `cfg.api === 'comfyui'` and hands off to
`comfyGenerate()` (`comfy.js`), which returns the same thing — a data URL — so
everything downstream is unchanged. The four steps are: `POST /prompt {prompt,
client_id}` → poll `GET /history/<prompt_id>` → take the first
`{filename, subfolder, type}` from the entry's outputs → `GET /view?...` for the
bytes. Polling rather than the `/ws` websocket is a deliberate trade: the
websocket gives per-step progress, but needs its own connection lifecycle for a
status line that elapsed-time already covers on an 8-13s generation.

The `api` flag is a **third** registry field, alongside `loadLifecycle` and
`samplerSource`, and like them it must be listed in `getProviderConfig()` or it
is silently dropped (see the provider-abstraction notes above).

**Workflows are bundled as `.js`, and regenerated by a tool.**
`workflows/workflows.js` is generated by `tools/sync-workflows.js` (`npm run
sync-workflows`, which reads a SillyTavern install) exactly as `cards/cards.js`
is generated by `tools/sync-cards.js`. It is a `<script>`-loadable file rather
than JSON for the same `file://` reason: `fetch()` is CORS-blocked there.

The tool **skips workflows chatchat cannot run**, and the notes in the generated
file record why: editor-format exports (a `{nodes:[],links:[]}` document — only
the API export is postable), graphs that load a LoRA (a machine-specific path
that hard-fails elsewhere), and graphs needing an input image (chatchat is
text-to-image, so they would queue and hang rather than fail cleanly). A pasted
workflow always overrides the bundled picker.

**Placeholder substitution supports two conventions**, because both appear in the
wild: SillyTavern's `"%prompt%"` and the ComfyInject extension's
`"{{POSITIVE_PROMPT}}"`. Both are handled **quoted-first**, and that is load
bearing. Every placeholder in a real workflow file sits inside a JSON string, so
the regex replaces the quotes as well and inserts `JSON.stringify(value)`:
`"%width%"` becomes a bare `1024` number while `"%prompt%"` keeps its quotes and
comes out escaped. Matching the placeholder alone leaves `""832""` behind —
invalid JSON that breaks every ComfyInject-style workflow at once while the
SillyTavern-style default keeps working. An unmapped placeholder is a **hard
error** naming itself rather than a warning: a leftover `%seed%` reaches ComfyUI
as literal text, and the error it returns names the node but not the cause.
`test/comfyui.spec.js` runs *every* bundled workflow through this and asserts
valid JSON, no leftovers, and that numeric fields stayed numbers.

**Checkpoint discovery uses the single-node form.**
`GET /object_info/CheckpointLoaderSimple` is 926 bytes against ~2MB for the full
`/object_info`, and it is the only part of that payload this app needs; the
image-model dropdown is built from it.

`resolveImageProvider()` (`images.js`) picks which provider actually serves
the request. An explicit selection (`activeImageProviderId` not `"auto"`)
always wins. In `"auto"` mode: if the active *text* provider is non-local, it
also serves images (even if it lacks image support — surfaced as a normal
error). If the text provider is local, `resolveImageProvider()` falls back to
the one other configured image-capable provider that's actually set up (has
a key, or is a user-added custom provider flagged local/LAN) — ambiguous if
more than one qualifies. The built-in `local_image` and `comfyui` presets
deliberately do **not** count as "configured" for auto-detection (they always
exist whether or not that server is running); picking either requires the
explicit selector.

`imageprofile.js` holds the *per-chat* look on `chat_meta[chatId].imageProfile`
(not a top-level key): a fixed random seed, a style string, and a map of
character name → locked appearance. `composeImagePrompt()` substitutes each
known name for its appearance before sending — that substitution is what keeps
a character recognisable across generations, since names mean nothing to a
diffusion model.

**The image profile owns the body; `scenestate.js` owns what is on it.**
`discoverCharacters()` deliberately excludes clothing from a lock, because a
lock is substituted into every later prompt and a fixed outfit would fight the
scene's own state of dress. `js/scenestate.js` covers the other half, as a
`chat_scene_<chatId>` record kept beside the chat and deleted with it:

```json
{ "scene": "rain-soaked neon street, late evening",
  "present": ["Jess", "Maya"],
  "characters": { "jess": { "clothing": "white sundress, soaked",
                            "state": "shivering, hair plastered down" } } }
```

It is maintained by the **chat model** (the one already resident in the
provider), so there is no extra server to run. Two paths keep it current:
`scheduleSceneStateUpdate()` folds each reply in as a fire-and-forget call from
`streamAssistantResponse()` (it must never delay a reply the user is already
reading), and `refreshSceneState()` before every generation is the guarantee —
correct even when the background pass failed or a chat switch interrupted it.
Both are gated by `sceneTrackingEnabled()` on the chat having a cast, so a plain
chat pays nothing.

Four properties are load bearing, and each has tests:

- **Advisory, never load-bearing.** Every path degrades to the previous record
  or to no record. `parseSceneStateJSON()` handles fenced blocks, preamble,
  trailing prose and trailing commas, and returns `null` rather than throwing;
  a failed update logs and keeps what it had. An image must never fail because
  scene tracking did.
- **Absent fields carry forward; absent *characters* do not.** `present` is
  authoritative — an update that omits someone means they left the scene — but
  a field the update omits is not a field that became empty. See
  `mergeSceneState()`.
- **Everything is rebuilt, not trusted.** `normalizeSceneState()` coerces field
  by field with length caps, because the only guarantee about the input is that
  a language model produced it. Present characters are filled first so the cap
  can never drop someone who is in the scene, and a name listed as present with
  no detail gets an empty shell rather than vanishing.
- **It is captured before the first await.** `updateSceneState()` reads the
  target chat id and the transcript *synchronously*, so a chat switch mid-flight
  cannot fold one conversation into another chat's record.

`compressHistory()` invalidates the record (`throughIndex = -1`) rather than
trying to remap indices across a rewrite that replaces the transcript with a
summary plus one exchange.

**Prompts are budgeted, because the text encoder is small.** SDXL's CLIP takes
77 tokens per chunk over two chunks — roughly 118 words — and silently drops the
rest. Measured on a real three-character scene the composed prompt came to **308
tokens against a 154-token budget**, so half of it never reached the model: the
style suffix was cut entirely and two characters' outfits merged. Injected
character detail was the dominant cost (68 words for two characters), so
`PROMPT_LOCK_WORDS` / `PROMPT_DETAIL_WORDS` cap each character's contribution,
keeping the leading words since the cards describe build, hair and eyes first.
Ordering is the remaining priority mechanism: subject and action lead, and the
style suffix trails, so it is what gets dropped when a prompt still overflows.
That is why `buildScenePrompt()` also tells the summariser to stay under 50
words and not to describe clothing — though models do not always comply.

Rendering goes through `renderImageMessage()` (`messages.js`), which reads the
blob from IndexedDB and expects the CSS contract `.message-image`,
`.generated-image`, and `.generated-image-missing` for the case where the blob
is gone but the message survives.

**Generated images are capped to the transcript's height, not the window's.**
`updateGeneratedImageHeight()` measures `#messages` and sets
`--generated-image-max-height`; it is recomputed on resize and in
`showChatView()`, since the transcript has no height while the hero is showing.
A `vh`-based cap is only a guess, and it was wrong in practice: the transcript
sits between a header and a composer, so on an 800px window it is only ~614px,
and a portrait capped at `70vh` (560px) still overflowed once the message
padding and toolbar were added. ComfyUI is what made this matter — it is the
first provider here that produces non-square images by default.

**`renderImageMessage()` is async and must be awaited before scrolling.** It
reads the blob from IndexedDB, so the `<img>` does not exist when the call
returns. The transcript's scroll-to-bottom ran immediately after it, meaning the
scroll always happened against a transcript with no image in it, and a tall
image was left below the fold with nothing to indicate it was there.
`settleScrollAfterImages()` re-pins as each image decodes; it only acts when the
reader was already at the bottom, and any scroll gesture cancels it, so an image
loading further up the transcript cannot yank the view away mid-read. Both the
generation path and `renderMessages()` collect the render promises and settle
after them.

**Views (`view.js`).** Only two top-level views exist — the hero/landing
screen and the chat transcript — toggled via `showHeroView()`/`showChatView()`.

Casting the lead into an empty chat calls `showChatView()`, which hides the
hero — and `#story-config` (the cast picker, your name, the style pills) lives
inside it. Mid-chat the entry point is therefore the config panel's **Edit
Story** button, whose `openStorySettings()` physically moves `#story-config`
into a modal, exactly as SillyTavern keeps its character settings in a drawer.
`js/cardeditor.js` reopening that path is what keeps the cast editable after
the first turn.

**Overlay stacking.** The layer order is load-bearing and non-obvious, because
several overlays share `z-index: 50` and then DOM order decides:
`sidebar backdrop 25 · mobile menu 40 · story settings 50 · card editor 55 ·
confirm dialog 58 · toasts 60/70`. The card editor must outrank the story
settings modal that opened it, and a confirm raised from inside the editor
must outrank both. Break that and the editor renders but its buttons are
unclickable — which is exactly what the tests caught.

**Hero overflow.** `.hero-region` uses `justify-content: safe center`, not
`center`. Plain `center` puts the top of the content at a negative offset once
it is taller than the pane, and browsers will not scroll to it, so the first
rows render under the top bar and become unclickable. `safe center` falls back
to `start` precisely when that would happen. Anything that makes the hero
form taller can trip this.

**Setup guide (`help.js`).** The `?` button next to Configuration
(`openHelp()`/`closeHelp()`) opens a static modal — same overlay pattern as
story settings — covering local text/image setup on Mac and Windows, using a
local model over LAN, and quick tips for the cloud presets. `HELP_CONTENT_HTML`
is hardcoded trusted markup (no user data), so it's set via `innerHTML`
directly rather than through the markdown/DOMPurify pipeline used for chat
content.

## Known rough edges

- `index.html` still has **38 inline `onclick=` handlers**. Extracting them is
  planned (§6/§10 of `imprve_llm.md`) but not done.
- `js/dom.js` exists and is loaded, but **nothing uses it yet** — it's the id
  map for that extraction. Don't assume ids are centralized; grep
  `index.html`.
- `chatlist.js` (378), `cardeditor.js` (425), `chat.js` (447), `cards.js`
  (560), `messages.js` (598), `images.js` (545), `config.js` (513), `state.js`
  (459), `models.js` (402), and `init.js` (763) are still over the ~250-line
  target.
- The **character cast is per-chat** (`chat_meta[chatId].storyConfig.castIds`),
  not global — casting in one chat does not carry to the next.
- Only a card's **embedded** `character_book` is used. SillyTavern's separate
  World Info files, and the lorebook editor, are not implemented.
- `.charx` (v3 zip) cards are not importable — PNG and JSON only.
- A deleted chat's images are not freed until the next reload; see the
  IndexedDB note above. `deleteImagesForChats()` exists but nothing calls it.
- SillyTavern's `data/default-user/characters/Seraphina/` in that install is a
  28-file emotion sprite set. Per-emotion avatars would be a cheap way to add
  expression to the transcript, but nothing reads them yet.
