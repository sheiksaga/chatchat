# Story Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chat Mode / Story Mode toggle pills to the hero area, with story config inputs and a specialized system prompt for CYOA-style roleplay.

**Architecture:** Mode state lives in `state.js`. Mode pills replace the existing quick-action chips in `index.html`. Story config fields (scene, characters, tags) appear below the pills when Story Mode is active. `chat.js` constructs a system prompt from story config and prepends it to the first message. Config is persisted per-chat via `CHAT_META_KEY`.

**Tech Stack:** Vanilla JS, CSS custom properties (already defined), no new dependencies.

## Global Constraints
- No new dependencies
- Must maintain existing chat mode behavior unchanged
- LM Studio at `localhost:1234` via `API_BASE` constant
- Story config saved per-chat via existing `CHAT_META_KEY` pattern
- 7 files modified, 0 files created

---

### Task 1: Mode state and story config

**Files:**
- Modify: `js/state.js`

**Produces:** `currentMode` and `storyConfig` variables available to all modules.

- [ ] **Step 1: Add mode state variables to state.js**

Add before the `const apiParams` block at the end of `js/state.js`:

```js
/** @type {'chat'|'story'} */
let currentMode = 'chat';
/** @type {{scene:string, characters:string, tags:string}} */
let storyConfig = { scene: '', characters: '', tags: '' };
```

Open `js/state.js`, read the last few lines to get exact context, then insert these two lines before:

```js
const apiParams = {
    temperature: 0.7,
    repetitionPenalty: 1.1
};
```

- [ ] **Step 2: Verify state.js loads without errors**

Open `index.html` in a browser, check the console (F12). No errors should appear.

---

### Task 2: Replace hero chips with mode pills, add story config inputs

**Files:**
- Modify: `index.html`

**Produces:** Mode toggle pills in the hero area, story config input fields that appear for story mode.

- [ ] **Step 1: Replace quick-action chips with mode pills + story config**

In `index.html`, find the `<div class="quick-actions">` block (contains three `<button class="quick-chip">` elements) and replace with:

```html
                <div class="quick-actions" id="mode-pills">
                    <button class="quick-chip active" id="pill-chat-mode" onclick="setMode('chat')" aria-pressed="true">
                        <span class="quick-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></span> Chat Mode
                    </button>
                    <button class="quick-chip" id="pill-story-mode" onclick="setMode('story')" aria-pressed="false">
                        <span class="quick-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg></span> Story Mode
                    </button>
                </div>

                <!-- Story config (hidden in chat mode) -->
                <div class="story-config hidden" id="story-config">
                    <input type="text" class="story-config-input" id="story-scene" placeholder="Scene: A dark forest, a spaceship bridge, a medieval tavern...">
                    <input type="text" class="story-config-input" id="story-characters" placeholder="Characters: Captain Voss (stern), Elara (mysterious)...">
                    <input type="text" class="story-config-input" id="story-tags" placeholder="Tags: fantasy, mystery, horror, sci-fi, romance...">
                </div>
```

The `story-config` div goes between the mode pills and the orb.

- [ ] **Step 2: Add story config input listeners**

After adding the HTML, wire up input listeners for the story config fields. Add the following code to `js/init.js` inside the `init()` function, after `renderChatList()` and before the view check:

```js
    // Wire story config inputs
    ['story-scene', 'story-characters', 'story-tags'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                storyConfig.scene = document.getElementById('story-scene')?.value || '';
                storyConfig.characters = document.getElementById('story-characters')?.value || '';
                storyConfig.tags = document.getElementById('story-tags')?.value || '';
                saveStoryConfig();
            });
        }
    });
```

- [ ] **Step 3: Verify HTML renders correctly**

Open `index.html` in a browser. Hero area should show two pills [Chat Mode] [Story Mode], with Chat Mode highlighted. Story config fields should be hidden.

---

### Task 3: Mode toggle logic and story config persistence

**Files:**
- Modify: `js/init.js` — add `setMode()` and `saveStoryConfig()` functions, mode pill listener init
- Modify: `js/chatlist.js` — load/save `storyConfig` in `switchChat()` and `startNewChat()`

**Produces:** Clicking mode pills toggles the UI; story config persists per chat.

- [ ] **Step 1: Add `setMode()` global function to init.js**

Before the `init()` function, add:

