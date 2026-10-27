/* ══════════════════════════════════════════════════════════════
   imagemodels.js — what kind of image a model produces

   A small curated database mapping image model ids (ComfyUI diffusion-model
   filenames, OpenAI /models ids) to the *kind* of image they produce, plus the
   sampler/resolution defaults their own model cards recommend.

   Why a database at all: a filename says almost nothing about the style it was
   trained for. Story/Image modes need to know whether they are writing against
   an anime model or a photographic one before they can build a prompt, and
   chat-mode /img needs the model's own recommended sampler/steps/cfg instead
   of generic ones.

   Phase 1 of the Flux.2 migration shipped one entry: the FLUX.2 Klein 4B
   distilled model, which handles both text-to-image and instruction editing.
   It is a guidance-distilled, natural-language model — 4 steps, CFG 1.0,
   euler/simple — and it takes *no negative prompt* (the unconditional branch of
   its CFG-1 graph is `ConditioningZeroOut`, not a negative prompt).

   Phase 2 adds a second route on the same registry: Anima Turbo v1.1 (2B), a
   Qwen3-0.6B-text-encoder anime model at 8 steps / CFG 1.0, also
   `ConditioningZeroOut`-negatived. It is **text-to-image only** — Anima has no
   instruction editing — so its entry deliberately has no `editWorkflowId`.
   FLUX.2 stays the default and the only edit path.

   Phase 3 gives Anima a *mask* path instead: the same checkpoint plus the
   `anima-lllite-inpainting-v2` LLLite side-adapter, which repaints only what a
   white-on-black mask covers and keeps the rest of the picture. That is
   `inpaintWorkflowId` + the `inpaint` capability, and it is still not an
   instruction edit — `editWorkflowId` stays absent so /edit keeps refusing and
   nothing silently redraws a fresh picture in place of an edit.

   Phase 4 adds the Krea2 route (Turbo fp8-scaled and the Anime v14 int4
   variant): CLIPLoader type `krea2` over qwen3vl_4b, EmptyLatentImage, and the
   official 8 steps / CFG 1.0 / euler/simple recipe with `ConditioningZeroOut`
   as the negative. Krea2 graphs ship two optional LoRA sockets
   (`fedor_bypass.safetensors` and `snofs_krea_v1_nostrip.safetensors`, both
   strength 0 = off), which the image-model dropdown exposes as the "unlocked"
   checkboxes. Krea2 also carries a *fast* profile (768x768, 6 steps) that is on
   by default because the 1024x1024 / 8-step quality mode is slow. Like Anima it
   is **text-to-image only**: no `editWorkflowId`, no `inpaintWorkflowId`.

   Phase 4b adds an optional *quantised* Anima route ahead of the stock one:
   `anima-turbo-v1.1-int8convrot.safetensors`, the same Anima Turbo v1.1 with
   int8 conv-rotation weights. Measured ~1.5-1.8x faster at identical quality
   (832x1216 7.46 s vs 11.47 s, 1024x1024 6.45 s vs 11.78 s) and it keeps the
   LLLite mask path (~1.6x faster warm inpaint, outside-mask drift identical),
   so it is inpaint-capable but still not an edit model - `editWorkflowId`
   stays absent. The stock `anima-turbo-v1.1.safetensors` entry is unchanged
   and remains the fallback.

   Entries are matched by substring on a normalised id, so version tags,
   quantisation suffixes and extensions are all ignored. Models that aren't
   listed fall back to {@link IMAGE_DEFAULT_SETTINGS}.
   ══════════════════════════════════════════════════════════════ */

/** Style keys this database uses. Anything unknown degrades to "general". */
const IMAGE_STYLES = {
  anime: "anime",
  realistic: "realistic",
  illustration: "illustration",
  threeD: "3d",
  general: "general",
};

/**
 * Baseline sampler/resolution defaults, used when a model has no curated
 * entry. These are the Flux.2 Klein recipe: a wrong-but-sane default still
 * renders, whereas an empty one produces a ComfyUI placeholder error.
 */
const IMAGE_DEFAULT_WORKFLOW_ID = "flux2-klein-t2i";

