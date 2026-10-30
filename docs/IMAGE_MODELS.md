# Which image model to use

Nine checkpoints are wired into the picker. This page is what comparison runs measured, so the choice is
a lookup rather than a guess.

**Hardware and conditions.** RTX 3060 Ti (8 GB), ComfyUI 0.42.0, quantised weights, 832×1216 portrait
(1216×832 for wide shots), one fixed seed per beat. Story text always comes from **Stheno 8B** through the
app's own `/api/chat`, and every prompt is assembled by the app's own `/api/images/scene` — so these
numbers measure the pipeline the app actually runs, not hand-written prompts.

Two runs, same method:

- **Round 1** — all seven checkpoints then installed, nine story beats (63 images).
- **Round 2** — the four picks plus Z-Image+Mystic XXX, fourteen beats across four dimensions
  (70 images + 10 edits + 12 probes).

---

# Round 2 (current): four picks + Z-Image with the NSFW LoRA

> **Caveat, added after round 3:** these were taken with llama.cpp resident, which costs ~70 % on every
> image here. They are useful for comparing models against each other, not for predicting a quiet machine.
> See the round-3 table at the bottom for the clean numbers.

## Speed

Numbers are medians from a **model-major** run: each model stays resident while its block runs, which is
how the app behaves when you pick one model in a chat. (Round 1 interleaved all seven per beat, so every
image paid a 6 GB reload; those numbers are in the appendix and are misleading for steady use.)

| Model                    | Median    | Min  | Max  | LoRA/edit cost              |
| ------------------------ | --------- | ---- | ---- | --------------------------- |
| **Anima Turbo (int8)**   | **4.2 s** | 4.2  | 8.4  | —                           |
| **FLUX.2 Klein**         | **8.4 s** | 7.8  | 22.5 | edit 12–26 s                |
| **Z-Image Turbo 6B**     | 14.6 s    | 14.1 | 25.9 | edit 14–21 s                |
| **Z-Image + Mystic XXX** | 14.8 s    | 14.2 | 15.7 | **+0.2 s (1.4 %)** vs plain |
| **Krea2 Anime v14**      | 18.4 s    | 17.8 | 23.1 | edit 18–23 s                |

The Mystic XXX LoRA is essentially free: 0.2 GB of extra weights, +0.2 s median. The first image of a
session pays 8–11 s of weight loading, which is why every `max` is roughly `median + 8`.

Wide 1216×832 shots run 15–25 % slower than portrait.

## Accuracy — 14 beats

`++` followed completely · `+` followed with a miss · `–` pivoted away · `✗` ignored or replaced

| Model                | M1 solo | M2 two | M3 dress | M4 injury | S1 rain | S2 shrine | S3 counter | O1 book | O2 lantern | O3 map | N1 nude | N2 couple | N3 two | N4 heavy | Score       |
| -------------------- | ------- | ------ | -------- | --------- | ------- | --------- | ---------- | ------- | ---------- | ------ | ------- | --------- | ------ | -------- | ----------- |
| **Z-Image + Mystic** | ++      | –      | ++       | ++        | ++      | ++        | ++         | ++      | ++         | ++     | ++      | +         | ++     | ++       | **25.5/28** |
| **Krea2 Anime**      | ++      | ++     | ++       | +         | ++      | ++        | ++         | +       | ++         | ++     | ++      | +         | ++     | ++       | **25/28**   |
| **Z-Image Turbo**    | ++      | –      | ++       | ++        | ++      | ++        | ++         | ++      | ++         | ++     | +       | +         | ++     | ++       | **24.5/28** |
| **FLUX.2 Klein**     | +       | ++     | +        | ++        | ++      | ++        | +          | +       | ++         | ++     | +       | +         | ++     | +        | **21/28**   |
| **Anima Turbo**      | +       | ✗      | +        | +         | –       | ++        | +          | ✗       | +          | ✗      | +       | ✗         | ++     | +        | **11.5/28** |

What each miss actually was:

- **Z-Image picks a studio backdrop when a wide shot has two people in it.** M2 (`wide shot, full body,
environment visible`, two women) came back on a grey seamless studio background, kitchen gone — with and
  without the LoRA, so it is the model, not the add-on. Every other wide beat (street, shrine) is fine.
- **Anima refuses to leave a face out.** M2 → face close-up instead of a wide kitchen; S1 → a collage of
  street plus enormous face; O1 → an illustrated woman painted inside the logbook; O3 → a face sculpture
  beside the map. It will draw a pretty face in a frame that asked for a lantern and rope.
- **Injury continuity**: Z-Image (± LoRA) and FLUX.2 put the bandage on the hand _and_ kept the glass shard;
  Krea2 Anime drew a white cuff instead; Anima placed the bandage but changed the gown to a slip.
- **Object-only frames** (O1–O3): only Z-Image (both variants) consistently honours `still life`. FLUX.2
  and Krea2 Anime add a man at the desk; Anima adds a face.
- **N2 "explicit act, close shot"** is a prompt problem, not a model failing — see the framing bug below.
  Every model cropped to faces or upper bodies; Anima turned it into a kissing close-up.

## NSFW, in detail

