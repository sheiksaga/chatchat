# Changelog

Notable changes, newest first. Versions are tagged `vX.Y.Z`; the zip on each release is a runnable
build (`start-chatchat.bat` + `node build`), not a source snapshot.

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
