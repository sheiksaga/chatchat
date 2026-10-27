# Phase 4 — Krea2 Turbo T2I + optional unlocked variants

Krea2 is now a first-class image route in chatchat: selecting
`krea2_turbo_fp8_scaled.safetensors` (or `krea2Anime_v14_int4.safetensors`) runs
a real Krea2 graph instead of falling back to the FLUX.2 Klein graph.

The Krea2 route carries **two optional LoRAs** — the "unlocked variants" — plus a
**fast render profile** that is on by default because the quality canvas is slow
on this class of machine. All three are checkboxes in the image-model dropdown
and are per-app settings, not per-chat ones.

## What changed

| File | Change |
| --- | --- |
| `workflows/krea2_turbo_t2i.json` | Krea2 Turbo T2I API graph, now **11 nodes**: two `LoraLoaderModelOnly` slots |
| `workflows/workflows.js` | **regenerated** — five graphs, no skipped notes |
| `tools/sync-workflows.js` | `krea2-turbo-t2i` `needs` includes `{{UNLOCKED_LORA_NAME}}` / `{{UNLOCKED_LORA_STRENGTH}}`; `loraNames()` still ignores `{{PLACEHOLDER}}` values; header text updated |
| `js/imagemodels.js` | curated `krea2-turbo` and `krea2-anime` entries with **both** LoRAs and the fast profile; `t2i_unlocked` capability; neutral `unlockedLora*` / `fast*` defaults on `IMAGE_DEFAULT_SETTINGS` |
| `js/state.js` | `imageParams.unlockedBypass` / `.unlockedLora` / `.krea2Fast` + `setImageUnlockedBypass()` / `setImageUnlockedLora()` / `setImageKrea2Fast()` |
| `js/comfy.js` | `{{UNLOCKED_LORA_NAME}}` / `{{UNLOCKED_LORA_STRENGTH}}` aliases and vars; `comfyGenerate()` decides both LoRA strengths and the fast size/steps from the toggles; missing-placeholder message mentions the new placeholders |
| `js/images.js` | `appendKrea2UnlockedControls()` — three checkbox rows, rendered in both model-list paths |
| `css/style.css` | `.image-unlocked` row styling (same layout as before) |
| `tools/krea2-harness.js` | asserts both LoRA strengths, the fast/quality profiles, and renders one live 768x768 / 6-step picture |

## Krea2 registry recipe

Official Krea2 recipe, no negative prompt:

- `UNETLoader` → `LoraLoaderModelOnly` (Fedor) → `LoraLoaderModelOnly` (SNOFS) → `KSampler`
- `CLIPLoader` type **`krea2`** over `qwen3vl_4b_fp8_scaled.safetensors`
- `VAELoader` `qwen_image_vae.safetensors`
- **`EmptyLatentImage`** (not `EmptyFlux2LatentImage`)
- negative branch = `ConditioningZeroOut` on the positive conditioning
- **8 steps, CFG 1.0, euler/simple**, denoise 1.0 (quality) — **6 steps, 768x768** (fast)

Registry entries (both `family: "krea2"`, `capabilities: ["t2i","t2i_unlocked"]`,
`workflowId: "krea2-turbo-t2i"`, quality size 1024x1024):

| id | match | unet | filenamePrefix |
| --- | --- | --- | --- |
| `krea2-turbo` | `krea2turbo`, `krea2_turbo` | `krea2_turbo_fp8_scaled.safetensors` | `Krea2` |
| `krea2-anime` | `krea2anime` | `krea2Anime_v14_int4.safetensors` | `Krea2Anime` |

Both share `clip: qwen3vl_4b_fp8_scaled.safetensors`, `clipType: krea2`,
`vae: qwen_image_vae.safetensors`, and:

| setting | value |
| --- | --- |
| `loraName` / `loraStrength` | `fedor_bypass.safetensors` / `3.0` |
| `unlockedLoraName` / `unlockedLoraStrength` | `snofs_krea_v1_nostrip.safetensors` / `0.8` |
| `fastSteps` / `fastWidth` / `fastHeight` | `6` / `768` / `768` |

## The two LoRAs

**Fedor bypass** — 488-byte safetensors `.diff` file,
SHA256 `312024b593c0a0561b18be3f04bd7d92810cab05af28183dc3ced91c18913eb2`.
It is a weight delta, so ComfyUI's `comfy/lora.py` handles it through
`LoraLoaderModelOnly`. At strength 3.0 it removes the model's refusal gate.

**SNOFS** — `snofs_krea_v1_nostrip.safetensors`, 42 939 816 bytes,
SHA256 `1a638c4fbffcbb71b470cded72edf0eeed1b34788925f87210740652fcddc2d8`,
from `https://huggingface.co/Kutches/Kr3a/resolve/main/snofs_krea_v1_nostrip.safetensors`.
It is a 96-key LoKr on the text-fusion blocks
(`diffusion_model.txtfusion.layerwise_blocks.*` and
`diffusion_model.txtfusion.refiner_blocks.*`), and also loads through
`LoraLoaderModelOnly`. At strength 0.8 it adds unlocked conditioning.