```js
/**
 * Switch between chat and story mode. Updates pills, toggles story config visibility.
 * @param {'chat'|'story'} mode
 */
function setMode(mode) {
    currentMode = mode;
    const chatPill = document.getElementById('pill-chat-mode');
    const storyPill = document.getElementById('pill-story-mode');
    const storyConfigEl = document.getElementById('story-config');
    const heroPlaceholder = document.getElementById('hero-placeholder');

    if (mode === 'chat') {
        chatPill.classList.add('active');
        chatPill.setAttribute('aria-pressed', 'true');
        storyPill.classList.remove('active');
        storyPill.setAttribute('aria-pressed', 'false');
        storyConfigEl.classList.add('hidden');
        if (heroPlaceholder) heroPlaceholder.querySelector('span:last-child').textContent = '...';
    } else {
        storyPill.classList.add('active');
        storyPill.setAttribute('aria-pressed', 'true');
        chatPill.classList.remove('active');
        chatPill.setAttribute('aria-pressed', 'false');
        storyConfigEl.classList.remove('hidden');
        if (heroPlaceholder) heroPlaceholder.querySelector('span:last-child').textContent = 'What do you do?';
    }
}
```

- [ ] **Step 2: Add `saveStoryConfig()` global function to init.js**

After `setMode()`, add:

```js
/** Persist story config to current chat metadata */
function saveStoryConfig() {
    if (!currentChatId) return;
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now() };
    meta[currentChatId].storyConfig = { ...storyConfig };
    localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
}
```

- [ ] **Step 3: Load story config in `switchChat()` and `startNewChat()`**

In `js/chatlist.js`, modify `switchChat()` — after the line that loads `generationIdx = {};`, add:

```js
    // Load story config for this chat
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    storyConfig = meta[chatId]?.storyConfig || { scene: '', characters: '', tags: '' };
    currentMode = meta[chatId]?.lastMode || 'chat';
    // Sync UI
    setMode(currentMode);
    ['story-scene', 'story-characters', 'story-tags'].forEach((id, i) => {
        const el = document.getElementById(id);
        const keys = ['scene', 'characters', 'tags'];
        if (el) el.value = storyConfig[keys[i]] || '';
    });
```

In `startNewChat()` — after the line that sets `localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));`, change the `meta[currentChatId]` block to:

```js
    meta[currentChatId] = { createdAt: Date.now(), lastMode: currentMode };
```

- [ ] **Step 4: Set placeholder on hero input based on mode**

In `js/chat.js`, in `sendMessage()`, change the placeholder update. Find the line:
```js
    document.getElementById('hero-placeholder').style.display = '';
```
After it, the placeholder should reflect mode. But since `setMode()` already handles this, no extra change needed — verify `sendMessage()` doesn't override the placeholder.

- [ ] **Step 5: Verify mode toggle works**

Open browser → click [Story Mode] pill → story config fields appear, placeholder changes to "What do you do?". Click [Chat Mode] → fields hide, placeholder returns to "...".

---

### Task 4: Story mode system prompt and send logic

**Files:**
- Modify: `js/chat.js`

**Produces:** `sendMessage()` constructs a story system prompt for the first message in story mode. `compressHistory()` preserves story context.

- [ ] **Step 1: Add story prompt builder function to chat.js**

Before the `streamAssistantResponse()` function, add:

```js
/**
 * Build the story mode system prompt from storyConfig.
 * @returns {string}
 */
function buildStoryPrompt() {
    const parts = [
        'You are a creative storytelling AI running in story mode. Your role:',
        '- Narrate the scene vividly in second-person ("You stand before...")',
        '- Roleplay all non-player characters with distinct voices and personalities',
        '- NEVER roleplay what the user says, does, thinks, or feels — leave that for the user',
        '- End EVERY response with 2-3 explicit choices for what happens next (formatted as numbered options like "1. Open the door  2. Turn back  3. Call out")',
        '- Move the story forward based on the user\'s choice or free-text input',
        '- Maintain consistency with established characters, setting, and plot'
    ];
    if (storyConfig.scene) parts.push('\nScene: ' + storyConfig.scene);
    if (storyConfig.characters) parts.push('Characters: ' + storyConfig.characters);
    if (storyConfig.tags) parts.push('Tags/Genre: ' + storyConfig.tags);
    parts.push('\nBegin the story now. Describe the opening scene and present the first choices.');
    return parts.join('\n');
}
```

- [ ] **Step 2: Modify `streamAssistantResponse()` to use story prompt**

In `streamAssistantResponse()`, find the block:
```js
    try {
        const messages = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, ...chatHistory]
            : chatHistory;
```

Replace with:
```js
    try {
        let messages;
        if (currentMode === 'story' && chatHistory.length === 1 && chatHistory[0].role === 'user') {
            // First message in story mode: use story prompt
            messages = [{ role: 'system', content: buildStoryPrompt() }, ...chatHistory];
        } else if (currentMode === 'story' && chatHistory.length > 0) {
            // Continuing story: include story prompt to maintain context
            messages = [{ role: 'system', content: buildStoryPrompt() }, ...chatHistory];
        } else if (systemPrompt) {
            messages = [{ role: 'system', content: systemPrompt }, ...chatHistory];
        } else {
            messages = chatHistory;
        }
```

- [ ] **Step 3: Modify `compressHistory()` to preserve story context**