/** Bundled edit workflow, used when a model's entry does not name its own. */
const IMAGE_DEFAULT_EDIT_WORKFLOW_ID = "flux2-klein-edit";

const IMAGE_DEFAULT_SETTINGS = {
  sampler: "euler",
  scheduler: "simple",
  steps: 4,
  cfg: 1.0,
  width: 832,
  height: 1216,
  // The three model files a Flux.2 graph loads. Kept on the entry (not just in
  // the workflow) so a workflow can be re-pointed without editing JSON.
  unet: "flux-2-klein-4b-fp8.safetensors",
  clip: "qwen_3_4b.safetensors",
  clipType: "flux2",
  vae: "flux2-vae.safetensors",
  workflowId: IMAGE_DEFAULT_WORKFLOW_ID,
  editWorkflowId: IMAGE_DEFAULT_EDIT_WORKFLOW_ID,
  // Where ComfyUI saves the PNG. Curated models override it (Anima writes
  // `Anima`) so a file on disk names the route that drew it.
  filenamePrefix: "ComfyInject",
  // Optional LoRA applied by the graph's first LoraLoaderModelOnly node. Empty
  // for every model that has no such node, which leaves the placeholder
  // unfilled only in graphs that never ask for it.
  loraName: "",
  loraStrength: 0,
  // Second optional LoRA (the "unlocked variants" slot) and the fast render
  // profile. Neutral zeros here: a model that does not name them gets a graph
  // with no second LoRA node and no size/steps override.
  unlockedLoraName: "",
  unlockedLoraStrength: 0,
  fastSteps: 0,
  fastWidth: 0,
  fastHeight: 0,
};

/**
 * The curated registry. Order matters: the first entry whose `match` appears
 * in the normalised model id wins, so put the specific models above the
 * family catch-alls.
 *
 * Fields:
 *   match[]           lowercase/alphanumeric substrings to match
 *   label             long descriptive name (used in notes/toasts)
 *   displayName       short friendly name for dropdown rows/pills, when the
 *                     long label would not fit (see imageModelDisplayName)
 *   style             one of IMAGE_STYLES
 *   family            pipeline family (flux2, ...
 *   workflowId        bundled ComfyUI text-to-image graph for this model
 *   editWorkflowId    bundled ComfyUI instruction-edit graph, or null when the
 *                     model cannot edit (Anima). Never inherit the Flux.2 edit
 *                     graph by accident.
 *   inpaintWorkflowId bundled ComfyUI mask-inpainting graph (Anima LLLite), or
 *                     absent when the model cannot inpaint. Separate from
 *                     editWorkflowId: a mask is not an instruction edit.
 *   modelPatch        LLLite/inpainting side-adapter file the inpaint graph
 *                     loads through ModelPatchLoader
 *   settings          sampler/scheduler/steps/cfg/size/model-file overrides
 *   editWidth/Height  size for instruction edits when it differs from the T2I canvas
 *   inpaintSteps      sampler steps for mask inpainting when it differs
 *   capabilities      what the model is offered for ("t2i", "t2i_unlocked",
 *                     "edit", "inpaint")
 */
