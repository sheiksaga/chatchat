/* ══════════════════════════════════════════════════════════════
   images.js — Image generation

   Step 1 of the image-subsystem rewrite: the image *model selector*.
   The generation pipeline (request/render/commands) is added later — this
   file currently only discovers which models an image provider offers and
   remembers the user's pick in `imageParams.model` (localStorage
   "image_model"), which the eventual request path will read.

   The selector is shared by every image provider:
     - ComfyUI: "models" are the checkpoints its CheckpointLoaderSimple node
       accepts, read from /object_info/CheckpointLoaderSimple.
     - Other local providers (MLX Omni / the bundled diffusers server):
       the OpenAI-style GET /models list.
     - Cloud providers: no reliable discovery, so a free-text id field.
   Ids typed for a local provider are remembered (most recent first) and
   offered again, since a server's own list is not always complete.
   ══════════════════════════════════════════════════════════════ */

/**
 * Which provider config should handle image generation.
 *
 * If the user has explicitly picked an image provider ({@link
 * currentImageProvider}), that wins outright — this is how a Mac running
 * chat locally can still send images to a cloud provider, or vice versa,
 * without the two being coupled.
 *
 * Otherwise ("Auto"): if the active chat provider is Local (which never
 * serves images), fall back to whichever other configured provider declares
 * image support and is *actually set up* — a key (cloud), or a user-added
 * custom provider flagged local/LAN. A built-in local preset (e.g. "Local
 * image (MLX Omni)") does NOT count here even though it needs no key: it
 * always exists, whether or not the user has that server running, so
 * treating it as "configured" would silently route every /image at an
 * unconfigured server. Picking it requires the explicit selection above. If
 * a cloud provider is active, images always follow it (even if that
 * provider lacks image support/a key — surfaced as a normal error, not
 * silently routed elsewhere).
 * @returns {{cfg: object|null, ambiguous: boolean}}
 */