| Model                | Solo nude | Explicit act | Two women | Notes                                                                         |
| -------------------- | --------- | ------------ | --------- | ----------------------------------------------------------------------------- |
| **Z-Image + Mystic** | ++        | +            | ++        | LoRA adds clearly better skin and anatomy than plain Z-Image; acts still crop |
| **Krea2 Anime**      | ++        | +            | ++        | Most consistent anatomy of the anime models; its own unlock LoRA helps        |
| **Z-Image Turbo**    | +         | +            | ++        | Uncensored but soft: nudity yes, explicit detail thin                         |
| **FLUX.2 Klein**     | +         | +            | ++        | Turns explicit prompts romantic: embracing, draped, legs together             |
| **Anima Turbo**      | +         | ✗            | ++        | Two women works; a single act collapses to a face                             |

**Anima's "refusal" is prompt shape, not censorship.** Probing the same explicit prompt five ways
(GPU, same seed):

| Variant                        | Result                                                       |
| ------------------------------ | ------------------------------------------------------------ |
| CFG 1, long prompt, 8 steps    | explicit act, extreme proportions                            |
| CFG 2.5, long prompt, 12 steps | explicit act, better anatomy                                 |
| CFG 4, long prompt, 16 steps   | explicit act, hair colour drifted to black                   |
| **CFG 1, _short_ prompt**      | **two women, explicit act, both coherent — best of the set** |
| anima-base, CFG 4, 20 steps    | explicit but generic and washed out                          |

So CFG is not the blocker. The 0.6B text encoder behind `qwen_3_06b_base` cannot hold a long
comma-separated instruction plus framing tags; it keeps the nearest cluster ("close shot" → face) and drops
the rest. Short, concrete prompts work. This also explains the speed: 4.2 s is a 0.6B encoder and a
distilled sampler, not a clever architecture.

## LoRA strength

Same explicit prompt, same seed, on Z-Image:

