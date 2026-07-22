# ChatChat UI/UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the concrete UI/UX defects found in a full design-review pass (source read + live Playwright rendering) of ChatChat's hero, chat, and mobile views, without disturbing the parts of the design that already work well (token system, accent restraint, message bubble craft, existing state coverage).

**Architecture:** ChatChat is a no-build, no-framework static app (`index.html` + `css/style.css` + classic-script `js/*.js`, all sharing one global scope — see `AGENTS.md`). Every task here is a scoped CSS/markup/JS edit to that existing structure. Nothing here introduces a bundler, framework, or new runtime dependency for the shipped app.

**Tech Stack:** Plain HTML/CSS/JS (no build step). Verification uses a **dev-only** Playwright script at `tools/playwright/` (not shipped, not referenced by `index.html`) that renders the app via `file://` and screenshots/measures it — this project has no test suite or linter (`AGENTS.md`), so this script *is* the test harness for this plan.

**Status:** All 6 tasks are DONE (implemented and verified). See the "As shipped" note at the end of Task 1 for a CSS cascade gotcha hit during implementation, and the note at the end of Task 6 for the direction chosen there. Not yet committed to git (per this plan's own constraint: don't commit unless the session's user asks).

## Global Constraints

- No build step, no bundler, no framework — keep every fix as plain CSS/HTML/vanilla JS matching the existing style (see `AGENTS.md`, `PROJECT_STRUCTURE.md`).
- Preserve the existing design tokens, class names, and dark-only blue-accent theme except where a task explicitly changes a token value.
- `js/*.js` files are classic `<script>` tags sharing one global scope — do not convert to modules, do not add imports/exports.
- Don't add new CDN dependencies unless a task explicitly calls for it.
- Never use `git commit` as part of executing a task unless the user operating the session asks for a commit — leave changes staged/ready and say so.

---

## Setup (do this once, before Task 1)

The verification tool needs its own `node_modules` and a downloaded Chromium binary — this is separate from the app itself and never touches `index.html`.

```bash
cd tools/playwright
npm install
npx playwright install chromium
```

If `npx`/`npm` aren't on PATH, Node.js is missing — install it first (e.g. `brew install node` on macOS; confirmed working via Homebrew during this review). The Playwright MCP plugin some sessions have enabled needs the same Node/npx to launch its own MCP server — if that MCP server's tools aren't showing up after `/reload-plugins`, this `tools/playwright/shot.js` script is the fallback path and doesn't depend on the MCP server at all.

Run the baseline capture before making any change, so you have a true "before" to diff against:

```bash
node shot.js
```

This writes 10 PNGs to `tools/playwright/shots/` (gitignored): hero (chat + story mode), config panel, active hero input, seeded chat view, message-toolbar hover, collapsed sidebar, mobile chat, mobile sidebar-open, tablet hero. Re-run after each task and re-inspect the relevant screenshot(s) named in that task's Verification step.

---

### Task 1: Fix the offline banner — it visually and functionally breaks the shell

**Confirmed via live rendering, not just source reading:** with Chromium driven headlessly against `index.html`, `document.elementFromPoint()` at the mobile hamburger button's center returns the `.offline-banner` div, not the button — i.e. on the `max-width:639px` breakpoint, whenever the configured provider is unreachable (the default out-of-the-box state for anyone who hasn't started LM Studio yet), **the sidebar cannot be opened at all**, because the banner physically sits on top of the only control that opens it. Visually, the banner is also a flat, fully-saturated coral-red bar spanning the entire viewport width at `top:0`, slicing directly across the rounded top corner of the floating glass `.app-shell` and dominating far more of the palette than the app's restrained ~10% accent budget anywhere else.

This task converts it from a full-bleed, click-blocking, high-contrast alarm bar into a small non-interactive status chip that can never sit on top of a real control, and that matches the app's own toast/glass visual language instead of a stock OS-alert look.

