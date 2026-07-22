# Project Structure

> For cross-cutting architecture (state model, localStorage schema, provider
> abstraction, story modes, streaming, regeneration) see `AGENTS.md`. This
> file covers the file layout, script load order, and per-file dependencies.

```
chat/
├── index.html              # App shell — HTML markup, no inline CSS/JS
├── css/
│   └── style.css           # All styles (design tokens, layout, components, animations)
└── js/
    ├── state.js            # Application state variables (global)
    ├── view.js             # Hero view / chat view toggle
    ├── api.js              # LM Studio API: streaming, disableInputs
    ├── models.js           # Model selector dropdown, unload, RP profiles, idle timer
    ├── config.js           # Sliders (temp/rep-penalty), config panel, sidebar toggle
    ├── chatlist.js         # Sidebar chat list CRUD (render, switch, delete, new)
    ├── messages.js         # Message rendering, markdown, toolbar builder, saveGenerations
    ├── generations.js      # Regenerate LLM response, cycle through generation history
    ├── chat.js             # sendMessage, sendChatMessage, compressHistory, quickAction
    ├── hero.js             # Hero input interaction (focus, expand, submit)
    └── init.js             # Bootstrap: DOMContentLoaded, app init, event wiring
```

## Script Load Order (dependency chain)

```
state.js  →  view.js  →  api.js  →  models.js  →  config.js
                                              ↘
  chatlist.js  →  messages.js  →  generations.js  →  chat.js  →  hero.js  →  init.js
```

All files share global scope (regular `<script>` tags, not ES modules). Function declarations are hoisted so cross-file calls work regardless of definition order, but the above order ensures event listeners referencing later functions are safe.

## Key Dependencies

| File             | Requires from others                                              |
| ---------------- | ----------------------------------------------------------------- |
| `api.js`         | `state` (apiParams, selectedModel), `messages` (renderMarkdown)   |
| `models.js`      | `state` (all vars), DOM                                           |
| `config.js`      | `state` (apiParams)                                               |
| `chatlist.js`    | `state`, `view` (showHeroView/ showChatView), `messages`, `init` (setMode) |
| `messages.js`    | `state`, `generations` (regenerateMessage, cycleGeneration)       |
| `generations.js` | `state`, `api`, `messages`, `chatlist`, `chat` (streamAssistantResponse) |
| `chat.js`        | `state`, `view`, `api`, `messages`, `models` (resetIdleTimer), `chatlist` |
| `hero.js`        | `chat` (sendMessage)                                              |
| `init.js`        | everything above                                                  |