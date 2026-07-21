# Story Mode Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat story config with a structured sectioned form (scene, characters array, tags, first prompt), add a "Use Default" quick-start pill, and add export/import for story configs.

**Architecture:** Update `storyConfig` to hold an array of characters and a `firstPrompt`. The hero area renders a dynamic form with section labels and character rows. `buildStoryPrompt()` consumes the new shape. Export/import functions read/write JSON and plain text.

**Tech Stack:** Vanilla JS, CSS, `localStorage` (no new dependencies).

## Global Constraints
- No new dependencies
- Must maintain existing chat mode behavior unchanged
- LM Studio at `localhost:1234` via `API_BASE`
- Story config saved per-chat via `CHAT_META_KEY` pattern
- All previous story mode features (system prompt, compression, persistence) still work

---

### Task 1: Update state shape and add migration

**Files:**
- Modify: `js/state.js`

**Interfaces:**
- Consumes: none
- Produces: `storyConfig` (new shape with `characters: []` and `firstPrompt: ''`); `migrateData()` updated

- [ ] **Step 1: Update `storyConfig` default shape**

Replace in `js/state.js`:
```js
let storyConfig = { scene: '', characters: '', tags: '' };
```
With:
```js
let storyConfig = { scene: '', characters: [], tags: '', firstPrompt: '' };
```

- [ ] **Step 2: Add migration for old `storyConfig` format**

Inside `migrateData()`, add after the existing `if (version < 1)` block:
```js
    // Migrate old flat character string to array
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    let changed = false;
    for (const chatId in meta) {
        if (meta[chatId]?.storyConfig && typeof meta[chatId].storyConfig.characters === 'string') {
            const oldChars = meta[chatId].storyConfig.characters;
            meta[chatId].storyConfig.characters = oldChars
                .split(/[,|]/)
                .map(s => s.trim())
                .filter(Boolean)
                .map(name => ({ name, traits: '' }));
            if (!meta[chatId].storyConfig.firstPrompt) {
                meta[chatId].storyConfig.firstPrompt = '';
            }
            changed = true;
        }
    }
    if (changed) {
        localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    }
```

- [ ] **Step 3: Verify no console errors on refresh**

Open browser → F12 console should show no errors.

---

### Task 2: Replace flat story config HTML with sectioned form

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: existing `.quick-chip` styles, `.story-config` CSS block
- Produces: new DOM structure with `id`s: `story-scene`, `story-characters-list`, `story-tags`, `story-first-prompt`, `story-default-pill`

- [ ] **Step 1: Replace `story-config` div**

Find:
```html
                <!-- Story config (hidden in chat mode) -->
                <div class="story-config hidden" id="story-config">
                    <input type="text" class="story-config-input" id="story-scene" placeholder="Scene: A dark forest, a spaceship bridge, a medieval tavern...">
                    <input type="text" class="story-config-input" id="story-characters" placeholder="Characters: Captain Voss (stern), Elara (mysterious)...">
                    <input type="text" class="story-config-input" id="story-tags" placeholder="Tags: fantasy, mystery, horror, sci-fi, romance...">
                </div>
```

Replace with:
```html
                <!-- Story config (hidden in chat mode) -->
                <div class="story-config hidden" id="story-config">
                    <!-- Use Default pill -->
                    <div class="story-default-wrapper" id="story-default-wrapper">
                        <button class="quick-chip story-default-pill" id="story-default-pill" onclick="useDefaultStory()">
                            <span class="quick-chip-icon">✨</span> Use Default
                        </button>
                    </div>

                    <div class="story-section-label">Opening Scene</div>
                    <input type="text" class="story-config-input" id="story-scene" placeholder="A dark forest, a spaceship bridge, a medieval tavern...">

                    <div class="story-section-label">Characters</div>
                    <div id="story-characters-list"></div>
                    <button class="btn-add-char" id="btn-add-char" onclick="addCharacterRow()">+ Add Character</button>

                    <div class="story-section-label">Tags</div>
                    <input type="text" class="story-config-input" id="story-tags" placeholder="fantasy, mystery, horror, sci-fi, romance...">

                    <div class="story-section-label">First Prompt</div>
                    <textarea class="story-first-prompt" id="story-first-prompt" placeholder="Describe the opening scene and present the first choices for the player."></textarea>
                </div>
```

- [ ] **Step 2: Verify HTML renders**

Open browser → click Story Mode → see section labels, character area with "+ Add Character", First Prompt textarea, and "Use Default" pill.

---

### Task 3: Add CSS for new story mode UI