The two stack: Fedor at 3.0 plus SNOFS at 0.8 is the live-tested combination.

## Checkbox semantics

Three rows appear in the image-model dropdown **only** when the selected model's
registry entry names `loraName` or `unlockedLoraName` — i.e. only for Krea2.
Every other model names neither and gets no rows.

1. **Unlocked bypass (Fedor)** — `imageParams.unlockedBypass`.
   Off (default): the node still loads `fedor_bypass.safetensors` but at
   `strength_model = 0`, a no-op. On: `strength_model = 3.0`.
2. **Unlocked LoRA (SNOFS)** — `imageParams.unlockedLora`.
   Off (default): the second node loads `snofs_krea_v1_nostrip.safetensors` at
   `strength_model = 0`. On: `strength_model = 0.8`.
3. **Fast profile (768, 6 steps)** — `imageParams.krea2Fast`, **default on**.
   On: `steps = 6`, `width = height = 768`. Off: the registry's quality canvas,
   8 steps at 1024x1024.

Persisted as `localStorage.image_unlocked_bypass`, `image_unlocked_lora` and
`image_krea2_fast` (`"1"` / `"0"`; fast is read as on unless it is exactly `"0"`
so an untouched profile defaults to on). All three are app-wide.

The decisions live in `comfyGenerate()`:

- Fedor strength = `imageParams.unlockedBypass ? loraStrength : 0`
- SNOFS strength = `imageParams.unlockedLora ? unlockedLoraStrength : 0`
- Fast size/steps are filled in **only when the caller passed none of its own**,
  so an explicit `overrides.width`/`height`/`steps` still wins.

`comfyEdit()` / `comfyInpaint()` are untouched: Krea2 still has no edit or
inpaint graph.

## Live test result

`node tools/krea2-harness.js --base http://127.0.0.1:8188` — one 768x768,
6-step generation with both LoRAs on and the fast profile on, using a
deliberately non-explicit prompt ("a portrait of an adult woman in a red dress, standing
in a sunlit room, natural light").

- Result: **produced** a 768x768 PNG well over 50 000 bytes.
- Wall time: **27.1 s warm**, **39.1 s** on the first run after the LoRAs were
  first loaded (the previous 8-step 768x768 run took 36.1 s, and 8 steps at
  1024x1024 took 44.0 s). The first render pays the disk read for both LoRA
  files; subsequent runs are the warm figure.
- The harness asserts the wiring numerically, not visually: Fedor named at
  3.0, SNOFS named at 0.8, fast profile at 768x768 / 6 steps; with every switch
  off, Fedor 0, SNOFS 0, 8 steps at 1024x1024.

Effectiveness of the unlocked variants on real prompts is **not** visually
verified here. The LoRAs are wired at the intended strengths and the graph runs;
what Krea2 renders for a given adult prompt is for the user to test.

No explicit content was generated, requested or described.

## Caveats

- **Krea2 is T2I only.** Neither entry has `editWorkflowId` or
  `inpaintWorkflowId`, so `/edit` and Inpaint still refuse; the "is T2I only —
  switch to FLUX.2 to edit" notice is unchanged.
- Fast is the default, so app renders are 768x768 / 6 steps. Untick **Fast
  profile** for the 1024x1024 / 8-step quality canvas; that mode is still
  **not** under the 15 s budget.
- Loading two LoRAs adds a little per-render overhead on the first run after a
  ComfyUI restart (weights are read from disk).
- Not included: **BSS Projector Tuner**, and Krea2 **Identity/General Edit**
  graphs. Neither is bundled or offered.
- ComfyInject, the CLI, and the local-image-server model vocab files were
  **not** modified in this pass.

## Test commands used

```
node --check js/comfy.js
node --check js/imagemodels.js
node --check js/images.js
node --check js/state.js
node --check tools/krea2-harness.js
node --check tools/sync-workflows.js
node tools/sync-workflows.js "E:/Sangeeth/Quick_saves/coding/chatchat/workflows"
node tools/krea2-harness.js --base http://127.0.0.1:8188
```

## Note on the LoRA filenames in the bundled manifest

The graph uses `{{LORA_NAME}}` and `{{UNLOCKED_LORA_NAME}}` placeholders, so the
literal filenames live in `js/imagemodels.js` (`settings.loraName`,
`settings.unlockedLoraName`) and not in `workflows/workflows.js`. Verify the
wiring through substitution instead of a raw grep:

```
node -e "…substituteComfyWorkflow(krea2 graph, comfyVars(...))…"
# LoraLoaderModelOnly -> {"lora_name":"fedor_bypass.safetensors","strength_model":3}
# LoraLoaderModelOnly -> {"lora_name":"snofs_krea_v1_nostrip.safetensors","strength_model":0.8}
```

`node tools/krea2-harness.js` performs exactly this check, plus the live render.
