# Story Mode & Appearance Improvements — Design

Date: 2026-07-21
Status: Approved

Browser-based LM Studio chat client (vanilla JS, no build step, global scope,
regular `<script>` tags loaded at end of `<body>`). This spec covers a batch of
story-mode enhancements plus three general UI improvements. No new files, no new
libraries.

## Constraints

- Any new innerHTML carrying user/model text must be sanitized through the
  existing `renderMarkdown` / DOMPurify pipeline, or built via `textContent` /
  DOM nodes.
- Run `node --check` on every edited JS file.
- Preserve backward compatibility with existing saved `storyConfig` objects via
  the migration pattern already in `state.js` (see the `firstPrompt` migration).
- Respect `prefers-reduced-motion` for all new animation.

## Current State (reference)

- `storyConfig` shape: `{ scene, characters: [{name, traits}], tags, firstPrompt }`
  (`state.js:59`). Per-chat, persisted in `chat_meta`.
- Story config form: `#story-config` in `index.html` (~line 161). Fields:
  `#story-scene`, `#story-characters-list`, `#story-tags`, `#story-first-prompt`.
  "Use Default" pill = `useDefaultStory()`.
- `buildStoryPrompt()` in `chat.js:9` assembles the story system prompt.
- `renderStoryConfig()` / `addCharacterRow()` / `removeCharacterRow()` in
  `init.js`; character rows built as two text inputs + delete button.
- Hero send button: `#hero-send-btn` (`.btn-send.hero-send-btn`,
  `onclick=sendHeroMessage()`, index.html:221). Hero textarea `#hero-input-text`.
- Assistant messages rendered via `renderMarkdown` → marked → DOMPurify.
- Message column width governed by `.messages-area` `max-width: 720px` and
  `.message { max-width: 70% }` (style.css:1053).
- `.orb`: radial-gradient circle + `orb-breathe` animation (style.css:625).
  Disabled under reduced motion at style.css:1591.

---

## Story Mode

### 1. Character Role field

- Character model: `{name, traits}` → `{name, traits, role}`.
- Each row in `renderStoryConfig()` renders three inputs: **Name**,
  **Characteristics**, **Relationship/Role** (placeholder e.g. "Ship's captain").
  Wire the existing per-input `input` listener to also handle `field === 'role'`.
- `buildStoryPrompt()` emits, per character:
  `Character — <name>: <traits>. Role: <role>` (omit `Role:` clause when empty).
- Migration in `state.js`: when loading a stored `storyConfig`, default each
  character's `role` to `''` if absent.
- Include `role` in export (`exportStoryConfig`) and import (`handleStoryImport`)
  paths in `init.js`.

### 2. "Start" button flow

- Helper `refreshHeroSendButton()`:
  - If `currentMode === 'story'` AND `#hero-input-text` is empty AND
    `storyConfig.firstPrompt` is non-empty → put `#hero-send-btn` into "Start"
    state: label "Start", add class `.is-start` (drives CSS transition + glow),
    optional ▶ glyph.
  - Otherwise → "Send" state (label "Send", remove `.is-start`).
- Called from: `setMode()`, the `#hero-input-text` `input` listener, and after
  First Prompt changes.
- `sendHeroMessage()` gains a branch: when the button is in Start state and the
  hero input is empty, send `storyConfig.firstPrompt` as the message (it becomes
  the first **user** message, visible at top of chat) instead of the empty input.
- Typing any character in the hero box reverts to Send and sends the typed text.
- Behavior is story-mode only; chat mode unchanged.
- CSS: smooth width/label transition on `#hero-send-btn`; `.is-start` adds accent
  glow. No layout jump (reserve width / use transition on `min-width`).

### 3. "Generate" pill

- New pill next to "Use Default" in `#story-default-wrapper`: **✨ Generate**
  (`onclick=generateStory()`).
