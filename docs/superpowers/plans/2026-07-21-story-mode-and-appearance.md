# Story Mode & Appearance Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-aware characters, a First-Prompt "Start" flow, an LLM "Generate" pill, speech/action/thought text styling to story mode, plus global appearance controls, a favicon, and a 3D-rotating orb.

**Architecture:** Vanilla JS, global scope, no build step. Scripts load in order (state → view → api → models → config → chatlist → messages → generations → chat → hero → init) via `<script>` tags at end of `<body>`. State lives in `storyConfig` (per-chat, in `chat_meta`) and localStorage prefs. All model/user text rendered via `renderMarkdown` (marked → DOMPurify); new DOM built with `textContent`/nodes to stay XSS-safe.

**Tech Stack:** HTML/CSS/vanilla JS; marked 11.1.1, DOMPurify 3.0.9, highlight.js 11.9.0; LM Studio OpenAI-compatible API at `http://localhost:1234/v1`.

## Global Constraints

- No new files, no new libraries.
- Any innerHTML carrying user/model text MUST go through `renderMarkdown`/DOMPurify, or be built with `textContent`/DOM nodes.
- Run `node --check <file>` on every edited `.js` file; it must pass.
- Preserve backward compatibility with existing saved `storyConfig` objects (migration pattern in `state.js`).
- Respect `prefers-reduced-motion` for all new animation.
- **Testing note:** this project has no unit-test framework. "Verify" steps = `node --check` for JS syntax + a concrete manual browser check. This dir is NOT a git repo, so there are no commit steps.

---

## File Structure

- `js/state.js` — `storyConfig` type + migration default for character `role`.
- `js/chat.js` — `buildStoryPrompt` (role + formatting nudge); call `applyStoryFormatting` on completed story stream.
- `js/messages.js` — `applyStoryFormatting` + `wrapSpeechInNode`; call in `renderMessages`.
- `js/hero.js` — `refreshHeroSendButton`; Start-flow in `sendHeroMessage`; input listener.
- `js/init.js` — role input in `renderStoryConfig`/`addCharacterRow`; role in export/import + `useDefaultStory`; `generateStory` + `parseStoryJson`; call `refreshHeroSendButton` from `setMode`.
- `js/config.js` — `applyAppearancePrefs` + slider wiring in `initSliders`.
- `index.html` — role placeholder note, Generate pill, Appearance sliders, favicon `<link>`.
- `css/style.css` — 3-input char row, Start-button transition, story-text styles, `--content-max-width`/`--base-font-size`, Generate pill loading, orb 3D layers.

---

## Task 1: Character `role` field — state, migration, prompt

**Files:**
- Modify: `js/state.js:58-59` (type comment), `js/state.js:11-37` (`migrateData`)
- Modify: `js/chat.js:20-24` (`buildStoryPrompt` character loop)

**Interfaces:**
- Produces: `storyConfig.characters[i]` now shaped `{name:string, traits:string, role:string}`. `buildStoryPrompt()` emits `Character — <name>: <traits>. Role: <role>` (Role clause omitted when empty).

- [ ] **Step 1: Update the storyConfig type comment**

In `js/state.js`, replace line 58:

```js
/** @type {{scene:string, characters:Array<{name:string, traits:string, role:string}>, tags:string, firstPrompt:string}} */
```

- [ ] **Step 2: Add a role migration default**

In `js/state.js` `migrateData()`, after the existing character-migration `for` loop (after line 33, before `if (changed)`), add a second pass that backfills `role` on every stored character:

```js
    for (const chatId in meta) {
        const chars = meta[chatId]?.storyConfig?.characters;
        if (Array.isArray(chars)) {
            chars.forEach(c => {
                if (c && typeof c === 'object' && c.role === undefined) {
                    c.role = '';
                    changed = true;
                }
            });
        }
    }
```

- [ ] **Step 3: Emit role in buildStoryPrompt**

In `js/chat.js`, replace the character loop (lines 20-24):

```js
    if (storyConfig.characters && storyConfig.characters.length > 0) {
        storyConfig.characters.forEach(function(c) {
            if (!c.name) return;
            var line = 'Character — ' + c.name + ': ' + (c.traits || 'unknown');
            if (c.role && c.role.trim()) line += '. Role: ' + c.role.trim();
            parts.push(line);
        });
    }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check js/state.js && node --check js/chat.js`
