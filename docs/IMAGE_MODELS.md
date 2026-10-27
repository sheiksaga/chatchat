# Which image model to use

Seven checkpoints are wired into the picker. This page is what a full comparison run measured, so the
choice is a lookup rather than a guess.

**Run conditions.** RTX 3060 Ti (8 GB), ComfyUI 0.42.0, 4-bit/8-bit quantised weights, 832×1216 portrait
(1216×832 for wide shots), one fixed seed per beat. Story text came from **Stheno 8B** through the app's
own `/api/chat`, and every prompt was assembled by the app's own `/api/images/scene` — so this measures
the pipeline the app actually runs, not hand-written prompts.

Nine story beats, all seven models each (63 images, 0 failures):

| #   | Beat                                        | What it tests                 |
| --- | ------------------------------------------- | ----------------------------- |
| A1  | closing the bakery alone, tired             | solo character, interior      |
| A2  | sister walks in, arms crossed               | two characters in one frame   |
| A3  | the bank called again, eyes fill            | emotion in a close-up         |
| A4  | changes out of the apron into a black dress | wardrobe continuity           |
| A5  | cuts her forearm, sister bandages it        | injury continuity + hands     |
| A6  | waits outside in the raincoat for the cab   | weather + environment, wide   |
| B1  | empty lighthouse interior in a storm        | scene only, no character card |
| B2  | a stranger in a red coat comes in           | two people, no card           |
| B3  | writing the watch in the logbook            | object detail, hands, text    |

## Speed

Two different numbers matter, and they disagree on purpose.

| Model                | Steady state, portrait¹ | Mixed-model churn² | 6 GB load once |
| -------------------- | ----------------------- | ------------------ | -------------- |
| Anima Turbo (int8)   | **7.9 s**               | 6.5 s              | ~2 s           |
| Anima Turbo fp16     | 8.5 s                   | 10.8 s             | ~3 s           |
| **Z-Image Turbo 6B** | **12.3 s**              | 27.6 s             | ~9 s           |
| Krea2 Anime v14      | 17.9 s                  | 30.2 s             | ~9 s           |
| FLUX.2 Klein         | 22.8 s                  | 22.2 s             | ~5 s           |
| Anima Base v1.0      | 26.8 s                  | 37.0 s             | ~15 s          |
| Krea2 Turbo          | 42.5 s                  | 47.9 s             | ~11 s          |

