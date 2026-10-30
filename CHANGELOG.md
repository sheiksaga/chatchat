# Changelog

Notable changes, newest first. Versions are tagged `vX.Y.Z`; the zip on each release is a runnable
build (`start-chatchat.bat` + `node build`), not a source snapshot.

## Unreleased

**A scene panel, so a wrong picture is diagnosable.** The chat header's "Look" popover became a Scene
drawer with three fields and, at the bottom, the exact prompt the currently selected image model would
receive — the same string the generation path sends, re-rendered whenever a field, the framing or the
model changes, with its word count and size. Until now the only way to see that prompt was to read the
code.

- **Style** — photograph / anime / illustration, stored per chat. It reaches the prompt as tags for
  Anima and the flat dialects and as a sentence for Z-Image, in each model's own slot.
- **Seed** — a fixed per-chat seed, used by "of this moment" so the same beat and the same person come
  back, with a Randomise button. Regenerate still varies; that button exists to.

**Prompt text, fixed by measuring it.** Four bugs in `prompts/scene.ts` came out of the storyboard and
roleplay benchmark (`docs/IMAGE_MODELS.md`, round 5); all of them had been quietly costing quality.

- The card's hair was never in the prompt. A card's `appearance` field often stops at eye colour,
  with the hair in an `Appearance:` line further down the description; the builder read the first 18 words
  of prose and cut it. Every model invented a hair colour from beat to beat.
- The reader's line filled the whole prompt and the reply — the part that says what actually happened —
  was truncated away. A beat where Jess's cardigan came off drew a fully dressed picture.
- Sentences were cut at the first full stop, which loses "5'2", slender. Dark blonde hair…".
- Hesitation speech reached the model, and Anima answered with dialogue balloons full of gibberish text.
- `{{user}}` macros were sent to the image model verbatim; they are stripped now.

- The record is now a schema (`shared/story.ts`) rather than an untyped `unknown`; `parseStory` fills in
  defaults, so every chat written before this change loads unchanged.

**Storyboard, second pass: NPCs, shot grammar, and a mirror bug.**

- **The card tells the model how to shoot a sequence.** Every visible person is a subject with their own
  description (a driver wears a uniform, never the protagonist's suit); a beat has to be shown by what a
  camera sees, not by its cause; consecutive beats must not repeat a framing; and LOCK is for a solo shot
  of an established subject only — a frame a new person enters is a new composition, which is what was
  quietly cloning the protagonist onto every NPC.
- **The marker knows the shot sheet:** OTS and 2SHOT (the words that decide whether a second character is
  in frame), plus EWS/WS/FS/MS/MCU/CU/ECU and HA/LA/EYELEVEL.
- **The last picture is handed back to the model verbatim.** A storyboard chat now gets PREVIOUS SHOT
  appended after the card's own rules, so continuity is copying a canonical tag list instead of
  remembering prose.
- **Fixed: the chat folder missed the newest reply.** POST /api/chat appended the assistant message and
  never mirrored it, so `data/chats/<id>/chat.json` lagged one turn — which put pictures above the wrong
  prompt for anything that placed them by message id. Regression test included.

**Marker vocabulary, auto-draw, and one shipped card.**

- **`[[IMG: …]]` understands the words cards actually use.** Aspect ratios `PORTRAIT` / `SQUARE` /
  `LANDSCAPE` / `CINEMA`, shots `CLOSE` / `MEDIUM` / `WIDE` / `DUTCH` / `OVERHEAD` / `LOWANGLE` /
  `HIGHANGLE` / `PROFILE` / `BACKVIEW` / `POV`, and `SEED: RANDOM` / `SEED: LOCK`. Segments 2–4 are
  classified by content, so order does not matter. It mattered: `PORTRAIT` was dropped on the floor,
  `MEDIUM` was pasted into the prompt as a junk tag (portrait pictures of people standing in a medium
  shot came back with the word in them), and `LOCK` did nothing at all.
- **A storyboard chat draws its own pictures.** `story.autoImages` is tri-state — `null` inherits from
  the character card's `image-generation` tag — and the Scene drawer carries the toggle. Every other
  chat keeps markers as click-to-generate chips.
- `LOCK` resolves to the chat's fixed seed, else the seed the newest picture used, else a fresh seed
  saved on the chat, so the same face comes back instead of drifting.
- **One shipped card, `Storyboard`.** Created on first start only when the characters table is empty,
  from `src/lib/server/cards/shipped.ts`. It is an ordinary card afterwards: edit it, or delete it.

## 0.1.0 — first release

The rewrite, feature-complete against the pre-rewrite app: streaming chat, character cards v1/v2/v3,
lorebooks, an image pipeline on ComfyUI, LAN access, and no runtime CDN.

**Chat**

- Streaming chat through any OpenAI-compatible server, with llama.cpp first-class: samplers and
  thinking suppression ride `providerOptions`, and router-mode defaults are read from
  `models-router.ini` (router `/props` reports nothing).
- Regenerate with generation history (`‹ 1/3 ›`), message edit and delete, retry, stop.
- Markdown and code highlighting stream-safe (`svelte-streamdown`), full-text search over every
  message (SQLite FTS5).
- Server owns the system prompt, the keys and the message ids; the browser never calls a model.

**Characters and story**

- SillyTavern cards v1/v2/v3, PNG or JSON, plus old-folder import — with avatars and a card editor
  that also edits lorebooks.
- Lorebook matching, ordering, budget and injection; per-chat "look" that every scene prompt reuses.
- RP prompt assembly is server-side and covered by 20 tests.

**Images**

- `POST /api/images` streams ComfyUI progress over SSE on the same request, so there is no job
  registry to leave stuck.
- Eleven registered graphs behind one picker: Z-Image Turbo (default), Z-Image + Mystic, Krea2 Anime,
  Krea2 Turbo, FLUX.2 Klein, FLUX.2 Klein NSFW, Anima Turbo, Anima fp16, Anima base, plus an
  instruction **edit** graph and an inpaint graph.
- Scene prompts are model-aware: Anima gets its documented hybrid order, Z-Image gets structured
  prose (it cannot honour a negative at CFG 1), everything else keeps the tag list.
- Inpaint with a brush mask, "change with a sentence" instruction edits, same-seed reruns.
- A picture belongs to the message it was drawn under (`images.message_id`), and is rendered there.

**Platform**

- Runs on your machine, reachable from a phone over LAN or Tailscale with `CHATCHAT_TOKEN` and an
  HMAC cookie — no accounts, no telemetry.
- No CDN at runtime: fonts, icons, manifest and theme are bundled.
- `data/chats/<id>/` holds each chat's transcript mirror, story file and pictures; SQLite is
  authoritative and the JSON is a mirror written after every change.
- `npm run doctor` probes every configured provider, the ComfyUI graphs and the LoRAs they name,
  the database and the LAN token.

**Known gaps** — see `docs/PARITY.md`: the story file persists only its `look` (no scene list or
per-character state UI yet), the image picker is a curated table rather than live `/object_info`,
and there is no service worker.

**Requires** Node 22.13+ (`node:sqlite` without a flag) and, for images, ComfyUI 0.42+ with the
models the registry names.