Expected: no output, exit 0.

- [ ] **Step 5: Verify in browser**

Open `index.html`, DevTools console:
```js
storyConfig.characters = [{name:'Shara', traits:'bossy, arrogant', role:"Ship's captain"}];
console.log(buildStoryPrompt());
```
Expected: output contains `Character — Shara: bossy, arrogant. Role: Ship's captain`.

---

## Task 2: Character `role` input in the form + export/import

**Files:**
- Modify: `js/init.js:20-40` (`renderStoryConfig` char rows), `js/init.js:49-54` (`addCharacterRow`), `js/init.js:63-71` (`useDefaultStory`), `js/init.js:291-327` (`exportStoryConfig`), `js/init.js:334-373` (`handleStoryImport`)
- Modify: `css/style.css:767-801` (`.story-char-row`)

**Interfaces:**
- Consumes: `{name, traits, role}` character shape from Task 1.
- Produces: form renders three inputs per character; export/import round-trip `role`.

- [ ] **Step 1: Render a third input (Relationship/Role)**

In `js/init.js` `renderStoryConfig()`, replace the `row.innerHTML = ...` assignment (lines 23-26) with:

```js
            row.innerHTML = '<input type="text" placeholder="Name" value="' + escapeHtml(char.name) + '" data-idx="' + i + '" data-field="name">' +
                '<input type="text" placeholder="Characteristics" value="' + escapeHtml(char.traits) + '" data-idx="' + i + '" data-field="traits">' +
                '<input type="text" placeholder="Relationship / Role" value="' + escapeHtml(char.role || '') + '" data-idx="' + i + '" data-field="role">' +
                '<button class="btn-del-char" onclick="removeCharacterRow(' + i + ')" aria-label="Remove character" title="Remove">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
```

The existing per-input listener (lines 31-38) already writes `storyConfig.characters[idx][field]` for any `data-field`, so `role` is handled automatically.

- [ ] **Step 2: Default role in new rows and useDefaultStory**

In `js/init.js` `addCharacterRow()` (line 51), replace:

```js
    storyConfig.characters.push({ name: '', traits: '', role: '' });
```

In `useDefaultStory()` (lines 66-68), replace the characters array:

```js
        characters: [
            { name: 'The Guide', traits: 'mysterious, wise, speaks in riddles', role: 'Enigmatic mentor' }
        ],
```

- [ ] **Step 3: Include role in export**

In `js/init.js` `exportStoryConfig()` JSON branch, the `data` object already spreads `storyConfig.characters` (objects with `role`) — no change needed there. In the text branch, replace the `charLines` map (lines 304-307):

```js
        var charLines = (storyConfig.characters || [])
            .filter(function(c) { return c.name; })
            .map(function(c) {
                var line = '- ' + c.name + ': ' + (c.traits || 'unknown');
                if (c.role) line += ' (' + c.role + ')';
                return line;
            })
            .join('\n');
```

- [ ] **Step 4: Include role in import**

In `js/init.js` `handleStoryImport()` JSON branch, replace the `characters` line (346) so role survives:

```js
                    characters: Array.isArray(data.characters)
                        ? data.characters.map(function(c) { return { name: c.name || '', traits: c.traits || '', role: c.role || '' }; })
                        : [],
```

In the text branch, replace the char-match parse (line 356 regex + 364 push) to capture an optional `(role)` suffix:

```js
                    var charMatch = line.match(/^-\s*(.+?)\s*:\s*(.*)/);
```
stays as-is; replace the push (line 364) with:

```js
                        var traitsRaw = charMatch[2].trim();
                        var roleMatch = traitsRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                        if (roleMatch) {
                            storyConfig.characters.push({ name: charMatch[1].trim(), traits: roleMatch[1].trim(), role: roleMatch[2].trim() });
                        } else {
                            storyConfig.characters.push({ name: charMatch[1].trim(), traits: traitsRaw, role: '' });
                        }
```

Also update the text-branch reset object (line 350) and JSON-branch — leave `firstPrompt` etc. unchanged; only characters differ. The reset object at 350 stays `{ scene: '', characters: [], tags: '', firstPrompt: '' }` (characters filled by parser).

- [ ] **Step 5: Make the char row hold three inputs**

In `css/style.css`, replace the flex-basis rules (lines 789-790):

