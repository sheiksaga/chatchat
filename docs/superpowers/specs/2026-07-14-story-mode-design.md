# Story Mode — Design Spec

2026-07-14

## Summary

Add two modes to the chat app: **Chat Mode** (standard LLM companion, current behavior) and **Story Mode** (roleplaying CYOA companion). Mode is toggled via pills in the hero area. Story mode adds scene/character/tag config inputs and a specialized system prompt that instructs the AI to narrate scenes, roleplay NPCs, and end each response with 2-3 explicit choices.

---

## 1. Mode State & Toggle

### 1.1 State (`state.js`)
- `currentMode`: `'chat'` | `'story'`, default `'chat'`
- `storyConfig`: `{ scene, characters, tags }` — per-chat, stored in `CHAT_META_KEY` alongside `name` and `createdAt`

### 1.2 UI — Hero area (`index.html`)
Replace the three quick-action chips (Create Image, Brainstorm, Make a plan) with two mode toggle pills:

```
[Chat Mode]  [Story Mode]
```

- Both are `<button class="quick-chip">` styled identically to the existing chips
- Active pill gets a filled/accent background (new CSS class `.quick-chip.active`)
- Clicking a pill sets `currentMode` and updates the hero area's sub-content
- Both pills are always visible in the hero area; only one is active at a time

### 1.3 Visibility rule
- Mode pills show only in the hero region (hidden when chatting, same as existing chips)
- When returning to hero view (new chat), the last-used mode is remembered

---

## 2. Story Config Inputs

### 2.1 Fields (appear below mode pills when Story Mode is active)
| Field | Input | Placeholder |
|---|---|---|
| Scene | `<input type="text">` | "A dark forest, a spaceship bridge, a medieval tavern..." |
| Characters | `<input type="text">` | "Captain Voss (stern), Elara (mysterious), The Guard..." |
| Tags | `<input type="text">` | "fantasy, mystery, horror, sci-fi, romance..." |

- Fields are in a `.story-config` container, hidden when Chat Mode is active
- Transition: `max-height` + `opacity` for smooth expand/collapse (same pattern as model dropdown)
- Values are saved to `storyConfig` on input change, persisted per-chat via `CHAT_META_KEY`
- All fields are optional — if empty, the system prompt omits that section

### 2.2 Layout in hero area
```
        [Chat Mode]  [Story Mode]        ← mode pills (replaces quick chips)
        ┌ Scene       [________________] ← story config (story mode only)
        │ Characters  [________________]
        │ Tags        [________________]
        └
              (orb)
        ┌─────────────────────────────┐
        │ ✦ What do you do?           │  ← hero input (placeholder changes per mode)
        │                             │
        │                      [Send] │
        └─────────────────────────────┘
```

---

## 3. System Prompt Construction

### 3.1 Chat Mode
Unchanged — uses the user's custom system prompt from the config panel if set.

### 3.2 Story Mode
Constructed automatically from `storyConfig` and mode instructions. The user's config-panel system prompt is **ignored** in story mode (the story prompt replaces it).

**Template:**

```
You are a creative storytelling AI running in story mode. Your role:
- Narrate the scene vividly in second-person ("You stand before...")
- Roleplay all non-player characters with distinct voices and personalities
- NEVER roleplay what the user says, does, thinks, or feels — leave that for the user
- End EVERY response with 2-3 explicit choices for what happens next (formatted as numbered options)
- Move the story forward based on the user's choice or free-text input
- Maintain consistency with established characters, setting, and plot

Scene: {scene}
Characters: {characters}
Tags/Genre: {tags}

Begin the story now. Describe the opening scene and present the first choices.
```

Sections with empty values are omitted from the prompt.

---

## 4. Chat Behavior Changes

### 4.1 `sendMessage()` modifications
- Before building the messages array, check `currentMode`
- If `story` and this is the first message (`chatHistory.length === 0`): prepend the constructed story system prompt as `{ role: 'system', content: '<storyPrompt>' }`
- If `story` and continuing: include the system prompt with all messages (same as chat mode does with user's system prompt)

### 4.2 Compress History in Story Mode
- `compressHistory()` should prefix the summary with `[Story context: scene={scene}, characters={characters}]` to preserve story state through compression

### 4.3 Input placeholder
- Chat Mode: "Message" (unchanged)
- Story Mode hero input: "What do you do?" or "Your response..."
- Story Mode chat input: "Your response..."

---

## 5. Persistence

### 5.1 Story config per chat
- `storyConfig` is saved/loaded per chat via `CHAT_META_KEY` alongside `name` and `createdAt`:
```json
{
  "chat_id_abc": {
    "createdAt": 1720000000000,
    "name": "My Story",
    "storyConfig": {
      "scene": "A haunted mansion on the hill",
      "characters": "Lady Grey, The Butler",
      "tags": "horror, mystery"
    }
  }
}
```

### 5.2 Mode persistence
- `currentMode` is NOT persisted across sessions — always defaults to `'chat'` on load
- Within a session, switching chats preserves the current mode selection

---

## 6. CSS Changes

- `.quick-chip.active` — filled accent background, white text, stronger border (matches `.btn-new-chat` but pill-shaped)
- `.story-config` — flex column container, gap, padding; smooth expand/collapse transition
- `.story-config input` — styled like `#chat-input` but single-line, smaller

---

## 7. File Changes

| File | Changes |
|---|---|
| `js/state.js` | Add `currentMode`, `storyConfig` |
| `index.html` | Replace quick-action chips with mode pills, add story config input rows |
| `css/style.css` | Add `.quick-chip.active`, `.story-config`, story input styles |
| `js/chat.js` | Modify `sendMessage()` for story system prompt; update `compressHistory()` for story context |
| `js/chatlist.js` | Load/save `storyConfig` in `switchChat()` and `startNewChat()` |
| `js/messages.js` | No changes needed (system prompt is transparent to rendering) |
| `js/init.js` | Initialize mode state |

---

## 8. Self-Review

- **No placeholders** — all fields, templates, and behaviors are specified
- **Internal consistency** — mode pills map to `currentMode`; story config maps to system prompt; persistence uses existing `CHAT_META_KEY` pattern
- **Scope** — single feature, ~7 files touched, no new dependencies
- **No ambiguity** — story prompt template is explicit; placeholder text is specified; transitions are defined