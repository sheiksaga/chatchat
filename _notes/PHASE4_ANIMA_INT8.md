# Phase 4 — Optional Anima int8 route (chatchat / ComfyInject / CLI)

Anima Turbo v1.1 now has an **optional quantised build**: the same model with
int8 conv-rotation weights (`anima-turbo-v1.1-int8convrot.safetensors`). It is
exposed as its own selectable route everywhere and is **not** a replacement —
the existing v1.1 entry stays the default/fallback in all three apps.

## Model file

| | |
| --- | --- |
| Path | `ComfyUI/models/diffusion_models/anima-turbo-v1.1-int8convrot.safetensors` |
| Size | 2,249,911,304 bytes |
| SHA256 | `dca788a021936a4f993d2ea75a301c8c0f7e1e5346cf858ee1a048f2c39075e4` |
| Source | `wingbrother/Anima-Turbo-v1.1-int8-convrot-256-learned` → `Anima_Turbo_v1-1_int8crl256.safetensors` |

Companion files are unchanged from stock Anima: `qwen_3_06b_base.safetensors`
(CLIP, type `stable_diffusion`), `qwen_image_vae.safetensors` (VAE), and the
`anima-lllite-inpainting-v2.safetensors` LLLite patch for mask inpainting.

## T2I benchmark (vs current v1.1)

Same seed, same prompt, same 8-step / CFG 1.0 / euler / simple recipe; no other
change to the graph.

| Resolution | v1.1 int8 | v1.1 stock | Speedup |
| --- | --- | --- | --- |
| 832x1216 | 7.46 s | 11.47 s | 1.54x |
| 1024x1024 | 6.45 s | 11.78 s | 1.83x |

Visual quality was judged equivalent on the benchmark images.

Important: these are warm, server-side sampling timings with the model already
resident. Actual cold/model-switch runs can be much slower — a 512x512 CLI smoke
test measured 84.6 s, and a later 832x1216 run after `/free` took 257.6 s. The
int8 route is only a speed win while Anima stays loaded in ComfyUI; a model
switch/eviction can dominate. The stock v1.1 route has the same cold-load
problem, but this is why int8 is optional and not the default.

## LLLite inpaint test

The int8 build was also run through the existing `anima-lllite-inpaint` graph
(source + white-on-black mask + instruction, LLLite strength 1.0 over the whole
run, `grow_mask_by: 6`):

| | v1.1 int8 | v1.1 stock |
| --- | --- | --- |
| Warm run | 16.21 s | 25.85 s |
| Outside-mask drift | 1.35 | 1.35 (identical) |

So the quantisation does not touch image regions the mask tells it to keep, and
it is safe to expose int8 as **inpaint-capable**. It is still **not an edit
model** — Anima has no instruction-edit graph, so `editWorkflowId` /
`edit_workflow` stay empty and `/edit` keeps refusing.

## Integration locations

| App | File | What was added |
| --- | --- | --- |
| chatchat | `js/imagemodels.js` | `anima-turbo-int8` registry entry, placed **before** the generic `anima-turbo-2b` entry so its filename matches first |
| CLI | `llama_models/comfy_cli.py` | `ANIMA_INT8_MODEL`, `ANIMA_INT8_PREFIX`, a `MODEL_SLOTS` download row, an `"anima-int8"` `MODEL_PROFILES` entry, `Cfg.is_anima` covers both, `build_t2i_graph` uses `CFG.is_anima` |
| ComfyInject | `settings.js` | `"anima-turbo-v1.1-int8convrot.safetensors"` `model_registry` entry |
| ComfyInject | `index.js` | `initSettings()` now merges **missing nested** `model_registry` keys from `defaultSettings`, so existing installs pick up the new entry without losing their own |

chatchat entry:

