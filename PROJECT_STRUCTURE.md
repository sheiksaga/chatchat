# Project Structure

> For cross-cutting architecture (state model, storage schema, provider
> abstraction, story modes, streaming, regeneration, image generation) see
> `AGENTS.md`. This file covers file layout, script load order, and per-file
> dependencies.

```
chat/
├── README.md               # Human-facing intro
├── index.html              # App shell — markup + 38 inline onclick handlers, no inline CSS
├── css/
│   └── style.css           # Skeleton styles (~458 lines) — see note below
├── js/                     # Classic scripts, global scope — see load order below
│   ├── state.js            # State, storage helpers, provider + image config
│   ├── dom.js              # DOM id map and $() helper — LOADED BUT UNUSED
│   ├── imagestore.js       # IndexedDB blob store for generated images
│   ├── view.js             # Hero view / chat view toggle
│   ├── api.js              # Streaming + one-shot completions, error detail
│   ├── models.js           # Model selector, load/unload, RP profiles, idle timer
│   ├── imageprofile.js     # Per-chat image look: style, seed, character locks
│   ├── config.js           # Sliders, config panel, appearance prefs, text/image provider UI
│   ├── chatlist.js         # Sidebar chat CRUD (render, switch, delete, undo)
│   ├── scene-prompt.js     # /image parsing and scene-prompt building
│   ├── images.js           # Image generation — resolves the active image provider, requests, renders
│   ├── messages.js         # Message rendering, toolbars, image rendering, export/import
│   ├── generations.js      # Regenerate and cycle through responses
│   ├── chat.js             # sendMessage, story styles, compressHistory
│   ├── hero.js             # Hero input interaction
│   ├── help.js             # Setup guide modal (local text/image, LAN, cloud tips)
│   └── init.js             # Bootstrap: DOMContentLoaded, app init, event wiring
├── vendor/                 # Committed third-party libs — relative path, no CDN, no SRI
│   ├── marked.min.js
│   ├── purify.min.js
│   ├── highlight.min.js
│   └── github-dark.min.css
├── test/
│   └── smoke.spec.js       # 11 Playwright smoke tests, all network mocked
├── tools/
│   └── analyze-ux.js       # Dev-only script, not part of the app
├── playwright.config.js    # Serves the dir on port 8765, starts/stops itself
└── package.json            # Dev tooling only (Playwright, prettier)
```

## Styling

`css/style.css` is a deliberate **skeleton**. It replaced ~2,290 lines of
decorative CSS that had drifted out of sync with the markup — the settings
panel, for one, had no matching rule and rendered its whole form inline,
pushing the hero off screen.

The rule for what belongs in it: **styling that carries behaviour, not
appearance.** Those rules are commented `[FUNCTIONAL]` and must survive any
restyle:

| Rule | Why it is load-bearing |
|------|------------------------|
| `.hidden { display: none !important }` | every view toggle routes through it |
| `.hero-input-textarea` collapsed + `.hero-input.active` reveal | the hero input's show/hide; asserted by two tests |
| `.model-dropdown` / `.top-bar-settings` hidden until `.open` | panels are closed by default |
| `.message-image`, `.generated-image`, `.generated-image-missing` | exact names `renderImageMessage()` targets |
| `#sr-announcer` off-screen (not `display:none`) | `display:none` makes assistive tech ignore it |
| `overflow-x` on `pre`, `overflow-wrap` on `.message` | stops long content scrolling the page sideways |

The panel's class is `top-bar-settings`; `config-panel` is only its close
button and its element **id**. Styling the wrong one is what broke the layout.

Decorative parallax layers (`.world`) are still in the markup but not painted.

## Script Load Order

This is the exact order of the `<script>` tags in `index.html`. Keep the two in
sync — this diagram is why a new file lands in the right place instead of being
appended at the end.

```
state.js → dom.js → imagestore.js → view.js → api.js → models.js
  → imageprofile.js → config.js → help.js → chatlist.js → scene-prompt.js
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
| `config.js`       | `state` (apiParams, safeSetItem, provider registry/accessors)            |
| `help.js`         | nothing — static content, only DOM                                       |
| `chatlist.js`     | `state`, `view`, `messages`, `init` (setMode)                            |
| `scene-prompt.js` | `state` (chatHistory), `api` (`requestCompletion`)                       |
| `images.js`       | `state` (imageParams, provider registry/accessors), `imageprofile`, `imagestore`, `messages`, `api` (`apiErrorDetail`) |
| `messages.js`     | `state`, `generations`, `imagestore` (`getImage`)                        |
| `generations.js`  | `state`, `api`, `messages`, `chatlist`, `chat`                           |
| `chat.js`         | `state`, `view`, `api`, `messages`, `models`, `chatlist`, `scene-prompt` (`parseImageCommand`), `images` (`generateImageMessage`) |
| `hero.js`         | `chat` (sendMessage)                                                     |
| `init.js`         | everything above, plus `imagestore` (`pruneOrphanImages` on boot)        |

## File sizes

Rough guide for judging whether a file is safe to read whole, not a contract.

| File | Lines | | File | Lines |
|------|------|---|------|------|
| `js/init.js` | 715 | | `js/imageprofile.js` | 216 |
| `js/messages.js` | 534 | | `js/dom.js` | 125 |
| `js/config.js` | 458 | | `js/help.js` | 136 |
| `js/state.js` | 388 | | `js/scene-prompt.js` | 136 |
| `js/models.js` | 369 | | `js/imagestore.js` | 153 |
| `js/chat.js` | 362 | | `js/api.js` | 198 |
| `js/chatlist.js` | 353 | | `js/hero.js` | 92 |
| `js/images.js` | 340 | | `js/generations.js` | 90 |
| `index.html` | 966 | | `js/view.js` | 18 |

`init.js`, `messages.js`, `config.js`, `state.js`, `models.js`, `chat.js`,
`chatlist.js`, and `images.js` are over the ~250-line target — see §2 of
`imprve_llm.md`. `config.js` and `state.js` grew past it in this change: the
independent text/image provider UI needed a generic per-"kind" renderer
(`config.js`) and a richer provider registry (`state.js`); splitting either
further wasn't obviously cleaner given how tightly the two providers'
render/detail logic share code.