function resolveImageProvider() {
  const explicit = currentImageProvider();
  if (explicit) return { cfg: explicit, ambiguous: false };

  const active = currentProvider();
  if (!active.isLocal) return { cfg: active, ambiguous: false };

  const candidates = getImageCapableProviders().filter(
    (cfg) => cfg.key || (cfg.isLocal && !API_PROVIDERS[cfg.id]),
  );

  if (candidates.length === 1) return { cfg: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { cfg: null, ambiguous: true };
  return { cfg: null, ambiguous: false };
}

/** Fetch headers for a specific provider config (may differ from the active chat provider). */
function imageProviderHeaders(cfg, extra) {
  const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
  if (cfg.key) h["Authorization"] = "Bearer " + cfg.key;
  return h;
}

/* ── Discovery ────────────────────────────────────────────────────
   ComfyUI's checkpoint discovery lives in js/comfy.js (comfyCheckpoints);
   this file only handles the OpenAI-style /models list. */

/** Can the resolved image provider edit an existing picture? */
function imageEditSupported() {
  const { cfg } = resolveImageProvider();
  return !!cfg && cfg.api === "comfyui";
}

/**
 * Can the selected model repaint a masked region (Anima LLLite)?
 *
 * Separate from {@link imageEditSupported}, which only says the *provider* can
 * run a graph. Inpaint additionally needs the model to have an LLLite graph, so
 * the Inpaint action gates on this and a FLUX.2 selection never silently
 * substitutes for it.
 * @param {string} [modelId]
 * @returns {boolean}
 */
function imageInpaintSupported(modelId) {
  const { cfg } = resolveImageProvider();
  if (!cfg || cfg.api !== "comfyui") return false;
  const id = modelId || imageParams.model;
  return typeof imageModelCanInpaint === "function" && imageModelCanInpaint(id);
}

/**
 * The workflow id recorded with a generated picture, for the image metadata.
 * Only ComfyUI runs bundled graphs by id; other providers get null.
 * @param {string} workflowId
 * @returns {string|null}
 */
function comfyWorkflowId(workflowId) {
  const { cfg } = resolveImageProvider();
  return cfg && cfg.api === "comfyui" ? workflowId || null : null;
}

/**
 * Fetch the model ids an OpenAI-compatible image provider advertises.
 * @param {object} cfg
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function fetchImageModelList(cfg, signal) {
  const response = await fetchApi(`${cfg.baseUrl}/models`, {
    headers: imageProviderHeaders(cfg),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.data || []).map((m) => m.id);
}

/* ── Remembered local image models ────────────────────────────────
   A local server's own list is not always complete (MLX Omni only
   recognises chat-model configs, so it never lists FLUX/diffusers-style
   checkpoints). As a substitute, every model id the user picks for a local
   provider is remembered here so it can be picked again instead of retyped. */

const IMAGE_MODEL_HISTORY_KEY = "image_model_history";
const IMAGE_MODEL_HISTORY_MAX = 10;

/** @returns {string[]} Remembered local image model ids, most recent first. */
function getImageModelHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(IMAGE_MODEL_HISTORY_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

/** Remember a model id, most-recent-first, deduped, capped. */
function addToImageModelHistory(modelId) {
  const history = getImageModelHistory().filter((id) => id !== modelId);
  history.unshift(modelId);
  safeSetItem(
    IMAGE_MODEL_HISTORY_KEY,
    JSON.stringify(history.slice(0, IMAGE_MODEL_HISTORY_MAX)),
  );
}

/** Forget a remembered model id and re-render the dropdown in place. */
function removeFromImageModelHistory(modelId, dropdown, cfg) {
  const history = getImageModelHistory().filter((id) => id !== modelId);
  safeSetItem(IMAGE_MODEL_HISTORY_KEY, JSON.stringify(history));
  dropdown.innerHTML = "";
  renderImageModelHistoryList(dropdown, cfg);
}

/* ── Dropdown rendering ─────────────────────────────────────────── */

/**
 * Render remembered model ids as selectable rows, each with a remove (×)
 * button. Appends to whatever is already in `dropdown` so a caller can show a
 * status/error line above the list.
 * @param {HTMLElement} dropdown
 * @param {object} [cfg] The resolved image provider, if known
 */
function renderImageModelHistoryList(dropdown, cfg) {
  const history = getImageModelHistory();

  if (history.length === 0) {
    dropdown.insertAdjacentHTML(
      "beforeend",
      `<div class="model-dropdown-empty">
        No models loaded yet — type a model id below once, and it'll be
        remembered here for next time.
      </div>`,
    );
    appendManualEntryLink(dropdown);
    return;
  }

  const listEl = document.createElement("div");
  listEl.className = "model-dropdown-list";
  history.forEach((id) => {
    const item = document.createElement("div");
    item.className = "model-dropdown-item history-item";
    item.setAttribute("role", "option");
    if (id === imageParams.model) {
      item.classList.add("active");
      item.setAttribute("aria-selected", "true");
    }

    const label = document.createElement("span");
    // Friendly row text; the raw id stays in the title and on the forget button
    // so the exact filename is still discoverable, and it is still what gets
    // selected and persisted.
    label.textContent = imageModelDisplayName(id);
    label.title = id;
    label.onclick = () => selectImageModel(id);
    item.title = id;
    item.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "history-item-remove";
    removeBtn.setAttribute(
      "aria-label",
      `Forget ${imageModelDisplayName(id)} (${id})`,
    );
    removeBtn.title = "Forget this model";
    removeBtn.textContent = "×";
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeFromImageModelHistory(id, dropdown, cfg);
    };
    item.appendChild(removeBtn);

    listEl.appendChild(item);
  });
  dropdown.appendChild(listEl);
  appendImageModelNote(dropdown);
  appendKrea2UnlockedControls(dropdown, imageParams.model);
  appendManualEntryLink(dropdown);
  appendSeedControl(dropdown);
}

/**
 * Append the T2I-only notice for a model that has no edit graph.
 *
 * Registry-driven, not a name check: whatever the selected model's entry says
 * about `editWorkflowId`, this line says the same thing. Nothing is appended
 * for a model that can edit.
 * @param {HTMLElement} dropdown
 * @param {string} [modelId]
 */
function appendImageModelNote(dropdown, modelId) {
  const id = modelId || imageParams.model;
  if (typeof imageModelCanEdit === "function" && imageModelCanEdit(id)) return;
  const note = document.createElement("div");
  note.className = "model-dropdown-note image-model-t2i-note";
  note.textContent =
    imageModelLabel(id) + " is T2I only — switch to FLUX.2 to edit.";
  dropdown.appendChild(note);
}

/**
 * Append the Krea2 "unlocked variants" checkbox rows below a model list.
 *
 * Only Krea2 has this route: the entry names LoRA files
 * (`fedor_bypass.safetensors`, `snofs_krea_v1_nostrip.safetensors`) and the
 * graph loads them through two LoraLoaderModelOnly nodes, plus a fast render
 * profile. Every other model names neither LoRA and has no fast profile, so
 * nothing is appended and their graphs are unaffected. All three ticks are
 * per-app settings (in localStorage), not per-chat ones.
 * @param {HTMLElement} dropdown
 * @param {string} [modelId]
 */
function appendKrea2UnlockedControls(dropdown, modelId) {
  const id = modelId || imageParams.model;
  const meta = resolveImageModelMeta(id);
  const s = meta.settings || {};
  if (!s.loraName && !s.unlockedLoraName) return;

  const rows = [
    {
      key: "bypass",
      text: "Unlocked bypass (Fedor)",
      checked: !!imageParams.unlockedBypass,
      title:
        `Loads ${s.loraName || "fedor_bypass.safetensors"} at strength ` +
        `${s.loraStrength || 3.0} — removes the refusal gate. Turned off, the ` +
        "same LoRA node runs at strength 0.0 (a no-op). Only affects Krea2 models.",
      onToggle: (on) => setImageUnlockedBypass(on),
      toast: (on) =>
        on ? "Krea2 unlocked bypass on" : "Krea2 unlocked bypass off",
    },
    {
      key: "lora",
      text: "Unlocked LoRA (SNOFS)",
      checked: !!imageParams.unlockedLora,
      title:
        `Loads ${s.unlockedLoraName || "snofs_krea_v1_nostrip.safetensors"} at ` +
        `strength ${s.unlockedLoraStrength || 0.8} — adds unlocked conditioning. ` +
        "Turned off, the second LoRA node runs at strength 0.0 (a no-op). " +
        "Only affects Krea2 models.",
      onToggle: (on) => setImageUnlockedLora(on),
      toast: (on) =>
        on ? "Krea2 unlocked LoRA on" : "Krea2 unlocked LoRA off",
    },
    {
      key: "fast",
      text: "Fast profile (768, 6 steps)",
      checked: !!imageParams.krea2Fast,
      title:
        `Renders at ${s.fastWidth || 768}x${s.fastHeight || 768} with ` +
        `${s.fastSteps || 6} steps instead of ${s.width || 1024}x` +
        `${s.height || 1024} with ${s.steps || 8} steps — lowers resolution and ` +
        "sampler steps to finish sooner. Untick for quality mode. " +
        "Only affects Krea2 models.",
      onToggle: (on) => setImageKrea2Fast(on),
      toast: (on) => (on ? "Krea2 fast profile on" : "Krea2 fast profile off"),
    },
  ];

  for (const spec of rows) {
    const row = document.createElement("div");
    row.className = "image-unlocked";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `image-unlocked-${spec.key}`;
    input.checked = spec.checked;
    input.title = spec.title;

    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = spec.text;
    label.title = input.title;

    input.addEventListener("change", () => {
      const on = spec.onToggle(input.checked);
      showToast(spec.toast(on));
    });

    row.appendChild(input);
    row.appendChild(label);
    dropdown.appendChild(row);
  }
}

/**
 * Append the seed row below a model list.
 *
 * Three modes, one policy everywhere (see nextImageSeed in js/state.js):
 *   fixed   the number in the box, so a prompt and its result pair up
 *   random  a new seed per picture
 *   last    the seed the previous picture actually used
 * The seed that will be used next is shown, so "fixed" and "last" are visible
 * as numbers rather than as a mode name.
 * @param {HTMLElement} dropdown
 */
function appendSeedControl(dropdown) {
  const wrap = document.createElement("div");
  wrap.className = "image-seed";

  const label = document.createElement("label");
  label.className = "image-seed-label";
  label.textContent = "Seed";
  label.title =
    "Fixed makes a prompt reproducible. Random draws a new seed each picture. Last reuses the previous picture's seed (shown here).";

  const input = document.createElement("input");
  input.type = "number";
  input.className = "image-seed-input";
  input.value = String(imageParams.seed);
  input.setAttribute("aria-label", "Fixed seed for image generation");
  input.addEventListener("change", () => {
    input.value = String(setImageSeed(input.value));
  });

  const effective = document.createElement("span");
  effective.className = "image-seed-effective";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "image-seed-toggle";
  const paint = () => {
    const mode = imageParams.seedMode;
    // A chat locks its own seed, so the global fixed/random/last policy is not
    // in play while a chat is open. Say so instead of showing a mode that does
    // nothing; the story record's Seed ↻ is how a chat's seed is redrawn.
    const locked =
      typeof storySeedFor === "function" ? storySeedFor(currentChatId) : null;
    const isLocked = Number.isFinite(locked);
    toggle.textContent = isLocked
      ? "Reroll"
      : mode === "random"
        ? "Random"
        : mode === "last"
          ? "Last"
          : "Fixed";
    toggle.title = isLocked
      ? "This chat's seed is locked — every picture in it uses this number. " +
        "Click to draw a new seed for future pictures."
      : mode === "fixed"
        ? "Every picture uses the seed in the box — click for random"
        : mode === "random"
          ? "A new seed is drawn for every picture — click to reuse the last one"
          : "Every picture reuses the previous seed — click for a fixed seed";
    toggle.classList.toggle("is-random", !isLocked && mode === "random");
    toggle.classList.toggle("is-last", !isLocked && mode === "last");
    toggle.classList.toggle("is-chat-locked", isLocked);
    toggle.disabled = false;
    input.disabled = isLocked || mode !== "fixed";
    const next = effectiveImageSeed();
    effective.textContent = isLocked
      ? "locked " + locked
      : Number.isFinite(next)
        ? "next " + next
        : Number.isFinite(imageParams.lastSeed)
          ? "last " + imageParams.lastSeed
          : "";
    effective.title = isLocked
      ? "The seed locked to this chat"
      : "The seed the next picture will use";
  };
  toggle.onclick = () => {
    const locked =
      typeof storySeedFor === "function" ? storySeedFor(currentChatId) : null;
    if (Number.isFinite(locked)) {
      const seed = rerollChatSeed();
      if (Number.isFinite(seed)) {
        showToast("New chat seed " + seed, "success");
      }
      paint();
      return;
    }
    const order = ["fixed", "random", "last"];
    const at = order.indexOf(imageParams.seedMode);
    setImageSeedMode(order[(at + 1) % order.length]);
    paint();
  };
  paint();

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(effective);
  wrap.appendChild(toggle);
  dropdown.appendChild(wrap);
}

/** Append a small "type a custom id instead" fallback below a fetched model list. */
function appendManualEntryLink(dropdown) {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "model-dropdown-manual-link";
  link.textContent = "Type a custom model id instead";
  link.onclick = () => renderImageModelTextInput(dropdown);
  dropdown.appendChild(link);
}

/** Render the free-text image model id field — used for cloud providers, and as a manual fallback for local ones. */
function renderImageModelTextInput(dropdown) {
  dropdown.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "story-config-input image-model-input";
  input.placeholder = "Model id (e.g. gpt-image-1)";
  input.setAttribute("aria-label", "Image model id");
  input.value = imageParams.model;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    const val = input.value.trim();
    if (val) selectImageModel(val);
    else dropdown.classList.remove("open");
  });
  dropdown.appendChild(input);
  input.focus();
  input.select();
  appendSeedControl(dropdown);
}

/* ── Selector lifecycle ─────────────────────────────────────────── */