- `generateStory()`:
  - Disable/spinner the pill.
  - Non-streaming `fetch` to `${API_BASE}/chat/completions` (pattern from
    `compressHistory`), `temperature` ~0.9, asking for a **complete, fresh,
    random** story config as strict JSON with keys:
    `setting` (→ `scene`), `characters` (array of `{name, traits, role}`),
    `tags`, `firstPrompt`.
  - Parse JSON defensively (strip code fences / extract first `{...}` block).
    On success: replace `storyConfig`, `renderStoryConfig()`, `saveStoryConfig()`.
    On parse/API failure: `showToast(..., 'error')`, leave form untouched.
  - Re-enable pill in `finally`.
- Note: "from scratch" intentionally overwrites any typed fields (approved).

### 4. Story text formatting

- `applyStoryFormatting(msgEl)` runs **after** `renderMarkdown` for assistant
  messages **only when `currentMode === 'story'`** (called from the message
  render path in `messages.js` / streaming completion in `chat.js`).
- Transforms within the rendered message element:
  - `"quotes"` → wrap in `<span class="story-speech">` by walking text nodes
    (TreeWalker over text nodes; no innerHTML regex). Accent color.
  - `<em>` (from `*asterisks*`) → add class `.story-action` (muted italic).
  - inline `<code>` (from `` `backticks` ``) → add class `.story-thought`
    (dim italic, no code background/border).
- Story system prompt (`buildStoryPrompt`) nudged: instruct the model to put
  speech in "double quotes", actions in *asterisks*, and thoughts in `backticks`.
- Scope guard: only story-mode assistant bubbles; chat-mode rendering and chat
  code blocks untouched.

---

## General

### 5. Appearance controls (Config panel)

- New "Appearance" group in the existing config panel with two range sliders +
  a "Reset" link:
  - **Message width** → sets `--content-max-width` on `:root`
    (default 720px; range ~560–1100px). Applied to the message column
    containers currently hardcoded to 720px.
  - **Font size** → sets `--base-font-size` on `:root` (default 16px;
    range ~13–20px).
- Persist to localStorage: `pref_content_width`, `pref_font_size`.
- `applyAppearancePrefs()` reads localStorage and sets the CSS vars; called early
  in `init()` before first paint. Slider `input` listeners update the var live
  and persist.
- CSS: introduce `--content-max-width` and consume it where the message column
  width is set; base font size cascades from `:root`.

### 6. Favicon

- Inline SVG data-URI `<link rel="icon" type="image/svg+xml" href="data:...">`
  in `<head>` — the blue orb reproduced as a radial-gradient circle. No external
  file.

### 7. 3D rotating orb

- Layer `.orb`:
  - Base sphere gradient (fixed) — keep existing.
  - Rotating pseudo-element (`::before` or `::after`) carrying soft light bands,
    slow `rotate` animation (~12s linear) to fake surface rotation, masked to the
    circle (`overflow: hidden` / `border-radius: 50%`).
  - Fixed specular highlight (top-left) + bottom inner shadow for depth.
  - Keep the existing `orb-breathe`.
- Fully disabled under `prefers-reduced-motion` (extend the existing
  `.orb { animation: none }` rule to the new pseudo-element animation).

---

## Files Touched

- `index.html` — role input, Generate pill, favicon link, Appearance config
  sliders.
- `js/state.js` — migration default for `role`.
- `js/chat.js` — `buildStoryPrompt` (role, formatting nudge), Start-flow send
  handling, call `applyStoryFormatting` on streamed completion.
- `js/init.js` — render/wire role + `generateStory()` + `refreshHeroSendButton()`
  + appearance prefs + export/import of `role` + `useDefaultStory` default object.
- `js/messages.js` — `applyStoryFormatting()`, call it in the render path.
- `css/style.css` — story-text styles, Start-button transition, orb 3D layers,
  `--content-max-width` / `--base-font-size` plumbing.

No new files, no new libraries.

## Out of Scope

- Per-chat appearance (width/font are global).
- Any "opening scene" / pre-seeded assistant greeting field.
- Reworking the existing generation-history / story summarization systems.
