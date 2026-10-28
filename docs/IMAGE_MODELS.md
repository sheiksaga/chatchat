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

| Use                                     | Model                | Why                                                      |
| --------------------------------------- | -------------------- | -------------------------------------------------------- |
| Everyday story images                   | **Z-Image Turbo**    | 14.6 s, best props/hands/objects, 87 % obedience         |
| Story images plus skin/explicit detail  | **Z-Image + Mystic** | same speed, better anatomy, 91 % obedience               |
| Anime, two characters, explicit anatomy | **Krea2 Anime**      | 18.4 s, most reliable anime anatomy, own unlock LoRA     |
| Photoreal + real edits                  | **FLUX.2 Klein**     | 8.4 s, only usable instruction editor                    |
| Drafts, quick iteration                 | **Anima Turbo**      | 4.2 s, but short prompts only, and it will insert a face |

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
