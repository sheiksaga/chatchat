# Story Mode Redesign — Design Spec

2026-07-14

## Summary

Replace the flat story config inputs with a structured, sectioned form that starts a story faster. Add per-section entry fields, a "Use Default" quick-start pill, and export/import for story configs.

---

## 1. Hero Area UI (Story Mode)

The hero area in story mode now shows a structured form above the orb:

```
[Chat Mode]  [Story Mode]          ← mode pills (unchanged)
[Use Default]                      ← new pill, appears under Story Mode with bounce-in animation
│
├─ Opening Scene ──────────────────
│  [A dark forest, a spaceship bridge, a medieval tavern...]
│
├─ Characters ─────────────────────
│  [Name] [Characteristics] [X]
│  [Name] [Characteristics] [X]
│  [+ Add Character]
│
├─ Tags ───────────────────────────
│  [fantasy, mystery, horror, sci-fi, romance...]
│
├─ First Prompt ───────────────────
│  [Describe the opening scene and present the first choices.]
│                                   ← textarea, this seeds the AI's first response
│
              (orb)
┌─────────────────────────────────┐
│ ✦ What do you do?              │  ← hero textarea (user's first reply)
│                                │
│                         [Send] │
└─────────────────────────────────┘
```

### 1.1 Section headings

Each section has a small label/heading above its inputs:
- **Opening Scene** — single text input
- **Characters** — dynamic list of name/traits rows + add button
- **Tags** — single comma-separated text input
- **First Prompt** — textarea (multi-line), this is the initial prompt sent to the AI to kick off the story

### 1.2 "Use Default" pill

- Appears only when **Story Mode** is active
- Positioned directly under the mode pills, slightly indented or centered
- Bounces in with a spring animation (`scale(0.9) → scale(1)` with overshoot)
- Pre-fills all fields with a generic fantasy adventure:
  - Scene: `A misty forest at twilight. Ancient trees loom overhead, and a narrow path winds deeper into the unknown.`
  - Characters: `[{name: "The Guide", traits: "mysterious, wise, speaks in riddles"}]`
  - Tags: `fantasy, mystery, adventure`
  - First Prompt: `Begin the story. Describe the opening scene vividly and present 2-3 clear choices for what happens next.`
- Clicking it immediately transitions to chat view and streams the AI's first response

---

## 2. Data Model Changes

### 2.1 `storyConfig` shape

```js
/** @type {{scene: string, characters: Array<{name:string, traits:string}>, tags: string, firstPrompt: string}} */
let storyConfig = {
  scene: '',
  characters: [],
  tags: '',
  firstPrompt: ''
};
```

- `characters` is now an **array of objects** instead of a flat string
- `firstPrompt` is new — this is the seed prompt sent to the AI to start the story

### 2.2 Migration

On load, if `CHAT_META_KEY` contains old flat `storyConfig` (string `characters` field), migrate:
```js
if (typeof storyConfig.characters === 'string') {
  // Split by comma or pipe, create basic entries
  storyConfig.characters = storyConfig.characters
    .split(/[,|]/) 
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({ name, traits: '' }));
}
```

### 2.3 Persistence

`saveStoryConfig()` serializes the full object (including array) into `CHAT_META_KEY`.

---

## 3. Character Row UI

Each character row has:
- **Name input** — `type="text"`, placeholder "Name"
- **Traits input** — `type="text"`, placeholder "Characteristics"
- **Delete button** — `×` icon, removes the row from the array and re-renders

### 3.1 Add Character button
- Styled as a subtle outline pill
- Appends a new empty `{name:'', traits:''}` to `storyConfig.characters`
- Re-renders the character list

### 3.2 Minimum/maximum
- No minimum (empty list is valid)
- Soft maximum: visually starts scrolling after ~6 rows (CSS `max-height` + `overflow-y: auto`)

---

## 4. Export / Import Story Config

### 4.1 Export button

Small icon button (or `Ctrl+Shift+S` shortcut) next to the mode pills or in the config panel. Exports current `storyConfig` as:

**JSON format** (`story-config-YYYY-MM-DD.json`):
```json
{
  "scene": "A misty forest at twilight...",
  "characters": [
    { "name": "The Guide", "traits": "mysterious, wise, speaks in riddles" }
  ],
  "tags": "fantasy, mystery, adventure",
  "firstPrompt": "Begin the story. Describe the opening scene..."
}
```

**Plain text format** (`story-config-YYYY-MM-DD.txt`):
```
Scene: A misty forest at twilight...

Characters:
- The Guide: mysterious, wise, speaks in riddles

Tags: fantasy, mystery, adventure

First Prompt:
Begin the story. Describe the opening scene vividly...
```

### 4.2 Import