```css
        .story-char-row { flex-wrap: wrap; }
        .story-char-row input:nth-child(1) { flex: 1 1 30%; min-width: 90px; }
        .story-char-row input:nth-child(2) { flex: 2 1 40%; min-width: 110px; }
        .story-char-row input:nth-child(3) { flex: 1 1 30%; min-width: 100px; }
```

(The `.story-char-row { display:flex; gap; align-items:center; margin-bottom }` block at 767-772 stays; this adds `flex-wrap` and re-does the child sizing.)

- [ ] **Step 6: Verify syntax**

Run: `node --check js/init.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify in browser**

Open `index.html` → Story Mode. Each character row shows **Name / Characteristics / Relationship-Role**. Add a character, fill role, reload page → role persists. Export JSON then Import it → role round-trips. Export Text shows `- Name: traits (role)`.

---

## Task 3: "Start" button flow

**Files:**
- Modify: `js/hero.js:6-32` (`setupHeroInput`), `js/hero.js:49-56` (`sendHeroMessage`); add `refreshHeroSendButton`
- Modify: `js/init.js:89-139` (`setMode` — call refresh), `js/init.js:249-254` (firstPrompt listener — call refresh)
- Modify: `css/style.css` (add `#hero-send-btn` transition + `.is-start`)

**Interfaces:**
- Consumes: `currentMode`, `storyConfig.firstPrompt`.
- Produces: `refreshHeroSendButton()` — global; sets `#hero-send-btn` label to "Start" (adds `.is-start`) when story-mode + empty input + non-empty firstPrompt, else "Send".

- [ ] **Step 1: Add refreshHeroSendButton to hero.js**

In `js/hero.js`, add after `getHeroInputValue` (after line 37):

```js
/**
 * Toggle the hero send button between "Send" and "Start" (story mode,
 * empty input, First Prompt present). Safe to call anytime.
 */
function refreshHeroSendButton() {
    const btn = document.getElementById('hero-send-btn');
    if (!btn) return;
    const ta = document.getElementById('hero-input-text');
    const empty = !ta || !ta.value.trim();
    const fp = storyConfig.firstPrompt && storyConfig.firstPrompt.trim();
    if (currentMode === 'story' && empty && fp) {
        btn.textContent = 'Start';
        btn.classList.add('is-start');
    } else {
        btn.textContent = 'Send';
        btn.classList.remove('is-start');
    }
}
```

- [ ] **Step 2: Refresh on hero input changes**

In `js/hero.js` `setupHeroInput()`, inside the `textarea.blur` handler is fine, but add an `input` listener after the `keydown` listener (after line 31):

```js
    textarea.addEventListener('input', refreshHeroSendButton);
```

- [ ] **Step 3: Use First Prompt as the message when in Start state**

In `js/hero.js`, replace `sendHeroMessage()` (lines 49-56):

```js
async function sendHeroMessage() {
    const btn = document.getElementById('hero-send-btn');
    let text = getHeroInputValue();
    if (!text && btn && btn.classList.contains('is-start')
        && storyConfig.firstPrompt && storyConfig.firstPrompt.trim()) {
        text = storyConfig.firstPrompt.trim();
    }
    if (!text) return;
    await sendMessage(text);
    const ta = document.getElementById('hero-input-text');
    if (ta) { ta.value = ''; ta.blur(); ta.style.height = 'auto'; }
    document.getElementById('hero-input-box').classList.remove('active');
    refreshHeroSendButton();
}
```

- [ ] **Step 4: Refresh from setMode and firstPrompt edits**

In `js/init.js` `setMode()`, add before the closing `}` of the function (after line 138, inside the function, after the persist block):

```js
    if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
```

In `js/init.js` the firstPrompt input listener (lines 249-254), add a refresh call:

```js
    if (firstPromptEl) {
        firstPromptEl.addEventListener('input', function() {
            storyConfig.firstPrompt = firstPromptEl.value;
            saveStoryConfig();
            if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
        });
    }
```

- [ ] **Step 5: Style the Start state**

In `css/style.css`, find the hero send button styling. Add near the hero-input rules (after line 869, the `.hero-input-wrapper` block) a transition + Start style:

```css
        .hero-send-btn {
            transition: background-color 200ms ease-out, box-shadow 220ms ease-out, color 200ms ease-out, transform 120ms ease-out;
        }
        .hero-send-btn.is-start {
            box-shadow: 0 0 18px var(--accent-glow);
            transform: translateZ(0) scale(1.03);
        }
```