/**
 * Open the image model selector. Local providers get a real fetched list
 * (ComfyUI checkpoints / OpenAI-style /models) with remembered ids as a
 * fallback; cloud providers get a free-text field, since there is no way to
 * shortlist a cloud catalog.
 */
async function openImageModelSelector() {
  const dropdown = document.getElementById("image-model-dropdown");
  if (!dropdown) return;
  if (dropdown.classList.contains("open")) {
    dropdown.classList.remove("open");
    return;
  }

  // Close the sibling overlays so the panels never overlap.
  document.getElementById("model-dropdown")?.classList.remove("open");
  document.getElementById("config-panel")?.classList.remove("open");

  dropdown.innerHTML = "";
  dropdown.classList.add("open");

  const { cfg } = resolveImageProvider();
  if (!cfg || !cfg.images) {
    dropdown.innerHTML =
      '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">No image provider selected</div>';
    return;
  }

  if (!cfg.isLocal) {
    renderImageModelTextInput(dropdown);
    return;
  }

  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Available image models");
  dropdown.innerHTML =
    '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">Loading models...</div>';

  try {
    // ComfyUI exposes no /models: what it can render is the set of checkpoints
    // its loader node accepts, which is exactly the list we want here.
    const models =
      cfg.api === "comfyui"
        ? await comfyCheckpoints(cfg, AbortSignal.timeout(8000))
        : await fetchImageModelList(cfg, AbortSignal.timeout(5000));

    dropdown.innerHTML = "";

    if (models.length === 0) {
      // The server's own list is empty — fall back to what's been typed here
      // before.
      renderImageModelHistoryList(dropdown, cfg);
      return;
    }

    // The remembered id may be a registry recipe rather than a filename this
    // server has. Pick an installed one before rendering, so the list always
    // shows a valid active choice instead of none.
    if (!imageModelInstalled(imageParams.model, models)) {
      const pick = pickInstalledImageModel(imageParams.model, models);
      if (pick) applyImageModelSelection(pick);
    }

    renderModelDropdownList(
      dropdown,
      models,
      imageParams.model,
      selectImageModel,
      { badgeFor: imageModelStyleLabel, labelFor: imageModelDisplayName },
    );
    appendImageModelNote(dropdown);
    appendKrea2UnlockedControls(dropdown, imageParams.model);
    appendManualEntryLink(dropdown);
    appendSeedControl(dropdown);
  } catch (err) {
    dropdown.innerHTML = `<div class="model-dropdown-item" style="color:var(--danger);">Can't reach ${escapeHtml(cfg.label)}: ${escapeHtml(err.message)}</div>`;
    renderImageModelHistoryList(dropdown, cfg);
  }
}

/**
 * Select an image model and persist the choice.
 * @param {string} modelId
 */
function selectImageModel(modelId) {
  imageParams.model = modelId;
  safeSetItem("image_model", modelId);
  const { cfg } = resolveImageProvider();
  if (cfg && cfg.isLocal) addToImageModelHistory(modelId);
  const nameEl = document.getElementById("current-image-model-name");
  if (nameEl) nameEl.textContent = imageModelDisplayName(modelId);
  document.getElementById("image-model-dropdown")?.classList.remove("open");
  // Anima draws but cannot edit — say so once, at the moment of selection.
  if (typeof imageModelCanEdit === "function" && !imageModelCanEdit(modelId)) {
    showToast(
      imageModelLabel(modelId) + " is T2I only — switch to FLUX.2 to edit.",
    );
  }
  // The Inpaint affordance is model-gated, so existing picture controls have to
  // be rebuilt when the route changes. Without this, an Anima Inpaint button
  // stays visible after switching back to FLUX.2 (and vice versa).
  if (typeof closeInpaintEditor === "function") closeInpaintEditor();
  if (typeof renderMessages === "function") renderMessages();
  // Best-effort: pull the model's Civitai card so its style/family is known
  // the next time it is used. Never blocks the selection itself.
  enrichImageModelMeta(modelId).catch(() => {});
}

/** Update visibility of the image model selector pill for the resolved provider. */
function updateImageModelVisibility() {
  const pill = document.getElementById("image-model-selector");
  if (!pill) return;
  const { cfg } = resolveImageProvider();
  const show = !!cfg && !!cfg.images && (!!cfg.key || !!cfg.isLocal);
  pill.classList.toggle("hidden", !show);
  // Also close the dropdown when hiding.
  if (!show)
    document.getElementById("image-model-dropdown")?.classList.remove("open");
  // Keep the label in sync with the remembered selection.
  const nameEl = document.getElementById("current-image-model-name");
  if (nameEl && imageParams.model)
    nameEl.textContent = imageModelDisplayName(imageParams.model);
}

/* ── Remembered model vs installed model ─────────────────────────
   `imageParams.model` starts as a registry id ("flux2-klein-4b"), which is a
   recipe name, not a ComfyUI filename. On a machine whose only installed
   checkpoint is Anima, every draw fails until the user opens the dropdown and
   picks a filename that exists. The remembered id is therefore reconciled
   against the provider's real list before drawing, so the first Generate works
   without a trip through the model menu.
   ──────────────────────────────────────────────────────────────── */

/** Basename without extension, lowercased, for comparing ids with filenames. */
function imageModelFileKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/[\\/]/)
    .pop()
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, "");
}

/** The files a selected model id would actually ask ComfyUI to load. */
function imageModelLoadFiles(modelId) {
  if (!modelId) return [];
  const meta = resolveImageModelMeta(modelId);
  return [modelId, meta.settings.unet].filter(Boolean);
}

/** Is this selection backed by a file the provider actually lists? */
function imageModelInstalled(modelId, files) {
  if (!modelId || !files || !files.length) return false;
  const available = new Set(files.map(imageModelFileKey));
  return imageModelLoadFiles(modelId).some((file) =>
    available.has(imageModelFileKey(file)),
  );
}

/**
 * Choose an installed model that resembles the current selection.
 *
 * Same family first (so a flux preference stays flux when flux is installed),
 * then same style, then anything the registry understands. An unrecognised
 * filename is not offered: the registry would apply FLUX settings to it and
 * fail in a more confusing way.
 * @param {string} modelId
 * @param {string[]} files
 * @returns {string} "" when nothing usable is installed
 */
function pickInstalledImageModel(modelId, files) {
  const current = resolveImageModelMeta(modelId);
  const known = files.filter((file) => resolveImageModelMeta(file).matched);
  if (!known.length) return "";
  const sameFamily = known.find(
    (file) => resolveImageModelMeta(file).family === current.family,
  );
  if (sameFamily) return sameFamily;
  const sameStyle = known.find(
    (file) => resolveImageModelMeta(file).style === current.style,
  );
  if (sameStyle) return sameStyle;
  return known[0];
}

/** Change the selection without the dropdown/toast/render side effects. */
function applyImageModelSelection(modelId) {
  imageParams.model = modelId;
  safeSetItem("image_model", modelId);
  const nameEl = document.getElementById("current-image-model-name");
  if (nameEl) nameEl.textContent = imageModelDisplayName(modelId);
}

/** @type {Promise<string>|null} One reconcile at a time. */
let _imageModelReconcile = null;

/**
 * Make `imageParams.model` a model this ComfyUI can actually load.
 *
 * Best-effort: if the server cannot be reached, the remembered selection is
 * left alone and the normal request path reports the real error. Only a
 * successful list is allowed to change the selection.
 * @param {{announce?:boolean}} [opts]
 * @returns {Promise<string>} The model id to draw with
 */
async function reconcileImageModelSelection(opts) {
  opts = opts || {};
  const { cfg } = resolveImageProvider();
  if (!cfg || !cfg.images || cfg.api !== "comfyui") return imageParams.model;
  if (_imageModelReconcile) return _imageModelReconcile;

  _imageModelReconcile = (async () => {
    let files;
    try {
      files = await comfyCheckpoints(cfg, AbortSignal.timeout(8000));
    } catch (e) {
      return imageParams.model;
    }
    if (!files || !files.length) return imageParams.model;
    if (imageModelInstalled(imageParams.model, files)) return imageParams.model;

    const pick = pickInstalledImageModel(imageParams.model, files);
    if (!pick) return imageParams.model;

    applyImageModelSelection(pick);
    addToImageModelHistory(pick);
    if (opts.announce && typeof showToast === "function") {
      showToast(
        "That image model isn't installed — using " +
          imageModelDisplayName(pick) +
          ".",
      );
    }
    return pick;
  })().finally(() => {
    _imageModelReconcile = null;
  });

  return _imageModelReconcile;
}