**Files:**
- Modify: `css/style.css`

**Interfaces:**
- Consumes: existing CSS custom properties (`--accent`, `--stroke`, `--panel-bg`, etc.)
- Produces: new selectors for story config sections, character rows, default pill

- [ ] **Step 1: Add section label styles**

Insert after the existing `.story-config-input::placeholder` rule (or near other story config styles):
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
        .story-section-label:first-of-type { margin-top: var(--s-1); }

        .story-default-wrapper {
            display: flex;
            justify-content: center;
            margin-bottom: var(--s-2);
        }
        .story-default-pill {
            animation: pillBounceIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes pillBounceIn {
            from { opacity: 0; transform: scale(0.85) translateY(6px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
        }
```

- [ ] **Step 2: Add character row styles**

Insert after the section label styles:
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
            font-family: var(--font-sans);
            transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
        }
        .story-char-row input:focus {
            outline: none;
            border-color: var(--accent-line);
            box-shadow: 0 0 0 3px var(--accent-haze);
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
            transition: color 150ms ease-out;
        }
        .story-char-row .btn-del-char:hover { color: var(--danger); }

        .btn-add-char {
            height: 32px;
            padding: 0 14px;
            border-radius: var(--radius-pill);
            background: transparent;
            border: 1px dashed var(--stroke);
            color: var(--text-secondary);
            font-size: var(--text-sm);
            cursor: pointer;
            transition: border-color 150ms ease-out, color 150ms ease-out;
            margin-bottom: var(--s-2);
        }
        .btn-add-char:hover {
            border-color: var(--accent-line);
            color: var(--accent);
        }
```

- [ ] **Step 3: Add first prompt textarea styles**

Insert after character row styles:
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
            transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
        }
        .story-first-prompt:focus {
            outline: none;
            border-color: var(--accent-line);
            box-shadow: 0 0 0 3px var(--accent-haze);
        }
        .story-first-prompt::placeholder { color: var(--text-muted); }
```

- [ ] **Step 4: Verify styling**

Open browser → Story Mode → fields should have proper spacing, character rows inline, First Prompt textarea taller than inputs, "Use Default" pill bounces in.

---

### Task 4: Add render and interaction functions for story config

**Files:**
- Modify: `js/init.js`

**Interfaces:**
- Consumes: `storyConfig` (new shape), `currentChatId`, `saveStoryConfig()`
- Produces: `renderStoryConfig()`, `addCharacterRow()`, `removeCharacterRow(index)`, `useDefaultStory()`

- [ ] **Step 1: Add `renderStoryConfig()`**

Add in `js/init.js` before `setMode()`:
```js
/**
 * Render the story config form fields from storyConfig state.
 */
function renderStoryConfig() {
    const sceneEl = document.getElementById('story-scene');
    const tagsEl = document.getElementById('story-tags');
    const firstPromptEl = document.getElementById('story-first-prompt');
    const charList = document.getElementById('story-characters-list');

    if (sceneEl) sceneEl.value = storyConfig.scene || '';
    if (tagsEl) tagsEl.value = storyConfig.tags || '';
    if (firstPromptEl) firstPromptEl.value = storyConfig.firstPrompt || '';

    if (charList) {
        charList.innerHTML = '';
        (storyConfig.characters || []).forEach((char, i) => {
            const row = document.createElement('div');
            row.className = 'story-char-row';
            row.innerHTML = `
                <input type="text" placeholder="Name" value="${escapeHtml(char.name)}" data-idx="${i}" data-field="name">
                <input type="text" placeholder="Characteristics" value="${escapeHtml(char.traits)}" data-idx="${i}" data-field="traits">
                <button class="btn-del-char" onclick="removeCharacterRow(${i})" aria-label="Remove character" title="Remove">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;
            charList.appendChild(row);
        });

        // Wire live input listeners on the new rows
        charList.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', () => {
                const idx = parseInt(input.dataset.idx);
                const field = input.dataset.field;
                if (!storyConfig.characters[idx]) storyConfig.characters[idx] = { name: '', traits: '' };
                storyConfig.characters[idx][field] = input.value;
                saveStoryConfig();
            });
        });
    }
}

/** Minimal HTML escape helper */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 2: Add `addCharacterRow()` and `removeCharacterRow()`**

Add after `renderStoryConfig()`:
```js
function addCharacterRow() {
    if (!storyConfig.characters) storyConfig.characters = [];
    storyConfig.characters.push({ name: '', traits: '' });
    renderStoryConfig();
    saveStoryConfig();
    // Focus the new name input
    const inputs = document.getElementById('story-characters-list')?.querySelectorAll('input');
    if (inputs && inputs.length > 0) {
        inputs[inputs.length - 2]?.focus();
    }
}

function removeCharacterRow(index) {
    if (!storyConfig.characters) return;
    storyConfig.characters.splice(index, 1);
    renderStoryConfig();
    saveStoryConfig();
}
```

- [ ] **Step 3: Add `useDefaultStory()`**

Add after the above:
```js
const DEFAULT_STORY = {
    scene: 'A misty forest at twilight. Ancient trees loom overhead, and a narrow path winds deeper into the unknown.',
    characters: [
        { name: 'The Guide', traits: 'mysterious, wise, speaks in riddles' }
    ],
    tags: 'fantasy, mystery, adventure',
    firstPrompt: 'Begin the story. Describe the opening scene vividly and present 2-3 clear choices for what happens next.'
};

function useDefaultStory() {
    storyConfig = { ...DEFAULT_STORY };
    renderStoryConfig();
    saveStoryConfig();
    // If hero input is empty, auto-send the first prompt to start the chat
    const heroText = document.getElementById('hero-input-text')?.value.trim();
    if (!heroText) {
        // Start chat with just the system prompt (no user message yet)
        if (!currentChatId) startNewChat();
        showChatView();
        streamAssistantResponse();
    } else {
        sendHeroMessage();
    }
}
```

- [ ] **Step 4: Update `setMode()` to render config**

In `setMode()`, after toggling `storyConfigEl` visibility, add:
```js
    if (mode === 'story') {
        renderStoryConfig();
    }
```

- [ ] **Step 5: Update DOMContentLoaded init**

In `init()`, after `renderChatList()`, add:
```js
    // If hero is visible and in story mode, render config fields
    const heroRegion = document.getElementById('hero-region');
    if (heroRegion && !heroRegion.classList.contains('hidden') && currentMode === 'story') {
        renderStoryConfig();
    }
```

- [ ] **Step 6: Wire text input listeners for scene/tags/firstPrompt**

In `init()`, replace the existing story config input listeners block:
```js
    // Wire story config inputs
    const sceneEl = document.getElementById('story-scene');
    const tagsEl = document.getElementById('story-tags');
    const firstPromptEl = document.getElementById('story-first-prompt');

    if (sceneEl) {
        sceneEl.addEventListener('input', () => {
            storyConfig.scene = sceneEl.value;
            saveStoryConfig();
        });
    }
    if (tagsEl) {
        tagsEl.addEventListener('input', () => {
            storyConfig.tags = tagsEl.value;
            saveStoryConfig();
        });
    }
    if (firstPromptEl) {
        firstPromptEl.addEventListener('input', () => {
            storyConfig.firstPrompt = firstPromptEl.value;
            saveStoryConfig();
        });
    }
```

- [ ] **Step 7: Verify form interactions**

Open browser → Story Mode → type in Scene, Tags, First Prompt → switch chats → values persist. Add/remove characters → works. Click "Use Default" → fields populate and story starts.

---

### Task 5: Update chatlist.js for new storyConfig shape

**Files:**
- Modify: `js/chatlist.js`

**Interfaces:**
- Consumes: `storyConfig` (new shape), `CHAT_META_KEY`
- Produces: updated `switchChat()` and `startNewChat()`

- [ ] **Step 1: Update `switchChat()` to load new shape**

Find:
```js
    storyConfig = meta[chatId]?.storyConfig || { scene: '', characters: '', tags: '' };
```
Replace with:
```js
    storyConfig = meta[chatId]?.storyConfig || { scene: '', characters: [], tags: '', firstPrompt: '' };
```

- [ ] **Step 2: Update the UI sync block in `switchChat()`**

Find:
```js
    ['story-scene', 'story-characters', 'story-tags'].forEach((id, i) => {
        const el = document.getElementById(id);
        const keys = ['scene', 'characters', 'tags'];
        if (el) el.value = storyConfig[keys[i]] || '';
    });
```
Replace with:
```js
    if (currentMode === 'story') {
        renderStoryConfig();
    } else {
        // Sync simple fields when not in story mode (defensive)
        const sceneEl = document.getElementById('story-scene');
        if (sceneEl) sceneEl.value = storyConfig.scene || '';
    }
```

- [ ] **Step 3: Update `startNewChat()` to store lastMode properly**

This should already exist as:
```js
    meta[currentChatId] = { createdAt: Date.now(), lastMode: currentMode };
```
No change needed — verify it's present.

- [ ] **Step 4: Verify persistence across chat switch**

Create story → fill fields → switch to another chat → switch back → all fields restored (including characters array).

---

### Task 6: Update buildStoryPrompt and streaming logic

**Files:**
- Modify: `js/chat.js`

**Interfaces:**
- Consumes: `storyConfig` (new shape with `characters` array and `firstPrompt`)
- Produces: updated `buildStoryPrompt()` and `streamAssistantResponse()`

- [ ] **Step 1: Update `buildStoryPrompt()`**

Replace:
```js
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

With:
```js
function buildStoryPrompt() {
    const parts = [
        'You are a creative storytelling AI running in story mode.',
        'Narrate vividly in second-person ("You stand before...").',
        'Roleplay all non-player characters with distinct voices.',
        'NEVER roleplay what the user says, does, thinks, or feels.',
        'End EVERY response with 2-3 explicit numbered choices.',
        'Move the story forward based on the user\'s input.',
        'Maintain consistency with established characters, setting, and plot.'
    ];
    if (storyConfig.scene) parts.push('\nScene: ' + storyConfig.scene);
    if (storyConfig.characters && storyConfig.characters.length > 0) {
        storyConfig.characters.forEach(c => {
            if (c.name) parts.push(`Character — ${c.name}: ${c.traits || 'unknown'}`);
        });
    }
    if (storyConfig.tags) parts.push('Tags/Genre: ' + storyConfig.tags);
    if (storyConfig.firstPrompt) parts.push('\n' + storyConfig.firstPrompt);
    return parts.join('\n');
}
```

- [ ] **Step 2: Update `streamAssistantResponse()` for first prompt**

In `streamAssistantResponse()`, the existing condition:
```js
        let messages;
        if (currentMode === 'story') {
            messages = [{ role: 'system', content: buildStoryPrompt() }, ...chatHistory];
        } else if (systemPrompt) {
            messages = [{ role: 'system', content: systemPrompt }, ...chatHistory];
        } else {
            messages = chatHistory;
        }
```
This already works correctly — `buildStoryPrompt()` now includes `firstPrompt`. No change needed.

- [ ] **Step 3: Update `compressHistory()` for new story config**

In `compressHistory()`, find:
```js
        const storyContext = currentMode === 'story' && (storyConfig.scene || storyConfig.characters)
            ? `[Story: scene="${storyConfig.scene}", characters="${storyConfig.characters}"] `
            : '';
```
Replace with:
```js
        const charNames = (storyConfig.characters || []).map(c => c.name).filter(Boolean).join(', ');
        const storyContext = currentMode === 'story' && (storyConfig.scene || charNames)
            ? `[Story: scene="${storyConfig.scene}", characters="${charNames}"] `
            : '';
```

- [ ] **Step 4: Verify story mode end-to-end**

1. Story Mode → fill scene, add characters, tags, first prompt
2. Send hero message → AI responds with scene + choices
3. Continue story → works
4. Compress history → summary includes story context

---

### Task 7: Add export/import for story configs

**Files:**
- Modify: `js/init.js` (add functions)
- Modify: `index.html` (add small export/import buttons)
- Modify: `css/style.css` (add button styles)

**Interfaces:**
- Consumes: `storyConfig` (current values)
- Produces: `exportStoryConfig()`, `importStoryConfig(file)`

- [ ] **Step 1: Add export/import buttons to HTML**

After the First Prompt textarea in `index.html`, add:
```html
                    <div class="story-action-bar">
                        <button class="btn-story-action" onclick="exportStoryConfig('json')" title="Export as JSON">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Export JSON
                        </button>
                        <button class="btn-story-action" onclick="exportStoryConfig('txt')" title="Export as text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            Export Text
                        </button>
                        <button class="btn-story-action" onclick="triggerStoryImport()" title="Import story config">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            Import
                        </button>
                    </div>
                    <input type="file" id="story-import-input" accept=".json,.txt" style="display:none" onchange="handleStoryImport(this)">
```

- [ ] **Step 2: Add CSS for action bar**

In `css/style.css`, add:
```css
        .story-action-bar {
            display: flex;
            gap: var(--s-2);
            margin-top: var(--s-2);
            flex-wrap: wrap;
        }
        .btn-story-action {
            height: 32px;
            padding: 0 12px;
            border-radius: var(--radius-pill);
            background: var(--panel-bg);
            border: 1px solid var(--stroke);
            color: var(--text-secondary);
            font-size: var(--text-sm);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: border-color 150ms ease-out, color 150ms ease-out;
        }
        .btn-story-action:hover {
            border-color: var(--accent-line);
            color: var(--accent);
        }
```

- [ ] **Step 3: Add export functions to init.js**

Add after `useDefaultStory()`:
```js
function exportStoryConfig(format) {
    const dateStr = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
        const data = { ...storyConfig, exportedAt: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `story-config-${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Story config exported as JSON', 'success');
    } else {
        const charLines = (storyConfig.characters || [])
            .filter(c => c.name)
            .map(c => `- ${c.name}: ${c.traits || 'unknown'}`)
            .join('\n');
        const text = [
            'Scene: ' + (storyConfig.scene || ''),
            '',
            'Characters:',
            charLines || '(none)',
            '',
            'Tags: ' + (storyConfig.tags || ''),
            '',
            'First Prompt:',
            storyConfig.firstPrompt || ''
        ].join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `story-config-${dateStr}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Story config exported as text', 'success');
    }
}

function triggerStoryImport() {
    document.getElementById('story-import-input')?.click();
}

function handleStoryImport(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            if (file.name.endsWith('.json')) {
                const data = JSON.parse(e.target.result);
                storyConfig = {
                    scene: data.scene || '',
                    characters: Array.isArray(data.characters) ? data.characters : [],
                    tags: data.tags || '',
                    firstPrompt: data.firstPrompt || ''
                };
            } else {
                // Parse plain text
                const text = e.target.result;
                const lines = text.split('\n');
                storyConfig = { scene: '', characters: [], tags: '', firstPrompt: '' };
                let section = null;
                let firstPromptLines = [];
                lines.forEach(line => {
                    const sceneMatch = line.match(/^Scene:\s*(.*)/i);
                    const tagMatch = line.match(/^Tags?:\s*(.*)/i);
                    const charMatch = line.match(/^-\s*(.+?)\s*:\s*(.*)/);
                    const firstPromptHeader = line.match(/^First Prompt:/i);
                    if (sceneMatch) {
                        section = 'scene';
                        storyConfig.scene = sceneMatch[1];
                    } else if (tagMatch) {
                        section = 'tags';
                        storyConfig.tags = tagMatch[1];
                    } else if (charMatch) {
                        storyConfig.characters.push({ name: charMatch[1].trim(), traits: charMatch[2].trim() });
                    } else if (firstPromptHeader) {
                        section = 'firstPrompt';
                    } else if (section === 'firstPrompt') {
                        firstPromptLines.push(line);
                    }
                });
                storyConfig.firstPrompt = firstPromptLines.join('\n').trim();
            }
            renderStoryConfig();
            saveStoryConfig();
            showToast('Story config imported', 'success');
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    input.value = ''; // allow re-import of same file
}
```

- [ ] **Step 4: Add keyboard shortcuts**

In the existing `keydown` listener in `init.js`, add:
```js
    // Ctrl+Shift+S: Export story config JSON
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (currentMode === 'story') exportStoryConfig('json');
    }
    // Ctrl+Shift+L: Import story config
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        if (currentMode === 'story') triggerStoryImport();
    }
```

- [ ] **Step 5: Verify export/import**

1. Fill story config → click Export JSON → file downloads correctly
2. Clear form → click Import → select the JSON → fields repopulate
3. Export as text → file is readable plain text
4. Import text → fields repopulate

---

### Task 8: Final verification

- [ ] **Step 1: Chat mode unchanged**

Switch to Chat Mode → send messages → no story prompt leakage → behaves exactly as before.

- [ ] **Step 2: Delete all chats → no leftover story metadata**

Click "Delete All Chats" → refresh → `localStorage` should have no `CHAT_META_KEY` or `chat_` entries.

- [ ] **Step 3: Full story flow**

1. New chat → Story Mode
2. Click "Use Default" → story starts immediately
3. Continue with a few messages
4. Switch to another chat
5. Switch back → all story fields restored (including characters)
6. Export → file looks correct
7. Compress history → summary preserves story context

---

## Self-Review

- **Spec coverage:** Sectioned form (T2), section labels (T3), character rows with add/remove (T4), default pill with bounce (T4), first prompt textarea (T2), export/import JSON+txt (T7), migration (T1), chatlist persistence (T5), prompt builder update (T6), compression update (T6).
- **No placeholders:** All code provided.
- **Type consistency:** `storyConfig.characters` is always an array; `firstPrompt` always a string. Old string data migrated in T1.
