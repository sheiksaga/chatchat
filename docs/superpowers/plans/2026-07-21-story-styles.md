# Story Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the storytelling style a per-chat selectable option (Adventure / Roleplay / Game Master), replacing the single hardcoded story prompt.

**Architecture:** A `STORY_STYLES` registry in `js/chat.js` maps a style id to a system-prompt builder. `buildStoryPrompt()` dispatches to the active style. All styles share one config-lines scaffold and the existing speech/action/thought formatting. A new `storyConfig.style` field (default `'cyoa'`) is persisted per-chat and chosen via a segmented pill row in the story-config form.

**Tech Stack:** Vanilla JS (no build step, global scope, classic `<script>` tags), plain HTML/CSS. No test runner — verification is `node --check` for syntax plus small Node `vm` harnesses for pure logic, and a manual browser checklist for DOM/UI.

## Global Constraints

- No build step, no ES modules. All JS is global-scope function/`const`/`let` declarations loaded via `<script>` at end of `<body>`. Script load order: `state → view → api → models → config → chatlist → messages → generations → chat → hero → init`.
- Any new innerHTML built from user/model text MUST be escaped (`escapeHtml`) or built via DOM nodes / `textContent`. Static markup may use innerHTML.
- This is **not** a git repository — there are no commit steps. Each task ends by running `node --check` on every edited `.js` file (expected: no output = pass).
- CYOA output must stay **byte-for-byte identical** to today's prompt so existing stories don't shift behavior. Task 2 includes a regression check enforcing this.
- Temp/harness scripts go in `C:\Users\gandh\.claude\jobs\5a74b809\tmp` (referred to below as `$TMP`).

---

### Task 1: Add `style` to the data model + migration backfill

**Files:**
- Modify: `js/state.js:123-124` (default `storyConfig` shape + JSDoc)
- Modify: `js/state.js:87-98` (add a `style` backfill loop next to the role backfill)
- Test: `$TMP/test-migrate.js` (Node vm harness)

**Interfaces:**
- Produces: `storyConfig` now carries an optional `style` field (`'cyoa' | 'roleplay' | 'gm'`). Persisted story configs in `chat_meta` are backfilled to `style: 'cyoa'` by `migrateData()`.

- [ ] **Step 1: Write the failing test**

Create `$TMP/test-migrate.js`:

```js
const fs = require('fs'), vm = require('vm');
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
// A stored story config that predates the `style` field.
store['chat_meta'] = JSON.stringify({
  c1: { storyConfig: { scene: 'x', characters: [{ name: 'A', traits: '', role: '' }], tags: '', firstPrompt: '' } }
});
const ctx = { localStorage, console, JSON };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/state.js', 'utf8'), ctx);
ctx.migrateData();
const meta = JSON.parse(store['chat_meta']);
const ok = meta.c1.storyConfig.style === 'cyoa';
console.log(ok ? 'PASS style backfilled' : 'FAIL style=' + meta.c1.storyConfig.style);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node "$CLAUDE_JOB_DIR/tmp/test-migrate.js"` (from the project root `E:\Sangeeth\Quick_saves\coding\chat`)
Expected: `FAIL style=undefined` and exit code 1.

- [ ] **Step 3: Add the migration backfill loop**

In `js/state.js`, immediately after the role-backfill loop (the block ending at line 98, right before `if (changed) {`), insert:

```js
    // Backfill story style on stored configs that predate the style field.
    for (const chatId in meta) {
        const sc = meta[chatId]?.storyConfig;
        if (sc && typeof sc === 'object' && !sc.style) {
            sc.style = 'cyoa';
            changed = true;
        }
    }
```

- [ ] **Step 4: Update the default `storyConfig` shape**

In `js/state.js`, replace lines 123-124:

```js
/** @type {{scene:string, characters:Array<{name:string, traits:string, role:string}>, tags:string, firstPrompt:string}} */
let storyConfig = { scene: '', characters: [], tags: '', firstPrompt: '' };
```

with:

```js
/** @type {{style:('cyoa'|'roleplay'|'gm'), scene:string, characters:Array<{name:string, traits:string, role:string}>, tags:string, firstPrompt:string}} */
let storyConfig = { style: 'cyoa', scene: '', characters: [], tags: '', firstPrompt: '' };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node "$CLAUDE_JOB_DIR/tmp/test-migrate.js"`
Expected: `PASS style backfilled` and exit code 0.

- [ ] **Step 6: Syntax check**

