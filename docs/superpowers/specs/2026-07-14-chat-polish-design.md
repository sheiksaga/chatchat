# Chat App Polish — Design Spec

2026-07-14

## Summary

Four polish areas for the modularized chat app: streaming/formatting fixes, soft-playful animations, idle model auto-unload, and RP model profile loading.

---

## 1. Formatting Fixes

### 1.1 Streaming columns bug
**Problem:** During streaming, paragraph blocks appear in separate visual columns, then snap to normal layout at stream end.  

**Root cause:** The `.message` div has no explicit `overflow-wrap` or `word-break`. Markdown `<p>` tags inside the flex-child message container may trigger browser layout quirks on rapid `innerHTML` updates.

**Fix:**
- Add `overflow-wrap: break-word; word-break: break-word;` to `.message` in `style.css`
- Ensure `marked.setOptions({ breaks: true, gfm: true })` is called once during init in `script.js`
- Optional: debounce `innerHTML` updates during streaming to 30ms to reduce layout thrash

### 1.2 Text overflow
- Same `overflow-wrap`/`word-break` fix above handles long unbroken tokens staying within `max-width: 70%`

### 1.3 RP formatting (bold speech, italic thoughts)
- No code change needed. The RP models natively use `**dialogue**` and `*thoughts*`. Marked already renders these.
- For the RP model profiles (stretch), system prompts will encourage this format.

---

## 2. UX Animations (Soft & Playful)

### 2.1 Chat input focus
```css
#chat-input {
    transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 250ms ease-out,
                border-color 200ms ease-out;
}
#chat-input:focus {
    transform: scale(1.015);
    box-shadow: 0 0 0 6px var(--accent-haze);
}
```

### 2.2 Model selector dropdown
- Replace `display: none/block` toggle with `max-height` + `opacity` transition
- Items appear staggered: each child delayed by 40ms × index
- Close: 180ms ease-in (no stagger)

```css
.model-dropdown {
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transition: max-height 250ms cubic-bezier(0.34, 1.56, 0.64, 1),
                opacity 200ms ease-out;
}
.model-dropdown.open {
    max-height: 320px;
    opacity: 1;
}
```

### 2.3 Send button bounce
- On click: `transform: scale(1.15)` for 100ms, then settle back with spring easing

### 2.4 New message entry
- Existing `msgIn` keyframe (`opacity 0→1, translateY 6px→0`) is fine. Add a left-border highlight: a 2px accent line that fades in 600ms on `.message.assistant`

---

## 3. Idle Auto-Unload

### 3.1 Timer logic
- Global `idleTimeout` variable (30 min = 1,800,000 ms)
- Reset on every `sendMessage()` call
- On fire: `POST http://localhost:1234/v1/models/unload`, set `selectedModel = ''`, update UI
- If user sends a message while unloaded, they must re-select a model from the dropdown

### 3.2 Edge case
- If no model is currently selected (e.g. first load), timer is not started
- Timer cleared on page unload (`beforeunload`)

---

## 4. RP Model Profiles (Stretch)

### 4.1 Models
- `llama-3some-8b-v2`
- `ministrations-8b-v1`
- `mn-12b-mag-mell-r1-uncensored-scale1.2-i1`

### 4.2 Flow
1. Fetch HuggingFace model card (`https://huggingface.co/{org}/{model}/raw/main/README.md`)
2. Parse recommended settings (temperature, top_p, repetition_penalty, top_k, context_length)
3. Store in `localStorage` keyed by model ID
4. When model is selected, auto-apply settings to config sliders
5. Fallback: if fetch fails, keep current settings

### 4.3 Known limitations
- Model card parsing is heuristic — some cards use structured YAML, others free text
- Only applies when an RP model is selected from the dropdown; user can override sliders manually

---

## File Changes

| File | Changes |
|---|---|
| `style.css` | Add `overflow-wrap`/`word-break` to `.message`; replace model-dropdown toggle with animated transition; adjust `#chat-input:focus`; add message highlight keyframe |
| `script.js` | Call `marked.setOptions({breaks:true,gfm:true})`; add idle timer logic; add RP model profile fetching (stretch); debounce streaming renders |
| `index.html` | No changes needed |