- Hidden file input triggered by a small import icon button (or `Ctrl+Shift+L`)
- Accepts `.json` and `.txt`
- For `.json`: `JSON.parse()` → assign to `storyConfig` → re-render fields
- For `.txt`: parse lines starting with known prefixes (`Scene:`, `Characters:`, `Tags:`, `First Prompt:`) using simple regex
- On import, does **not** start a chat — just populates the fields so the user can review/edit before sending

### 4.3 Cleanup on chat delete

When `deleteChat()` or `deleteAllChats()` is called, `storyConfig` data is removed from `CHAT_META_KEY` (already happens via the existing cleanup). The exported files on disk are the user's responsibility.

---

## 5. Chat Behavior Changes

### 5.1 First prompt handling

The **First Prompt** field is **not** shown to the user as a message. Instead:

1. When the user clicks **Send** in hero mode (or **Use Default**):
   - If `storyConfig.firstPrompt` is non-empty, it is prepended to the messages array as `{role: 'system', content: buildStoryPrompt() + '\n\n' + storyConfig.firstPrompt}`
   - The user's first visible message is what they type in the hero textarea
   - If the hero textarea is empty and the user clicks Send (after using **Use Default**), the story starts with just the system prompt and first prompt

2. `buildStoryPrompt()` now includes the first prompt section:
```js
function buildStoryPrompt() {
  const parts = [
    'You are a creative storytelling AI running in story mode.',
    'Narrate vividly in second-person. Roleplay NPCs with distinct voices.',
    'NEVER roleplay the user. End with 2-3 numbered choices.',
  ];
  if (storyConfig.scene) parts.push('Scene: ' + storyConfig.scene);
  storyConfig.characters.forEach(c => {
    if (c.name) parts.push(`Character — ${c.name}: ${c.traits || 'unknown'}`);
  });
  if (storyConfig.tags) parts.push('Tags/Genre: ' + storyConfig.tags);
  if (storyConfig.firstPrompt) parts.push('\n' + storyConfig.firstPrompt);
  return parts.join('\n');
}
```

### 5.2 Compress history in story mode

Preserves story context (same as current behavior), now including `firstPrompt` in the compressed summary prefix.

---

## 6. CSS Additions

### 6.1 Section headings
```css
.story-section-label {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  margin-bottom: var(--s-1);
  margin-top: var(--s-3);
}
```

### 6.2 Character rows
```css
.story-char-row {
  display: flex;
  gap: var(--s-2);
  align-items: center;
  margin-bottom: var(--s-1);
}
.story-char-row input {
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  border: 1px solid var(--stroke);
  color: var(--text);
  font-size: var(--text-sm);
}
.story-char-row input:first-child { flex: 1; }
.story-char-row input:nth-child(2) { flex: 2; }
.story-char-row .btn-del-char {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.story-char-row .btn-del-char:hover { color: var(--danger); }
```

### 6.3 Add character button
```css
.btn-add-char {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 1px dashed var(--stroke);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color 150ms, color 150ms;
}
.btn-add-char:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}
```

### 6.4 First prompt textarea
```css
.story-first-prompt {
  width: 100%;
  min-height: 80px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  border: 1px solid var(--stroke);
  color: var(--text);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  resize: vertical;
}
.story-first-prompt:focus {
  outline: none;
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-haze);
}
```

### 6.5 "Use Default" pill bounce-in
```css
.story-default-pill {
  /* same base as .quick-chip */
  animation: pillBounceIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes pillBounceIn {
  from { opacity: 0; transform: scale(0.85) translateY(6px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

---

## 7. File Changes

| File | Changes |
|---|---|
| `js/state.js` | Update `storyConfig` default shape; add migration logic |
| `index.html` | Replace `story-config` div with sectioned form; add "Use Default" pill |
| `css/style.css` | Add `.story-section-label`, `.story-char-row`, `.btn-add-char`, `.story-first-prompt`, bounce-in keyframe |
| `js/init.js` | Add `renderStoryConfig()`; wire "Use Default" onclick; add export/import handlers; update `setMode()` to toggle new pill |
| `js/chatlist.js` | Update `switchChat()` to load new `storyConfig` shape; update `startNewChat()` |
| `js/chat.js` | Update `buildStoryPrompt()` to use character array + firstPrompt; update `streamAssistantResponse()` to inject first prompt |
| `js/messages.js` | No changes |

---

## 8. Self-Review

- **Placeholder scan:** No TBD/TODO — all fields, templates, behaviors specified.
- **Internal consistency:** `storyConfig` shape updated everywhere; migration handles old data.
- **Scope:** Single focused feature — structured story config + quick-start + export/import.
- **Ambiguity:** First Prompt is explicitly a system-prompt addition, not a visible user message.