- [ ] **Step 6: Verify syntax**

Run: `node --check js/hero.js && node --check js/init.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify in browser**

Open `index.html` → Story Mode → type a First Prompt, leave the hero box empty. The hero button smoothly becomes **Start ▶** (glow). Click it → the First Prompt appears as the first user bubble and the model responds. Reload, new story chat, type text in the hero box → button reverts to **Send** and sends the typed text. In Chat mode the button always says Send.

---

## Task 4: "Generate" pill (LLM-filled story config)

**Files:**
- Modify: `index.html:162-167` (`#story-default-wrapper`)
- Modify: `js/init.js` (add `generateStory` + `parseStoryJson`)
- Modify: `css/style.css` (Generate pill loading state)

**Interfaces:**
- Consumes: `API_BASE`, `selectedModel`, `showToast`, `renderStoryConfig`, `saveStoryConfig`, `refreshHeroSendButton`, `{name,traits,role}` shape.
- Produces: `generateStory()` (onclick), `parseStoryJson(raw)` → object|null.

- [ ] **Step 1: Add the Generate pill next to Use Default**

In `index.html`, inside `#story-default-wrapper` (after the Use Default button, before the closing `</div>` at line 167), add:

```html
                        <button class="quick-chip story-default-pill" id="story-generate-pill" onclick="generateStory()" title="Fill the form with an AI-generated story">
                            <span class="quick-chip-icon">&#x1F3B2;</span> Generate
                        </button>
```

- [ ] **Step 2: Add generateStory + parseStoryJson**

In `js/init.js`, add after `useDefaultStory()` (after line 83):

```js
/**
 * Defensively parse a JSON object from an LLM response (handles code fences
 * and surrounding prose). Returns the parsed object or null.
 */
function parseStoryJson(raw) {
    if (!raw) return null;
    var s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(s.slice(start, end + 1)); } catch (e) {}
    }
    return null;
}

/**
 * Ask the local LLM for a complete, fresh, random story config and fill the form.
 */
async function generateStory() {
    var pill = document.getElementById('story-generate-pill');
    if (pill) { pill.disabled = true; pill.classList.add('is-loading'); }
    try {
        var sys = 'You are a creative writing assistant. Invent a completely original interactive-fiction premise. Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys: "setting" (a vivid 1-2 sentence setting), "characters" (array of 2-4 objects, each with "name", "traits", and "role"), "tags" (comma-separated genres), "firstPrompt" (a short instruction that kicks off the story).';
        var user = 'Generate a fresh, random story configuration now as JSON.';
        var response = await fetch(API_BASE + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: selectedModel || undefined,
                messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
                temperature: 0.9,
                stream: false
            })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();
        var parsed = parseStoryJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
        if (!parsed) throw new Error('could not parse story JSON');
        storyConfig = {
            scene: typeof parsed.setting === 'string' ? parsed.setting : (parsed.scene || ''),
            characters: Array.isArray(parsed.characters)
                ? parsed.characters.map(function(c) { return { name: (c && c.name) || '', traits: (c && c.traits) || '', role: (c && c.role) || '' }; })
                : [],
            tags: parsed.tags || '',
            firstPrompt: parsed.firstPrompt || ''
        };
        renderStoryConfig();
        saveStoryConfig();
        if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
        showToast('Story generated', 'success');
    } catch (err) {
        showToast('Generate failed: ' + err.message, 'error');
    } finally {
        if (pill) { pill.disabled = false; pill.classList.remove('is-loading'); }
    }
}
```

- [ ] **Step 3: Style the loading state**

In `css/style.css`, after the `.story-default-pill` block (after line 765), add:

```css
        .story-default-pill.is-loading { opacity: 0.6; pointer-events: none; }
        .story-default-pill.is-loading .quick-chip-icon { animation: genBounce 700ms ease-in-out infinite; }
```

(`genBounce` already exists at style.css:1108.)

- [ ] **Step 4: Verify syntax**

Run: `node --check js/init.js`
Expected: no output, exit 0.

- [ ] **Step 5: Verify in browser (LM Studio running)**

Open `index.html` → Story Mode → click **🎲 Generate**. Pill dims/animates; on success the Setting, Characters (with roles), Tags, and First Prompt fields fill in and a "Story generated" toast shows. Stop LM Studio and click again → an error toast appears and the form is left untouched.

---