| Strength | Verdict                                                                          |
| -------- | -------------------------------------------------------------------------------- |
| 0.7      | works, explicit, slightly plastic skin                                           |
| **1.0**  | **best balance — clean anatomy, keeps the scene request (author's own setting)** |
| 1.3      | over-cooked: the act fell back to a posed lingerie shot, identity drifted older  |

The LoRA carries **only `diffusion_model.*` tensors** (no text-encoder weights), so `strength_clip` is a
no-op; the graph sets it to 1.0 to match the author's workflow and it costs nothing.
Krea2 Anime's own unlock LoRA (`snofs_krea_v1_nostrip`) also works at 0.8–1.0 and is a second route to the
same result.

## Image edits

Each model edited **its own** M1 render with the same two instructions: swap the sweater for a black
evening gown, then make it rain hard.

| Model            | Edit path                                                  | Dress swap                                  | Rain                                             | Time          |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ------------- |
| **FLUX.2 Klein** | native instruction edit (ReferenceLatent + Flux2Scheduler) | **worked** — black gown, same face and pose | **worked** — wet hair, rain streaks, storm light | 26.4 / 12.3 s |
| Krea2 Anime      | generic img2img, denoise 0.55                              | partial — lace top and skirt, not a gown    | partial — damp hair, street at night             | 23.4 / 18 s   |
| Z-Image Turbo    | generic img2img, denoise 0.55                              | **no change**                               | **no change**                                    | 21.1 / 14 s   |
| Z-Image + Mystic | generic img2img, denoise 0.55                              | **no change**                               | **no change**                                    | 15.6 / 16.9 s |
| Anima Turbo      | generic img2img, denoise 0.55                              | partial — same sweater, tighter             | **no change**                                    | 8.9 / 4.2 s   |

FLUX.2 is the only model here that can be _told_ what to change. The others need denoise ≈0.7+ (which
starts to lose the face) or a dedicated edit model — at CFG 1 a distilled sampler barely moves the latent
toward a text instruction. The app's existing masked inpaint (Anima LLLite, 9.1 s) remains the reliable way
to change a region.

## Framing bug found while testing

`prompts/scene.ts` appends the shot tags **after** the scene text, and `close` is
`close-up, portrait, detailed face`. For an intimate scene the tail of the prompt therefore reads
`... explicit sex with a man ... close-up, portrait, detailed face`, and every model obeys the last,
strongest tokens — which is why N2 came back as faces and kissing rather than the act. Not a model problem:
a prompt-assembly problem. Two candidate fixes (not applied yet):

1. When the scene text contains explicit or action terms, keep the close shot but swap the tag for
   `close-up on hands and bodies` instead of `detailed face`.
2. Let the user's `extra` field override shot tags entirely (today it only appends).

## Recommendations

| Use                                     | Model                | Why                                                       |
| --------------------------------------- | -------------------- | --------------------------------------------------------- |
| Everyday story images                   | **Z-Image Turbo**    | 14.6 s, best props/hands/objects, 87 % obedience          |
| Story images plus skin/explicit detail  | **Z-Image + Mystic** | same speed, better anatomy, 91 % obedience                |
| Anime, two characters, explicit anatomy | **Krea2 Anime**      | 18.4 s, most reliable anime anatomy, own unlock LoRA      |
| Photoreal + real edits                  | **FLUX.2 Klein**     | 8.4 s, only usable instruction editor                     |
| Drafts, quick iteration                 | **Anima Turbo**      | 4.2 s, but hybrid prompts only, and it will insert a face |

---

# Appendix — round 1: all seven checkpoints

Interleaved run (every image switched model, so load time is baked in). Use it for the ranking of the
models that round 2 dropped, not for absolute speed.

| Model            | Portrait | Scene  | Note                                           |
| ---------------- | -------- | ------ | ---------------------------------------------- |
| Z-Image Turbo    | 12.3 s   | 19.0 s | later confirmed 14.6 s warm in round 2         |
| Krea2 Anime v14  | 17.9 s   | 18.9 s |                                                |
| FLUX.2 Klein     | 22.8 s   | 22.1 s | round 2 shows 8.4 s once resident              |
| Anima Base v1.0  | 26.8 s   | 27.0 s | slowest of the anime family, least detail      |
| Anima Turbo      | 7.9 s    | 8.0 s  | 4.2 s warm                                     |
| Anima Turbo fp16 | 8.5 s    | 8.5 s  | same results as int8, more VRAM                |
| Krea2 Turbo      | 42.5 s   | 44.6 s | painterly, loosest adherence, ignores injuries |

Round 1 obedience (nine beats): Z-Image 18/18, FLUX.2 17/18, Krea2 Anime 14/18, Krea2 Turbo 11/18,
Anima Base 9/18, Anima Turbo 9/18, Anima fp16 8/18.
Round 1 NSFW: nudity 7/7, explicit act only Krea2 Anime and FLUX.2, Anima Turbo/fp16 and Anima Base
partial, Z-Image truncated to implied.

## Where the files are

In the app: **Jess round 2** (M1–M4), **lighthouse object/scene chat** (S1–S3), **NSFW probe** (N1–N4),
plus the round-1 chats.

In ComfyUI `output/`:

| Prefix                                                                                           | What                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `ZImageTurbo_*`                                                                                  | Z-Image Turbo (round 2 continues the counter, 15+ = round 2) |
| `ZImageMystic_*`                                                                                 | Z-Image + Mystic XXX                                         |
| `Flux2Klein_*`                                                                                   | FLUX.2 Klein (was `ComfyInject_*` before the prefix fix)     |
| `Krea2Anime_*`                                                                                   | Krea2 Anime v14                                              |
| `AnimaTurbo_*`                                                                                   | Anima Turbo int8                                             |
| `EditZImage_*`, `EditZImageMystic_*`, `EditFlux2Klein_*`, `EditKrea2Anime_*`, `EditAnimaTurbo_*` | the img2img edits                                            |
| `Probe-ZImage-L07/L1/L13_*`                                                                      | LoRA strength sweep                                          |
| `Probe-AnimaTurbo-cfg1/cfg25/cfg4/short_*`, `Probe-AnimaBase-cfg4_*`                             | the anima diagnosis                                          |
| `Probe-KreaUnlock08/1_*`                                                                         | Krea2's own unlock LoRA                                      |

---

# Round 3 — LoRAs, instruction edits, and where the time actually goes

Two things happened after round 2: the app grew a real edit feature, and five community LoRAs were measured.
Both changed the answers.

## Instruction edit is now a feature, not a benchmark note

`workflows/flux2_klein_edit.json` had been sitting in the repo unregistered since the first commit. It is now
`flux2-klein-edit`, behind `POST /api/images/edit` and the **Change with a sentence** button in the viewer.
The browser sends `{imageId, instruction}` and nothing else — the source bytes are already on disk, so no
1.5 MB round trip over Tailscale.

First real run: an anima nude from the NSFW chat, instruction _"change the grey knit sweater into a black
evening gown, keep the same face and pose"_ → the gown appeared, the face/hair/pose/room and the **anime art
style** survived, 25.8 s cold (first FLUX.2 load inside the app). It is the only edit path that obeys: the
generic img2img graph at denoise 0.55 changes nothing on the distilled models.

## LoRAs measured

| LoRA                        | File                                                 | Effect                                                                                  | Cost           |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------- |
| **Z-Image Turbo Lightning** | `Zed_Turbo_Lightning.safetensors` (34 MB)            | 8 steps → 4 with no visible loss; wide shots keep their composition                     | **−40 % time** |
| **Klein Fixes (NSFW)**      | `FLUX_NSFW_Fix.safetensors` (176 MB, 4B build)       | FLUX.2 "nude" goes from a smooth mannequin with underwear on to an actual detailed nude | none           |
| **Klein anatomy slider**    | `klein4B_slider_anatomy.safetensors` (11 MB)         | ± anatomy control on top; +0.5 was redundant beside the fix above                       | none           |
| **Anima Highres/Aesthetic** | `anima-highres-aesthetic-boost.safetensors` (132 MB) | brighter, cleaner lighting; 1536 px without falling apart                               | +0.3 s         |
| **Anima Detail Tweaker**    | `rendering_detailer_base10.safetensors` (88 MB)      | more material detail, fewer garbled corner texts                                        | +0.1 s         |

All five loaded on our exact checkpoints: the anima pair targets hidden size 2048 and the Klein pair is the
**4B** build (the popular 9B unlockers are a different tensor shape and will not load).

Z-Image Mystic XXX + Lightning at 1.0/1.0 is still fully explicit with detailed anatomy — the two LoRAs
compose, so the fastest and the spiciest Z-Image recipe are now the same one.

## Speed, measured properly

Round 2's numbers went through the app **with llama.cpp resident**, which starves ComfyUI of VRAM on an 8 GB
card. These are direct to ComfyUI with the chat idle, three seeds per config, median of the warm runs:

| Recipe               | Before           | After                              | Change                   |
| -------------------- | ---------------- | ---------------------------------- | ------------------------ |
| Z-Image Turbo        | 8.5 s (8 steps)  | **5.1 s** (4 steps + Lightning)    | −40 %                    |
| Z-Image + Mystic XXX | 8.7 s (8 steps)  | **5.1 s** (4 steps + both LoRAs)   | −41 %                    |
| FLUX.2 Klein         | 4.3 s (4 steps)  | **3.4 s** at 3 steps, same quality | −21 %                    |
| FLUX.2 Klein NSFW    | —                | **4.2 s** (4 steps + fix)          | the LoRA is free         |
| Krea2 Anime v14      | 13.6 s (8 steps) | **10.6 s** at 6 steps              | −22 %                    |
| Anima Turbo + detail | 4.0 s (8 steps)  | **4.2 s**                          | +0.2 s for better detail |

**The LLM costs more than any sampler setting.** With Stheno resident, every image above runs ~70 % slower
because the 8 GB card has to shuffle weights. The app cannot fix that on llama.cpp: the backend reports
`caps.unload: false` and `llama-server` in this build has no unload route (checked in the binary), so the
weights stay until the process exits. What the app does do is unload LM Studio on an idle timer. Practically:
pictures taken before you start chatting are the cheap ones, and a 5 s Z-Image becomes ~8.5 s mid-chat —
which is still fast enough to just take the picture.

## What changed in the app

- The picker now offers 9 entries; `z-image-turbo-t2i`, `z-image-mystic-t2i` and `anima-turbo-t2i` were
  upgraded **in place** to the recipes above (same names, same look, half the time).
- New entry: **FLUX.2 Klein Unlocked (4B)** — the only photoreal explicit model here that also edits.

> **Naming (2026-10-29):** the picker labels these two **Unlocked** (“Z-Image + Mystic XXX Unlocked”,
> “FLUX.2 Klein Unlocked”), which matches `_notes/PHASE4_KREA2_UNLOCKED.md`. The ids keep `nsfw`/`mystic`
> because every image row ever drawn stores them in `images.workflow`; renaming ids would strand that
> history. The file names below are ComfyUI's and are unchanged.

- New graphs: `z_image_turbo_lora2_t2i` (two LoRA slots), `flux2_klein_lora_t2i`, `anima_turbo_quality_t2i`.
- `npm run doctor` now lists every LoRA the registry names and reports the ones ComfyUI cannot see.

## Anima: the LoRA question, answered

There is no LoRA that improves instruction following, and that is structural: a LoRA patches the diffusion
transformer, while instruction following happens in the text encoder — the 0.6B `qwen_3_06b_base` in our
build. What the community ships for Anima is what LoRAs can do: quality/detail sliders, step distillation, and
hundreds of artist styles. The real upgrade for adherence is Anima 3.8B v1.1 (a 4B encoder, custom nodes,
~5 GB more download), not a LoRA on the 2B.

What _did_ help adherence, for free: **the right prompt shape** — and it is not "short", it is **hybrid**.
The round-2 note on this page said Anima "wants short prompts". That was the wrong diagnosis: what
collapsed at CFG 1, 2.5 and 4 alike was **long tag soup carrying contradictory framing tags**
(`... explicit sex ... close-up, portrait, detailed face`) — the 0.6B encoder keeps the last, strongest
tag cluster and drops the rest. Anima's own guidance (and the community guide cited below) is a **hybrid
prompt**: a Danbooru tag block for identity / clothing / count, then one or two prose sentences for the
action, and **exactly one** camera tag. The bare ask `two nude women kissing on a bed, explicit, realistic`
scored well because it was _unambiguous_, not because it was short — the same content as tags plus
sentences scores the same and controls appearance better.

Source: [The Ultimate Anima Prompting Guidebook](https://civitai.com/articles/35368/the-ultimate-anima-prompting-guidebook-all-you-need).

---

# Prompting rules per model

The prompt builder in `src/lib/server/prompts/scene.ts` is model-aware: the same beat is written
differently depending on which workflow will draw it. These are the shapes it emits.

- **`generic` / `krea2` / `flux2`** — Danbooru-style tag soup, unchanged from earlier rounds. A model in
  this group reads a comma-separated list and ignores nothing; prose costs tokens and buys nothing.
- **`anima*`** — the official hybrid order, in this exact sequence: `masterpiece, best quality, highres`,
  then a safety tag (`safe` / `nsfw` / `explicit`), then a subject count (`1girl, solo` / `1boy, solo` /
  `2girls`), then appearance tags, then **one prose sentence** of action taken from the transcript, then
  **exactly one** camera tag, then the chat's `look`, then `detailed lighting`, then the user's own extra
  tags. No `score_*` tags — they are a Danbooru ordering artifact, not a quality hint, and in Anima's
  positive they only steal attention from the subject.
- **`z-image*`** — one structured prose paragraph, in the order shot → subject/appearance → action →
  environment → lighting/style → technical/cleanup (`no text, no watermark`). 80–250 words, no tag soup.

Two cross-cutting rules:

- The close framing no longer emits `portrait, detailed face`. It cropped explicit scenes to face
  close-ups (see the round-2 framing bug), so the tag is gone; `close-up` alone is enough.
- A framing the user supplies in `extra` **suppresses** the shot tag entirely. A prompt cannot carry two
  conflicting framings — that is what the 0.6B encoder and every distilled sampler resolve by obeying the
  last one.

## Anima's official defaults

| Knob                | Anima Base                      | Anima Turbo        |
| ------------------- | ------------------------------- | ------------------ |
| Sampler / scheduler | `er_sde`                        | `er_sde`           |
| Steps               | ~35                             | 8–12               |
| CFG                 | 4.5                             | 1                  |
| Negative            | the model's documented negative | the documented one |
| Resolution          | 512–1536 (long side)            | 512–1536           |

Anima Base now runs that recipe rather than a generic 20-step euler pass. `anima-base-t2i` is no longer
listed in the picker (it stays reachable through the API and the `/image` marker), and the default image
model is now `z-image-turbo-t2i`. Krea2 Anime runs 6 steps.

Never put `score_*` tags in an Anima positive, even as "quality" padding.

## Z-Image Turbo: prose, and why "regenerate" is not enough

- **Long structured prose beats tag soup.** One paragraph of **80–250 words** in the order shot →
  subject/appearance → action → environment → lighting/style → technical/cleanup describes the beat more
  reliably than the same content as tags, and the cleanup clause (`no text, no watermark`) is written as
  part of the sentence rather than as a tag.
- **At CFG 1 the negative prompt is cancelled.** ComfyUI's CFG maths subtracts `negative × 0`, so a
  distilled sampler at CFG 1 cannot honour a negative at all. Anything you want excluded has to be
  **phrased positively inside the prompt** ("plain seamless background", "clean unmarked skin"), not
  appended to the negative. Keep the negative field for CFG > 1 graphs only.
- **Steps: 8–12 is the official recipe**; we run **4 with the Lightning LoRA** and verified visually that
  nothing is lost (round 3, wide shots keep composition). Treat 4 as an app decision, not the model's.
- **The same prompt with a different seed renders nearly identical images.** Confirmed in the model's own
  discussion thread — the distilled sampler at 4–8 steps has very little seed entropy left. So pressing
  "regenerate" does nothing; a new _picture_ needs a changed **prompt**, not a changed seed. That also
  means a single-seed A/B between two prompts measures almost nothing (see the method note below).

Sources: [Z-Image Turbo prompting notes](https://gist.github.com/illuminatianon/c42f8e57f1e3ebf037dd58043da9de32),
[Tongyi-MAI/Z-Image-Turbo discussion #8](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/discussions/8).

## Method note: seeds before conclusions

A model or prompt comparison needs **at least 4 seeds per prompt** — single-seed differences under ~10 %
are noise, on Z-Image especially (where seeds barely move the latent). `E:/tmp/seeds.mjs` exists to enforce
this when timing or comparing outside the app.

# Round 4 — the prompt dialects, checked on real images

Ten scenes through `POST /api/images/scene` → `/api/images`, two chats (a bakery beat and an explicit
bedroom beat), three workflows, ComfyUI in auto-VRAM mode (~6.3 s warm on Z-Image, ~5.3 s warm on Anima).
Contact sheet: `E:/tmp/sheets/prompts-v2.jpg`.

**What the rewrite fixed, visible in the output:**

- **Close framing is no longer a face filler.** Dropping `portrait, detailed face` from the close tag produces
  an upper-body close-up with the room still in it, instead of a head-and-shoulders crop of a scene that was
  about hands, a bed, or a fight.
- **`explicit` is now sent when the scene is explicit.** The safety word reads the chat's `look` as well as the
  transcript, because round-2 chats keep wardrobe/anatomy tags there; before that fix the prompt said `safe`
  while the look said `completely nude`, and the two arguments cancelled out.
- **A user's own framing wins outright.** `extra: "wide shot from behind, looking out the window"` suppressed
  the shot tag and produced exactly that shot — the prompt never carries two framings.
- **Z-Image stopped collapsing wide beats onto a grey studio backdrop.** Environment survives now. It still
  renders a "wide establishing shot of a person" as a medium shot of that person: the _setting_ is obeyed, the
  _distance_ is not. That is the model, not the prompt.

**Known gaps, in order of how much they annoy:**

- Z-Image wide framing (above). Use Anima for genuinely wide beats, or add `full body` to `extra`.
- At CFG 1 nobody obeying a negative means Z-Image will happily add a second figure to a close-up; Anima with
  its count tag (`1girl, solo`) does not.
- `medium shot, upper body` reads as head-to-thigh on Anima. Harmless, but the three shots are not evenly spaced.

**Timings do depend on how ComfyUI was started.** `start-comfy.bat` (auto VRAM) is the correct launcher for the
LoRA graphs; `start-comfy-turbo.bat` (`--highvram`) thrashes with any LoRA loaded. The round-3 numbers and the
picker labels assume auto mode and a warm model: a run right after a model switch costs 10–17 s once.

# Round 5 — storyboarding and roleplay scenes, measured

Two question sets, one GPU session (ComfyUI auto-VRAM, llama.cpp router resident). Six chats, 18 pictures,
all with LOCK/seed policy or the scene builder as the app ships it. Sheets: `E:/tmp/sheets/bus-storyboard.jpg`,
`E:/tmp/sheets/rp-mall.jpg`. Raw run data: `E:/tmp/busbench-results.json`.

## Storyboard: 3 beats of one continuous action

Beats: a man sprints for the bus → inside the bus the driver spots him in the mirror → the driver brakes so
he can board. Prompt authoring came from **gemma-4-E4B-heretic** driving the shipped `Storyboard` card; the
first beat is `SEED: RANDOM`, beats 2-3 are `LOCK`, which the app resolves to a fixed per-chat seed.

|                                                | Anima Turbo                                                           | Z-Image + Mystic                             |
| ---------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| Markers emitted, all 3 beats                   | 3/3                                                                   | 3/3                                          |
| Same person across beats                       | partial — hair and build drift, beat 2 reads as a different character | yes — same face, hair and build in all three |
| Scene carried (pavement → bus interior → door) | yes                                                                   | yes                                          |
| Two-subject beat (driver in the mirror)        | two figures, driver small in the aisle                                | driver at the wheel, mirror visible          |
| Wall time per picture                          | **6.3-6.4 s**                                                         | 13.6-13.8 s                                  |
| LLM time per beat (gemma, warm)                | 1.0-1.1 s                                                             | 1.0-1.2 s                                    |

What made continuity work was **not** the seed. It was the card's rule that every prompt repeats the
established tags verbatim, plus `LOCK` keeping the noise the same. Two prompt-authoring rules were added to
the card after this run and are why beat 2/3 show the driver at all: tag **every** person in frame (a driver
seen in a mirror is a subject), and use `LANDSCAPE`/`CINEMA` when two people are in the shot. Before that,
the same beats came back as a portrait of one man in an empty bus.

## Roleplay: bakery → mall, SFW and NSFW

Stheno for prose, the scene builder for the prompt (no markers). Beats: the bakery morning, then the mall.
The NSFW variant asks Jess to become an exhibitionist at the mall.

Measured before and after four fixes to `prompts/scene.ts` (all of which were found by this benchmark):

- **Hair was missing from every prompt.** The card's `appearance` field stops at eye colour; the hair lives
  in an `Appearance:` line deep in the description, and the builder read only the first 18 words of prose.
  Every model therefore invented a hair colour — brown, black, platinum — from picture to picture.
  Now an `Appearance:` line is read, and a card's own `{{user}}` macros are stripped instead of being sent
  to the image model.
- **The reader's line ate the whole prompt.** `moment` was "last two turns, first 45 words", so
  "The morning rush is over and Jess is wiping down the counter…" filled it and the reply — which described
  what Jess actually did — was cut away. A beat where her cardigan came off produced a fully dressed
  picture. The builder now takes the reader's line (24 words) **and** the reply (32 words).
- **Sentences were truncated at the first full stop**, which is how "5'2", slender. Dark blonde hair…" lost
  the hair twice over.
- **Hesitation speech reached the prompt**, and Anima answered with a speech bubble full of gibberish text
  ("WE SHOULD...UM...LOOK AT SOME THINGS"). Sentences containing `...` and single-quoted fragments are gone,
  and Anima now gets a 20-word action sentence instead of a paragraph.

After the fixes, in the same 4 chats:

|                                     | Anima Turbo                         | Z-Image + Mystic               |
| ----------------------------------- | ----------------------------------- | ------------------------------ |
| Same woman across the two beats     | yes (blonde, same face)             | yes (blonde, same face)        |
| SFW beat 2 reads as a mall          | yes                                 | yes                            |
| NSFW beat 2 shows the cardigan open | yes, plus `nsfw` in the prompt      | yes, plus `nsfw` in the prompt |
| Wall time                           | 8.5-12.3 s                          | 14.8-19.5 s                    |
| Prompt text that hurt               | occasional speech bubbles with text | none                           |

**Still wrong, and it is the same root cause:** the count tag. `subjectTag()` reads the _card_, so a
roleplay picture is tagged `1girl, solo` while the prose says "we walk into the mall together" — the model
then draws the partner as a second woman, or crops him out. The legacy app solved this with a per-chat
`present[]` list; until that exists, one-subject framing is the honest default and two-person beats will be
a coin flip.

## What to use for what

- **Storyboard / multi-beat continuity:** Z-Image + Mystic. Twice the wait, and the only one that kept the
  same face across three beats.
- **Storyboard when speed matters:** Anima Turbo at ~6 s, accepting a re-cast character by beat 3.
- **Roleplay scenes:** either. Anima is 2× faster and occasionally authors text into the picture; Z-Image is
  slower and cleaner.

## Round 5b — the same three beats, after reprompting

The first storyboard run was bad in ways worth writing down, because none of them were the model's fault:
the third beat contradicted the second ("he is inside the bus" → "the driver brakes so the man can get
aboard"), the driver was never _tagged_, so he was drawn as a copy of the protagonist in a suit, and the
braking beat named a cause instead of anything a camera can see. Fixed in three places:

- **The beats** are now one shot each, and beat 2 puts him outside the bus, seen in the mirror: sprint
  after the bus → driver glances at the mirror → driver brakes and opens the door.
- **The card** gained the rules that were missing: every visible person is a subject with their own
  features (a driver wears a navy uniform shirt, badge and peaked cap — never the passenger's suit); show
  the action, not its cause (`motion blur, leaning passengers, gripping yellow handrail`, not "slams the
  brakes"); consecutive beats must not repeat the same framing; and `LOCK` is only for a solo picture of an
  established subject, because a frame a new person enters is a new composition.
- **The marker grammar** learned the two words that decide whether a second character is in shot at all:
  `OTS` and `2SHOT`, plus the shot sizes `EWS WS FS MS MCU CU ECU` and the angles `HA LA EYELEVEL`.
- **The backend** hands the card the last drawn prompt verbatim (`PREVIOUS SHOT`, appended after the card's
  own post-history rules). A storyboard card's only memory was its own prose; the canonical tag list is
  what makes "remember what you wrote" into "copy what is still true".

|                                              | Anima Turbo  | Z-Image + Mystic         |
| -------------------------------------------- | ------------ | ------------------------ |
| Driver drawn as an NPC in uniform + cap      | yes          | yes                      |
| Two people in frame for the two-person beats | yes          | yes                      |
| Open door / boarding visible                 | partly       | yes, clearest of the two |
| Motion (the bus braking) visible             | no           | no                       |
| Wall time per shot                           | **6.9-10 s** | 14.2-19 s                |

Both models still compress beats: Z-Image boarded the man one beat early, and neither draws a braking bus
as motion — a single still has no "before". The fix for that is framing (`motion blur`, a leaning crowd,
the door), which the card now asks for, and it is the one part of a shot sheet that a text-to-image model
serves worst.

### The picture-attribution bug this uncovered

The pictures in the first run were rendered above the wrong prompt. Cause: `POST /api/chat` appended the
assistant row and never called `mirrorChat`, so `data/chats/<id>/chat.json` stopped one reply short until
something else wrote. Anything that read the folder — a backup, an import, a script placing pictures by
message id — saw a transcript the database did not. Fixed, with a regression test that reads the mirror
after a streamed turn.

## Round 5c — layperson prose, two models, two six-beat sequences

The user's own words, no shot vocabulary (a layperson should not have to write `OTS`): a village sequence
overhead → house → door → market → pomegranate → yen, and a beach sequence car → sand → change → onlookers.
Krea2 Anime **Unlocked** (the no-strip LoRA at strength 1) against **Z-Image + Mystic**. Sheets:
`E:/tmp/sheets/village.jpg`, `E:/tmp/sheets/beach.jpg`.

What changed for this run — three things, all of which were the actual cause of the weak Z-Image storyboards:

1. **The prompt dialect is now chosen per model, by the server.** A storyboard chat remembers its image
   model (`story.imageWorkflow`, set when the picker changes) and the chat route appends a `PROMPT STYLE`
   paragraph: Z-Image is told to write a 40-80 word caption and open it with what changed; Krea2/Anima are
   told to write Danbooru tags. Before this the card demanded tags for every model, and a caption model fed
   tag soup simply repeated the previous shot.
2. **"Describe the state the beat ends in."** A still has no before, so "she takes off her dress and pulls
   on a bikini" is drawn as the dress; "she stands in a red bikini, dress heaped on the ground" is drawn as
   the bikini.
3. **"The camera follows X" is a shot, not a beat.** Both models turned it into a face close-up until the
   card said a camera-move beat means the subject moving through the place — back view or wide, never a
   face.

|                                                        | Krea2 Anime Unlocked                                              | Z-Image + Mystic                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------- |
| Overhead village → house → door → market → fruit → yen | all six, in order                                                 | all six, in order                                   |
| "Camera follows her" beat                              | wide street with stalls, subject mid-scene                        | back view down the lane, wide                       |
| Character held across the sequence                     | no — kimono white → navy → pale, and beat 5/6 are different women | yes — same blue floral kimono and hair in beats 3-5 |
| NSFW progression obeyed                                | yes — dress off, bikini on, crowd looking                         | partly — implies it; beat 3 keeps the dress on      |
| Style                                                  | photoreal, not anime, despite the checkpoint                      | photoreal                                           |
| Wall time                                              | ~20 s/shot                                                        | ~14 s/shot                                          |

**Verdict.** Z-Image + Mystic is the better _storyboarder_ — faster, more consistent, and it reads a
caption like text — but it will not fully obey an undressing beat. Krea2 Anime Unlocked is the one that
obeys explicit progression, at 20 s, with wardrobe drift and a photoreal look that the "anime" label does
not describe. Neither draws a beat it cannot see: if a still cannot show it (a bus braking, a door
opening mid-swing), describe the state it leaves behind.

## Round 6 — three sequences, three unclipped models, no shot tags

Same three stories for **Krea2 Unlocked**, **Z-Image + Mystic** and **Anima Turbo** (no unlock LoRA exists
for Anima; it turned out not to need one). Village (sfw, 6 beats), beach (semi, 4 beats), clothing store
(explicit, 6 beats) — all written as plain prose, the way a layperson describes a shot. Sheets:
`E:/tmp/sheets/r6-village.jpg`, `r6-beach.jpg`, `r6-store.jpg`.

|                                  | Krea2 Unlocked                             | Z-Image + Mystic                   | Anima Turbo                 |
| -------------------------------- | ------------------------------------------ | ---------------------------------- | --------------------------- |
| Village, all six beats           | yes                                        | yes                                | yes                         |
| "Camera follows her" beat        | street with stalls                         | back view down the lane            | extreme wide, figure tiny   |
| Character held across a sequence | no (kimono changes, faces differ)          | mostly (same kimono 3-5)           | yes (same girl throughout)  |
| Beach: undressing obeyed         | yes                                        | partly (dress pulled open, bikini) | yes (bikini)                |
| Store: naked under the coat      | yes                                        | yes                                | yes                         |
| Store: bystanders reacting       | two men walking past                       | a man with his hand to his face    | no — became a rear close-up |
| Artifacts                        | style flips photoreal ↔ anime mid-sequence | one split/diptych frame            | beat compression            |
| Per shot                         | ~20.5 s                                    | ~14 s                              | **~7.4 s**                  |

**Verdict.** For explicit progression, **Krea2 Unlocked and Z-Image + Mystic both comply**; the difference
is style stability (Krea2 flips) versus obedience at the edges (Z-Image would not fully undress on the beach
but did in the changing room). **Anima Turbo is the fastest and the most consistent character** — 7.4 s is
three times faster than Krea2 — but it compresses beats: a beat about onlookers became a rear close-up, and
one "camera follows" beat became a landscape with a tiny figure. At this speed it is the right model for a
long storyboard, with the caveat that beats about _other people_ need the people named in the beat itself.

Nothing here needs a shot tag from the user: the card picks the framing, and every one of these sequences was
written as plain prose.

## Why the art style used to flip mid-sequence (2026-10-30)

Krea2 Unlocked is the model whose style drifted most, and round 7 measured exactly where it came from. The
storyboard writer was **asked** to keep the render style in every prompt:

```
PROMPT STYLE (this chat draws with a Danbooru model): … RENDER STYLE (keep it in every prompt): anime screenshot, cel shading, clean lineart, vivid color
```

It complied on most beats and dropped the tail on the two beats that describe an explicit act
(`hand on crotch`, `masturbating penis to completion`) — the tags sit at the end of a long tag list, and the
end is the first thing the writer loses when it switches into a descriptive register. Measured on the drawn
frames, those two are exactly the soft/painterly ones: mean horizontal lineart contrast 12.7 and 13.1
against 17-18 for the frames that carried the tags. The seed, the model and the LoRA were the same.

The fix is not a better instruction, it is not asking at all: `pinStyle()` in `shared/story.ts` appends the
chat's style tags server-side in `POST /api/images` whenever the prompt does not already carry them (and
`story.style` is chat-level, set by the Scene panel). Pinned, the same sequence drew six anime frames with
no flip. Rules that follow:

- **Never let a model own the art style.** Either the graph carries it (a style LoRA) or the server appends it.
- `pinStyle()` is idempotent — the first style tag counts as "already pinned", so a writer that includes the
  tags does not get them twice.
- The Scene panel's `style` therefore means "how this chat draws", for every path: chip, "of this moment",
  edit and the scene preview.
- The no-strip LoRA had the same effect at full strength, and it is now **0.5**. Nine frames, three prompts,
  strengths 0 / 0.5 / 1, one fixed seed each (`E:/tmp/sheets/krea-lora-ab.jpg`): the explicit handjob frame
  scored lineart contrast 13.2 / **14.4** / 10.2 — crispest at 0.5, softest of all nine at 1.0, where the
  hands also went muddy. At 0 the act is replaced by a red bottle; 0.5 draws it and keeps the cel look.

Two lessons that outlive Krea2:

- **Explicitness is a prompt-shape problem before it is a model problem.** The same model that drew nothing
  in round 7's cinema sequence drew a clean explicit frame here, and the difference was framing: the failing
  prompts asked for a wide shot of twelve people with the act buried mid-list, while these lead with
  `1girl, 1man, two shot, close-up, nude, penis, erection, handjob`.
- **The unlock LoRA is a dial, not a switch.** Full strength buys content at the cost of the art style it
  was bolted onto.
