# Parity checklist (legacy → rewrite)

`legacy/` holds the pre-rewrite app. Copy behaviour from there, not from memory: each row names the
file that implements it today. Tick a row only when the rewrite does the same thing **and** a test
covers it.

| Feature                                                        | Legacy source                               | Status                                                                       |
| -------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Streaming chat with llama.cpp                                  | `legacy/js/api.js`                          | done — verified on the router                                                |
| Samplers (temp / top_k / min_p / repeat_penalty)               | `legacy/js/config.js`, `api.js`             | done — `providerOptions`, autopilot from `models-router.ini`                 |
| Thinking suppression for reasoning models                      | `legacy/js/api.js` (`chat_template_kwargs`) | done                                                                         |
| Provider switching (llama.cpp / LM Studio / OpenAI-compatible) | `legacy/js/state.js`, `config.js`           | done — `/settings`, registry, per-provider model choice                      |
| Server-side API keys                                           | legacy kept them in `localStorage`          | done (improvement: keys never reach the browser)                             |
| Chat list / create                                             | `legacy/js/chatlist.js`                     | done                                                                         |
| Chat rename / delete                                           | `legacy/js/chatlist.js`                     | done                                                                         |
| Message persistence                                            | `legacy/js/chatstore.js`, `tools/serve.js`  | done — SQLite + FTS5, WAL                                                    |
| Markdown + code highlighting while streaming                   | `legacy/js/messages.js`                     | done (`svelte-streamdown`)                                                   |
| Regenerate / cycle generations                                 | `legacy/js/generations.js`                  | done — `‹ › vN/M`, alternates in `generations`                               |
| Message edit / delete                                          | `legacy/js/messages.js`                     | done (no branch-from-edit yet)                                               |
| Composer autosize, Enter/Shift+Enter, stop                     | `legacy/js/composer.js`, `chat.js`          | done — Stop keeps the partial reply                                          |
| Scroll stick-to-bottom, per-message gen stats                  | `legacy/js/messages.js`                     | done (+ jump-to-latest)                                                      |
| Character cards v1/v2/v3                                       | `legacy/js/cards.js`                        | done — PNG/JSON/old manifest, avatars                                        |
| Card editor, cast picker                                       | `legacy/js/cardeditor.js`                   | done — including lorebook editing                                            |
| RP prompt assembly                                             | `legacy/js/rp.js`                           | done — server-side, 20 tests                                                 |
| Lorebooks / world info                                         | — (new capability)                          | done — matching, injection, ordering, budget, editing                        |
| Story file per chat                                            | `legacy/js/storyfile.js`                    | partial — JSON column + API (`look` persisted); scene list UI still missing  |
| Message search                                                 | — (new capability)                          | done — FTS5 endpoint + sidebar search box                                    |
| Image generation (ComfyUI graphs)                              | `legacy/js/comfy.js`                        | done — `POST /api/images` streams progress, verified on the GPU              |
| Image model table                                              | `legacy/js/imagemodels.js`                  | partial — curated defaults (`KREA2_DEFAULTS`); live `/object_info` not yet   |
| Image viewport / zoom / regenerate                             | `legacy/js/imageview.js`                    | done — full-screen viewer, regenerate, same-seed, delete                     |
| Inpainting (mask + LLLite)                                     | `legacy/js/comfy.js`                        | done — brush mask editor → `/api/images/inpaint`, verified on the GPU        |
| Scene → image prompt                                           | `legacy/js/sceneprompt.js`                  | done — `prompts/scene.ts` (deliberately smaller: see the file's header)      |
| `/image` command                                               | `legacy/js/images.js`                       | done — composer intercepts it, the model never sees it                       |
| `[[IMG: …]]` markers in replies                                | `legacy/js/comfy.js` (ComfyInject)          | done — parsed into "make this image" buttons instead of auto-generating      |
| Appearance prefs (content width, font size, user name)         | `legacy/js/config.js`                       | done — `/settings`, applied as CSS variables                                 |
| Help / setup guide                                             | `legacy/js/help.js`                         | partial — `/diagnostics` + `docs/TROUBLESHOOTING.md`; no in-app walkthrough  |
| LAN access for phone                                           | legacy was loopback-only                    | done (improvement) — token + HMAC cookie, verified over LAN/Tailscale        |
| No runtime CDN                                                 | legacy loaded Google Fonts Inter            | done — system UI font stack, manifest + icon self-hosted, zero external URLs |
| offline-first PWA (installable, works without network)         | —                                           | partial — installable manifest; no service worker yet                        |

## Intentional differences

- **Keys and prompts never leave the server.** The browser posts messages; the server owns the system
  prompt, samplers and keys. This is why `/api/*` exists for everything.
- **Image markers do not auto-generate.** A reply that wants a picture shows a button. Silent GPU work
  the user did not ask for is worse than one click.
- **No virtualised transcript.** Several hundred messages render fine and virtualisation would break
  in-page search; revisit only with evidence.
- **`sceneprompt.js` was 672 lines of output repair.** The rewrite asks for tags the card already has
  instead of fixing prose afterwards — shorter, testable, and the same pictures in practice.