## Task 5: Story text formatting (speech / action / thought)

**Files:**
- Modify: `js/messages.js` (add `applyStoryFormatting` + `wrapSpeechInNode`; call in `renderMessages`)
- Modify: `js/chat.js:65-66` (call after story stream completes)
- Modify: `js/chat.js:9-28` (`buildStoryPrompt` formatting nudge)
- Modify: `css/style.css` (`.story-speech`/`.story-action`/`.story-thought`)

**Interfaces:**
- Consumes: `currentMode`.
- Produces: `applyStoryFormatting(el)` — tags `<em>`→`.story-action`, inline `<code>`→`.story-thought`, wraps `"quotes"` in `<span class="story-speech">`.

- [ ] **Step 1: Add the formatting functions**

In `js/messages.js`, add after `renderMarkdown` (after line 53):

```js
/**
 * Wrap quoted speech runs ("..." or curly quotes) in <span class="story-speech">,
 * skipping code/pre and already-wrapped spans. Operates on text nodes only.
 */
function wrapSpeechInNode(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('code, pre, .story-speech')) continue;
        if (/[“"][^“”"]+[”"]/.test(node.nodeValue)) targets.push(node);
    }
    targets.forEach(textNode => {
        const frag = document.createDocumentFragment();
        const parts = textNode.nodeValue.split(/([“"][^“”"]+[”"])/g);
        parts.forEach(part => {
            if (part && /^[“"][^“”"]+[”"]$/.test(part)) {
                const span = document.createElement('span');
                span.className = 'story-speech';
                span.textContent = part;
                frag.appendChild(span);
            } else if (part) {
                frag.appendChild(document.createTextNode(part));
            }
        });
        textNode.parentNode.replaceChild(frag, textNode);
    });
}

/**
 * Apply story-mode text styling to a rendered assistant message element.
 * Speech = quotes, actions = *asterisks* (<em>), thoughts = `backticks` (inline <code>).
 */
function applyStoryFormatting(el) {
    if (!el) return;
    el.querySelectorAll('em').forEach(n => n.classList.add('story-action'));
    el.querySelectorAll('code').forEach(n => { if (!n.closest('pre')) n.classList.add('story-thought'); });
    wrapSpeechInNode(el);
}
```

- [ ] **Step 2: Call it from renderMessages (story mode only)**

In `js/messages.js` `renderMessages()`, in the assistant branch, after `addMessageToolbar(div, i);` (line 138) add:

```js
            if (currentMode === 'story') applyStoryFormatting(div);
```

- [ ] **Step 3: Call it after a live story stream completes**

In `js/chat.js` `streamAssistantResponse()`, after `announceToSR(fullResponse);` (line 66) add:

```js
            if (currentMode === 'story') applyStoryFormatting(loadingDiv);
```

- [ ] **Step 4: Nudge the model to use the markers**

In `js/chat.js` `buildStoryPrompt()`, add to the `parts` array (inside the initial array literal, after the last existing line at line 17, before the closing `]`):

```js
        'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.'
```

- [ ] **Step 5: Add the styles**

In `css/style.css`, add a new block (e.g. after the `.message.assistant code` rules ~line 1162):

```css
        /* Story-mode prose styling */
        .message.assistant .story-speech { color: var(--accent); }
        .message.assistant em.story-action { color: var(--text-muted); font-style: italic; }
        .message.assistant code.story-thought {
            background: none;
            border: none;
            padding: 0;
            color: var(--text-secondary);
            font-style: italic;
            font-family: var(--font-sans);
        }
```

- [ ] **Step 6: Verify syntax**

Run: `node --check js/messages.js && node --check js/chat.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify in browser**

Open `index.html` → Story Mode, DevTools console:
```js
currentMode = 'story';
const d = document.createElement('div');
d.innerHTML = renderMarkdown('"Get down!" she barked. *She dove behind the crate.* `This was a trap.`');
applyStoryFormatting(d);
console.log(d.innerHTML);
```
Expected: `"Get down!"` wrapped in `span.story-speech`, the action in `em.story-action`, the thought in `code.story-thought`. Then run a real story turn (LM Studio) and confirm speech is accent-colored, actions muted italic, thoughts dim italic. Switch to Chat mode and confirm normal messages are unaffected.

---

## Task 6: Appearance controls (message width + font size)

**Files:**
- Modify: `index.html:117-131` (config panel — add Appearance group)
- Modify: `js/config.js:5-23` (`initSliders` — add `applyAppearancePrefs` + wiring)
- Modify: `css/style.css` (`--content-max-width`, `--base-font-size`, consume on `.message`)

**Interfaces:**
- Produces: `applyAppearancePrefs()` — reads `pref_content_width`/`pref_font_size` (defaults 720/15), sets `--content-max-width`/`--base-font-size` on `document.documentElement`, syncs the two sliders + value labels.

- [ ] **Step 1: Add CSS variables and consume them**

In `css/style.css`, add the two variables to the existing `:root` token block (near the top, wherever `--accent` etc. are declared — add these lines inside that `:root {}`):

```css
            --content-max-width: 720px;
            --base-font-size: 15px;