/* ── Request pipeline ───────────────────────────────────────────── */

/**
 * Pull a usable image out of a generation response.
 *
 * The documented shape is { data: [ { b64_json } | { url } ] }, but the image
 * routes are a compatibility layer over several upstream providers, so a few
 * variants show up in practice. Anything unrecognised is logged in full — that
 * console dump is the fastest way to identify a new shape.
 * @param {object} data Parsed response body
 * @returns {string} data: URL or hosted image URL
 */
function extractImageUrl(data) {
  const candidates = [].concat(
    data.data || [],
    data.images || [],
    data.output || [],
  );
  for (const entry of candidates) {
    if (typeof entry === "string") {
      // Either a bare URL or bare base64 bytes.
      if (/^(https?:|data:)/.test(entry)) return entry;
      if (entry.length > 256) return "data:image/png;base64," + entry;
      continue;
    }
    if (!entry) continue;
    const b64 = entry.b64_json || entry.b64 || entry.base64;
    if (b64)
      return b64.startsWith("data:") ? b64 : "data:image/png;base64," + b64;
    if (entry.url) return entry.url;
    if (entry.image_url)
      return typeof entry.image_url === "string"
        ? entry.image_url
        : entry.image_url.url;
  }
  if (typeof data.image === "string" && data.image) {
    return /^(https?:|data:)/.test(data.image)
      ? data.image
      : "data:image/png;base64," + data.image;
  }

  console.error("Unrecognised image response shape:", data);
  throw new Error("API returned no image data (see console for the response)");
}

/**
 * Generate one image and return it as a data: URL / hosted URL.
 *
 * Dispatches on the resolved provider: ComfyUI runs a node graph (js/comfy.js);
 * everything else speaks the OpenAI-compatible /images/generations request.
 * Sampler/steps/size come from the model's registry entry when the transport
 * understands them, so a model renders the way its own card recommends instead
 * of with generic settings. The prompt is sent as written — FLUX.2 is a
 * natural-language model, so there is no quality anchor and no negative prompt.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.seed]
 * @param {string} [opts.initImage] data: URL of the picture to edit; ComfyUI
 *   only — other providers have no edit path and draw fresh instead
 * @param {string} [opts.instruction] What to change about `initImage`
 * @param {string} [opts.maskImage] data: URL of a white-on-black mask; when
 *   present the request is a mask inpaint (Anima LLLite), not an instruction
 *   edit — `prompt` is then the instruction for the masked area
 * @param {number} [opts.width] Source width, for an inpaint request
 * @param {number} [opts.height] Source height, for an inpaint request
 * @param {object} [opts.settings] Override the registry's settings
 * @param {string} [opts.workflowId] Override the registry's ComfyUI workflow
 * @param {object} [opts.overrides] Per-call sampler/size overrides
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>}
 */
