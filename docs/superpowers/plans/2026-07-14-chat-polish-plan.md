# Chat App Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix streaming columns, add overflow-wrap, improve markdown init, add soft animations (chat input, model dropdown, send button, message highlight), idle auto-unload timer, and RP model profiles.

**Architecture:** Two files only — `style.css` (all CSS changes) and `script.js` (logic + init). No new files needed.

**Tech Stack:** Vanilla JS, CSS custom properties (already defined), `marked` library (already loaded via CDN).

## Global Constraints
- No new dependencies
- Must maintain existing layout and functionality
- LM Studio at `localhost:1234`

---

### Task 1: Formatting fixes (CSS + JS)

**Files:**
- Modify: `style.css` (line ~745 `.message` block)
- Modify: `script.js` (add `marked.setOptions` call)

**Produces:** `marked` initialised with GFM+breaks; `.message` has `overflow-wrap` and `word-break`

- [ ] Add `marked.setOptions({ breaks: true, gfm: true })` near top of script.js after DOMContentLoaded

Add before `initSliders()` call:
```js
marked.setOptions({ breaks: true, gfm: true });
```

- [ ] Add word-break properties to `.message` in style.css

In `.message { ... }` block, add:
```css
overflow-wrap: break-word;
word-break: break-word;
```

- [ ] Verify: open chat, send long message with URLs, text stays within bubble

---

### Task 2: Chat input focus animation

**Files:**
- Modify: `style.css` (line ~815 `#chat-input` and `#chat-input:focus`)

- [ ] Update `#chat-input` transition property

Replace:
```css
transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
```
With:
```css
transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1),
            border-color 200ms ease-out,
            box-shadow 250ms ease-out;
```

- [ ] Update `#chat-input:focus` to add scale and larger glow

Replace:
```css
#chat-input:focus {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-haze);
}
```
With:
```css
#chat-input:focus {
    outline: none;
    border-color: var(--accent-line);
    box-shadow: 0 0 0 8px var(--accent-haze);
    transform: scale(1.015);
}
```

- [ ] Verify: click chat input, see gentle expand + glow

---

### Task 3: Model dropdown animation

**Files:**
- Modify: `style.css` (model-dropdown block, around line ~995)

- [ ] Replace `.model-dropdown` toggle logic with animated version

Replace:
```css
.model-dropdown {
    display: none;
    position: absolute;
    top: var(--s-9);
    left: var(--s-5);
    background: var(--panel-bg);
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    padding: var(--s-1);
    z-index: 11;
    min-width: 240px;
    max-height: 300px;
    overflow-y: auto;
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
}
.model-dropdown.open { display: block; }
```
With:
```css
.model-dropdown {
    position: absolute;
    top: var(--s-9);
    left: var(--s-5);
    background: var(--panel-bg);
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    padding: var(--s-1);
    z-index: 11;
    min-width: 240px;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    transition: max-height 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
                opacity 220ms ease-out;
}
.model-dropdown.open {
    max-height: 320px;
    opacity: 1;
    overflow-y: auto;
}
```

- [ ] Add staggered item entrance in script.js `openModelSelector()`

After populating dropdown items, add:
```js
dropdown.querySelectorAll('.model-dropdown-item').forEach((item, i) => {
    item.style.animation = `dropdownItemIn 200ms ${i * 40}ms both cubic-bezier(0.34, 1.56, 0.64, 1)`;
});
```

- [ ] Add keyframe to style.css

```css
@keyframes dropdownItemIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] Verify: click model selector, see smooth slide+stagger

---

### Task 4: Send button bounce + message highlight

**Files:**
- Modify: `style.css`

- [ ] Add send button click animation

Add to `.btn-send:active` (or create if not existing):
```css
.btn-send:active {
    transform: scale(1.15);
    transition: transform 100ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] Add assistant message left-border highlight flash

Add keyframe:
```css
@keyframes assistIn {
    0%   { border-left: 2px solid var(--accent); }
    100% { border-left: 2px solid transparent; }
}
```

Add to `.message.assistant`:
```css
animation: assistIn 800ms ease-out forwards,
           msgIn 250ms cubic-bezier(0.22, 0.61, 0.36, 1);
```