```
id: "anima-turbo-int8"
match: ["int8convrot", "anima-turbo-int8", "animaturboint8"]
workflowId: "anima-turbo-t2i"       inpaintWorkflowId: "anima-lllite-inpaint"
modelPatch: "anima-lllite-inpainting-v2.safetensors"
capabilities: ["t2i_unlocked", "inpaint"]      inpaintSteps: 8
settings: euler / simple / 8 steps / cfg 1.0 / 1024x1024
          unet anima-turbo-v1.1-int8convrot.safetensors
          clip qwen_3_06b_base.safetensors (stable_diffusion)
          vae  qwen_image_vae.safetensors    filenamePrefix "AnimaFast"
```

The graph is identical to stock Anima — only the diffusion-model file and the
output prefix differ. chatchat writes `AnimaFast#####`, the CLI writes
`cli_anima_int8_#####_.png`, ComfyInject keeps its own prefix.

## How to select the route

- **chatchat** — pick `Anima Fast (int8)` in the image-model dropdown
  (`anima-turbo-v1.1-int8convrot.safetensors`). T2I and Inpaint both work;
  `/edit` still refuses.
- **CLI** — `image.bat --model anima-int8 "anime portrait, cel shading"`
  (or `/status` in the REPL to confirm `route anima-int8`). `--edit` is rejected
  exactly as it is for `--model anima`.
- **ComfyInject** — choose `Anima Fast int8 (anime)` in the model dropdown. On
  upgrade the entry is added automatically; an existing install can also simply
  re-select it from the dropdown once saved.

## Caveats

- Benchmarks are **one seed per resolution**; a second seed was not run, so treat
  the exact speedup numbers as indicative rather than a distribution. They are
  **warm sampling times**, not cold-start times.
- Cold load/model-switch can be very slow (observed 73–258 s after eviction).
  Use int8 only if Anima stays resident across the RP session; keep v1.1 as the
  fallback.
- Absolute timings vary with GPU state, ComfyUI warm/cold model loads and the
  rest of the machine's load. The ratios are the useful part.
- **Current v1.1 remains the fallback and default.** Nothing in the existing
  `anima-turbo-v1.1.safetensors` / `anima` / `Anima Turbo v1.1 2B` entries was
  changed; the int8 route is purely additive.
- Still T2I-only for instruction editing. `--edit` / `/edit` / `[[EDIT: ...]]`
  keep refusing on both Anima routes.
- VRAM: the int8 file is ~2.25 GB vs ~4.18 GB, but peak sampling VRAM is governed
  by the dequantised weights, so do not expect a large VRAM drop — the win is
  speed.
- **YAAE / Cosmos are not included.** No YAAE or Cosmos code, models or graphs
  were added or touched by this phase.

## Validation performed

- `node --check js/imagemodels.js` — OK.
- VM smoke (`workflows/workflows.js` + `js/imagemodels.js` + `js/comfy.js`, stub
  context): `anima-turbo-v1.1-int8convrot.safetensors` resolves to
  `workflowId anima-turbo-t2i`, `inpaintWorkflowId anima-lllite-inpaint`,
  `editWorkflowId null`, `settings.unet` = the int8 filename; the T2I
  substitution emits the int8 `unet_name`, and the inpaint substitution emits the
  int8 `unet_name` plus `ModelPatchLoader` loading
  `anima-lllite-inpainting-v2.safetensors`. Stock Anima and FLUX.2 entries
  unchanged.
- `python -m py_compile comfy_cli.py` — OK. Profile/graph check: `flux2`,
  `anima`, `anima-int8` build graphs with the expected unet, prefix, steps and
  canvas; `anima-int8` rejects `--edit`.
- ComfyInject parse checks of `settings.js`, `index.js`, `src/comfy.js`,
  `src/ui.js` — OK. Registry-merge simulation shows the int8 entry added to an
  existing registry while custom entries and the default checkpoint are kept.
- No new ComfyUI generation was run and ComfyUI was **not** restarted; the
  benchmark and inpaint numbers above were measured before integration.