async function requestImage(prompt, opts) {
  opts = opts || {};
  const { cfg, ambiguous } = resolveImageProvider();
  if (ambiguous) {
    throw new Error(
      "Multiple configured providers support image generation — pick one explicitly under Image Provider in settings",
    );
  }
  if (!cfg || !cfg.images) {
    throw new Error(
      "No provider configured for image generation — add one under Image Provider in settings",
    );
  }
  if (!cfg.key && !cfg.isLocal) {
    throw new Error(
      "No API key set for " +
        cfg.label +
        " — add one under Provider in settings",
    );
  }

  const model = opts.model || imageParams.model;

  if (cfg.api === "comfyui") {
    // A mask makes this a mask-inpaint request, not an instruction edit: Anima
    // repaints only what the white pixels cover. Checked first because a mask
    // and an instruction cannot both be the scope of the change.
    if (opts.maskImage) {
      return await comfyInpaint({
        cfg: cfg,
        model: model,
        instruction: prompt,
        initImage: opts.initImage,
        maskImage: opts.maskImage,
        width: opts.width,
        height: opts.height,
        settings: opts.settings,
        workflowId: opts.workflowId,
        seed: opts.seed,
        signal: opts.signal,
        onStatus: opts.onStatus,
      });
    }
    // An edit is the model's own instruction-edit workflow, not a rewired
    // text-to-image graph: the instruction and the source picture go in, and
    // the model keeps everything the instruction does not change.
    if (opts.initImage) {
      return await comfyEdit({
        cfg: cfg,
        model: model,
        instruction: prompt,
        initImage: opts.initImage,
        settings: opts.settings,
        workflowId: opts.workflowId,
        seed: opts.seed,
        overrides: opts.overrides,
        signal: opts.signal,
        onStatus: opts.onStatus,
      });
    }
    return await comfyGenerate({
      cfg: cfg,
      model: model,
      prompt: prompt,
      settings: opts.settings,
      workflowId: opts.workflowId,
      seed: opts.seed,
      overrides: opts.overrides,
      signal: opts.signal,
      onStatus: opts.onStatus,
    });
  }

  const meta = resolveImageModelMeta(model);
  const settings = Object.assign({}, meta.settings, opts.settings || {});
  const body = {
    prompt: prompt,
    model: model,
    size:
      opts.size || imageParams.size || `${settings.width}x${settings.height}`,
    n: 1,
  };
  // LoRA is a local-server extension (mflux/MLX Omni, and the bundled
  // diffusers server) — only meaningful, and only sent, to a local provider.
  if (cfg.isLocal && imageParams.loraPath) {
    body["lora-paths"] = [imageParams.loraPath];
    body["lora-scales"] = [imageParams.loraScale];
  }
  if (cfg.isLocal && (opts.steps || settings.steps)) {
    body["steps"] = opts.steps || settings.steps;
  }

  let response;
  try {
    response = await fetchApi(`${cfg.baseUrl}/images/generations`, {
      method: "POST",
      headers: imageProviderHeaders(cfg),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (networkErr) {
    if (networkErr.name !== "AbortError" && cfg.id === "local_image") {
      networkErr.localServerUnreachable = true;
    }
    throw networkErr;
  }
  if (!response.ok) throw new Error(await apiErrorDetail(response));
  return extractImageUrl(await response.json());
}

/* ── Reproducibility ─────────────────────────────────────────────
   A picture is a function of its prompt, seed, model and sampler settings.
   Storing all of them with the picture is what makes "regenerate this scene"
   return the same scene instead of a new variation of it. The prompt stored
   with the image already came from that moment's scene record, so a rerun
   replays the record too (see storyFileForRegeneration).
   ──────────────────────────────────────────────────────────────── */

/**
 * The parameters this draw is about to use, in the shape a rerun needs.
 *
 * Mirrors the decisions comfyGenerate/comfyEdit/comfyInpaint make from the
 * model registry plus the user's toggles. The values are captured before the
 * request because a toggle can change between now and the rerun.
 * @param {string} model
 * @param {number} seed
 * @param {object} [opts]
 * @returns {object}
 */
function captureImageGeneration(model, seed, opts) {
  opts = opts || {};
  const meta = resolveImageModelMeta(model);
  const s = meta.settings || {};
  const o = Object.assign({}, opts.overrides || {});
  const isInpaint = !!opts.maskImage;
  const isEdit = !isInpaint && !!opts.initImage;

  let width = opts.width !== undefined ? opts.width : o.width;
  let height = opts.height !== undefined ? opts.height : o.height;
  let steps = o.steps;

  if (isInpaint) {
    if (width === undefined) width = s.width;
    if (height === undefined) height = s.height;
    if (steps === undefined) steps = meta.inpaintSteps;
  } else if (isEdit) {
    if (width === undefined) width = meta.editWidth || s.width;
    if (height === undefined) height = meta.editHeight || s.height;
    if (steps === undefined) steps = s.steps;
  } else {
    // Krea2's fast profile is a size and step override, so a rerun has to
    // remember whether it was on at the time rather than read today's toggle.
    if (s.fastSteps && imageParams.krea2Fast) {
      if (width === undefined) width = s.fastWidth;
      if (height === undefined) height = s.fastHeight;
      if (steps === undefined) steps = s.fastSteps;
    }
    if (width === undefined) width = s.width;
    if (height === undefined) height = s.height;
    if (steps === undefined) steps = s.steps;
  }

  const generation = {
    model: model,
    seed: Number.isFinite(seed) ? seed : null,
    workflow: comfyWorkflowId(
      opts.workflowId ||
        (isInpaint
          ? meta.inpaintWorkflowId
          : isEdit
            ? meta.editWorkflowId
            : meta.workflowId),
    ),
    sampler: o.sampler || s.sampler,
    scheduler: o.scheduler || s.scheduler,
    steps: steps,
    cfg: isInpaint ? 1.0 : o.cfg !== undefined ? o.cfg : s.cfg,
    width: width,
    height: height,
  };

  if (s.loraName) {
    generation.loraName = o.loraName || s.loraName;
    generation.loraStrength =
      o.loraStrength !== undefined
        ? o.loraStrength
        : imageParams.unlockedBypass
          ? s.loraStrength || 3.0
          : 0;
  }
  if (s.unlockedLoraName) {
    generation.unlockedLoraName = o.unlockedLoraName || s.unlockedLoraName;
    generation.unlockedLoraStrength =
      o.unlockedLoraStrength !== undefined
        ? o.unlockedLoraStrength
        : imageParams.unlockedLora
          ? s.unlockedLoraStrength || 0.8
          : 0;
  }

  return generation;
}

/** A stored generation snapshot as the per-call overrides a rerun passes. */
function generationOverrides(generation) {
  if (!generation || typeof generation !== "object") return undefined;
  const out = {};
  for (const key of [
    "width",
    "height",
    "steps",
    "cfg",
    "sampler",
    "scheduler",
    "loraName",
    "loraStrength",
    "unlockedLoraName",
    "unlockedLoraStrength",
  ]) {
    if (generation[key] !== undefined && generation[key] !== null) {
      out[key] = generation[key];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The scene record a message's picture was drawn from.
 *
 * The stored snapshot is the default, so scrolling back to an old scene
 * redraws it with the location and clothes it had then. The one exception is
 * the newest picture: if the record was hand-edited since it was drawn, the
 * correction is what the user is trying to see, so today's record wins.
 * @param {number} msgIndex
 * @param {object} msg
 * @returns {object|null}
 */
function storyFileForRegeneration(msgIndex, msg) {
  const stored = msg && msg.image && msg.image.story ? msg.image.story : null;
  const file = currentChatId ? getStoryFile(currentChatId) : null;
  if (!stored) return file;
  const editedSince =
    file && Number(file.editedAt || 0) > Number(stored.editedAt || 0);
  const isLatest = !chatHistory.slice(msgIndex + 1).some((m) => m && m.image);
  return editedSince && isLatest ? file : stored;
}

/* ── Generated versions ──────────────────────────────────────────
   Regenerating with a different model is a comparison, not a replacement:
   every result is kept on the message and the image's hover controls cycle
   through them. `msg.image` is always the one on screen; `msg.imageVariants`
   holds every version and `msg.imageVariantIndex` says which is showing.

   Older messages have no variant list. It is created lazily on the first
   regeneration, seeded with the picture that was already there, so nothing
   needs migrating and a chat that never regenerates stores no extra data.
   ──────────────────────────────────────────────────────────────── */

/** The fields that describe one generated version (never the variant list). */
const IMAGE_VARIANT_KEYS = [
  "id",
  "prompt",
  "model",
  "workflow",
  "seed",
  "steps",
  "cfg",
  "generation",
  "story",
  "sourceImageId",
  "editOf",
  "mask",
  "width",
  "height",
  "attached",
  "createdAt",
];

/** A plain copy of one version's metadata. */
function imageVariantFromMeta(meta) {
  const variant = {};
  for (const key of IMAGE_VARIANT_KEYS) {
    if (meta[key] !== undefined) variant[key] = meta[key];
  }
  return variant;
}

/**
 * Every generated version of a message's picture.
 *
 * Read-only callers get a one-entry list for an older image without mutating
 * the message. Pass `create` from the regeneration path to start the list.
 * @param {object} msg
 * @param {boolean} [create]
 * @returns {Array<object>}
 */
function imageVariantsFor(msg, create) {
  if (!msg || !msg.image) return [];
  if (Array.isArray(msg.imageVariants) && msg.imageVariants.length) {
    return msg.imageVariants;
  }
  if (!create) return [msg.image];
  msg.imageVariants = [imageVariantFromMeta(msg.image)];
  msg.imageVariantIndex = 0;
  return msg.imageVariants;
}

/** The safe index of the version currently on screen. */
function activeImageVariantIndex(msg) {
  const total = msg && msg.imageVariants ? msg.imageVariants.length : 0;
  if (!total) return 0;
  const index = Number.isInteger(msg.imageVariantIndex)
    ? msg.imageVariantIndex
    : 0;
  return Math.max(0, Math.min(total - 1, index));
}

/** A stable description of what a draw was, for spotting an exact repeat. */
function imageVariantSignature(variant) {
  if (!variant) return "";
  const g = variant.generation || {};
  return [
    variant.prompt || "",
    variant.model || g.model || "",
    variant.seed !== undefined ? variant.seed : g.seed,
    variant.sourceImageId || "",
    g.width,
    g.height,
    g.steps,
    g.cfg,
    g.sampler,
    g.scheduler,
  ].join("|");
}

/** Every blob id a message's picture owns (current version and alternatives). */
function imageVariantIds(msg) {
  if (!msg || !msg.image) return [];
  const ids = imageVariantsFor(msg)
    .map((variant) => variant && variant.id)
    .filter(Boolean);
  if (msg.image.id && ids.indexOf(msg.image.id) < 0) ids.push(msg.image.id);
  return ids;
}

/**
 * Show the previous or next generated version of one image.
 *
 * Only the picture is re-rendered: the reply text and toolbar stay put, so
 * cycling never disturbs the transcript's scroll position more than the new
 * image's height requires.
 * @param {number} msgIndex
 * @param {number} direction -1 for previous, 1 for next
 * @returns {Promise<void>}
 */
async function cycleImageVariant(msgIndex, direction) {
  const msg = chatHistory[msgIndex];
  if (!msg || !msg.image) return;
  const variants = imageVariantsFor(msg);
  if (variants.length < 2) return;

  const current = activeImageVariantIndex(msg);
  const next = (current + direction + variants.length) % variants.length;
  msg.imageVariantIndex = next;
  msg.image = variants[next];
  safeSetItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));

  const messagesEl = document.getElementById("messages");
  const div =
    messagesEl &&
    messagesEl.querySelector('[data-msg-index="' + msgIndex + '"]');
  if (!div) return;
  const frame = msg.image.attached ? div.querySelector(".message-image") : div;
  if (!frame) return;
  frame.textContent = "";
  await appendImageElement(frame, msg);
  if (typeof updateGeneratedImageHeight === "function") {
    updateGeneratedImageHeight();
  }
  if (typeof showToast === "function") {
    showToast("Version " + (next + 1) + " of " + variants.length, "success");
  }
}

/**
 * Delete a message's picture and every generated version of it.
 *
 * An image attached to a reply is removed while the reply text stays, which is
 * what makes "that picture was wrong, keep the writing" possible. A standalone
 * `/image` message exists only for its picture, so the message goes too.
 * @param {number} msgIndex
 * @param {{confirmed?:boolean}} [opts]
 * @returns {Promise<void>}
 */
async function deleteRenderedImage(msgIndex, opts) {
  opts = opts || {};
  const msg = chatHistory[msgIndex];
  if (!msg || !msg.image) return;

  const ids = imageVariantIds(msg);
  const attached = !!msg.image.attached;

  const remove = async () => {
    for (const id of ids) {
      if (typeof deleteImage === "function") deleteImage(id).catch(() => {});
    }

    if (attached) {
      // Drop the picture, keep the prose. The toolbar comes back through a
      // fresh render, which restores the "Generate image" action.
      delete msg.image;
      delete msg.imageVariants;
      delete msg.imageVariantIndex;
      safeSetItem(
        STORAGE_KEY_PREFIX + currentChatId,
        JSON.stringify(chatHistory),
      );
      if (typeof renderMessages === "function") renderMessages();
      if (typeof showToast === "function") showToast("Image deleted");
      return;
    }

    // A standalone image message is nothing but the picture.
    chatHistory.splice(msgIndex, 1);
    // Keep the text-generation alternatives aligned with the shifted indices.
    const nextStore = {};
    const nextIdx = {};
    for (const key in generationStore) {
      const at = parseInt(key, 10);
      if (at < msgIndex) {
        nextStore[at] = generationStore[key];
        nextIdx[at] = generationIdx[key] || 0;
      } else if (at > msgIndex) {
        nextStore[at - 1] = generationStore[key];
        nextIdx[at - 1] = generationIdx[key] || 0;
      }
    }
    for (const key in generationStore) delete generationStore[key];
    Object.assign(generationStore, nextStore);
    for (const key in generationIdx) delete generationIdx[key];
    Object.assign(generationIdx, nextIdx);

    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );
    if (typeof saveGenerations === "function") saveGenerations();
    if (typeof renderMessages === "function") renderMessages();
    if (typeof showToast === "function") showToast("Image deleted");
  };

  if (opts.confirmed || typeof showConfirmDialog !== "function") {
    await remove();
    return;
  }
  showConfirmDialog("Delete this image?", {
    confirmLabel: "Delete",
    onConfirm: remove,
  });
}

/**
 * Generate an image and append it to the current transcript.
 *
 * Mirrors streamAssistantResponse()'s lifecycle: placeholder row, its own
 * abort controller (so stopping a chat reply can't cancel an in-flight image),
 * the bytes persisted to IndexedDB, and a retry affordance on failure.
 *
 * Story/Image modes will compose `prompt` before calling this; chat-mode /img
 * passes the literal prompt through untouched.
 *
 * @param {string} prompt Literal image prompt
 * @param {object} [opts] Forwarded to {@link requestImage}
 * @returns {Promise<number>} Index of the new message, or -1 on failure
 */
async function generateImageMessage(prompt, opts) {
  opts = Object.assign({}, opts || {});
  const originalPrompt = prompt;
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return -1;

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message assistant loading-indicator";
  loadingDiv.textContent = opts.maskImage ? "Inpainting…" : "Generating image…";
  messagesEl.appendChild(loadingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const abortController = new AbortController();

  try {
    if (!prompt) {
      throw new Error("/img needs a prompt — e.g. /img a man with a briefcase");
    }

    // A remembered registry id ("flux2-klein-4b") is a recipe, not a file this
    // ComfyUI necessarily has. Reconcile against the real list before any
    // capability checks or drawing, so the first Generate works even when the
    // model dropdown was never opened. A stored generation or an explicit
    // model is a deliberate replay and is left alone.
    if (
      !opts.model &&
      !opts.generation &&
      typeof reconcileImageModelSelection === "function"
    ) {
      const { cfg } = resolveImageProvider();
      if (cfg && cfg.api === "comfyui") {
        loadingDiv.textContent = "Checking image model…";
        await reconcileImageModelSelection({ announce: true });
      }
    }

    // A mask inpaint is its own capability, and unlike an instruction edit it
    // must never degrade into a fresh draw: silently repainting the whole
    // picture would look like a successful answer. Refuse by name instead.
    if (opts.maskImage) {
      if (!opts.initImage) {
        throw new Error("Inpainting needs a source picture.");
      }
      if (!imageInpaintSupported()) {
        throw new Error(
          `${imageModelLabel(imageParams.model)} can't inpaint — switch the ` +
            "image model to Anima to paint a mask.",
        );
      }
      loadingDiv.textContent = "Inpainting…";
    } else if (opts.initImage && !imageEditSupported()) {
      showToast(
        "This provider can't edit an existing image yet — drawing a new one instead.",
      );
      delete opts.initImage;
      delete opts.editOf;
    } else if (opts.initImage) {
      loadingDiv.textContent = "Editing previous image…";
    }

    // One seed per chat (see nextImageSeed / storySeedFor): every picture in
    // this chat uses the locked seed, so a rerun of the same prompt and
    // settings lands on the same picture. An explicit seed from a stored image
    // still wins — that is what a regenerate replays.
    let seed = Number.isFinite(opts.seed) ? opts.seed : undefined;
    if (seed === undefined && opts.initImage && opts.sourceSeed !== undefined) {
      seed = opts.sourceSeed;
    }
    if (seed === undefined) {
      seed = nextImageSeed();
    }

    const model = opts.model || imageParams.model;
    // A rerun carries the generation it is reproducing; a fresh draw captures
    // today's settings before the request so the picture can be reproduced
    // even after a toggle changes.
    const generation =
      opts.generation && opts.generation.model === model
        ? Object.assign({}, opts.generation, { seed: seed })
        : captureImageGeneration(model, seed, opts);

    const dataUrl = await requestImage(prompt, {
      signal: abortController.signal,
      model: model,
      seed: generation.seed,
      settings: opts.settings,
      workflowId: opts.workflowId || generation.workflow,
      overrides: generationOverrides(generation),
      initImage: opts.initImage,
      maskImage: opts.maskImage,
      width: generation.width,
      height: generation.height,
      onStatus: (status) => {
        loadingDiv.textContent = status;
      },
    });

    // The seed actually drawn with is remembered, because the UI shows it.
    const effectiveSeed = Number.isFinite(generation.seed)
      ? recordImageSeed(generation.seed)
      : null;
    const isInpaint = !!opts.maskImage;

    const id = newImageId();
    await putImage({
      id: id,
      chatId: String(currentChatId),
      dataUrl: dataUrl,
      prompt: prompt,
      model: model,
    });

    // content stays readable text so the LLM has sensible context if the
    // conversation continues; the image bytes hang off `image`.
    const imageMeta = {
      id: id,
      prompt: prompt,
      model: model,
      workflow: generation.workflow,
      seed: effectiveSeed,
      steps: generation.steps,
      cfg: generation.cfg,
      // The full reproducibility snapshot: model, seed, sampler, steps, cfg,
      // size and the LoRA strengths in force. A rerun passes it straight back.
      generation: Object.assign({}, generation, { seed: effectiveSeed }),
    };
    // The scene record this picture was drawn from. Regenerating this message
    // replays it instead of the chat's current record, so an old scene is
    // redrawn with the place, time and clothes it had at the time.
    if (opts.story) imageMeta.story = opts.story;
    // An edit or an inpaint remembers its source picture, so regenerating this
    // message works on the same source again instead of redrawing from scratch.
    if (opts.editOf) imageMeta.sourceImageId = opts.editOf;
    if (isInpaint) {
      // `editOf` mirrors `sourceImageId` so the lineage reads the same whichever
      // field a consumer looks at, and `mask` marks the message as a mask
      // result (the mask PNG itself is not stored — a rerun paints it again).
      if (opts.editOf) imageMeta.editOf = opts.editOf;
      imageMeta.mask = true;
      if (opts.width && opts.height) {
        imageMeta.width = opts.width;
        imageMeta.height = opts.height;
      }
    }
    // Keep a copy of the scene the prompt was built from on the message, even
    // when the caller did not supply one: older records and plain chats then
    // rerun against the record that existed when the picture was made.
    if (!imageMeta.story && typeof storyFileSnapshot === "function") {
      imageMeta.story = storyFileSnapshot();
    }
    chatHistory.push({
      role: "assistant",
      content: isInpaint
        ? `*Inpainted image — ${prompt}*`
        : opts.initImage
          ? `*Edited image — ${prompt}*`
          : `*Generated image — ${prompt}*`,
      image: imageMeta,
    });
    const newIdx = chatHistory.length - 1;

    loadingDiv.classList.remove("loading-indicator");
    loadingDiv.dataset.msgIndex = newIdx;
    await renderImageMessage(loadingDiv, chatHistory[newIdx]);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (typeof settleScrollAfterImages === "function") {
      settleScrollAfterImages(messagesEl);
    }
    if (typeof announceToSR === "function") {
      announceToSR(
        isInpaint
          ? `Masked area repainted: ${prompt}`
          : opts.initImage
            ? `Image edited: ${prompt}`
            : `Image generated for ${prompt}`,
      );
    }
    return newIdx;
  } catch (err) {
    if (err.name === "AbortError") {
      loadingDiv.remove();
      return -1;
    }
    console.error("Image generation error:", err);
    loadingDiv.textContent = `Error: ${err.message}`;
    loadingDiv.classList.remove("loading-indicator");
    showToast(`Image generation failed: ${err.message}`, "error");
    if (typeof addRetryButton === "function") {
      addRetryButton(loadingDiv, () =>
        generateImageMessage(originalPrompt, opts),
      );
    }
    return -1;
  } finally {
    if (currentChatId) {
      safeSetItem(
        STORAGE_KEY_PREFIX + currentChatId,
        JSON.stringify(chatHistory),
      );
    }
    if (typeof renderChatList === "function") renderChatList();
  }
}

/**
 * Repaint the masked area of a picture and append the result as a new message.
 *
 * Thin wrapper over {@link generateImageMessage} with `maskImage` set: that
 * function owns the placeholder row, the abort scope, blob storage, the
 * `chatHistory` entry and the rendering. Everything specific to inpainting
 * (which model capability is required, what the metadata says) lives in the
 * `maskImage` branches there, so there is one message path, not two.
 *
 * Why a wrapper at all: the mask editor has the source bitmap and the painted
 * mask in hand and wants a named entry point, and a future caller with an image
 * id but no message should not have to assemble the `opts` shape.
 *
 * @param {string} instruction What the masked area should become
 * @param {object} opts
 * @param {string} opts.initImage data: URL of the source picture
 * @param {string} opts.maskImage data: URL of the white-on-black mask PNG
 * @param {string} [opts.editOf] Image id the result descends from
 * @param {number} [opts.width] Source width in pixels
 * @param {number} [opts.height] Source height in pixels
 * @param {number} [opts.seed]
 * @returns {Promise<number>} Index of the new message, or -1 on failure
 */
async function generateInpaintMessage(instruction, opts) {
  opts = opts || {};
  if (!opts.initImage || !opts.maskImage) {
    showToast("Inpainting needs a source picture and a painted mask.", "error");
    return -1;
  }
  return await generateImageMessage(instruction, {
    initImage: opts.initImage,
    maskImage: opts.maskImage,
    editOf: opts.editOf,
    width: opts.width,
    height: opts.height,
    seed: opts.seed,
  });
}

/** @type {Set<number>} Messages with an image currently being generated. */
const messageImageJobs = new Set();

/**
 * Generate (or regenerate) the image attached to one message.
 *
 * On demand only. A diffusion pass per message would be slow and most prose is
 * not worth a picture, so nothing here runs until the button is pressed.
 *
 * In story mode the prompt is built from the scene record — the moment is
 * summarised and the cast's locked look is appended — so a character keeps the
 * same face across images. In a plain chat there is no record, so the message
 * text is the prompt.
 *
 * @param {number} msgIndex
 * @param {{reusePrompt?:boolean}} [opts] `reusePrompt` re-draws a standalone
 *   image message from the prompt it already carries (its own content is just
 *   a caption, so there is no prose to illustrate).
 * @returns {Promise<void>}
 */
async function generateImageForMessage(msgIndex, opts) {
  opts = opts || {};
  const msg = chatHistory[msgIndex];
  if (!msg || !currentChatId) return;
  // A standalone image message has no prose of its own to illustrate — unless
  // an explicit regenerate asks for the stored prompt to be redrawn.
  const standalone = !!(msg.image && !msg.image.attached);
  if (standalone && !(opts.reusePrompt && msg.image.prompt)) return;
  // Guard against a double click starting two generations for one message.
  if (messageImageJobs.has(msgIndex)) return;

  const messagesEl = document.getElementById("messages");
  const div = messagesEl
    ? messagesEl.querySelector('[data-msg-index="' + msgIndex + '"]')
    : null;
  if (!div) return;

  messageImageJobs.add(msgIndex);

  // Reuse the existing slot on a regenerate so pictures do not stack up. A
  // standalone image message *is* the slot, so it is cleared in place.
  let wrap = standalone ? div : div.querySelector(".message-image");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "message-image";
    const toolbar = div.querySelector(".msg-toolbar");
    if (toolbar) div.insertBefore(wrap, toolbar);
    else div.appendChild(wrap);
  }
  wrap.textContent = "";

  const status = document.createElement("div");
  status.className = "image-status";
  status.textContent =
    currentMode === "story" || msg.image
      ? "Reading the scene…"
      : "Generating image…";
  wrap.appendChild(status);
  wrap.scrollIntoView({ block: "nearest" });

  const previousId = msg.image && msg.image.id;
  // A message made by editing an earlier picture edits that same picture
  // again when regenerated; `sourceImageId` names the source blob.
  let editOf = msg.image && msg.image.sourceImageId;
  const controller = new AbortController();

  try {
    const storedGeneration =
      msg.image &&
      msg.image.generation &&
      typeof msg.image.generation === "object"
        ? msg.image.generation
        : null;
    // If this draw is going to use the selected model (a first image or a
    // model switch), make sure that model exists on this ComfyUI. An exact
    // replay keeps its stored model untouched.
    const wantsSelectedModel =
      !storedGeneration ||
      (!!storedGeneration.model &&
        storedGeneration.model !== imageParams.model);
    if (
      wantsSelectedModel &&
      typeof reconcileImageModelSelection === "function"
    ) {
      const { cfg } = resolveImageProvider();
      if (cfg && cfg.api === "comfyui") {
        status.textContent = "Checking image model…";
        await reconcileImageModelSelection({ announce: true });
      }
    }

    // The model selector wins when the user has changed it. Replaying the old
    // model is right for an exact rerun, but silently ignoring a new selection
    // is how "switch to Anima and regenerate" produced the same picture twice.
    const selectedModel = imageParams.model;
    const modelChanged =
      !!storedGeneration &&
      !!storedGeneration.model &&
      storedGeneration.model !== selectedModel;
    const model = modelChanged
      ? selectedModel
      : storedGeneration && storedGeneration.model
        ? storedGeneration.model
        : selectedModel;

    // A hand edit to the record is a correction the user wants to see. It is
    // only applied to the newest picture: an old scene keeps the snapshot it
    // was drawn from, or scrolling back would redraw it with today's clothes.
    const currentRecord = currentChatId ? getStoryFile(currentChatId) : null;
    const handEditedSince =
      !!msg.image &&
      !!msg.image.story &&
      !!currentRecord &&
      Number(currentRecord.editedAt || 0) >
        Number(msg.image.story.editedAt || 0) &&
      !chatHistory.slice(msgIndex + 1).some((m) => m && m.image);

    const record = storyFileForRegeneration(msgIndex, msg);

    let prompt;
    if (msg.image && msg.image.prompt && !handEditedSince) {
      // The stored prompt came from the record at the time. Reusing it verbatim
      // (plus the stored seed and settings) is what makes a rerun identical.
      prompt = msg.image.prompt;
    } else if (!standalone || handEditedSince) {
      // No stored prompt, a corrected record, or a first-time image for this
      // reply: build from the scene record. A fresh draw must first fold the
      // latest reply in, or it would illustrate the previous scene. A hand
      // correction on a standalone image message also belongs here: the user
      // edited the record precisely so the next draw would use it.
      let sceneFile = record;
      const needsFresh =
        !sceneFile ||
        !msg.image ||
        (sceneFile === currentRecord &&
          typeof storyFileIsStale === "function" &&
          storyFileIsStale(sceneFile));
      if (needsFresh && typeof prepareStoryFileForImage === "function") {
        sceneFile =
          (await prepareStoryFileForImage({
            signal: controller.signal,
            onStatus: (s) => (status.textContent = s),
          })) || sceneFile;
      }
      if (sceneFile || currentMode === "story") {
        prompt = await buildStoryImagePrompt({
          atIndex: msgIndex,
          file: sceneFile,
          signal: controller.signal,
          onStatus: (s) => (status.textContent = s),
        });
      } else {
        prompt = (msg.content || "").trim();
        if (!prompt) throw new Error("This message has nothing to illustrate.");
      }
    } else {
      // A standalone image message is redrawn from the prompt it was made with.
      prompt = (msg.image && msg.image.prompt) || "";
      if (!prompt) throw new Error("This message has nothing to illustrate.");
    }

    // A mask result keeps its lineage but not its mask: the mask PNG is not
    // stored, so a rerun repaints the masked area from the stored prompt with a
    // fresh mask drawn by the user rather than silently editing the whole
    // frame. Saying so is better than quietly turning an inpaint into an edit.
    const isInpaint = !!(msg.image && msg.image.mask);

    status.textContent = "Generating image…";

    let initImage;
    let sourceSeed;
    if (isInpaint) {
      status.textContent = "Inpainting…";
    } else if (editOf && typeof getImage === "function") {
      const source = await getImage(editOf).catch(() => null);
      if (source && source.dataUrl && imageEditSupported()) {
        initImage = source.dataUrl;
        // An edit of the same source keeps its seed, so the change reads as a
        // change rather than as a new picture.
        sourceSeed = Number.isFinite(msg.image.seed)
          ? msg.image.seed
          : undefined;
        status.textContent = "Editing previous image…";
      } else {
        // The source blob is gone, or this provider can't edit — redraw from
        // the stored prompt and drop the stale lineage.
        editOf = undefined;
      }
    }

    // Reproduce the picture: its own seed and generation snapshot win, then
    // the source picture's seed for an edit, then the chat's locked seed. A
    // hand-edited record asks for a new draw from the corrected record, so it
    // takes the chat's current seed (which is how a seed edit in the JSON takes
    // effect on the next regenerate). A model change is a new draw too, so it
    // uses the chat's current seed rather than the old model's.
    const seed =
      handEditedSince || modelChanged
        ? nextImageSeed()
        : storedGeneration && Number.isFinite(storedGeneration.seed)
          ? storedGeneration.seed
          : initImage && Number.isFinite(sourceSeed)
            ? sourceSeed
            : nextImageSeed();

    if (isInpaint) {
      // Regenerating a mask result opens the mask editor again, seeded with the
      // same source and instruction — a fresh mask is the only useful input and
      // the app does not keep the old one.
      const source =
        editOf && typeof getImage === "function"
          ? await getImage(editOf).catch(() => null)
          : null;
      // Drop the placeholder this function created: the modal takes over. The
      // `finally` below still releases messageImageJobs for this index.
      wrap.remove();
      if (source && source.dataUrl && imageInpaintSupported()) {
        openInpaintEditor({
          msgIndex: msgIndex,
          sourceImageId: editOf,
          sourceDataUrl: source.dataUrl,
          instruction: prompt,
          seed: seed,
        });
      } else {
        showToast(
          "That picture can no longer be inpainted — open Inpaint on a live " +
            "image instead.",
          "error",
        );
      }
      return;
    }

    // The settings a rerun passes. A changed model gets its own registry
    // recipe; an unchanged model replays the snapshot exactly.
    const generation =
      storedGeneration && !modelChanged && storedGeneration.model === model
        ? Object.assign({}, storedGeneration, { seed: seed })
        : captureImageGeneration(model, seed, { initImage: initImage });

    const dataUrl = await requestImage(prompt, {
      model: model,
      seed: generation.seed,
      signal: controller.signal,
      initImage: initImage,
      settings: opts.settings,
      overrides: generationOverrides(generation),
      width: generation.width,
      height: generation.height,
      onStatus: (s) => (status.textContent = s),
    });

    const effectiveSeed = Number.isFinite(seed) ? recordImageSeed(seed) : null;
    generation.seed = effectiveSeed;

    const id = newImageId();
    await putImage({
      id: id,
      chatId: String(currentChatId),
      dataUrl: dataUrl,
      prompt: prompt,
      model: model,
    });

    const variant = {
      id: id,
      prompt: prompt,
      model: model,
      workflow: generation.workflow,
      seed: effectiveSeed,
      steps: generation.steps,
      cfg: generation.cfg,
      generation: generation,
      // Replaying an old scene keeps its snapshot; a rebuilt one stores the
      // record it was actually built from.
      story:
        msg.image && msg.image.story && !handEditedSince
          ? msg.image.story
          : typeof storyFileSnapshot === "function"
            ? storyFileSnapshot()
            : null,
      createdAt: Date.now(),
    };
    if (editOf) variant.sourceImageId = editOf;
    // `attached` marks an image hanging off a text reply. A standalone image
    // message must keep it unset, or renderMessages() would start treating it
    // as a caption plus picture.
    if (!standalone) variant.attached = true;

    // Keep the versions. A rerun that produced exactly the same draw replaces
    // the visible version instead of stacking identical copies; a new model, a
    // corrected record or a new seed is a genuine alternative and is appended.
    const variants = imageVariantsFor(msg, true);
    const variantAt = activeImageVariantIndex(msg);
    const currentVariant = variants[variantAt] || msg.image;
    const sameDraw =
      !handEditedSince &&
      !modelChanged &&
      imageVariantSignature(currentVariant) === imageVariantSignature(variant);

    if (sameDraw) {
      variants[variantAt] = variant;
      // The superseded blob has no remaining reference.
      if (
        previousId &&
        previousId !== id &&
        typeof deleteImage === "function"
      ) {
        deleteImage(previousId).catch(() => {});
      }
    } else {
      variants.push(variant);
      msg.imageVariantIndex = variants.length - 1;
    }
    msg.image = variant;
    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );

    wrap.textContent = "";
    await appendImageElement(wrap, msg);
    updateGeneratedImageHeight();
    // The regenerate replaced the picture, so its saved viewport size no longer
    // applies to anything — drop it so the new image starts at 100%.
    if (previousId && previousId !== id && typeof setImageZoom === "function") {
      setImageZoom(previousId, 1);
    }

    const btn = div.querySelector(".msg-image-btn");
    if (btn) {
      btn.title = "Regenerate image";
      btn.setAttribute("aria-label", "Regenerate the image for this message");
    }
    if (typeof announceToSR === "function") {
      announceToSR("Image generated for this message");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      wrap.remove();
      return;
    }
    console.error("Message image generation failed:", err);
    status.className = "generated-image-missing";
    status.textContent = err.message;
    showToast("Image generation failed: " + err.message, "error");
  } finally {
    messageImageJobs.delete(msgIndex);
  }
}

attachModelDropdownKeyNav("image-model-dropdown");

/**
 * Re-draw the picture belonging to one message.
 *
 * The stored prompt and the picture's generation snapshot are replayed when the
 * selected model has not changed, so the result is reproducible. Selecting a
 * different image model makes the next regenerate use that model instead and
 * keeps the previous result as a version you can switch back to.
 * @param {number} msgIndex
 * @returns {Promise<void>}
 */
function regenerateImageForMessage(msgIndex) {
  const msg = chatHistory[msgIndex];
  if (!msg || !msg.image) return Promise.resolve();
  return generateImageForMessage(msgIndex, {
    reusePrompt: !msg.image.attached,
  });
}

// Close the image model dropdown when clicking outside it.
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("image-model-dropdown");
  const selector = document.getElementById("image-model-selector");
  if (!dropdown || !selector) return;
  const path = e.composedPath();
  if (!path.includes(dropdown) && !path.includes(selector)) {
    dropdown.classList.remove("open");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  updateImageModelVisibility();
  // Best-effort: the remembered model may be a registry recipe rather than a
  // file this ComfyUI has. Settle on an installed one before the first draw,
  // so Generate works without opening the model menu. A failed/unreachable
  // server leaves the selection untouched.
  if (typeof reconcileImageModelSelection === "function") {
    reconcileImageModelSelection().catch(() => {});
  }
});