**Files:**
- Modify: `css/style.css:1911-1929` (`.offline-banner` rule + `@keyframes offlineSlideIn`)
- Modify: `js/models.js:293-299` (`showOfflineBanner`)
- Test: `tools/playwright/shot.js` (already covers this; verification step below adds one assertion)

**Interfaces:**
- Consumes: existing tokens `--panel-bg`, `--danger`, `--text`, `--radius-pill`, `--s-2`, `--s-3`, `--text-xs` (all already defined in `css/style.css`'s token block, untouched by this task).
- Produces: `showOfflineBanner()` keeps its exact existing signature and global-scope name (`js/models.js:293`), still called the same way from `checkAPIHealth()` (`js/models.js:307,310`) and `config.js:110` — no caller changes needed.

- [x] **Step 1: Replace the CSS rule**

In `css/style.css`, replace the current block (lines 1911-1929):

```css
        .offline-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 99;
            background: rgba(230,106,122,0.9);
            color: white;
            text-align: center;
            padding: 6px;
            font-size: var(--text-xs);
            font-weight: 600;
            animation: offlineSlideIn 200ms ease-out;
        }
        @keyframes offlineSlideIn {
            from { transform: translateY(-100%); }
            to   { transform: translateY(0); }
        }
```

with:

```css
        .offline-banner {
            position: fixed;
            top: var(--s-3);
            left: 50%;
            transform: translateX(-50%);
            z-index: 15;
            display: flex;
            align-items: center;
            gap: var(--s-2);
            background: var(--panel-bg);
            color: var(--text);
            border: 1px solid rgba(230,106,122,0.35);
            border-radius: var(--radius-pill);
            padding: 8px 16px;
            font-size: var(--text-xs);
            font-weight: 600;
            box-shadow: 0 4px 24px rgba(0,0,0,0.4);
            backdrop-filter: blur(20px) saturate(140%);
            -webkit-backdrop-filter: blur(20px) saturate(140%);
            animation: offlineSlideIn 200ms ease-out;
            /* Status indicator only — must never intercept clicks on the
               chrome underneath it (was blocking the mobile menu button). */
            pointer-events: none;
        }
        .offline-banner .offline-banner-icon { color: var(--danger); }
        @keyframes offlineSlideIn {
            from { opacity: 0; transform: translate(-50%, -8px); }
            to   { opacity: 1; transform: translate(-50%, 0); }
        }
```

Key changes and why each one matters on its own (either alone would have fixed the click-blocking bug; both together also fix the visual clash):
- `pointer-events: none` — the banner can now physically never intercept a click, regardless of z-index or layout, closing the confirmed bug directly.
- `top: var(--s-3)` + centered pill instead of `top:0` full-bleed — stops it from slicing across the app-shell's rounded top corner.
- `background: var(--panel-bg)` + a thin `--danger`-tinted border instead of a solid saturated red fill — brings it in line with the same restrained, glassy status language already used for `.toast` (`css/style.css:1860-1874`), so it reads as "this app telling you something" rather than an OS-level alarm.
- `z-index: 15` — still above ordinary content, but below the mobile sidebar drawer (`z-index: 30`) and the toast stack (`z-index: 100`), so it can never trap or hide a modal/drawer that opens after it.

- [x] **Step 2: Give the warning glyph its own element so it can be colored**

In `js/models.js`, replace `showOfflineBanner` (lines 293-299):

```javascript
function showOfflineBanner() {
    if (offlineBanner) return;
    offlineBanner = document.createElement('div');
    offlineBanner.className = 'offline-banner';
    offlineBanner.textContent = '⚠ ' + currentProvider().label + ' is unreachable';
    document.body.prepend(offlineBanner);
}
```

with:

```javascript
function showOfflineBanner() {
    if (offlineBanner) return;
    offlineBanner = document.createElement('div');
    offlineBanner.className = 'offline-banner';
    const icon = document.createElement('span');
    icon.className = 'offline-banner-icon';
    icon.textContent = '⚠';
    const text = document.createElement('span');
    text.textContent = currentProvider().label + ' is unreachable';
    offlineBanner.append(icon, text);
    document.body.prepend(offlineBanner);
}
```

(Kept to `createElement`/`textContent` rather than `innerHTML`, matching the pattern the rest of this codebase already uses for dynamically-built DOM — see `js/messages.js`'s toolbar builder.)

- [x] **Step 3: Verify the click-blocking bug is actually fixed**

```bash
cd tools/playwright
node shot.js
```

`shot.js` step 8→9 does a **real, non-forced** `page.click('.mobile-menu-btn')` at the 390×844 mobile viewport, which is exactly the click that failed before this fix (Playwright's un-forced click refuses to proceed if another element visually occupies that point). If the script completes without a `TimeoutError` on that step and `shots/09-mobile-sidebar-open.png` shows the sidebar drawer actually open (not identical to `08-mobile-chat.png`), the bug is fixed.

You can also assert it directly:

```bash
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('file://' + path.resolve('../../index.html'));
  await page.waitForTimeout(500);
  const elTag = await page.evaluate(() => {
    const btn = document.querySelector('.mobile-menu-btn');
    const r = btn.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width/2, r.top + r.height/2).className;
  });
  console.log('element at button center:', elTag);
  await browser.close();
})();
"
```

Expected: `element at button center: mobile-menu-btn` (previously this printed `offline-banner`).

- [x] **Step 4: Visual check**

Open `shots/08-mobile-chat.png` and `shots/01-hero-chat.png`. Confirm: the banner no longer spans full-bleed edge-to-edge, no longer overlaps the model-selector/Configuration pills or the hamburger icon, and reads as a quiet pill rather than a dominant red stripe.

- [ ] **Step 5: Commit** (only if the user running this session asks for a commit — not yet done)

```bash
git add css/style.css js/models.js
git commit -m "fix: stop offline banner from blocking clicks and dominating the palette"
```

**As shipped — one addition beyond the steps above:** the initial fix left the pill visually overlapping the top-bar's model-selector/Configuration pills specifically at the `max-width:639px` mobile breakpoint (functionally harmless — `pointer-events:none` already meant nothing was blocked — but still a visual collision). Fixed by adding, immediately after the `@keyframes offlineSlideIn` block (i.e. *after* line ~1929, not inside the earlier `@media (max-width:1023px)`/`@media (max-width:639px)` responsive section further up the file):

```css
        @media (max-width: 639px) {
            .offline-banner { top: calc(var(--s-9) + var(--s-2)); max-width: calc(100% - var(--s-6)); }
        }
```

**Gotcha worth knowing if you touch this again:** a first attempt placed this override inside the *existing* `@media (max-width:639px)` block up in the "RESPONSIVE" section (around where `.top-bar { padding-left: 60px; }` lives) — same specificity as the base `.offline-banner` rule, but *earlier in source order*, so the base rule (which comes later in the file, in section 16) won the cascade and the override silently did nothing. Moving the override to *after* the base rule fixed it without needing `!important`. On mobile there's still a minor transient overlap with the *first message bubble* at the very top of a fresh conversation (not with any control — purely cosmetic, scrolls away immediately) — a reasonable follow-up if picked up again, but not a blocker.

---

### Task 2: Make the glassmorphism actually render

**Confirmed via live rendering:** `--shell-bg` (`#0A0F1C`), `--sidebar-bg` (`#0D1424`), `--panel-bg` (`#0F1828`) are fully opaque 6-digit hex colors. `.app-shell`, `.top-bar-settings`, `.model-dropdown`, and `.toast` all carry `backdrop-filter: blur(20-24px) saturate(140-150%)` — which blurs whatever is behind an element *through* it, and does nothing when the element itself is 100% opaque. Screenshots confirm this: the ~130 lines of CSS building the sky/cloud/mountain "world" layer (`css/style.css:89-202`) are visible only in the thin margin outside the rounded shell; the entire interior — where the user actually looks — is flat solid navy. This is the app's single most distinctive visual idea, currently a no-op.

**Files:**
- Modify: `css/style.css:11-17` (surface token block)

**Interfaces:**
- Consumes: nothing new.
- Produces: same token names (`--shell-bg`, `--sidebar-bg`, `--panel-bg`, `--panel-bg-hover`), same call sites — every rule that references them (`.app-shell`, `.sidebar`, `.top-pill`, message bubbles, dropdowns, toasts, etc.) needs zero changes, since only the token *values* change, not their usage.

- [x] **Step 1: Add alpha to the surface tokens**

Replace (lines 11-17):

```css
            /* 3.1 Surface */
            --bg-deep: #04060E;
            --shell-bg: #0A0F1C;
            --sidebar-bg: #0D1424;
            --panel-bg: #0F1828;
            --panel-bg-hover: #142033;
            --topbar-bg: #0C1322;
```

with:

```css
            /* 3.1 Surface */
            --bg-deep: #04060E;
            --shell-bg: rgba(10,15,28,0.86);
            --sidebar-bg: rgba(13,20,36,0.86);
            --panel-bg: rgba(15,24,40,0.90);
            --panel-bg-hover: rgba(20,32,51,0.92);
```

(`--topbar-bg` was defined but never referenced anywhere in the stylesheet — dropped as dead code rather than carried forward unused. Confirm before deleting: `grep -n "topbar-bg" css/style.css` should show only the definition line, no usages.)

The alpha values (0.86-0.92) are chosen to keep every existing legibility case working (message bubble text, button labels, sidebar row text) while letting the world layer read through as a genuine glow rather than a bright, distracting texture. These are a starting point, not exact — see Step 3.

- [x] **Step 2: Re-run the screenshot script**

```bash
cd tools/playwright && node shot.js
```

- [x] **Step 3: Visual + legibility check**

Open `shots/01-hero-chat.png` and `shots/05-chat-view.png`. Confirm:
- The sky/mountain gradient is now visibly perceptible *through* the shell and panels (not just in the outer margin) — that's the fix working.
- Text in the assistant message bubble, sidebar rows, and top-bar pills is still comfortably legible against the now-translucent backgrounds. If anything reads as low-contrast, raise that surface's alpha in increments of ~0.03 and re-screenshot — legibility wins over atmosphere if they trade off.

- [ ] **Step 4: Commit** (only if asked)

```bash
git add css/style.css
git commit -m "fix: give surface tokens real alpha so backdrop-filter glass effect actually renders"
```

---

### Task 3: Fix the orb getting squashed into an ellipse in Story mode

**Confirmed via live rendering + geometry inspection**, not a guess: at 1440×900 in Story mode (after clicking "Story Mode", once the story-config form is showing), `.orb`'s rendered `getBoundingClientRect()` is `{ width: 97.6, height: 66.2 }` — i.e. a 96×96 circle is rendering as a squashed 98×66 ellipse. Root cause traced precisely:

- `.hero-region` (`css/style.css:616-626`) is `display:flex; flex-direction:column`, itself a flex item of `.main-pane` (`display:flex; flex-direction:column`, `overflow-y:auto`).
- `.orb` (`css/style.css:629-638`) has explicit `width:96px; height:96px` but no `flex-shrink` override, so it defaults to `flex-shrink: 1`.
- In Story mode, the combined intrinsic height of orb + mode pills + the full story-config form exceeds the space `.hero-region` has been allotted. Because text-bearing flex children (the pills, the form fields) have a real min-content height the browser won't shrink below, and `.orb` has no content forcing a minimum, the flexbox shrink algorithm takes the deficit almost entirely out of `.orb` — squashing it — instead of letting `.hero-region`/`.main-pane` grow and scroll.

**Files:**
- Modify: `css/style.css:629-638` (`.orb`)
- Modify: `css/style.css:671-677` (`.quick-actions`, the mode-pill row — same latent risk, same fix)
- Modify: `css/style.css:616-626` (`.hero-region`)

**Interfaces:**
- Consumes: nothing new.
- Produces: no class/selector renamed; `.orb`, `.quick-actions`, `.hero-region` keep their names and existing markup hookup in `index.html:176-265`.

- [x] **Step 1: Stop the orb (and mode pills) from ever shrinking**

In `.orb` (lines 629-638), add one declaration:

```css
        .orb {
            position: relative;
            width: 96px; height: 96px;
            flex-shrink: 0;
            border-radius: 50%;
            overflow: hidden;
            background: radial-gradient(circle at 35% 30%,
                #BFE0FF 0%, #4A8CFF 35%, #1E3A8A 75%, #0A1530 100%);
            box-shadow: 0 0 48px var(--accent-glow);
            animation: orb-breathe 6s ease-in-out infinite;
        }
```

In `.quick-actions` (lines 671-677), same idea — the Chat Mode / Story Mode pill row should never compress either:

```css
        .quick-actions {
            display: flex;
            gap: var(--s-2);
            flex-wrap: wrap;
            justify-content: center;
            flex-shrink: 0;
        }
```

- [x] **Step 2: Let the hero region grow and scroll instead of compressing its children**

In `.hero-region` (lines 616-626), add `overflow-y: auto`:

```css
        .hero-region {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--s-8) var(--s-5);
            gap: var(--s-6);
            min-height: 60vh;
            overflow-y: auto;
        }
```

With children now `flex-shrink: 0` where it matters, `.hero-region`'s own content can no longer be squeezed smaller than its parts need — so when the Story-mode form is tall, `.hero-region` (and its `.main-pane` ancestor, which already has `overflow-y: auto`) scrolls instead of deforming the orb.

- [x] **Step 3: Verify the geometry directly**

```bash
cd tools/playwright
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file://' + path.resolve('../../index.html'));
  await page.waitForTimeout(500);
  await page.click('#pill-story-mode');
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.orb').getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  console.log(box);
  await browser.close();
})();
"
```

Expected: `width` and `height` within ~1px of each other (both ≈96), not the previous `{ width: 97.6, height: 66.2 }`.

- [x] **Step 4: Re-run full screenshot script and eyeball it**

```bash
node shot.js
```

Open `shots/02-hero-story.png` — the orb should read as a clean circle, and if the story-config form is taller than the viewport, the hero region should show a scrollbar or scrolled state rather than a compressed layout.

- [ ] **Step 5: Commit** (only if asked)

```bash
git add css/style.css
git commit -m "fix: prevent orb/mode-pills from being flex-squashed in Story mode"
```

---

### Task 4: Replace the native `confirm()` on "Delete All Chats"

Single-chat delete already uses a well-crafted toast-with-undo pattern (`js/chatlist.js:184-186`, `showToast('Chat deleted', '', { onAction: () => restoreDeletedChat(snapshot) })`) — genuinely good UX, no changes needed there. But "Delete All Chats", the most destructive action in the app, falls back to a bare native `window.confirm()` (`js/chatlist.js:220`), which stamps a stock OS dialog over the custom dark-glass UI at the exact moment the stakes are highest. This task replaces it with an in-app modal reusing the visual language the story-settings modal already established (`.story-settings-overlay` / `.story-settings-modal`, `css/style.css:2024-2049`), generalized into a small reusable confirm dialog.

**Files:**
- Modify: `css/style.css` (add a new section after the story-settings-modal block, ~line 2061)
- Modify: `js/chatlist.js:219-235` (`deleteAllChats`)

**Interfaces:**
- Consumes: existing tokens `--panel-bg`, `--stroke`, `--radius-lg`, `--s-4`, `--s-5`, `--danger`.
- Produces: a new global function `showConfirmDialog(message, { confirmLabel, onConfirm })` in `js/chatlist.js`, callable from anywhere in this shared global scope the same way `showToast` already is.

- [x] **Step 1: Add the confirm-dialog CSS**

Append after the `.story-settings-modal .story-config { max-height: none; }` rule at the end of `css/style.css`:

```css
        /* ══════════════════════════════════════════════════════════════
           20. CONFIRM DIALOG (destructive-action confirmation)
           ══════════════════════════════════════════════════════════════ */
        .confirm-dialog-overlay {
            position: fixed;
            inset: 0;
            z-index: 200;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--s-5);
            background: rgba(4,6,14,0.6);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            animation: toastIn 200ms ease-out;
        }
        .confirm-dialog {
            background: var(--panel-bg);
            border: 1px solid var(--stroke);
            border-radius: var(--radius-lg);
            padding: var(--s-5);
            width: 100%;
            max-width: 380px;
            box-shadow: 0 12px 48px rgba(0,0,0,0.5);
        }
        .confirm-dialog-message {
            font-size: var(--text-base);
            color: var(--text);
            margin-bottom: var(--s-5);
            line-height: var(--lh-base);
        }
        .confirm-dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--s-2);
        }
        .confirm-dialog-cancel {
            height: 36px;
            padding: 0 16px;
            border-radius: var(--radius-pill);
            background: transparent;
            border: 1px solid var(--stroke);
            color: var(--text-secondary);
            font-family: var(--font-sans);
            font-size: var(--text-sm);
            font-weight: 500;
            cursor: pointer;
            transition: all 150ms ease-out;
        }
        .confirm-dialog-cancel:hover { background: var(--panel-bg-hover); color: var(--text); }
        .confirm-dialog-confirm {
            height: 36px;
            padding: 0 16px;
            border-radius: var(--radius-pill);
            background: rgba(230,106,122,0.15);
            border: 1px solid rgba(230,106,122,0.4);
            color: var(--danger);
            font-family: var(--font-sans);
            font-size: var(--text-sm);
            font-weight: 600;
            cursor: pointer;
            transition: all 150ms ease-out;
        }
        .confirm-dialog-confirm:hover { background: rgba(230,106,122,0.28); }
        .confirm-dialog-cancel:focus-visible,
        .confirm-dialog-confirm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [x] **Step 2: Add the reusable `showConfirmDialog` helper and wire it into `deleteAllChats`**

In `js/chatlist.js`, replace the current `deleteAllChats` (lines 219-235), which currently reads in full:

```javascript
function deleteAllChats() {
    if (!confirm('Delete all chats? This cannot be undone.')) return;
    const chats = JSON.parse(localStorage.getItem('chat_index') || '[]');
    chats.forEach(id => {
        localStorage.removeItem(STORAGE_KEY_PREFIX + id);
        localStorage.removeItem(GENERATIONS_PREFIX + id);
    });
    localStorage.setItem('chat_index', '[]');
    localStorage.removeItem(CHAT_META_KEY);
    currentChatId = null;
    chatHistory = [];
    generationStore = {};
    generationIdx = {};
    renderChatList();
    showHeroView();
    document.getElementById('messages').innerHTML = '';
}
```

with:

```javascript
function showConfirmDialog(message, { confirmLabel = 'Confirm', onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    const msg = document.createElement('div');
    msg.className = 'confirm-dialog-message';
    msg.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'confirm-dialog-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'confirm-dialog-cancel';
    cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'confirm-dialog-confirm';
    confirmBtn.textContent = confirmLabel;
    const close = () => overlay.remove();
    cancelBtn.onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    confirmBtn.onclick = () => { close(); onConfirm(); };
    actions.append(cancelBtn, confirmBtn);
    dialog.append(msg, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    confirmBtn.focus();
}

function deleteAllChats() {
    showConfirmDialog('Delete all chats? This cannot be undone.', {
        confirmLabel: 'Delete All',
        onConfirm: () => {
            const chats = JSON.parse(localStorage.getItem('chat_index') || '[]');
            chats.forEach(id => {
                localStorage.removeItem(STORAGE_KEY_PREFIX + id);
                localStorage.removeItem(GENERATIONS_PREFIX + id);
            });
            localStorage.setItem('chat_index', '[]');
            localStorage.removeItem(CHAT_META_KEY);
            currentChatId = null;
            chatHistory = [];
            generationStore = {};
            generationIdx = {};
            renderChatList();
            showHeroView();
            document.getElementById('messages').innerHTML = '';
        }
    });
}
```

- [x] **Step 3: Verify**

```bash
cd tools/playwright
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('dialog', d => { throw new Error('native dialog appeared: ' + d.message()); });
  await page.goto('file://' + path.resolve('../../index.html'));
  await page.waitForTimeout(400);
  await page.click('.btn-delete-all');
  await page.waitForTimeout(300);
  const hasDialog = await page.\$('.confirm-dialog');
  console.log('custom dialog present:', !!hasDialog);
  await page.screenshot({ path: 'shots/11-confirm-dialog.png' });
  await browser.close();
})();
"
```

Expected: script does **not** throw (no native `dialog` event fires), `custom dialog present: true`, and `shots/11-confirm-dialog.png` shows the styled modal, not a browser alert.

- [ ] **Step 4: Commit** (only if asked)

```bash
git add css/style.css js/chatlist.js
git commit -m "fix: replace native confirm() on Delete All Chats with an in-app dialog"
```

---

### Task 5: Bump message-toolbar tap targets on mobile

`.msg-toolbar button` is 24×24px (`css/style.css:1150-1164`) — acceptable for a mouse-hover-revealed control on desktop, but the `max-width:639px` media query (`css/style.css:1550-1562`) makes the toolbar `position:static; opacity:1` **permanently visible** on mobile (no hover state exists on touch), meaning these become permanent 24×24 tap targets exactly where WCAG's ~40-44px minimum matters most.

**Files:**
- Modify: `css/style.css:1550-1562` (the mobile `.msg-toolbar` override inside the `@media (max-width:639px)` block)

**Interfaces:**
- Consumes: existing `.msg-toolbar button` selector, `--radius-sm` token.
- Produces: no new class names; purely a sizing override scoped to the existing mobile breakpoint.

- [x] **Step 1: Add a mobile-only size override**

Directly after the existing block (lines 1550-1562):

```css
            .message { max-width: 85%; }
            .msg-toolbar {
                position: static;
                opacity: 1;
                margin-top: 4px;
                justify-content: flex-end;
            }
            .message.assistant .msg-toolbar { left: auto; justify-content: flex-start; }
            .message.user .msg-toolbar { right: auto; justify-content: flex-end; }
```

add:

```css
            .msg-toolbar button {
                width: 36px;
                height: 36px;
            }
            .msg-toolbar .gen-count { min-width: 32px; }
```

- [x] **Step 2: Verify**

```bash
cd tools/playwright
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('file://' + path.resolve('../../index.html'));
  await page.evaluate(() => {
    localStorage.setItem('data_version', '1');
    localStorage.setItem('chat_index', JSON.stringify(['demo1']));
    localStorage.setItem('chat_meta', JSON.stringify({ demo1: { createdAt: Date.now(), name: 'Demo' } }));
    localStorage.setItem('chat_demo1', JSON.stringify([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' }
    ]));
  });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('.sidebar-row');
  await page.waitForTimeout(400);
  const size = await page.evaluate(() => {
    const b = document.querySelector('.msg-toolbar button');
    const r = b.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  console.log(size);
  await browser.close();
})();
"
```

Expected: `{ width: 36, height: 36 }` (previously `24, 24`).

- [ ] **Step 3: Commit** (only if asked)

```bash
git add css/style.css
git commit -m "fix: enlarge message-toolbar tap targets on mobile to meet accessible minimums"
```

---

### Task 6 (optional, lower priority — do last): Typography identity

`--font-sans`/`--font-display` (`css/style.css:46-47`) list `"Inter"`/`"SF Pro Display"` after `-apple-system, BlinkMacSystemFont`. Since `-apple-system` always wins first on macOS/iOS — the platform this app is built for (LM Studio is Mac/desktop-first per `AGENTS.md`) — every named face after it is currently unreachable; the whole app renders in plain system UI font. This is a real craft gap (the visual identity established by the orb/world backdrop isn't matched by the typography) but is lower-severity than Tasks 1-5 (nothing is broken; it's an opportunity, not a defect), so treat it as optional follow-up rather than blocking.

Two legitimate directions — pick one, don't do both:
- **(a) Commit to the system font deliberately**: drop the unreachable names from the stack (cleanup only, no visual change), and instead lean harder on the existing type-scale (tighter `letter-spacing` on `--text-display`/`--text-xl` if ever used for a heading) to carry personality.
- **(b) Actually load Inter**: add `<link rel="preconnect" href="https://fonts.googleapis.com">` + a Google Fonts `<link>` for Inter (weights 400/500/600/700) in `index.html`'s `<head>`, alongside the existing CDN `<script>`/`<link>` tags for `marked`/`DOMPurify`/`highlight.js` — same pattern already in use, no new build tooling.

This task intentionally has no prescribed code diff — it's a direction choice for whoever picks it up, informed by whether the user wants "distinctive" (b) or "honest and clean" (a).

**As shipped:** went with (b) — actually load Inter. Added a Google Fonts `<link>` for Inter (weights 400/500/600/700) in `index.html`'s `<head>`, right before the `marked` CDN `<script>` tag, using the same preconnect + stylesheet-link pattern as the rest of the CDN includes. Critically, loading the font alone wasn't enough — `--font-sans`/`--font-display` had `-apple-system` listed *before* `"Inter"`, which means the browser would keep picking `-apple-system` first regardless of whether Inter loaded, since font-family fallback order doesn't care about load order. Fixed by moving `"Inter"` to the front of both stacks, with `-apple-system`/`BlinkMacSystemFont`/etc. kept as the fallback chain for if the CDN is ever unreachable. Verified with `document.fonts.check('16px Inter')` returning `true` after `document.fonts.ready` — confirms the font actually loaded and is selected, not just declared.

---

## Notes (not tasks — low priority, fold into whichever task touches that file if convenient)

- `index.html` mixes two "hidden" mechanisms: the `.hidden` class (used on `.hero-region`, `.messages-area`, `.prompt-chips`) and inline `style="display:none"` (used on `#provider-key-row`, `#edit-story-btn`). Pick one — delete the inline version, add `.hidden` to the element's `class` list instead, and remove the corresponding direct `.style.display` toggling in JS if any exists (check `js/config.js`/`js/init.js` for where these are toggled before changing).
- `#sidebar-chat-list` has no explicit empty-state markup for a brand-new install (zero chats). Low priority — the hero screen already communicates "nothing yet" — but a one-line "No chats yet" placeholder would close the gap if the sidebar is ever visible while empty on a wide viewport.
- `renameChat()` (`js/chatlist.js:243`) uses native `window.prompt()` for renaming — same "breaks the glass illusion" class of issue as the old `deleteAllChats` confirm, just lower severity since renaming isn't destructive. Worth an inline-editable text field (there's already an `.edit-textarea` pattern used for editing user messages, `css/style.css:1193-1202`, that could be adapted) as a future follow-up, not scoped into this plan.