```

Then in the `.message` rule (line 1051), replace `max-width: 70%;` (line 1053) with:

```css
            max-width: var(--content-max-width);
```

and replace `font-size: var(--text-base);` (line 1055) with:

```css
            font-size: var(--base-font-size, var(--text-base));
```

- [ ] **Step 2: Add the Appearance group to the config panel**

In `index.html`, after the Rep. Penalty slider row (after line 127, before the Compress button at line 128), add:

```html
                <div class="settings-label" style="margin-top:var(--s-2)">Appearance</div>
                <div class="settings-slider-row">
                    <label for="pref-width">Message width</label>
                    <input type="range" id="pref-width" min="520" max="1080" step="20" value="720">
                    <span class="settings-slider-val" id="pref-width-val">720</span>
                </div>
                <div class="settings-slider-row">
                    <label for="pref-font">Font size</label>
                    <input type="range" id="pref-font" min="13" max="20" step="1" value="15">
                    <span class="settings-slider-val" id="pref-font-val">15</span>
                </div>
                <button class="btn-add-char" id="pref-reset" onclick="resetAppearancePrefs()" style="align-self:flex-start">Reset appearance</button>
```

- [ ] **Step 3: Add applyAppearancePrefs + wiring + reset**

In `js/config.js`, add to `initSliders()` (before its closing `}` at line 23):

```js
    applyAppearancePrefs();
    const widthSlider = document.getElementById('pref-width');
    const widthVal = document.getElementById('pref-width-val');
    if (widthSlider) {
        widthSlider.addEventListener('input', () => {
            document.documentElement.style.setProperty('--content-max-width', widthSlider.value + 'px');
            if (widthVal) widthVal.textContent = widthSlider.value;
            localStorage.setItem('pref_content_width', widthSlider.value);
        });
    }
    const fontSlider = document.getElementById('pref-font');
    const fontVal = document.getElementById('pref-font-val');
    if (fontSlider) {
        fontSlider.addEventListener('input', () => {
            document.documentElement.style.setProperty('--base-font-size', fontSlider.value + 'px');
            if (fontVal) fontVal.textContent = fontSlider.value;
            localStorage.setItem('pref_font_size', fontSlider.value);
        });
    }
```

Then add two functions after `initSliders` (after line 23):

```js
/** Apply saved appearance prefs (message width, font size) to CSS vars + sliders. */
function applyAppearancePrefs() {
    const width = localStorage.getItem('pref_content_width') || '720';
    const font = localStorage.getItem('pref_font_size') || '15';
    document.documentElement.style.setProperty('--content-max-width', width + 'px');
    document.documentElement.style.setProperty('--base-font-size', font + 'px');
    const ws = document.getElementById('pref-width'), wv = document.getElementById('pref-width-val');
    const fs = document.getElementById('pref-font'), fv = document.getElementById('pref-font-val');
    if (ws) ws.value = width; if (wv) wv.textContent = width;
    if (fs) fs.value = font; if (fv) fv.textContent = font;
}

