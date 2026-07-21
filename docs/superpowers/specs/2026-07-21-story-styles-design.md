# Story Styles — Design Spec

**Date:** 2026-07-21
**Status:** Approved

## Problem

Story mode currently supports exactly one storytelling style: a "choose your own
adventure" (CYOA) narrator that writes in second person and ends every reply with
2-3 numbered choices. This is hardcoded in `buildStoryPrompt()` (`js/chat.js`).

The user wants story mode to offer **selectable styles**, starting with three:

1. **Adventure (CYOA)** — the current behavior, unchanged.
2. **Roleplay / Improv** — the AI plays a designated lead character plus other
   characters as NPCs and manages the scene; the user steers and/or participates.
3. **Game Master** — the AI runs a scene like a tabletop GM, narrating outcomes
   and consequences of the user's attempted actions.

The design must leave a clean extension point for additional styles later.

## Goals

- Make the storytelling style a per-chat, selectable option.
- Ship the three styles above.
- Reuse the existing story-config fields (scene, characters, tags, first prompt)
  and the existing speech/action/thought formatting across all styles.
- Zero behavior change for existing story chats (they default to Adventure).

## Non-Goals

- No real dice/stat/skill-check engine for Game Master mode — it is prompt-only.
- No user-editable prompt templates (each style's prompt is fixed in code).
- No new character-row UI (casting uses a convention — see below).
- No co-writer / collaborative-prose style in this iteration.

## Design

### 1. Style registry

Replace the single hardcoded prompt with a `STORY_STYLES` registry object. Each
entry owns its own system-prompt builder but shares the common config fields and
formatting conventions.

```js
const STORY_STYLES = {
  cyoa:     { label: 'Adventure',    hero: 'What do you do?',        buildPrompt(cfg) { … } },
  roleplay: { label: 'Roleplay',     hero: 'What do you do or say?', buildPrompt(cfg) { … } },
  gm:       { label: 'Game Master',  hero: 'What do you do?',        buildPrompt(cfg) { … } },
};
```

`buildStoryPrompt()` becomes a dispatch:

```js
function buildStoryPrompt() {
  const style = STORY_STYLES[storyConfig.style] || STORY_STYLES.cyoa;
  return style.buildPrompt(storyConfig);
}
```

Adding a future style is a matter of adding one key. The registry lives along
`buildStoryPrompt()` in `js/chat.js`.

### 2. Shared prompt scaffold

Every style's `buildPrompt` shares a helper that emits the config-derived lines
(scene, characters, tags, first prompt) and the formatting convention line, so
that block is written once and each style adds only its style-specific
instructions on top. The formatting convention (unchanged) is:

> spoken dialogue in "double quotes", physical actions and narration wrapped in
> \*asterisks\*, and a character's inner thoughts wrapped in \`backticks\`.

The character block continues to emit `Character — <name>: <traits>. Role: <role>`
(role omitted when empty). **Casting convention:** in Roleplay and GM modes the
**first character in the list is the AI's lead character**; every other character
is an NPC the AI voices as needed. In CYOA all characters are simply NPCs (no
lead). No per-character UI is added.

### 3. The three prompts

**Adventure (`cyoa`)** — identical to the current prompt:
- Narrate vividly in second person.
- Roleplay all NPCs with distinct voices.
- Never roleplay what the user says/does/thinks/feels.
- End every response with 2-3 explicit numbered choices.
- Move the story forward based on user input; keep continuity.

**Roleplay (`roleplay`)**:
- The AI plays the **first listed character** as its lead, in first person / in
  character, and voices all other listed characters as NPCs.
- The AI sets and tracks the scene and its state (who is present, location, mood).
- The user may either **direct** out of character (e.g. "move toward the
  cockpit", "we are now in the schoolyard") **or speak/act in character**. The AI
  infers which and responds appropriately.
- The AI never narrates the user's own in-character words or actions for them.
- **No numbered choices** — the AI continues the scene naturally.

**Game Master (`gm`)**:
- The AI runs the scene as a tabletop game master: describes the world, voices
  NPCs, and enforces a consistent, reactive world.
- When the user attempts something with an uncertain outcome, the AI narrates a
  plausible result **with consequences** (success, partial success, or
  complication) rather than always letting the user succeed. This is narrative
  judgment only — **no dice rolls, stats, or numeric mechanics**.
- The user controls exactly one player character (their input = that character's
  intent). The AI never decides the player's choices for them.
- **No numbered choices**.

### 4. Data model & migration

- Add `style` to `storyConfig`: one of `'cyoa' | 'roleplay' | 'gm'`, default
  `'cyoa'`.
- Default in-memory shape becomes
  `{ style: 'cyoa', scene: '', characters: [], tags: '', firstPrompt: '' }`
  (all reset points updated: initial `let`, `useDefaultStory`, `generateStory`,
  import fallback, `setMode` resets).
- **Migration** (bump `data_version`): for every chat meta with a `storyConfig`
  lacking `style`, backfill `style: 'cyoa'`. Existing stories are unaffected.
- Persisted per-chat in `chat_meta` alongside the rest of `storyConfig` (no new
  localStorage key).

### 5. UI

- **Style selector**: a segmented pill row at the top of the story-config form
  (`#story-config`), above "Use Default / Generate", mirroring the existing
  mode-pill pattern. Buttons: `Adventure · Roleplay · Game Master`. Selecting a
  style calls a `setStoryStyle(id)` handler that updates `storyConfig.style`,
  persists, reflects the active pill, and refreshes style-dependent text.
- **Hero placeholder** text follows the active style's `hero` string (via the
  existing placeholder-updating path in `setMode` / a new refresh call).
- **First Prompt placeholder** hint adapts to the style (e.g. CYOA: "…present the
  first choices"; Roleplay: "…open the scene in character"; GM: "…set up the
  opening situation").
- The style pill row is rendered/kept in sync by `renderStoryConfig()`.

### 6. Style-aware defaults & generation

- `useDefaultStory()` picks a default `firstPrompt` (and keeps the rest) matching
  the active style, so "Use Default" produces a sensible opener per style.
- `generateStory()` includes the active style in its instruction so the generated
  `firstPrompt` fits (e.g. roleplay opens in character rather than presenting
  choices). The generated config keeps the currently selected `style`.

### 7. Export / import

- `exportStoryConfig('json')` includes `style` in the exported object.
- `handleStoryImport` reads `style` when present and falls back to `'cyoa'` for
  older exports.
- The human-readable text export/import is unaffected except an optional
  `Style: <label>` line (best-effort; import tolerates its absence).

## Affected files

- `js/chat.js` — `STORY_STYLES` registry, shared scaffold helper, dispatch
  `buildStoryPrompt()`.
- `js/state.js` — default `storyConfig` shape (+ `style`); migration backfill.
- `js/init.js` — `setStoryStyle()`, style-aware `renderStoryConfig` (render pills),
  `useDefaultStory` / `generateStory` style-awareness, import/export `style`,
  reset points.
- `index.html` — style pill row markup inside `#story-config`.
- `css/style.css` — styling for the style pill row (reuse existing pill classes
  where possible).

## Testing

- `node --check` on every edited JS file.
- Manual smoke test: switch between the three styles, confirm the correct system
  prompt is sent (via the model's behavior — choices vs. in-character vs. GM
  narration), placeholders update, style persists across reload and chat switch,
  and existing (pre-migration) story chats still behave as Adventure.