Run: `node --check js/state.js`
Expected: no output.

---

### Task 2: Style registry + prompt dispatch

**Files:**
- Modify: `js/chat.js:9-32` (replace `buildStoryPrompt` with registry + scaffold + dispatch)
- Test: `$TMP/test-styles.js` (Node vm harness)

**Interfaces:**
- Produces (global, from `js/chat.js`):
  - `STORY_STYLES` — object keyed by `'cyoa' | 'roleplay' | 'gm'`; each value is `{ label:string, hero:string, buildPrompt(cfg):string }`.
  - `currentStyle()` → returns a valid style id (`storyConfig.style` if known, else `'cyoa'`).
  - `storyHeroText()` → returns the hero-placeholder string for the active style.
  - `buildStoryPrompt()` → dispatches to the active style's `buildPrompt(storyConfig)` (unchanged signature; still consumed by `js/chat.js:56`).

- [ ] **Step 1: Write the failing test**

Create `$TMP/test-styles.js`:

```js
const fs = require('fs'), vm = require('vm');
const ctx = { storyConfig: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/chat.js', 'utf8'), ctx);

const cfg = {
  scene: 'A ship bridge',
  characters: [{ name: 'Shara', traits: 'bossy', role: 'Captain' }, { name: 'Jax', traits: 'nervous', role: 'Pilot' }],
  tags: 'sci-fi', firstPrompt: 'Begin.'
};
function P(style) { ctx.storyConfig = Object.assign({ style }, cfg); return ctx.buildStoryPrompt(); }

// Byte-identical regression baseline for CYOA (replicates the pre-change prompt).
function oldBuild(sc) {
  const parts = [
    'You are a creative storytelling AI running in story mode.',
    'Narrate vividly in second-person ("You stand before...").',
    'Roleplay all non-player characters with distinct voices.',
    'NEVER roleplay what the user says, does, thinks, or feels.',
    'End EVERY response with 2-3 explicit numbered choices.',
    "Move the story forward based on the user's input.",
    'Maintain consistency with established characters, setting, and plot.',
    'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.'
  ];
  if (sc.scene) parts.push('\nScene: ' + sc.scene);
  (sc.characters || []).forEach(function (c) {
    if (!c.name) return;
    var line = 'Character — ' + c.name + ': ' + (c.traits || 'unknown');
    if (c.role && c.role.trim()) line += '. Role: ' + c.role.trim();
    parts.push(line);
  });
  if (sc.tags) parts.push('Tags/Genre: ' + sc.tags);
  if (sc.firstPrompt) parts.push('\n' + sc.firstPrompt);
  return parts.join('\n');
}

const cy = P('cyoa'), rp = P('roleplay'), gm = P('gm');
let ok = true;
function check(name, cond) { if (!cond) { ok = false; console.log('FAIL ' + name); } else console.log('PASS ' + name); }

check('cyoa byte-identical to old prompt', cy === oldBuild(Object.assign({ style: 'cyoa' }, cfg)));
check('roleplay suppresses numbered choices', /Do NOT present numbered choices/i.test(rp));
check('gm suppresses numbered choices', /Do NOT present numbered choices/i.test(gm));
check('roleplay references FIRST character', /FIRST character/i.test(rp));
check('gm references FIRST character', /FIRST character/i.test(gm));
check('all include the scene', cy.includes('A ship bridge') && rp.includes('A ship bridge') && gm.includes('A ship bridge'));
check('all include the character line', [cy, rp, gm].every(p => p.includes('Character — Shara: bossy. Role: Captain')));
check('all include formatting convention', [cy, rp, gm].every(p => /double quotes/.test(p)));
check('unknown style falls back to cyoa', (ctx.storyConfig = Object.assign({}, cfg), ctx.buildStoryPrompt() === oldBuild(cfg)));
check('currentStyle validates', ctx.currentStyle && (ctx.storyConfig = { style: 'bogus' }, ctx.currentStyle() === 'cyoa'));
check('storyHeroText differs for roleplay', (ctx.storyConfig = { style: 'roleplay' }, ctx.storyHeroText() === 'What do you do or say?'));
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node "$CLAUDE_JOB_DIR/tmp/test-styles.js"`
Expected: FAIL lines for the roleplay/gm/currentStyle/storyHeroText checks (those don't exist yet), exit code 1.

- [ ] **Step 3: Replace `buildStoryPrompt` with the registry**

In `js/chat.js`, replace the whole current block (lines 9-32, the `buildStoryPrompt` function) with:

```js
/**
 * The formatting convention line shared by every story style.
 */
const STORY_FORMATTING_LINE = 'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.';

/**
 * Emit the config-derived lines (scene, characters, tags, first prompt) shared
 * by every story style. Order and text match the original CYOA prompt exactly.
 * @param {object} cfg storyConfig
 * @returns {string[]}
 */
function storyConfigLines(cfg) {
    const out = [];
    if (cfg.scene) out.push('\nScene: ' + cfg.scene);
    if (cfg.characters && cfg.characters.length > 0) {
        cfg.characters.forEach(function(c) {
            if (!c.name) return;
            var line = 'Character — ' + c.name + ': ' + (c.traits || 'unknown');
            if (c.role && c.role.trim()) line += '. Role: ' + c.role.trim();
            out.push(line);
        });
    }
    if (cfg.tags) out.push('Tags/Genre: ' + cfg.tags);
    if (cfg.firstPrompt) out.push('\n' + cfg.firstPrompt);
    return out;
}

/**
 * Registry of story styles. Each entry owns its system-prompt instructions but
 * shares the config-lines scaffold and formatting convention.
 */
const STORY_STYLES = {
    cyoa: {
        label: 'Adventure',
        hero: 'What do you do?',
        buildPrompt: function(cfg) {
            var parts = [
                'You are a creative storytelling AI running in story mode.',
                'Narrate vividly in second-person ("You stand before...").',
                'Roleplay all non-player characters with distinct voices.',
                'NEVER roleplay what the user says, does, thinks, or feels.',
                'End EVERY response with 2-3 explicit numbered choices.',
                'Move the story forward based on the user\'s input.',
                'Maintain consistency with established characters, setting, and plot.',
                STORY_FORMATTING_LINE
            ];
            return parts.concat(storyConfigLines(cfg)).join('\n');
        }
    },
    roleplay: {
        label: 'Roleplay',
        hero: 'What do you do or say?',
        buildPrompt: function(cfg) {
            var parts = [
                'You are a masterful roleplay partner running in story mode.',
                'The FIRST character listed below is your lead character — speak and act as them in first person, in character. Voice every other listed character as an NPC when the scene calls for it.',
                'Set the scene, then keep track of who is present, the location, and the mood as the story unfolds.',
                'The user may either DIRECT the scene from outside (e.g. "move toward the cockpit", "we are now in the schoolyard") OR speak and act in character. Interpret which they mean and respond accordingly.',
                'NEVER narrate the user\'s own words, actions, thoughts, or feelings for them.',
                'Do NOT present numbered choices — continue the scene naturally and leave room for the user to act.',
                'Maintain consistency with established characters, setting, and plot.',
                STORY_FORMATTING_LINE
            ];
            return parts.concat(storyConfigLines(cfg)).join('\n');
        }
    },
    gm: {
        label: 'Game Master',
        hero: 'What do you do?',
        buildPrompt: function(cfg) {
            var parts = [
                'You are a skilled game master (GM) running an interactive scene in story mode.',
                'Describe the world vividly, voice every non-player character with a distinct personality, and keep the world consistent and reactive.',
                'The FIRST character listed below is the user\'s player character; every other listed character is an NPC you control.',
                'When the user attempts something with an uncertain outcome, narrate a plausible result WITH consequences — success, partial success, or complication — instead of always letting them succeed. Use narrative judgment only; do NOT roll dice or use numeric stats.',
                'NEVER decide the player character\'s choices, words, or feelings for them.',
                'Do NOT present numbered choices — react to what the user does.',
                'Maintain consistency with established characters, setting, and plot.',
                STORY_FORMATTING_LINE
            ];
            return parts.concat(storyConfigLines(cfg)).join('\n');
        }
    }
};

/**
 * Resolve the active, valid story style id (defaults to 'cyoa').
 * @returns {'cyoa'|'roleplay'|'gm'}
 */
function currentStyle() {
    return (storyConfig && STORY_STYLES[storyConfig.style]) ? storyConfig.style : 'cyoa';
}

/**
 * The hero-input placeholder text for the active story style.
 * @returns {string}
 */
function storyHeroText() {
    return STORY_STYLES[currentStyle()].hero;
}

/**
 * Build the story mode system prompt for the active style.
 * @returns {string}
 */
function buildStoryPrompt() {
    return STORY_STYLES[currentStyle()].buildPrompt(storyConfig);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node "$CLAUDE_JOB_DIR/tmp/test-styles.js"`
Expected: all `PASS` lines, exit code 0. In particular `PASS cyoa byte-identical to old prompt`.

- [ ] **Step 5: Syntax check**

Run: `node --check js/chat.js`
Expected: no output.

---

### Task 3: Wire the style into UI logic (init.js)

**Files:**
- Modify: `js/init.js` — add `setStoryStyle`, `syncStoryStyleUI`; call `syncStoryStyleUI()` from `renderStoryConfig`; make `useDefaultStory` / `generateStory` style-aware; add `style` to import/export.
- Modify: `js/init.js:182-185` (setMode story-branch hero placeholder) to use `storyHeroText()`.

**Interfaces:**
- Consumes: `STORY_STYLES`, `currentStyle()`, `storyHeroText()` (Task 2); `storyConfig`, `saveStoryConfig()`, `renderStoryConfig()`, `refreshHeroSendButton()` (existing).
- Produces (global): `setStoryStyle(id)`, `syncStoryStyleUI()`. Consumed by the pill markup in Task 4.

- [ ] **Step 1: Add `setStoryStyle` and `syncStoryStyleUI`**

In `js/init.js`, immediately before `function setMode(mode) {` (line 148), insert:

```js
/**
 * Set the active story style, persist it, and refresh style-dependent UI.
 * @param {'cyoa'|'roleplay'|'gm'} id
 */
function setStoryStyle(id) {
    if (!STORY_STYLES[id]) return;
    storyConfig.style = id;
    saveStoryConfig();
    syncStoryStyleUI();
    if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
}

/** Reflect the active story style in the pills, hero placeholder, and first-prompt hint. */
function syncStoryStyleUI() {
    var active = currentStyle();
    ['cyoa', 'roleplay', 'gm'].forEach(function(id) {
        var pill = document.getElementById('style-pill-' + id);
        if (pill) {
            pill.classList.toggle('active', id === active);
            pill.setAttribute('aria-pressed', String(id === active));
        }
    });
    // Hero placeholder (only meaningful while the hero view is in story mode).
    var heroPlaceholder = document.getElementById('hero-placeholder');
    if (heroPlaceholder && currentMode === 'story') {
        var span = heroPlaceholder.querySelector('span:last-child');
        if (span) span.textContent = storyHeroText();
    }
    // First-prompt textarea hint.
    var fp = document.getElementById('story-first-prompt');
    if (fp) {
        var hints = {
            cyoa: 'Describe the opening scene and present the first choices for the player.',
            roleplay: 'Set the opening scene and have your lead character open, in character.',
            gm: 'Set up the opening situation and prompt the player for their first action.'
        };
        fp.placeholder = hints[active] || hints.cyoa;
    }
}
```

- [ ] **Step 2: Call `syncStoryStyleUI()` from `renderStoryConfig`**

In `js/init.js`, at the very end of `renderStoryConfig()` — after the `if (charList) { ... }` block closes, immediately before the function's closing brace (line 42) — add:

```js
    syncStoryStyleUI();
```

- [ ] **Step 3: Use `storyHeroText()` in `setMode`**

In `js/init.js`, in the story branch of `setMode` (lines 182-185), replace:

```js
        if (heroPlaceholder) {
            const span = heroPlaceholder.querySelector('span:last-child');
            if (span) span.textContent = 'What do you do?';
        }
```

with:

```js
        if (heroPlaceholder) {
            const span = heroPlaceholder.querySelector('span:last-child');
            if (span) span.textContent = storyHeroText();
        }
```

- [ ] **Step 4: Make `useDefaultStory` style-aware**

In `js/init.js`, replace the `useDefaultStory` body's config assignment (lines 65-72) so it keeps the current style and picks a matching first prompt:

```js
function useDefaultStory() {
    var style = currentStyle();
    var firstPrompts = {
        cyoa: 'Begin the story. Describe the opening scene vividly and present 2-3 clear choices for what happens next.',
        roleplay: 'Set the scene, then open in character as your lead character. Leave room for me to respond.',
        gm: 'Set up the opening situation as game master, then ask what I do.'
    };
    storyConfig = {
        style: style,
        scene: 'A misty forest at twilight. Ancient trees loom overhead, and a narrow path winds deeper into the unknown.',
        characters: [
            { name: 'The Guide', traits: 'mysterious, wise, speaks in riddles', role: 'Enigmatic mentor' }
        ],
        tags: 'fantasy, mystery, adventure',
        firstPrompt: firstPrompts[style] || firstPrompts.cyoa
    };
    renderStoryConfig();
    saveStoryConfig();
    // If hero input is empty, auto-send to start the chat
    var heroText = document.getElementById('hero-input-text') ? document.getElementById('hero-input-text').value.trim() : '';
    if (!heroText) {
        if (!currentChatId) startNewChat();
        showChatView();
        streamAssistantResponse();
    } else {
        sendHeroMessage();
    }
}
```

- [ ] **Step 5: Make `generateStory` style-aware**

In `js/init.js`, in `generateStory()`, replace the `sys` string assignment (line 109) with one that names the active style:

```js
        var styleId = currentStyle();
        var styleHints = {
            cyoa: 'The firstPrompt should tell the AI to describe the opening scene and present 2-3 numbered choices.',
            roleplay: 'The firstPrompt should tell the AI to set the scene and open in character as the first-listed character, leaving room for the user to respond (no numbered choices).',
            gm: 'The firstPrompt should tell the AI, acting as game master, to set up the opening situation and ask the player what they do (no numbered choices).'
        };
        var sys = 'You are a creative writing assistant. Invent a completely original interactive-fiction premise. Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys: "setting" (a vivid 1-2 sentence setting), "characters" (array of 2-4 objects, each with "name", "traits", and "role"), "tags" (comma-separated genres), "firstPrompt" (a short instruction that kicks off the story). ' + (styleHints[styleId] || styleHints.cyoa);
```

Then, in the same function, replace the `storyConfig = { ... }` assignment (lines 125-132) so it preserves the current style:

```js
        storyConfig = {
            style: styleId,
            scene: typeof parsed.setting === 'string' ? parsed.setting : (parsed.scene || ''),
            characters: Array.isArray(parsed.characters)
                ? parsed.characters.map(function(c) { return { name: (c && c.name) || '', traits: (c && c.traits) || '', role: (c && c.role) || '' }; })
                : [],
            tags: parsed.tags || '',
            firstPrompt: parsed.firstPrompt || ''
        };
```

- [ ] **Step 6: Include `style` in export/import**

In `js/init.js`, in `exportStoryConfig`, replace the JSON `data` object (line 356):

```js
        var data = { style: currentStyle(), scene: storyConfig.scene, characters: storyConfig.characters, tags: storyConfig.tags, firstPrompt: storyConfig.firstPrompt, exportedAt: new Date().toISOString() };
```

In the same function's text branch, add a `Style:` line at the top of the `text` array (change the first element, line 374, from `'Scene: ' + ...` to include style before it):

```js
        var text = [
            'Style: ' + STORY_STYLES[currentStyle()].label,
            'Scene: ' + (storyConfig.scene || ''),
```

In `handleStoryImport`, JSON branch, replace the `storyConfig = { ... }` assignment (lines 408-415):

```js
                storyConfig = {
                    style: STORY_STYLES[data.style] ? data.style : 'cyoa',
                    scene: data.scene || '',
                    characters: Array.isArray(data.characters)
                        ? data.characters.map(function(c) { return { name: c.name || '', traits: c.traits || '', role: c.role || '' }; })
                        : [],
                    tags: data.tags || '',
                    firstPrompt: data.firstPrompt || ''
                };
```

In `handleStoryImport`, text branch, replace the reset (line 418):

```js
                storyConfig = { style: 'cyoa', scene: '', characters: [], tags: '', firstPrompt: '' };
```

(Text import intentionally defaults to `cyoa`; the human-readable `Style:` line is best-effort output only.)

- [ ] **Step 7: Syntax check**

Run: `node --check js/init.js`
Expected: no output.

- [ ] **Step 8: Regression-check the prompt harness still passes**

Run: `node "$CLAUDE_JOB_DIR/tmp/test-styles.js"`
Expected: all `PASS` (unchanged — Task 3 doesn't touch `chat.js`, this confirms nothing regressed).

---

### Task 4: Style selector markup + styling

**Files:**
- Modify: `index.html:188-197` (add the style pill row at the top of `#story-config`)
- Modify: `css/style.css` (add `.story-style-pills` override near the `.story-section-label` block ~line 782)

**Interfaces:**
- Consumes: `setStoryStyle(id)` (Task 3); `.config-mode-pills` / `.mini-pill` classes (existing, `css/style.css:1941-1964`).

- [ ] **Step 1: Add the style pill row markup**

In `index.html`, inside `<div class="story-config hidden" id="story-config">` (line 188), insert this as the **first** child, immediately before the `<!-- Use Default pill -->` comment (line 189):

```html
                    <div class="story-section-label">Style</div>
                    <div class="config-mode-pills story-style-pills" role="group" aria-label="Story style">
                        <button type="button" class="mini-pill active" id="style-pill-cyoa" onclick="setStoryStyle('cyoa')" aria-pressed="true">Adventure</button>
                        <button type="button" class="mini-pill" id="style-pill-roleplay" onclick="setStoryStyle('roleplay')" aria-pressed="false">Roleplay</button>
                        <button type="button" class="mini-pill" id="style-pill-gm" onclick="setStoryStyle('gm')" aria-pressed="false">Game Master</button>
                    </div>
```

- [ ] **Step 2: Add the CSS override**

In `css/style.css`, immediately after the `.story-section-label:first-of-type { ... }` rule (line 782), add:

```css
        /* Story style selector: reuse the segmented .config-mode-pills / .mini-pill
           look but left-align it and let it wrap instead of hugging the right edge. */
        .story-style-pills {
            margin-left: 0;
            margin-bottom: var(--s-2);
            width: fit-content;
            max-width: 100%;
            flex-wrap: wrap;
        }
```

- [ ] **Step 3: Syntax sanity (HTML/CSS have no `node --check`)**

Confirm no stray tags by grepping the new IDs resolve once each.
Run: `node -e "const h=require('fs').readFileSync('index.html','utf8'); ['style-pill-cyoa','style-pill-roleplay','style-pill-gm'].forEach(id=>{const n=(h.match(new RegExp('id=\"'+id+'\"','g'))||[]).length; console.log(id, n===1?'PASS':'FAIL x'+n);});"`
Expected: three `PASS` lines.

- [ ] **Step 4: Manual browser smoke test**

Open `index.html` in a browser and verify:
1. Enter Story Mode → a **Style** row with `Adventure · Roleplay · Game Master` appears at the top of the story-config form; **Adventure** is active by default.
2. Click **Roleplay** → the pill highlights, the hero placeholder reads "What do you do or say?", and the First Prompt placeholder changes to the roleplay hint.
3. Click **Game Master** → placeholder returns to "What do you do?", First Prompt hint changes to the GM hint.
4. Start a story in each style and confirm behavior: Adventure ends with numbered choices; Roleplay stays in character with no numbered menu; Game Master narrates outcomes/consequences with no numbered menu.
5. Reload the page → the last-used style is still selected for that chat. Switch to a different chat and back → style persists per chat.
6. Open an existing (pre-change) story chat → it still behaves as Adventure (migration backfilled `cyoa`).
7. Export story config as JSON, re-import it → style round-trips.

---

## Self-Review

**Spec coverage:**
- Style registry (spec §1) → Task 2. ✔
- Shared prompt scaffold + casting convention (spec §2) → Task 2 (`storyConfigLines`, FIRST-character lines). ✔ (Refinement: GM names the first character as the *player character*, since GM has no AI lead; roleplay names it the AI lead. This resolves the spec's ambiguous "AI lead for both" wording in the only way consistent with GM's "user controls one player character".)
- Three prompts (spec §3) → Task 2. ✔
- Data model + migration default `cyoa` (spec §4) → Task 1. ✔
- Style selector pill row + hero/first-prompt placeholders (spec §5) → Task 3 (logic) + Task 4 (markup/CSS). ✔
- Style-aware defaults & generation (spec §6) → Task 3 steps 4-5. ✔
- Export/import `style` (spec §7) → Task 3 step 6. ✔

**Placeholder scan:** No TODO/TBD; every code step shows complete code. ✔

**Type consistency:** `STORY_STYLES` shape `{label, hero, buildPrompt}`, `currentStyle()`, `storyHeroText()`, `setStoryStyle(id)`, `syncStoryStyleUI()` names are used identically across Tasks 2-4. Pill ids `style-pill-<id>` match between Task 3 (`syncStoryStyleUI`, `setStoryStyle`) and Task 4 markup. ✔

**Note for executor:** No git in this repo — skip commits; the per-task `node --check` + harness runs are the gate. CYOA must remain byte-identical (Task 2 step 4 enforces via `PASS cyoa byte-identical to old prompt`).