/** Reset appearance prefs to defaults. */
function resetAppearancePrefs() {
    localStorage.removeItem('pref_content_width');
    localStorage.removeItem('pref_font_size');
    applyAppearancePrefs();
}
```

- [ ] **Step 4: Verify syntax**

Run: `node --check js/config.js`
Expected: no output, exit 0.

- [ ] **Step 5: Verify in browser**

Open `index.html`, open the config panel (gear). Drag **Message width** → message bubbles narrow/widen live; the value label updates. Drag **Font size** → message text scales live. Reload → both persist. Click **Reset appearance** → returns to 720 / 15.

---

## Task 7: Favicon (blue orb)

**Files:**
- Modify: `index.html:6-11` (`<head>`)

**Interfaces:** none.

- [ ] **Step 1: Add the favicon link**

In `index.html`, after the `<title>Chat</title>` line (line 6), add an inline SVG data-URI favicon reproducing the orb gradient:

```html
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3CradialGradient id='g' cx='38%25' cy='32%25' r='72%25'%3E%3Cstop offset='0%25' stop-color='%23BFE0FF'/%3E%3Cstop offset='35%25' stop-color='%234A8CFF'/%3E%3Cstop offset='75%25' stop-color='%231E3A8A'/%3E%3Cstop offset='100%25' stop-color='%230A1530'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='16' cy='16' r='15' fill='url(%23g)'/%3E%3C/svg%3E">
```

- [ ] **Step 2: Verify in browser**

Open `index.html`. The browser tab shows a small blue orb icon (may need a hard reload / new tab). No console errors.

---

## Task 8: 3D rotating orb

**Files:**
- Modify: `css/style.css:625-637` (`.orb` + keyframes), `css/style.css:1591` (reduced-motion)

**Interfaces:** none.

- [ ] **Step 1: Layer the orb with a rotating surface + fixed specular highlight**

In `css/style.css`, replace the `.orb` block (lines 625-637) with:

```css
        /* Orb (§7.4) — layered pseudo-3D sphere */
        .orb {
            position: relative;
            width: 96px; height: 96px;
            border-radius: 50%;
            overflow: hidden;
            background: radial-gradient(circle at 35% 30%,
                #BFE0FF 0%, #4A8CFF 35%, #1E3A8A 75%, #0A1530 100%);
            box-shadow: 0 0 48px var(--accent-glow);
            animation: orb-breathe 6s ease-in-out infinite;
        }
        .orb::before {
            content: '';
            position: absolute;
            inset: -30%;
            border-radius: 50%;
            background:
                conic-gradient(from 0deg,
                    rgba(255,255,255,0.12), rgba(30,58,138,0) 22%,
                    rgba(127,212,255,0.22) 50%, rgba(30,58,138,0) 78%,
                    rgba(255,255,255,0.12));
            animation: orbSpin 14s linear infinite;
        }
        .orb::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: radial-gradient(circle at 32% 26%, rgba(255,255,255,0.55), transparent 32%);
            box-shadow: inset -8px -10px 26px rgba(5,12,30,0.6),
                        inset 0 0 24px rgba(127,212,255,0.30);
            pointer-events: none;
        }
        @keyframes orb-breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        @keyframes orbSpin {
            to { transform: rotate(360deg); }
        }
```

- [ ] **Step 2: Disable the spin under reduced motion**

In `css/style.css`, find the reduced-motion rule `.orb { animation: none; }` (line 1591) and extend it:

```css
            .orb, .orb::before { animation: none; }
```

- [ ] **Step 3: Verify in browser**

Open `index.html` (hero view visible). The orb shows a fixed top-left highlight + bottom shadow (depth) with a soft light band slowly rotating (~14s) — reads as a spinning 3D sphere, still breathing. In OS "reduce motion" mode, the orb is static. No console errors.

---

## Self-Review

**Spec coverage:**
- Story #1 character Role → Tasks 1 & 2. ✓
- Story #2 Start-button flow → Task 3. ✓
- Story #3 Generate pill → Task 4. ✓
- Story #4 speech/action/thought formatting → Task 5. ✓
- General #5 appearance controls → Task 6. ✓
- General #6 favicon → Task 7. ✓
- General #7 3D rotating orb → Task 8. ✓

**Type consistency:** character shape `{name, traits, role}` used identically in Tasks 1, 2, 4. `refreshHeroSendButton` defined in Task 3, called (guarded) in Tasks 3/4. `applyStoryFormatting(el)` defined and called in Task 5. `applyAppearancePrefs`/`resetAppearancePrefs` defined and wired in Task 6. CSS vars `--content-max-width`/`--base-font-size` declared in Task 6 Step 1 and consumed in the same task.

**Placeholder scan:** none — every step carries concrete code/commands.

**Ordering note:** Tasks are independent enough to run in any order, but 1 → 2 (role state before role UI) and 3 before 4 (refreshHeroSendButton exists; both guard the call anyway). Task 5 is self-contained; 6/7/8 are independent.
