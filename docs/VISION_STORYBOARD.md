# Vision models and the storyboard

## The question and the answer

**Question.** Should a local vision-language model look at the previous picture and write the next ComfyUI prompt
for a storyboard chat, instead of the mechanical prompt builder that exists today?

**Recommendation.** No, not yet — carry the previous prompt, a locked per-chat seed and the existing
`flux2-klein-edit` graph first (about a day of work, no new weights, no new VRAM cost), and only then run a
one-hour, four-beat measurement to find out whether a VLM prompt beats the mechanical one on the single thing
that actually drifts: identity across beats.

---

## 1. What a vision model could contribute

### (a) Things the mechanical layer already solves, or can solve without a model

| Failure mode                                                                  | Who fixes it today                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card vocabulary leaking into the image (`MEDIUM` drawn as a word)             | Already fixed: `SHOT_TOKENS` maps shot words to real tags (`src/lib/shared/image.ts:130`).                                                            |
| Framing fights (two cameras in one prompt)                                    | Already fixed: a user framing suppresses the shot tag (`hasFraming` in `scene.ts`; rule stated in `docs/IMAGE_MODELS.md`, "two cross-cutting rules"). |
| "The bus", "the same man" — an object that must persist                       | The chat's `look` field plus the transcript tail, via `buildScenePrompt` (`src/lib/server/prompts/scene.ts:120`). Works when the prose names it.      |
| Wardrobe drift between beats                                                  | Partly: `look` carries the static wardrobe, `style` carries the medium (`src/lib/shared/story.ts:64`).                                                |
| Face drift across beats                                                       | Partly: `story.seed` plus the `LOCK` token (`src/routes/chat/[id]/ChatView.svelte:110-123`). See §2.                                                  |
| Prompt describes something the picture did not render (a cloak that vanished) | Nothing in the text layer — and no prompt rewrite fixes it either. The only lever that conditions on pixels is the edit graph.                        |

### (b) Things only seeing the pixels can solve

