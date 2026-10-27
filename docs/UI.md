# UI system

The desktop pass. Read this before touching a `.svelte` file, so the next screen matches the ones that
already exist instead of inventing a second scale.

Tokens live in **`src/app.css`**. Nothing in this app hardcodes a `px` font size or a `ms` duration in a
component unless the value is one-off (a 2px rail, a 52px thumbnail).

---

## 1. Type scale

| Utility        | Size / line-height | Used for                                                         |
| -------------- | ------------------ | ---------------------------------------------------------------- |
| `text-label`   | 13px / 20px        | metadata: timestamps, stats, hints, section headers, chips       |
| `text-ui`      | 16px / 24.8px      | everything you read or click: buttons, inputs, sidebar rows, nav |
| `text-title`   | 20px / 25.6px      | page and chat titles, dialog titles                              |
| `text-display` | 24px / 30.4px      | the `h1` of a top-level page (Home, Settings, Characters)        |

Message bodies are **not** in this table: they use `--content-size` (the Reading slider, 12–24px,
default **18px**) with `line-height: 1.7`, and `--content-width` (default **72ch**). Both are set as
CSS custom properties on the shell in `+layout.svelte`, so the settings page and the transcript read the
same values.

**13px is the floor.** The pre-redesign UI used 10px for role labels, timestamps and per-message actions;
that was the single biggest readability complaint. If something feels too big, reduce its weight or
colour, not its size below `text-label`.

Markdown output is styled by `.msg-prose` in `app.css` (it out-specifies the `text-sm`/`py-1` classes
that `svelte-streamdown`'s theme puts on the same elements). Don't add `prose` classes to a message.

---

## 2. Motion

Four named animations, all in `@theme`:

| Utility            | Effect                                 | Where                                                                                 |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `animate-fade-up`  | 220ms opacity + 6px rise               | a message that arrives while the page is open, error banners, the jump-to-latest pill |
| `animate-fade-in`  | 160ms opacity                          | full-page overlays, empty states                                                      |
| `animate-pop-in`   | 150ms opacity + scale 0.985 + 4px rise | popovers, dialogs                                                                     |
| `animate-toast-in` | 200ms opacity + 8px rise + scale       | toasts                                                                                |

Plus `animate-caret` (streaming caret), `animate-thinking` (the three queued dots), `animate-shimmer`
(the image progress strip via `.progress-strip`).

Rules:

- **Never animate the seeded transcript on load.** `animate-fade-up` in the chat page is gated on
  `hydrated && index === last` — a fifty-message chat must not flash on every refresh.
- Durations stay **≤ 250ms**, eased with `--ease-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`). Hover
  transitions are 150ms.
- `@media (prefers-reduced-motion: reduce)` in `app.css` neutralises every animation and transition
  globally. Don't re-enable motion in a component without wrapping it in that query.
- Reveal-on-hover affordances (message actions, sidebar row actions) must also carry
  `hover-none:opacity-100` — a phone has no hover, and the row would otherwise be un-actionable.

---

## 3. Primitives

