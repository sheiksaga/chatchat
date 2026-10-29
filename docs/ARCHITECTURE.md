# Architecture

A chat app that runs on one machine and is used from any device on that network. Two rules explain
almost every file:

1. **The browser never talks to a model.** Every backend call happens in a `+server.ts` route, so keys,
   system prompts and sampler presets live on the server and cannot be lost by clearing site data.
2. **Anything that can be tested without a GPU is tested without one.** llama.cpp is replaced by an HTTP
   stub (`backends/llm/fake-server.ts`), ComfyUI by another (`comfy/fake-comfy.ts`).

## Repository layout

| Path                  | What it is                                                                         |
| --------------------- | ---------------------------------------------------------------------------------- |
| `src/`, `static/`     | the app (SvelteKit 2.70, adapter-node)                                             |
| `src/lib/server/`     | everything privileged: db, backends, comfy, cards, prompts, config store           |
| `src/lib/shared/`     | zod schemas and pure helpers used by both sides (no I/O)                           |
| `src/lib/components/` | UI pieces: `chat/`, `images/`, `ui/` (shadcn-svelte primitives)                    |
| `tools/`              | operator scripts: `doctor`, `import:legacy`, `import:cards`, `dev:fake`, `release` |
| `e2e/`                | Playwright specs (desktop + phone) against the stub LLM                            |
| `docs/`               | architecture, parity board, dependency usage, troubleshooting                      |
| `_notes/`             | research, plan, living TODO (not part of the app)                                  |
| `data/`               | runtime data — SQLite, images, card avatars, provider keys (gitignored)            |
| `workflows/`          | ComfyUI API graphs                                                                 |

## Request lifecycle (a chat message)

```
Composer ──▶ POST /api/chat {messages, chatId, samplers}
                │
                ├─ db: persist the user turn (dedupe by message id)
                ├─ prompts/rp.ts: character block + lorebook + system prompt   (server owns this)
                ├─ backends/registry.ts → LlmBackend.stream()                  (keys stay here)
                ├─ streamText → toUIMessageStreamResponse({ generateMessageId })
                └─ onEnd: persist the assistant turn + stats, then rename the chat if it is the first
                        │
Browser ◀──────────────┘  SSE tokens, rendered by svelte-streamdown as they arrive
```

`regenerate` is the same route with `regenerateMessageId`: the new reply is appended to `generations`
for that message, so `‹ v1/3 ›` always has the old ones.

## Image lifecycle

```
/image …  or  "make this moment" button
   │
   ├─ prompts/scene.ts (server)   → prompt tags from the card + transcript + shot
   └─ POST /api/images            → images/generate.ts
            ├─ workflows.ts: fill `{{PLACEHOLDER}}`s in a ComfyUI graph
            ├─ comfy/client.ts: queue → progress over websocket → /view bytes
            ├─ images/store.ts: write data/images/<uuid>.png
            └─ db/images.ts: insert metadata (prompt, seed, workflow, size, message_id)
   Response body: SSE frames — `progress`, then `done` with the row, or `error`
```

`message_id` is what makes a picture belong somewhere: it is the turn it was drawn under, sent with the
request (a reply's `[[IMG: …]]` chip passes its own message, "of this moment" and `/image` pass the newest
reply). `placeImages()` in `shared/image.ts` turns that into the transcript layout — prompt above, image
below, under its own message. Rows written before the column was used fall back to `created_at`, so no
picture is ever orphaned or shown under an unrelated turn.

Immutable caching is safe because the id is random per generation; `GET /api/images/[id]` supports
Range requests so a 2 MB picture starts painting immediately.

## What is in `data/`

One folder per chat, readable without the app:

```
data/
  chatchat.db                     metadata (the app's working copy)
  config.json                     providers, keys (0600), appearance
  cards/<characterId>.png         card avatars, shared by every chat using the card
  chats/<chatId>/
    chat.json                     transcript + images + character, pretty-printed
    story.json                    the scene record (`look`, …)
    images/<imageId>.png          pictures, next to the chat that made them
  images/<imageId>.png            pictures that belong to no chat
```

The database is the source of truth; `chat.json` / `story.json` are **mirrors**, rewritten atomically
after every write (`db/layout.ts`). Delete a mirror and the app still works — the next write recreates
it. `file` columns store paths relative to `data/`, so copying the folder anywhere changes nothing.

At startup (`hooks.server.ts` → `init`) the server opens the database once, which runs the one-time
layout work: pictures written by older versions move into their chat's folder, rows whose bytes are gone
are dropped, and every mirror is rewritten.

## Database

SQLite through `node:sqlite` (no native module, no ORM): `chats`, `messages` (+ `messages_fts`),
`generations`, `images`, `characters`, `providers`, `app_meta`. Migrations are numbered SQL in
`db/migrations.ts` and applied on open. WAL is on, so a browser read never blocks a write.

## Decisions worth knowing

| Decision                                     | Why                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SvelteKit 2.70, not Kit 3                    | Kit 3 is outside most models' training data; Kit 2.70 is the version agents actually write well    |
| AI SDK 7 + own `LlmBackend`                  | One streaming client, but the app's contract is ours: swapping backends never touches routes       |
| `@stable-canvas/comfyui-client`              | MIT and speaks the plain HTTP+WS API; `@comfyorg/sdk` needs an extra Python proxy                  |
| Files for image bytes, SQLite for metadata   | Backups are `copy data/`; a 2 MB row would bloat every query                                       |
| Samplers parsed from `models-router.ini`     | The router's `/props` returns `params: null`; the ini is the only real source of truth             |
| `csrf.checkOrigin: false` + own origin check | adapter-node reports `https` on plain-http LAN, which breaks Kit's check and cookies (`CLAUDE.md`) |
| No CDN, system font stack                    | The app must work with the network unplugged                                                       |

## Directory of "where do I change…"

See `CLAUDE.md` — it holds the same table plus the banned patterns and the traps that have already
cost time (stream ids, `resolve()` links, `abortSignal`, and friends).
