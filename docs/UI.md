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

| Component        | Path                                                                            | Notes                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`         | `src/lib/components/ui/button/`                                                 | vendored shadcn-svelte. Sizes are `sm` (28px), default (32px), `lg` (36px).                                                                                                                                                                       |
| `IconButton`     | `src/lib/components/ui/icon-button/icon-button.svelte`                          | square icon-only button. `label` becomes **both** the accessible name and the tooltip; pass `title` to say something more specific than the name.                                                                                                 |
| `SelectMenu`     | `src/lib/components/ui/select-menu/SelectMenu.svelte`                           | one-of-N picker: trigger + popover listbox. Replaces every native `<select>` in the app (see §6.1). `tone="chip"` is the pill, `tone="plain"` the bare metadata trigger; `placement="auto"` flips the panel upward near the bottom of the window. |
| `ConfirmDialog`  | `src/lib/components/ui/confirm-dialog/ConfirmDialog.svelte`                     | `<dialog>` + `showModal()`, so Escape, focus trapping and the backdrop are the browser's job. This replaces `window.confirm()` everywhere — never reintroduce it.                                                                                 |
| `Toaster`        | `src/lib/components/ui/toast/Toaster.svelte` + `src/lib/stores/toast.svelte.ts` | mount once in `+layout.svelte`; call `toasts.success/error/info`. One short line, bottom-right, self-dismissing.                                                                                                                                  |
| `MessageActions` | `src/lib/components/chat/MessageActions.svelte`                                 | copy / edit / retry / delete for one turn.                                                                                                                                                                                                        |
| `SidebarTrigger` | `src/lib/components/chat/SidebarTrigger.svelte`                                 | the phone's way into the sidebar drawer. Goes first in a page header; hides itself at `md`+, where the sidebar is a column again.                                                                                                                 |
| `ScenePanel`     | `src/lib/components/chat/ScenePanel.svelte`                                     | the scene drawer (look / style / seed, plus the auto-draw toggle for storyboard chats) with a live preview of the prompt the selected image model would receive. A `<dialog>`, so Escape and the focus trap are free.                             |

`ConfirmDialog` and `Toaster` are in `src/lib/components/ui/**`, which eslint relaxes
(`svelte/no-navigation-without-resolve` off) — that is for vendored shadcn source, not a licence to put
app logic there.

---

## 4. Layout contract

```
div.flex.h-dvh.overflow-hidden            ← the shell; sets --content-size / --content-width
├─ div[data-testid=sidebar]                the Sidebar: drawer below `md`, first column at `md`+
└─ div.flex-1.overflow-y-auto             ← the ONLY page scroll container (not <html>)
   └─ page root — `{#key data.chat.id}` → ChatView (one instance per chat)
      ├─ header                            ← SidebarTrigger, title, provider + model picker, Scene
      ├─ section/div flex-1 overflow-y-auto (chat transcript)
      │    └─ per message: body → [[IMG]] chips → ImageBlock(s) for that message
      └─ div                                docked area: errors → ImageTools controls → Composer
```

- **The sidebar is a drawer on a phone.** One `<Sidebar>` instance, two presentations: below `md` it is
  `fixed`, off-canvas, and `invisible` while closed (so it leaves the accessibility tree and the tab
  order, yet can still animate in); from `md` up it is a static column in the flex row. A 240px column
  on a 412px phone left 172px for the conversation — the drawer gives it the full width.
- **Every page header starts with `<SidebarTrigger />`** (`md:hidden`). It has to be _in_ the header,
  not floating: a floating button either covers a control or forces every page to reserve a gutter. The
  login card has no header and no drawer — deliberate, there is nothing to navigate to before the token
  is accepted.
- The drawer closes on navigation (`$effect` on `page.url.pathname`), on Escape, and on a backdrop tap.
  Open state lives in `sidebar-drawer.svelte.ts` (context, not a module singleton).
- **The composer is docked, never floating.** It is a sibling of the transcript's scroll container, so
  it cannot cover the last line of a reply.
- **The scene record is a drawer, not a page.** `ScenePanel` opens from the chat header as a `<dialog>`
  anchored to the inline end, full height, with the conversation readable behind it. One scroll
  container: the panel body. The prompt preview inside it must not add a second one — a nested scroller
  cuts the prompt in half, which is the one thing that panel exists to show whole.
- **Pictures are content, not chrome.** They are rendered inside the transcript, under the message that
  drew them (`ImageBlock`: prompt above, image below — see `placeImages` in `shared/image.ts`). Only the
  _controls_ (`ImageTools`: model, "of this moment", progress, the viewer and mask overlays) are docked.
  A strip above the composer followed the reader instead of the conversation: turn 3's pictures appeared
  under turn 40, and pictures with no `message_id` looked like they belonged to whatever was on screen.
- A page may scroll at any level, but only one level per page.
- The transcript keeps itself at the bottom with a `ResizeObserver` (`stick` guard): the token effect
  alone loses the race against fonts and markdown on a cold load. Scrolling up sets `stick = false` and
  shows the `Jump to latest` pill.
- `+page.svelte` is only a `{#key data.chat.id}` wrapper around `ChatView.svelte`. This matters: SvelteKit
  reuses a page component across `/chat/a` → `/chat/b`, so every `$state` initializer would run once, for
  the first chat, and the second chat would inherit its pictures, its `look`, and its editing state.

---

## 5. Indicators (what tells the reader what is happening)

- **Backend status**: a dot in the chat header — emerald when the model list answered, amber plus a
  "model list unavailable" note when it did not. The **model picker** is always present (a plain
  `SelectMenu` in the metadata row, opening a list that also links to provider settings), even when the
  backend is down and the only entry is the configured model.
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
   layer. `app.css` resets **both** halves of it for `:is(input, select, textarea):focus` inside
   `@layer components` — `--tw-ring-color: transparent` **and** `border-color: var(--ring)`. Resetting only
   the ring leaves the blue border, which tinted the composer card on every page. Utilities out-specify
   that rule, so `focus:border-ring` still works.
2. **Never give a native `<select>` a small fixed height.** The same plugin puts `padding: 0.5rem 0.75rem`
   on every `select`; inside `h-5`/`h-7` that leaves a 4–12px content box and the 13px label is clipped to
   a slice of glyphs — the model pickers "disappeared" exactly this way. Use `SelectMenu`.
3. **A Svelte `class:` directive cannot contain `/`.** `class:border-foreground/25={active}` is a compile
   error ("Expected token >"). Use a template expression:
   `class="… {active ? 'border-foreground/25 bg-card' : 'border-border'}"`.
4. **Accessible names decide e2e selectors.** `getByRole(..., { name })` matches a **substring**, case
   insensitively. Renaming a sidebar icon button to `aria-label="Rename chat"` made
   `locator('li', { hasText: 'E2E Tester' }).getByRole('button', { name: 'chat' })` match five buttons.
   Keep icon-button names short (`Rename`, `Delete`, `Retry`, `Copy`) and put the longer sentence in
   `title`.
5. `@theme { --text-label: 0.8125rem; --text-label--line-height: 1.25rem }` is how you add a named size in
   Tailwind 4. A bare `--text-label` without the `--line-height` twin gives you the size and a default
   line-height.
6. Hover-revealed buttons keep `opacity-0` (not `hidden`): they stay in the tab order, `group-focus-within`
   reveals them for keyboard users, and Playwright can still click them.
7. **A picture's width is a `min()` over `vh`, not a JS calculation.** `ImageBlock` sizes itself with
   `max-width: min(100%, 28rem, calc(68vh * ratio))`, so a portrait can never fill the screen and the card
   still reflows when a phone rotates. `w-auto` + `max-w-full` on the `<img>` deadlocks to 0×0 inside a
   shrink-to-fit parent — don't reintroduce it.

---

## 7. Where to change what

| Task                              | File                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| Colours, type scale, motion       | `src/app.css` (`:root`, `.dark`, `@theme`)                               |
| Markdown output styling           | `src/app.css` → `.msg-prose`                                             |
| Reading defaults (width, size)    | `src/lib/shared/provider.ts` (`appConfigSchema`)                         |
| Sidebar contents                  | `src/lib/components/chat/Sidebar.svelte`                                 |
| Sidebar placement, drawer, shell  | `src/routes/+layout.svelte` + `chat/sidebar-drawer.svelte.ts`            |
| Chat header / transcript / errors | `src/routes/chat/[id]/ChatView.svelte`                                   |
| Chat mount / per-chat state       | `src/routes/chat/[id]/+page.svelte` (the `{#key}`)                       |
| Composer                          | `src/lib/components/chat/Composer.svelte`                                |
| One message's text                | `src/lib/components/chat/MessageBody.svelte`                             |
| One picture in the transcript     | `src/lib/components/images/ImageBlock.svelte`                            |
| Image controls, viewer, mask      | `src/lib/components/images/{ImageTools,ImageViewport,MaskEditor}.svelte` |

There is no CSS framework config file to edit (Tailwind 4 is CSS-first) and no component library to
upgrade — `ui/button` is copied source that we own.