¹ The number you actually live with: one model resident, repeated generations, 832×1216.
² The matrix run, where every image used a different model — so every call paid a full weight swap. Use
this column only to see how much reloading hurts (Z-Image's 6 GB int8 costs the most to swap).
Wide 1216×832 shots add roughly 15–25 % over the portrait time.

## Accuracy — story beats

`++` followed completely, `+` followed with a miss, `–` partial/pivoted, `✗` ignored or replaced.

| Model             | A1 solo | A2 pair | A3 grief | A4 wardrobe | A5 injury | A6 rain | B1 empty | B2 two | B3 object | Score     |
| ----------------- | ------- | ------- | -------- | ----------- | --------- | ------- | -------- | ------ | --------- | --------- |
| **Z-Image Turbo** | ++      | ++      | ++       | ++          | ++        | ++      | ++       | ++     | ++        | **18/18** |
| **FLUX.2 Klein**  | +       | ++      | ++       | ++          | ++        | ++      | ++       | ++     | ++        | **17/18** |
| Krea2 Anime v14   | ++      | +       | ++       | ++          | +         | ++      | +        | ++     | +         | 14/18     |
| Krea2 Turbo       | ++      | +       | ✗        | ++          | ✗         | +       | +        | ++     | ++        | 11/18     |
| Anima Base        | ++      | +       | +        | ++          | +         | +       | ✗        | ✗      | +         | 9/18      |
| Anima Turbo       | ++      | ++      | +        | +           | +         | +       | +        | ✗      | ✗         | 9/18      |
| Anima Turbo fp16  | ++      | +       | +        | +           | +         | +       | +        | ✗      | ✗         | 8/18      |

What the individual misses were:

- **Wardrobe continuity works everywhere.** 7/7 dropped the apron and dressed her in black at A4 without
  being told what to remove. This is the one continuity task that needs no special handling. (The anima
  trio turned "plain black dress" into a low-cut slip — same story, different mood.)
- **Injury continuity is where models split.** Z-Image and FLUX.2 wrapped the left forearm _and_ put the
  cut on the right cheek, and kept the hand holding a tray anatomically sane. The anima trio bandaged a
  hand or produced a doubled wrap with merged fingers. Krea2 Turbo drew no bandage at all.
- **Emotion without tears is not the same as grief.** Krea2 Turbo rendered a calm face at A3 and skipped
  the tears. The anima trio blushed instead of crying — cute, wrong for a scene about a bank calling.
- **"Empty room" is hard to ask for.** At B1 the prompt legitimately mentions the narrator climbing stairs,
  so Krea2 Anime and Krea2 Turbo put a figure on them (defensible), Anima Base moved the whole camera
  outside. Z-Image and FLUX.2 stayed in the room.
- **The anima trio wants a face on everything.** At B3 (logbook, candle, quill) they pasted an illustrated
  girl _inside the book pages_. Krea2-anime drew a man's face at the desk. Z-Image, FLUX.2 and Krea2 Turbo
  drew hands writing, which is what was asked.

## NSFW capability

Three prompts, all seven models, same seed: full nudity in a bathroom, an explicit act on a bed, and
lingerie on a bed.

| Model               | Nudity | Explicit act | Lingerie | Notes                                                                          |
| ------------------- | ------ | ------------ | -------- | ------------------------------------------------------------------------------ |
| **Krea2 Anime v14** | ++     | ++           | ++       | Only model that rendered an act with sane anatomy; anime style                 |
| **FLUX.2 Klein**    | ++     | ++           | ++       | Photoreal explicit, some limb merging at contact points                        |
| Krea2 Turbo         | ++     | +            | ++       | Intimate framing, avoids explicit detail                                       |
| Z-Image Turbo       | ++     | +            | ++       | Nudity fine; the act came back cropped/implied. No censorship, just truncation |
| Anima Base          | ++     | +            | ++       | Explicit pose, anatomy left smooth/undetailed                                  |
| Anima Turbo         | ++     | ✗            | ++       | Replaced the act with a face close-up                                          |
| Anima Turbo fp16    | ++     | ✗            | ++       | Same collapse to a face                                                        |

Nobody refused. There is no censorship layer to fight — the differences are all about _how_ a model
interprets an explicit prompt, and about anatomy quality.

Two habits to know:

- **The anima trio drifts hair colour on body shots**: auburn became silver/white in all three NSFW
  prompts, though it stayed auburn in the clothed beats. At CFG 1 there is no negative prompt to pin it,
  and these are distilled graphs.
- **Distilled models collapse close-ups.** "Explicit act, close shot" is ambiguous, and Turbo/fp16 resolve
  it as a _face_ close-up: 6–10 s, and 0 % of the requested act.

## Recommendations

| Use                     | Model                                                       | Why                                                  |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Everyday scene images   | **Z-Image Turbo 6B**                                        | 18/18 obedience, best props/hands/identity, 12 s     |
| Photoreal, most literal | **FLUX.2 Klein**                                            | 17/18, steadiest anatomy, 23 s                       |
| Sexual scenes           | **Krea2 Anime v14** (anime) or **FLUX.2 Klein** (photoreal) | the only two that render contact with usable anatomy |
| Fast iteration          | **Anima Turbo**                                             | 8 s; expect to redraw wardrobe/injury specifics      |
| Painterly mood pieces   | **Krea2 Turbo**                                             | slowest (43 s) and loosest, but the nicest colour    |

Concrete rules that came out of the run:

1. **Write the wardrobe, not the change.** "Black dress" works; "changed out of the apron" only works
   because the look field already replaced the tags.
2. **Name the injured limb and the side.** "Bandage on her left forearm, cut on her right cheek" was
   followed; the vaguer version left hands wrapped like fists.
3. **For an object or empty shot, put `still life` in `extra`.** Negations are stripped on purpose
   (`dropNegations`), so `no people` is not available — see the note in `prompts/scene.ts`.
4. **Card `appearance` should be tags, not prose.** Jess's card says `5'2" tall, slender, grey-green eyes,
pale skin that blushes...`, and that sentence lands in every prompt verbatim. It still works, but a
   tag-style line (as Seraphina's card has) gives the models less to misread.

## Where the files are

In the app: the run lives in three chats — **Jess** (A1–A6), the lighthouse chat (B1–B3) and
**NSFW probe (7 models)**, 21 images each.

In ComfyUI's `output/` folder, newest twelve files per prefix, in beat order
(A1…A6, B1…B3, N1…N3):

| Prefix          | Model                                                    |
| --------------- | -------------------------------------------------------- |
| `ZImageTurbo_*` | Z-Image Turbo 6B                                         |
| `Krea2Anime_*`  | Krea2 Anime v14                                          |
| `Flux2Klein_*`  | FLUX.2 Klein (was `ComfyInject_*` before the prefix fix) |
| `AnimaBase_*`   | Anima Base v1.0                                          |
| `AnimaTurbo_*`  | Anima Turbo int8                                         |
| `AnimaFp16_*`   | Anima Turbo fp16                                         |
| `Krea2_*`       | Krea2 Turbo                                              |