const IMAGE_MODEL_REGISTRY = [
  {
    id: "flux2-klein-4b",
    match: ["flux2klein", "flux-2-klein", "flux2"],
    label: "FLUX.2 Klein 4B (distilled)",
    displayName: "FLUX.2 Klein 4B",
    style: "general",
    family: "flux2",
    workflowId: "flux2-klein-t2i",
    editWorkflowId: "flux2-klein-edit",
    capabilities: ["t2i", "edit"],
    // Edits render smaller than the T2I canvas on purpose: FLUX.2 Klein's edit
    // graph takes 16.53 s at 832x1216 and 9.20 s at 832x1152 @ 4 steps
    // (_notes/PHASE2_EDIT_LATENCY.md). T2I keeps settings.width/height.
    editWidth: 832,
    editHeight: 1152,
    settings: {
      sampler: "euler",
      scheduler: "simple",
      steps: 4,
      cfg: 1.0,
      width: 832,
      height: 1216,
      unet: "flux-2-klein-4b-fp8.safetensors",
      clip: "qwen_3_4b.safetensors",
      clipType: "flux2",
      vae: "flux2-vae.safetensors",
      filenamePrefix: "ComfyInject",
    },
  },
  {
    // Optional quantised Anima: the same v1.1 recipe on the int8 conv-rotation
    // build. Must sit *above* the generic `anima-turbo-2b` catch-all, because
    // the first matching entry wins and that one only matches "animaturbo".
    // Measured (one seed per size, _notes/PHASE4_ANIMA_INT8.md): 832x1216
    // 7.46 s vs 11.47 s and 1024x1024 6.45 s vs 11.78 s on stock v1.1,
    // visually equivalent. LLLite inpaint works too: warm 16.21 s vs 25.85 s
    // with identical outside-mask drift (1.35 / 255). So it is inpaint-capable,
    // but still not an edit model - no editWorkflowId.
    id: "anima-turbo-int8",
    match: ["int8convrot", "anima-turbo-int8", "animaturboint8"],
    label: "Anima Fast (int8) (anime T2I + inpaint)",
    displayName: "Anima Fast (int8)",
    style: "anime",
    family: "anima",
    workflowId: "anima-turbo-t2i",
    inpaintWorkflowId: "anima-lllite-inpaint",
    modelPatch: "anima-lllite-inpainting-v2.safetensors",
    capabilities: ["t2i_unlocked", "inpaint"],
    inpaintSteps: 8,
    settings: {
      sampler: "euler",
      scheduler: "simple",
      steps: 8,
      cfg: 1.0,
      width: 1024,
      height: 1024,
      unet: "anima-turbo-v1.1-int8convrot.safetensors",
      clip: "qwen_3_06b_base.safetensors",
      clipType: "stable_diffusion",
      vae: "qwen_image_vae.safetensors",
      filenamePrefix: "AnimaFast",
    },
  },
  {
    // Text-to-image *and* mask inpainting, but never an instruction edit.
    // There is no Anima edit graph, and `editWorkflowId` must stay absent so
    // comfyEdit() refuses instead of silently drawing a fresh picture. FLUX.2
    // remains the only instruction-edit path; Anima's second path is a mask,
    // through the LLLite patch (`inpaintWorkflowId`).
    id: "anima-turbo-2b",
    match: ["animaturbo", "anima-turbo"],
    label: "Anima Turbo 2B (anime unlocked T2I + inpaint)",
    displayName: "Anima Turbo v1.1 (2B)",
    style: "anime",
    family: "anima",
    workflowId: "anima-turbo-t2i",
    inpaintWorkflowId: "anima-lllite-inpaint",
    modelPatch: "anima-lllite-inpainting-v2.safetensors",
    capabilities: ["t2i_unlocked", "inpaint"],
    // The inpaint graph keeps the T2I recipe (8 steps, CFG 1.0, euler/simple)
    // and adds LLLite at strength 1.0 across the whole run. Measured ~9 s warm
    // at both 832x1216 and 1024x1024 (_notes/PHASE3_ANIMA_INPAINT_BACKEND.md).
    inpaintSteps: 8,
    settings: {
      sampler: "euler",
      scheduler: "simple",
      steps: 8,
      cfg: 1.0,
      width: 1024,
      height: 1024,
      unet: "anima-turbo-v1.1.safetensors",
      clip: "qwen_3_06b_base.safetensors",
      clipType: "stable_diffusion",
      vae: "qwen_image_vae.safetensors",
      filenamePrefix: "Anima",
    },
  },
  {
    // Krea2 Turbo, photographic. Text-to-image only: no editWorkflowId and no
    // inpaintWorkflowId, so /edit and Inpaint both keep refusing. The graph
    // loads fedor_bypass.safetensors through the first LoraLoaderModelOnly and
    // snofs_krea_v1_nostrip.safetensors through the second; the dropdown's
    // "unlocked" checkboxes decide their strengths (0 off, 3.0 / 0.8 on),
    // default off. The fast profile (768x768, 6 steps) is offered alongside the
    // 1024x1024 / 8-step quality mode.
    id: "krea2-turbo",
    match: ["krea2turbo", "krea2_turbo"],
    label: "Krea2 Turbo (T2I, optional unlocked variants)",
    displayName: "Krea2 Turbo",
    style: "realistic",
    family: "krea2",
    workflowId: "krea2-turbo-t2i",
    capabilities: ["t2i", "t2i_unlocked"],
    settings: {
      sampler: "euler",
      scheduler: "simple",
      steps: 8,
      cfg: 1.0,
      width: 1024,
      height: 1024,
      unet: "krea2_turbo_fp8_scaled.safetensors",
      clip: "qwen3vl_4b_fp8_scaled.safetensors",
      clipType: "krea2",
      vae: "qwen_image_vae.safetensors",
      filenamePrefix: "Krea2",
      loraName: "fedor_bypass.safetensors",
      loraStrength: 3.0,
      unlockedLoraName: "snofs_krea_v1_nostrip.safetensors",
      unlockedLoraStrength: 0.8,
      fastSteps: 6,
      fastWidth: 768,
      fastHeight: 768,
    },
  },
  {
    // Krea2 Anime v14 (int4): same graph, same recipe, anime-tuned weights.
    id: "krea2-anime",
    match: ["krea2anime"],
    label: "Krea2 Anime v14 (T2I, optional unlocked variants)",
    displayName: "Krea2 Anime v14",
    style: "anime",
    family: "krea2",
    workflowId: "krea2-turbo-t2i",
    capabilities: ["t2i", "t2i_unlocked"],
    settings: {
      sampler: "euler",
      scheduler: "simple",
      steps: 8,
      cfg: 1.0,
      width: 1024,
      height: 1024,
      unet: "krea2Anime_v14_int4.safetensors",
      clip: "qwen3vl_4b_fp8_scaled.safetensors",
      clipType: "krea2",
      vae: "qwen_image_vae.safetensors",
      filenamePrefix: "Krea2Anime",
      loraName: "fedor_bypass.safetensors",
      loraStrength: 3.0,
      unlockedLoraName: "snofs_krea_v1_nostrip.safetensors",
      unlockedLoraStrength: 0.8,
      fastSteps: 6,
      fastWidth: 768,
      fastHeight: 768,
    },
  },

  /* ── Phase 2 (not active) ───────────────────────────────────────
     Only after Flux.2 is verified end to end. Each needs its own downloaded
     model files and its own workflow, so leaving these commented out is what
     keeps the app from offering a model that cannot render.

  {
    id: "z-image-turbo",
    match: ["zimageturbo", "z-image-turbo"],
    label: "Z-Image Turbo 6B",
    style: "realistic",
    family: "zimage",
    workflowId: "zimage_t2i",
    settings: { sampler: "euler", scheduler: "simple", steps: 8, cfg: 1.0 },
  },
  {
    id: "anima",
    match: ["anima"],
    label: "Anima 2B (anime)",
    style: "anime",
    family: "anima",
    workflowId: "anima_t2i",
    settings: { sampler: "euler", scheduler: "simple", steps: 8, cfg: 1.0 },
  },
  {
    id: "mage-flow-edit",
    match: ["mageflow", "mage-flow"],
    label: "Mage-Flow-Edit Turbo 4B",
    style: "general",
    family: "mage",
    editWorkflowId: "mage_flow_edit",
    settings: { sampler: "euler", scheduler: "simple", steps: 4, cfg: 1.0 },
  },
  */
];