- [ ] Verify: send message, see button bounce; new assistant msg has left glow

---

### Task 5: Idle auto-unload timer

**Files:**
- Modify: `script.js`

- [ ] Add idle timer variables and functions

Add near top with other globals:
```js
let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
```

Add function:
```js
function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (!selectedModel) return;
    idleTimer = setTimeout(async () => {
        try {
            await fetch('http://localhost:1234/v1/models/unload', { method: 'POST' });
        } catch (e) { /* ignore */ }
        selectedModel = '';
        localStorage.removeItem('selectedModel');
        const nameEl = document.getElementById('current-model-name');
        if (nameEl) nameEl.textContent = 'Select Model';
        idleTimer = null;
    }, IDLE_TIMEOUT);
}
```

- [ ] Call `resetIdleTimer()` in `sendMessage()` after `chatHistory.push()`

Add:
```js
resetIdleTimer();
```

- [ ] Call `resetIdleTimer()` in `selectModel()` after setting model

Add at end of `selectModel()`:
```js
resetIdleTimer();
```

- [ ] Clear timer on page unload — add at bottom of script

```js
window.addEventListener('beforeunload', () => {
    if (idleTimer) clearTimeout(idleTimer);
});
```

- [ ] Verify: wait 30 mins (or test with shorter timeout), model unloads

---

### Task 6: RP model profiles (stretch)

**Files:**
- Modify: `script.js`

- [ ] Add model profiles object

```js
const RP_MODELS = {
    'llama-3some-8b-v2': { hfRepo: 'TheDrummer/llama-3some-8b-v2' },
    'ministrations-8b-v1': { hfRepo: 'TheDrummer/Ministrations-8B-v1' },
    'mn-12b-mag-mell-r1-uncensored-scale1.2-i1': { hfRepo: 'marinara/mn-12b-mag-mell-r1-uncensored-scale1.2-i1' },
};
```

- [ ] Add profile fetch function

```js
async function fetchModelProfile(modelId) {
    const profile = RP_MODELS[modelId];
    if (!profile) return null;
    const cacheKey = `rp_profile_${modelId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
        const resp = await fetch(`https://huggingface.co/${profile.hfRepo}/raw/main/README.md`);
        const text = await resp.text();
        // Extract sampler params from common patterns
        const params = {};
        const tempMatch = text.match(/temperature[:\s]*([\d.]+)/i);
        const topPMatch = text.match(/top_p[:\s]*([\d.]+)/i);
        const topKMatch = text.match(/top_k[:\s]*(\d+)/i);
        const repMatch = text.match(/repeat(?:ition)?[_\s]*penalty[:\s]*([\d.]+)/i);
        if (tempMatch) params.temperature = parseFloat(tempMatch[1]);
        if (topPMatch) params.top_p = parseFloat(topPMatch[1]);
        if (topKMatch) params.top_k = parseInt(topKMatch[1]);
        if (repMatch) params.repetitionPenalty = parseFloat(repMatch[1]);
        localStorage.setItem(cacheKey, JSON.stringify(params));
        return params;
    } catch (e) {
        return null;
    }
}
```

- [ ] Apply profile in `selectModel()`

After setting model, add:
```js
const profile = await fetchModelProfile(modelId);
if (profile) {
    if (profile.temperature != null) {
        apiParams.temperature = profile.temperature;
        document.getElementById('temperature').value = profile.temperature;
        document.getElementById('temp-value').textContent = profile.temperature;
    }
    if (profile.repetitionPenalty != null) {
        apiParams.repetitionPenalty = profile.repetitionPenalty;
        document.getElementById('repetition-penalty').value = profile.repetitionPenalty;
        document.getElementById('rep-value').textContent = profile.repetitionPenalty;
    }
}
```

- [ ] Verify: select an RP model, see sliders update from HuggingFace card

---

## Self-Review

- Spec coverage: All 4 areas covered — formatting (T1), animations (T2-T4), idle unload (T5), RP profiles (T6)
- No placeholders: All steps have actual code
- Type consistency: All function names and selectors match across tasks