| Failure mode                                                                          | Why text cannot reach it                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "Same man" — the second picture's face is a different person                          | The prompt describes _the words that were asked for_, not the pixels that were drawn.                                                 |
| "The bus" — a prop rendered as a van, a lorry, a stroller                             | Only pixels say what the sampler chose; the prompt says what was requested.                                                           |
| Colour or garment drift after a regenerate or an edit                                 | The `LOCK` seed keeps the noise, not the render; a changed step count or LoRA re-rolls appearance while the prompt text stands still. |
| A tag cluster silently dropped (Anima's 0.6B encoder, `docs/IMAGE_MODELS.md` round 2) | A VLM reading the result can at least say "the injury is missing", which a tag list cannot know.                                      |

The honest summary: a VLM buys **one** capability — converting pixels back into words. Everything else in this
list is prompt plumbing we can do deterministically, and determinism is worth more than another model here.

---

## 2. The mechanical alternative, in detail

Three levers exist already, and one is a small step from working.

**1. A locked seed per chat.** `story.seed` is stored, editable (`src/lib/components/chat/ScenePanel.svelte:212`)
and used by every picture: "of this moment" passes `chatSeed`
(`src/lib/components/images/ImageTools.svelte:167-172`); a `LOCK` marker resolves to `story.seed`, then to the
newest picture's seed, and writes the first one it picks
(`src/routes/chat/[id]/ChatView.svelte:113-123`). Regenerate deliberately ignores it
(`ImageTools.svelte:175-184`) so a retry still produces a new picture. The rationale is in the record itself:
"reusing one seed is what keeps a face recognisable between scenes, which is the single hardest thing to get
from a text prompt" (`src/lib/shared/story.ts:14-16`).

**2. Carrying the previous prompt.** This is the part that is _not_ wired. `buildScenePrompt` builds every scene
from card + `look` + the last two turns (`CONTEXT_MESSAGES = 2`, `CONTEXT_WORDS = 45`, `scene.ts`), and `[[IMG]]`
markers are parsed fresh from each reply with no memory of the last one (`src/lib/shared/image.ts:208-223`). The
ComfyInject extension the grammar came from did exactly this — it rewrote every generated `<img>` back into
`[[IMG: <data-prompt> | <seed> ]]` before each generation, so the model saw its own previous prompts
(`comfyinject-rea/REPORT.md` §4) — and then threw most of it away with a two-segment token that dropped AR and
SHOT ("Proven losses in the round-trip", §7). We can copy the good half cheaply: append the previous picture's
`images.prompt` to the scene prompt as a continuity clause.

**3. The identity lever we already own.** `flux2-klein-edit` is registered and reachable
(`src/lib/server/comfy/workflows.ts:390-395`, `EDIT_WORKFLOW` at `:422`); it takes a source image plus one
instruction through `ReferenceLatent`, and it was the only edit path that obeyed its instruction in the
benchmark (`workflows.ts:196-203`; `docs/IMAGE_MODELS.md` round 3: same face and pose after a gown swap,
25.8 s cold). `POST /api/images/edit` already reads the source bytes from disk by id
(`src/routes/api/images/edit/+server.ts:32-40`) — the correct, phone-friendly shape.

**What the mechanical layer cannot fix.** If the sampler drew a van where the story said bus, the next beat
still asks for a bus and draws something else. Prompt continuity re-argues identity; it does not condition the
image model on the reference. The edit graph does condition on it, but only as "change this into that", which
costs a whole generation and pins the composition the last scene left.

---

## 3. If vision is pursued: the smallest design

**What gets sent.** Two things, nothing else: the previous picture's PNG bytes and the new beat as text. Not the
card, not the transcript — the card is already in the prompt path and the transcript tail is already assembled.

**Which model.** The `[gemma-4-E4B-it-qat-q4_0-heretic-Q4_0_PURE]` section in
`llama_models/models-router.ini:46-61` already points at an `mmproj` projector
(`mmproj-gemma-4-E4B-it-qat-q4_0-heretic-Q8_0.gguf`). Measured on disk: **4,255,261,440 B for the GGUF (~4.2 GB)**
and **559,874,944 B for the projector (~560 MB)**. It is the only vision-capable checkpoint configured, and the
router runs `--models-max 1`, so using it evicts whatever text model is resident.

**Where it would plug in.** One new server module `src/lib/server/prompts/describe.ts` exporting
`describePreviousImage(bytes, beat): Promise<string>`, called by `POST /api/images/scene` before
`buildScenePrompt` (`src/routes/api/images/scene/+server.ts:39-52`), with the bytes fetched exactly as the edit
route does it: `getImage(db(), imageId)` (`src/lib/server/db/images.ts:72`) then `readImageFile(image.file)`
(`src/lib/server/images/store.ts:47`). No new HTTP endpoint is required while the scene route is the only caller.

**The new work is in the prompt layer, not the route.** `PromptMessage` is text-only — a role plus a string
`content` (`src/lib/server/prompts/rp.ts:18-21`) — and `assemblePrompt` consumes stored rows mapped to
`{role, content}` from the chat route (`src/routes/api/chat/+server.ts:145-152`); images never enter that path.
`LlmCaps` has no vision flag (`src/lib/server/backends/llm/llamacpp.ts:79-85`). So sending an image means
widening `PromptMessage.content` to a text-or-parts union, teaching `assemblePrompt` to pass it through, adding
a capability flag, and confirming the OpenAI-compatible image content part survives this llama.cpp build.
**Unverified:** whether the router honours a `data:` image part on `/v1/chat/completions` — the app has only ever
sent text, so nothing in the repo proves this works.

**Cost per picture.** A 832x1216 PNG is roughly 1-2 MB on disk; through the projector it becomes a few hundred
vision tokens plus a short text answer. Wall-clock for that call is **unmeasured** — no VLM timing exists in
`docs/` or `_notes/` — plan for seconds and measure it. On top of that sits the VRAM problem, which is measured:
with an LLM resident, "every image above runs ~70 % slower because the 8 GB card has to shuffle weights", and "a
5 s Z-Image becomes ~8.5 s mid-chat" (`docs/IMAGE_MODELS.md`, round 3). The backend reports `caps.unload: false`
(`llamacpp.ts:84`) and this llama-server build has no unload route, so gemma at ~4.2 GB plus 560 MB of projector
stays resident until the process exits while ComfyUI loads its own graph beside it.
`docs/TROUBLESHOOTING.md:19` already names the workaround: start ComfyUI **before** llama-server.

The uncomfortable arithmetic: the two slowest things on this machine are the resident LLM and the shard swap
between the two runtimes. A VLM call does both — it wakes the LLM, then asks ComfyUI to draw on the card it is
sitting in.

---

## 4. Risks

1. **Error amplification.** A VLM describing the previous picture re-narrates its mistakes as facts ("a man in a
   red coat") and the next prompt inherits them. ComfyInject's outbound rewrite has the same shape and the same
   weakness: the model sees its own final prompts back (`REPORT.md` §4), so a bad prompt compounds. There is no
   ground truth anywhere in the loop.
2. **Prose against tags.** Anima needs the hybrid order (tags for identity, one sentence for action), Z-Image
   wants 80-250 words of prose, and the flat-tag models ignore prose (`docs/IMAGE_MODELS.md`, "Prompting rules
   per model"). A VLM writes prose by default, and feeding that to Anima is feeding a 0.6B encoder the exact
   shape the round-2 probe showed it cannot hold ("contradictory framing tags", "keeps the last, strongest tag
   cluster and drops the rest").
3. **Prompt-only continuity does not condition the model.** It re-argues identity; it does not pin it. In
   ComfyInject's own ranking the only mechanism that "pins actual appearance" is the edit graph, with prompt text
   as identity carrier second (`REPORT.md` §7). A VLM upgrades the second and touches neither the first nor the
   sampler.
4. **It fights the lever it is meant to improve.** Round 3 also found that on a distilled sampler "the same prompt
   with a different seed renders nearly identical images" and "a new picture needs a changed prompt, not a changed
   seed". So seed continuity and prompt continuity overlap — and a VLM prompt that rewrites every beat can undo
   the stability the `LOCK` seed buys.
5. **Budget creep on a full card.** 4.2 GB of new resident weights on a GPU that already cannot hold a 7.5 GB
   text encoder beside a model (`CLAUDE.md`, FLUX.2 CLIP section: "does not fit beside the model on 8 GB").
   Local-only is preserved, but the 8 GB story gets worse.

**Therefore:** measure before building. One hour, four beats, both arms, one contact sheet.

---

## 5. A three-step experiment (~1 hour, no app changes)

**Step 1 — mechanical arm (15 min).** One chat, one `look`, one `story.seed`, four consecutive beats through
`POST /api/images/scene` then `POST /api/images` on `z-image-turbo-t2i` (measured 5.1 s warm,
`docs/IMAGE_MODELS.md` round 3). Beats chosen to break continuity: M1 solo -> M2 with a prop ("the bus") -> M3
outfit change -> M4 injury. Record per beat: prompt text, seed, wall-clock.

**Step 2 — vision arm (25 min).** Same four beats, same seed, same graph; the prompt is "VLM's description of
beat N-1's PNG" followed by "beat N's text". Run the VLM **out of process** — a `curl` against
`/v1/chat/completions` with an image content part is enough; do not build the `PromptMessage` widening for an
experiment. Record: VLM wall-clock, token counts, resident VRAM from `nvidia-smi` with gemma up versus down, and
the two prompts side by side.

**Step 3 — read it (20 min).** One contact sheet of eight pictures (two arms, four beats), judged against the
table below.

| Question                             | Evidence                                                                            | Kill criterion                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Does beat 2 keep the same person?    | same hair/outfit tags in the two prompts, and visible identity on the contact sheet | the vision arm is not visibly better than the seeded prompt arm |
| Does the VLM prompt differ usefully? | a diff of the two prompts: does it add facts the transcript did not state?          | it only re-words what `look` already said                       |
| What does it cost?                   | wall-clock per beat, and VRAM headroom with gemma and ComfyUI both resident         | it pushes a 5 s Z-Image past ~15 s, or OOMs ComfyUI             |
| Is the output even read?             | one Anima beat from each prompt (round 2: Anima drops long tag soup)                | the prose arm loses the Danbooru tags that carry identity       |

Method note that applies to all of it: use **at least 4 seeds per prompt** for any prompt comparison, because
single-seed differences under ~10 % are noise and Z-Image barely moves on seed (`docs/IMAGE_MODELS.md`, "Method
note: seeds before conclusions").

---

## 6. What we would need to add, ordered

| #   | Change                                                                                                           | Where                                                                     | Size |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---- |
| 1   | Persist the previous picture's prompt on the story record and feed it to the scene prompt as a continuity clause | `src/lib/shared/story.ts` (field, patch schema, test), `prompts/scene.ts` | S    |
| 2   | "Continue from the last picture": scene route accepts a source image id and routes to the existing edit path     | `src/routes/api/images/scene/+server.ts`, `images/generate.ts` (exists)   | S    |
| 3   | Show the resolved seed and the continuity clause in the Scene panel preview, so drift is diagnosable             | `src/lib/components/chat/ScenePanel.svelte`                               | S    |
| 4   | A vision capability flag plus a "second model for description" config slot                                       | `backends/llm/llamacpp.ts`, `src/lib/shared/backend.ts`, `config.ts`      | S    |
| 5   | Widen `PromptMessage.content` to text-or-parts and thread it through `assemblePrompt`                            | `src/lib/server/prompts/rp.ts` (+ `rp.spec.ts`)                           | M    |
| 6   | `describePreviousImage()` module: image id -> bytes -> one description, with a timeout and a token cap           | `src/lib/server/prompts/describe.ts` (new)                                | M    |
| 7   | Wire it into the scene route behind a config flag; report vision capability from the diagnostics probe           | `api/images/scene/+server.ts`, `doctor`                                   | M    |
| 8   | VRAM arbitration: refuse the VLM call while a graph is queued, or accept the ~70 % image slowdown                | `server/comfy/client.ts`, config                                          | L    |
| 9   | E2E guard that the whole app still passes with no vision model configured                                        | `e2e/`, `tools/fake-llm.ts`                                               | M    |

Items 1-3 are worth doing regardless of the answer to the question at the top: they are continuity built from
ingredients we already have, and they are what makes the experiment in §5 measurable.

---

## Where the claims come from

- Marker grammar, word vocabulary, `LOCK`: `src/lib/shared/image.ts:1-30` and `:130-205`.
- Scene record and the seed rationale: `src/lib/shared/story.ts:1-30`, `:64-100`.
- Prompt assembly and the three dialects: `src/lib/server/prompts/scene.ts:120-250`; per-model rules in
  `docs/IMAGE_MODELS.md`, "Prompting rules per model".
- Text-only prompt path: `src/lib/server/prompts/rp.ts:18-21`, `src/routes/api/chat/+server.ts:145-152`.
- Edit and inpaint graphs, and the measured edit behaviour: `src/lib/server/comfy/workflows.ts:196-206`,
  `:384-422`; `src/lib/server/images/generate.ts:110-200`; `src/routes/api/images/edit/+server.ts:1-70`.
- The extension this grammar came from, and its continuity mechanisms ranked: `comfyinject-rea/REPORT.md` §4, §7.
- Vision projector and weight sizes: `llama_models/models-router.ini:46-61` and the files on disk.
- Speeds, the resident-LLM tax and the seed method note: `docs/IMAGE_MODELS.md`, round 3 and "Method note".
- 8 GB constraints: `CLAUDE.md` (FLUX.2 CLIP section), `docs/IMAGE_MODELS.md` round 3,
  `docs/TROUBLESHOOTING.md:19`.