| Component        | Path                                                                            | Notes                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`         | `src/lib/components/ui/button/`                                                 | vendored shadcn-svelte. Sizes are `sm` (28px), default (32px), `lg` (36px).                                                                                       |
| `IconButton`     | `src/lib/components/ui/icon-button/icon-button.svelte`                          | square icon-only button. `label` becomes **both** the accessible name and the tooltip; pass `title` to say something more specific than the name.                 |
| `ConfirmDialog`  | `src/lib/components/ui/confirm-dialog/ConfirmDialog.svelte`                     | `<dialog>` + `showModal()`, so Escape, focus trapping and the backdrop are the browser's job. This replaces `window.confirm()` everywhere — never reintroduce it. |
| `Toaster`        | `src/lib/components/ui/toast/Toaster.svelte` + `src/lib/stores/toast.svelte.ts` | mount once in `+layout.svelte`; call `toasts.success/error/info`. One short line, bottom-right, self-dismissing.                                                  |
| `MessageActions` | `src/lib/components/chat/MessageActions.svelte`                                 | copy / edit / retry / delete for one turn.                                                                                                                        |

`ConfirmDialog` and `Toaster` are in `src/lib/components/ui/**`, which eslint relaxes
(`svelte/no-navigation-without-resolve` off) — that is for vendored shadcn source, not a licence to put
app logic there.

---

## 4. Layout contract

```
div.flex.h-dvh.overflow-hidden            ← the shell; sets --content-size / --content-width
├─ aside (Sidebar)                         fixed width, never scrolls away
└─ div.flex-1.overflow-y-auto             ← the ONLY page scroll container (not <html>)
   └─ page root
      ├─ section/div flex-1 overflow-y-auto (chat transcript)
      └─ div                                docked area: errors → ImageTools → Composer
```

- **The composer is docked, never floating.** It is a sibling of the transcript's scroll container, so
  it cannot cover the last line of a reply.
- A page may scroll at any level, but only one level per page.
- The transcript keeps itself at the bottom with a `ResizeObserver` (`stick` guard): the token effect
  alone loses the race against fonts and markdown on a cold load. Scrolling up sets `stick = false` and
  shows the `Jump to latest` pill.

---

## 5. Indicators (what tells the reader what is happening)

- **Backend status**: a dot in the chat header — emerald when the model list answered, amber plus a
  "model list unavailable" link when it did not.
- **Reply states**: `submitted` → three thinking dots + "Waiting for the first token…" in the composer;
  `streaming` → "writing" next to the author name, a blinking caret at the end of the text, and a `Stop`
  button; `error` → a dismissible banner with the real error text (never "something went wrong") and the
  composer back to `ready`; `ready` → actions and the `retry` affordance appear.
- **Version history**: `v2/3` chip with `‹` / `›`, inside the message, so the transcript text keeps the
  server's ordering.
- **Destructive actions**: always a `ConfirmDialog` naming the thing being deleted.

---

## 6. Gotchas found the hard way

1. **`@tailwindcss/forms` paints its own blue focus ring** on every field, from a rule late in the base
   layer. `app.css` sets `--tw-ring-color: transparent` for `:is(input, select, textarea):focus` **inside
   `@layer components`** — base loses on source order. The app's focus language is a ring-coloured border
   (or the composer's focus-within glow) plus the global `:focus-visible` outline.
2. **A Svelte `class:` directive cannot contain `/`.** `class:border-foreground/25={active}` is a compile
   error ("Expected token >"). Use a template expression:
   `class="… {active ? 'border-foreground/25 bg-card' : 'border-border'}"`.
3. **Accessible names decide e2e selectors.** `getByRole(..., { name })` matches a **substring**, case
   insensitively. Renaming a sidebar icon button to `aria-label="Rename chat"` made
   `locator('li', { hasText: 'E2E Tester' }).getByRole('button', { name: 'chat' })` match five buttons.
   Keep icon-button names short (`Rename`, `Delete`, `Retry`, `Copy`) and put the longer sentence in
   `title`.
4. `@theme { --text-label: 0.8125rem; --text-label--line-height: 1.25rem }` is how you add a named size in
   Tailwind 4. A bare `--text-label` without the `--line-height` twin gives you the size and a default
   line-height.
5. Hover-revealed buttons keep `opacity-0` (not `hidden`): they stay in the tab order, `group-focus-within`
   reveals them for keyboard users, and Playwright can still click them.

---

## 7. Where to change what

| Task                              | File                                             |
| --------------------------------- | ------------------------------------------------ |
| Colours, type scale, motion       | `src/app.css` (`:root`, `.dark`, `@theme`)       |
| Markdown output styling           | `src/app.css` → `.msg-prose`                     |
| Reading defaults (width, size)    | `src/lib/shared/provider.ts` (`appConfigSchema`) |
| Sidebar                           | `src/lib/components/chat/Sidebar.svelte`         |
| Chat header / transcript / errors | `src/routes/chat/[id]/+page.svelte`              |
| Composer                          | `src/lib/components/chat/Composer.svelte`        |
| One message's text                | `src/lib/components/chat/MessageBody.svelte`     |
| Image strip, viewer, mask editor  | `src/lib/components/images/*.svelte`             |

There is no CSS framework config file to edit (Tailwind 4 is CSS-first) and no component library to
upgrade — `ui/button` is copied source that we own.
