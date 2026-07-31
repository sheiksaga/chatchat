# Project Structure

> For cross-cutting architecture (state model, storage schema, provider
> abstraction, story modes, streaming, regeneration, image generation) see
> `AGENTS.md`. This file covers file layout, script load order, and per-file
> dependencies.

```
chat/
├── README.md               # Human-facing intro
├── index.html              # App shell — markup + 35 inline onclick handlers, no inline CSS
├── css/                    # Split from a single 2,270-line style.css
│   ├── tokens.css          # Design tokens (:root custom properties)
│   ├── reset-world.css     # Reset and world/background layer
│   ├── sidebar.css         # Sidebar chat list
│   ├── shell-topbar.css    # App shell and top bar
│   ├── hero.css            # Landing / hero region, orb, prompt chips, story config
│   ├── chat-messages.css   # Message bubbles, markdown, images
│   ├── code-blocks.css     # Code block chrome and syntax theme hooks
│   ├── config.css          # Model dropdowns, config panel
│   ├── components.css      # Motion, toasts, offline banner, icons, dialogs
│   └── responsive.css      # All media queries
├── js/                     # Classic scripts, global scope — see load order below
│   ├── state.js            # State, storage helpers, provider + image config
│   ├── dom.js              # DOM id map and $() helper — LOADED BUT UNUSED
│   ├── imagestore.js       # IndexedDB blob store for generated images
│   ├── view.js             # Hero view / chat view toggle
│   ├── api.js              # Streaming + one-shot completions, error detail
│   ├── models.js           # Model selector, load/unload, RP profiles, idle timer
│   ├── imageprofile.js     # Per-chat image look: style, seed, character locks
│   ├── config.js           # Sliders, config panel, appearance prefs
│   ├── chatlist.js         # Sidebar chat CRUD (render, switch, delete, undo)
│   ├── scene-prompt.js     # /image parsing and scene-prompt building
│   ├── images.js           # Image generation via NanoGPT
│   ├── messages.js         # Message rendering, toolbars, image rendering, export/import
│   ├── generations.js      # Regenerate and cycle through responses
│   ├── chat.js             # sendMessage, story styles, compressHistory
│   ├── hero.js             # Hero input interaction
│   └── init.js             # Bootstrap: DOMContentLoaded, app init, event wiring
├── vendor/                 # Committed third-party libs — relative path, no CDN, no SRI
│   ├── marked.min.js
│   ├── purify.min.js
│   ├── highlight.min.js
│   └── github-dark.min.css
├── test/
│   └── smoke.spec.js       # 9 Playwright smoke tests, all network mocked
├── tools/
│   └── analyze-ux.js       # Dev-only script, not part of the app
├── playwright.config.js    # Serves the dir on port 8765, starts/stops itself
└── package.json            # Dev tooling only (Playwright, prettier)
```

## Script Load Order

This is the exact order of the `<script>` tags in `index.html`. Keep the two in
sync — this diagram is why a new file lands in the right place instead of being
appended at the end.

```
state.js → dom.js → imagestore.js → view.js → api.js → models.js
  → imageprofile.js → config.js → chatlist.js → scene-prompt.js
  → images.js → messages.js → generations.js → chat.js → hero.js → init.js
```

All files share global scope (classic `<script>` tags, not ES modules).
Cross-file calls work regardless of order because they only fire after
`DOMContentLoaded`, by which point every script has executed.

`state.js` stays first — every other file reads its globals, and `API_BASE` is
computed at parse time. `init.js` stays last — it wires the DOM and must see
every function.

## Key Dependencies

| File              | Requires from others                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `state.js`        | nothing (`showToast` is optional, guarded by `typeof`)                    |
| `dom.js`          | nothing — currently unused by any other file                             |
| `imagestore.js`   | `state` (`getChatIndex` for orphan pruning)                              |
| `api.js`          | `state` (apiParams, selectedModel, apiHeaders)                           |
| `models.js`       | `state`, DOM                                                             |
| `imageprofile.js` | `state` (chat meta accessors, chatHistory, storyConfig), `api` (`requestCompletion`) |
| `config.js`       | `state` (apiParams, safeSetItem)                                         |
| `chatlist.js`     | `state`, `view`, `messages`, `init` (setMode)                            |
| `scene-prompt.js` | `state` (chatHistory), `api` (`requestCompletion`)                       |
| `images.js`       | `state` (imageParams, imageApiBase/Headers), `imageprofile`, `imagestore`, `messages`, `api` (`apiErrorDetail`) |
| `messages.js`     | `state`, `generations`, `imagestore` (`getImage`)                        |
| `generations.js`  | `state`, `api`, `messages`, `chatlist`, `chat`                           |
| `chat.js`         | `state`, `view`, `api`, `messages`, `models`, `chatlist`, `scene-prompt` (`parseImageCommand`), `images` (`generateImageMessage`) |
| `hero.js`         | `chat` (sendMessage)                                                     |
| `init.js`         | everything above, plus `imagestore` (`pruneOrphanImages` on boot)        |

## File sizes

Rough guide for judging whether a file is safe to read whole, not a contract.

| File | Lines | | File | Lines |
|------|------|---|------|------|
| `js/init.js` | 578 | | `js/config.js` | 170 |
| `js/messages.js` | 469 | | `js/imagestore.js` | 137 |
| `js/models.js` | 321 | | `js/dom.js` | 124 |
| `js/chat.js` | 312 | | `js/scene-prompt.js` | 123 |
| `js/chatlist.js` | 282 | | `js/hero.js` | 82 |
| `js/state.js` | 240 | | `js/generations.js` | 76 |
| `js/images.js` | 212 | | `js/view.js` | 17 |
| `js/imageprofile.js` | 212 | | `index.html` | ~360 |
| `js/api.js` | 187 | | | |

`init.js`, `messages.js`, `models.js`, `chat.js`, and `chatlist.js` are still
over the ~250-line target — see §2 of `imprve_llm.md`.