/** Reduce a model id to [a-z0-9] for tolerant substring matching. */
function normalizeImageModelId(id) {
  return String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Find the registry entry for a model id, or null.
 * @param {string} modelId
 * @returns {object|null}
 */
function lookupImageModelMeta(modelId) {
  const norm = normalizeImageModelId(modelId);
  if (!norm) return null;
  return (
    IMAGE_MODEL_REGISTRY.find((entry) =>
      entry.match.some((m) => norm.includes(normalizeImageModelId(m))),
    ) || null
  );
}

/**
 * Everything known about a model, curated entry plus a merged settings object.
 * @param {string} modelId
 * @returns {object}
 */
function resolveImageModelMeta(modelId) {
  const entry = lookupImageModelMeta(modelId);
  const settings = Object.assign(
    {},
    IMAGE_DEFAULT_SETTINGS,
    (entry && entry.settings) || {},
  );
  return {
    modelId: modelId,
    matched: !!entry,
    id: entry ? entry.id : null,
    label: (entry && entry.label) || modelId,
    style: (entry && entry.style) || IMAGE_STYLES.general,
    family: (entry && entry.family) || "",
    workflowId:
      (entry && entry.workflowId) ||
      settings.workflowId ||
      IMAGE_DEFAULT_WORKFLOW_ID,
    // `undefined`, not a fallback: a model that cannot edit must not inherit
    // the Flux.2 edit graph. comfyEdit() fails on this rather than rendering a
    // text-to-image picture and calling it an edit.
    editWorkflowId: entry
      ? entry.editWorkflowId || null
      : settings.editWorkflowId || null,
    // Mask inpainting is its own graph (Anima LLLite), deliberately not folded
    // into editWorkflowId: /edit and Inpaint are different features and a
    // model can have one without the other.
    inpaintWorkflowId: (entry && entry.inpaintWorkflowId) || null,
    modelPatch: (entry && entry.modelPatch) || null,
    capabilities: (entry && entry.capabilities) || ["t2i"],
    inpaintSteps:
      (entry && entry.inpaintSteps) || settings.steps,
    // Edits may render on a different canvas than T2I (FLUX.2 Klein: 832x1152
    // vs 832x1216). Absent means "same as the T2I size".
    editWidth: (entry && entry.editWidth) || settings.width,
    editHeight: (entry && entry.editHeight) || settings.height,
    settings: settings,
  };
}

/**
 * Can this model edit an existing picture?
 * @param {string} modelId
 * @returns {boolean}
 */
function imageModelCanEdit(modelId) {
  return !!resolveImageModelMeta(modelId).editWorkflowId;
}

/**
 * Can this model repaint a masked region of an existing picture?
 *
 * A separate question from {@link imageModelCanEdit}: Anima has no
 * instruction-edit graph but does have an LLLite mask graph. Anything that
 * offers the Inpaint action gates on this, so a model without one is never
 * handed an instruction it would ignore.
 * @param {string} modelId
 * @returns {boolean}
 */
function imageModelCanInpaint(modelId) {
  return !!resolveImageModelMeta(modelId).inpaintWorkflowId;
}

/** The style descriptor for a model, or "general" when unknown. */
function imageModelStyle(modelId) {
  return resolveImageModelMeta(modelId).style;
}

/** Style badge for the dropdown: "" when unknown/general (nothing useful to say). */
function imageModelStyleLabel(modelId) {
  const style = imageModelStyle(modelId);
  return style && style !== "general" ? style : "";
}

/** Human name for the dropdown/help, e.g. for the T2I-only notice. */
function imageModelLabel(modelId) {
  return resolveImageModelMeta(modelId).label;
}

/**
 * Short friendly name for dropdown rows and the selected-model pill.
 *
 * A curated entry supplies `displayName` (falling back to its long `label`).
 * Anything unregistered is prettified from the raw id so an arbitrary ComfyUI
 * checkpoint is still readable: the model extension is dropped and the
 * separators become spaces. The *raw* id keeps doing all the real work — it
 * is what gets selected, persisted, filtered on and stored in data attributes;
 * this function only ever produces something to look at.
 * @param {string} modelId
 * @returns {string}
 */
function imageModelDisplayName(modelId) {
  const entry = lookupImageModelMeta(modelId);
  if (entry) return entry.displayName || entry.label || String(modelId || "");
  const raw = String(modelId || "");
  const pretty = raw
    .replace(/\.(safetensors|ckpt|pt|pth|gguf)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  // A pathological id (all separators, or empty) has nothing to prettify.
  return pretty || raw;
}

/**
 * Best-effort metadata enrichment for a model id.
 *
 * Kept as a no-op so callers written against the old Civitai lookup still work:
 * Flux.2 checkpoints are not Civitai models, and a network call per selection
 * buys nothing now that the registry carries the recipe.
 * @returns {Promise<null>}
 */
async function enrichImageModelMeta(modelId, signal) {
  return null;
}