In `compressHistory()`, find the `summaryPrompt` line:
```js
        const summaryPrompt = 'Summarize the conversation above into a concise paragraph. Keep all key facts, decisions, and context. Output ONLY the summary.';
```

Replace with:
```js
        const storyContext = currentMode === 'story' && (storyConfig.scene || storyConfig.characters)
            ? `[Story: scene="${storyConfig.scene}", characters="${storyConfig.characters}"] `
            : '';
        const summaryPrompt = storyContext + 'Summarize the conversation above into a concise paragraph. Keep all key facts, decisions, and context. Output ONLY the summary.';
```

Also update the compressed history prefix — find:
```js
            chatHistory = [
                { role: 'assistant', content: `[Previous conversation summary: ${summary}]` },
                ...lastExchange
            ];
```

Replace with:
```js
            const storyPrefix = currentMode === 'story' && (storyConfig.scene || storyConfig.characters)
                ? `[Story context: scene="${storyConfig.scene}", characters="${storyConfig.characters}"]\n`
                : '';
            chatHistory = [
                { role: 'assistant', content: `${storyPrefix}[Previous conversation summary: ${summary}]` },
                ...lastExchange
            ];
```

- [ ] **Step 4: Verify story mode flow end-to-end**

1. Open browser, click [Story Mode]
2. Enter scene, characters, tags
3. Type first message and send
4. AI should respond with scene narration + 2-3 choices
5. Type a response (free text or a choice number)
6. AI should continue the story

---

### Task 5: CSS for mode pills and story config

**Files:**
- Modify: `css/style.css`

**Produces:** Active pill styling, story config field styles, smooth expand/collapse transition.

- [ ] **Step 1: Add active pill style**

Find the `.quick-chip` block and add an `.active` variant after `.quick-chip:focus-visible`. Add:

```css
        .quick-chip.active {
            background: var(--accent);
            color: var(--text-on-accent);
            border-color: var(--accent);
        }
        .quick-chip.active .quick-chip-icon { color: var(--text-on-accent); }
```

- [ ] **Step 2: Add story config container and input styles**

Add a new section before the Hero Input section in the CSS. Insert after the `.quick-chip-icon` rule:

```css
        /* Story config fields */
        .story-config {
            display: flex;
            flex-direction: column;
            gap: var(--s-2);
            width: 100%;
            max-width: 720px;
            max-height: 200px;
            opacity: 1;
            overflow: hidden;
            transition: max-height 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
                        opacity 250ms ease-out,
                        margin 250ms ease-out;
            margin-bottom: var(--s-2);
        }
        .story-config.hidden {
            max-height: 0;
            opacity: 0;
            margin-bottom: 0;
            pointer-events: none;
        }
        .story-config-input {
            height: 36px;
            padding: 0 14px;
            border-radius: var(--radius-pill);
            background: var(--panel-bg);
            border: 1px solid var(--stroke);
            color: var(--text);
            font-size: var(--text-sm);
            font-family: var(--font-sans);
            transition: border-color 150ms ease-out;
        }
        .story-config-input:focus {
            outline: none;
            border-color: var(--accent-line);
            box-shadow: 0 0 0 3px var(--accent-haze);
        }
        .story-config-input::placeholder { color: var(--text-muted); }
```

- [ ] **Step 3: Verify styling in browser**

Open browser, click [Story Mode] — config fields should expand smoothly from below the pills. Click [Chat Mode] — fields should collapse. Active pill should be blue filled.

---

### Task 6: Verify everything end-to-end

**Files:**
- None (verification only)

- [ ] **Step 1: Chat mode unchanged**

1. Open browser, default should be Chat Mode with active pill
2. Send a message normally
3. Response should behave as before — no story preamble

- [ ] **Step 2: Story mode full flow**

1. Click [Story Mode] pill
2. Fill in: Scene="Haunted mansion", Characters="Lady Grey, The Butler", Tags="horror, mystery"
3. Send first message: "I knock on the door"
4. AI responds with scene description and 2-3 choices
5. Send response: "I go with option 1"
6. AI continues story, more choices

- [ ] **Step 3: Persistence across chat switch**

1. In story mode, send a few messages
2. Click "New Chat" → hero view appears
3. In the sidebar, click the story chat to switch back
4. Story config fields should be pre-filled with previous values
5. Continue the story — AI should have context

- [ ] **Step 4: Compress history in story mode**

1. In a story mode chat with several exchanges
2. Click "Compress Conversation"
3. Story context should be preserved in the compressed summary
4. Continue the story — AI should still know the scene and characters

- [ ] **Step 5: Mode pills hidden when chatting**

1. Enter story mode, start a chat
2. Mode pills should be hidden (they're in the hero region which is hidden during chat)
3. Return to hero view (new chat) → mode pills visible again