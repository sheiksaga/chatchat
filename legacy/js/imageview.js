/**
 * imageview.js — per-image viewport controls
 *
 * A generated picture gets a small floating pill in its top-right corner:
 * regenerate (⟳) plus a viewport-only zoom (− 100% +). The zoom changes how
 * large the picture is *displayed* in the transcript — the stored file is never
 * resampled, so "bigger" costs nothing and is reversible.
 *
 * The controls are written as a self-contained module because two very
 * different render paths produce images (a standalone `/image` message and an
 * image attached to a reply); both funnel through appendImageElement() in
 * messages.js, which calls attachImageControls().
 */

/** Zoom bounds and step, as a multiplier of the natural display size. */
const IMAGE_ZOOM_MIN = 0.4;
const IMAGE_ZOOM_MAX = 2;
const IMAGE_ZOOM_STEP = 0.1;

/** localStorage key holding one { imageId: multiplier } map for the app. */
const IMAGE_ZOOM_KEY = "chatchat_image_zoom";
/** Keep the persisted map from growing without bound. */
const IMAGE_ZOOM_MAX_ENTRIES = 300;

/**
 * Read the persisted zoom map.
 * @returns {Record<string, number>}
 */
function readImageZoomMap() {
  try {
    const raw = localStorage.getItem(IMAGE_ZOOM_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    // A corrupt or unavailable store is not worth failing a render over.
    return {};
  }
}

/**
 * Look up the saved zoom for one image.
 * @param {string} id
 * @returns {number} Multiplier, 1 when unset.
 */
function getImageZoom(id) {
  if (!id) return 1;
  const z = readImageZoomMap()[id];
  return typeof z === "number" && z >= IMAGE_ZOOM_MIN && z <= IMAGE_ZOOM_MAX
    ? z
    : 1;
}

/**
 * Persist the zoom for one image, dropping the oldest entries once the map is
 * larger than the cap (object key order is insertion order for string keys, so
 * the first keys are the oldest).
 * @param {string} id
 * @param {number} zoom
 */
function setImageZoom(id, zoom) {
  if (!id) return;
  const map = readImageZoomMap();
  map[id] = zoom;
  const keys = Object.keys(map);
  if (keys.length > IMAGE_ZOOM_MAX_ENTRIES) {
    keys.slice(0, keys.length - IMAGE_ZOOM_MAX_ENTRIES).forEach((k) => {
      delete map[k];
    });
  }
  try {
    localStorage.setItem(IMAGE_ZOOM_KEY, JSON.stringify(map));
  } catch (e) {
    // Storage full or blocked — the zoom still applies for this session.
  }
}

/** Snap to the step grid and clamp, so repeated clicks cannot drift. */
function normalizeImageZoom(zoom) {
  const stepped = Math.round(zoom / IMAGE_ZOOM_STEP) * IMAGE_ZOOM_STEP;
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, stepped));
}

/**
 * Icon-only button for the image pill.
 * @param {string} label Accessible name (also the tooltip)
 * @param {string} svg Inner SVG markup
 * @returns {HTMLButtonElement}
 */
function imageControlButton(label, svg) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = svg;
  return btn;
}

/**
 * Attach the floating controls to one rendered image.
 *
 * Idempotent: regenerating an image reuses the same container, so an existing
 * pill is removed before a fresh one is built. Called from appendImageElement()
 * in messages.js, which is the single place an <img> enters the DOM.
 *
 * @param {HTMLElement} container The `.message-image` frame holding the picture
 * @param {HTMLImageElement} img
 * @param {object} msg The chatHistory entry the picture belongs to
 */
function attachImageControls(container, img, msg) {
  if (!container || !img) return;
  const existing = container.querySelector(".image-controls");
  if (existing) existing.remove();

  const imageId = msg && msg.image ? msg.image.id : null;
  const div = container.closest("[data-msg-index]");
  const msgIndex = div ? Number(div.dataset.msgIndex) : -1;

  const controls = document.createElement("div");
  controls.className = "image-controls";
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "Image controls");

  // — Zoom: viewport only, persisted per image —
  const minus = imageControlButton(
    "Make image smaller",
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
  );

  const label = document.createElement("button");
  label.type = "button";
  label.className = "image-zoom-label";
  label.title = "Reset image size";
  label.setAttribute("aria-label", "Reset image size to 100%");

  const plus = imageControlButton(
    "Make image bigger",
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  );

  let zoom = normalizeImageZoom(getImageZoom(imageId));

  const applyZoom = (next, persist) => {
    zoom = normalizeImageZoom(next);
    img.style.setProperty("--img-zoom", String(zoom));
    label.textContent = Math.round(zoom * 100) + "%";
    label.setAttribute(
      "aria-label",
      `Image size ${Math.round(zoom * 100)}% — reset to 100%`,
    );
    // Clamped ends disable their button rather than silently doing nothing.
    minus.disabled = zoom <= IMAGE_ZOOM_MIN;
    plus.disabled = zoom >= IMAGE_ZOOM_MAX;
    if (persist) setImageZoom(imageId, zoom);
  };

  minus.onclick = (e) => {
    e.stopPropagation();
    applyZoom(zoom - IMAGE_ZOOM_STEP, true);
  };
  plus.onclick = (e) => {
    e.stopPropagation();
    applyZoom(zoom + IMAGE_ZOOM_STEP, true);
  };
  label.onclick = (e) => {
    e.stopPropagation();
    applyZoom(1, true);
  };

  // — Inpaint: paint a mask over this picture and repaint only that region —
  // Only offered when the selected model actually has an LLLite inpaint graph.
  // FLUX.2 has none, and a button that always throws is worse than no button.
  const canInpaint =
    typeof imageInpaintSupported === "function" && imageInpaintSupported();
  if (canInpaint && imageId) {
    const inpaint = imageControlButton(
      "Inpaint part of this image",
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 114.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z"/></svg>',
    );
    inpaint.onclick = (e) => {
      e.stopPropagation();
      openInpaintForMessage(msgIndex);
    };
    controls.appendChild(inpaint);
  }

  // — Versions: switch between pictures generated for this slot —
  // Only present once a regeneration has produced an alternative. The count
  // doubles as the button that advances, like the text "n/m" control.
  const variants =
    typeof imageVariantsFor === "function" ? imageVariantsFor(msg) : [];
  if (variants.length > 1 && msgIndex >= 0) {
    const variantAt =
      typeof activeImageVariantIndex === "function"
        ? activeImageVariantIndex(msg)
        : 0;

    const prevVariant = imageControlButton(
      "Previous generated version",
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    );
    prevVariant.onclick = (e) => {
      e.stopPropagation();
      cycleImageVariant(msgIndex, -1);
    };

    const variantLabel = document.createElement("button");
    variantLabel.type = "button";
    variantLabel.className = "image-variant-label";
    variantLabel.textContent = `${variantAt + 1}/${variants.length}`;
    const variantModel =
      msg.image && msg.image.model
        ? typeof imageModelDisplayName === "function"
          ? imageModelDisplayName(msg.image.model)
          : msg.image.model
        : "";
    variantLabel.title = variantModel
      ? `Version ${variantAt + 1} of ${variants.length} — ${variantModel}. Click for the next.`
      : `Generated versions — click for the next (${variantAt + 1} of ${variants.length})`;
    variantLabel.setAttribute(
      "aria-label",
      `Generated version ${variantAt + 1} of ${variants.length}`,
    );
    variantLabel.onclick = (e) => {
      e.stopPropagation();
      cycleImageVariant(msgIndex, 1);
    };

    const nextVariant = imageControlButton(
      "Next generated version",
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    );
    nextVariant.onclick = (e) => {
      e.stopPropagation();
      cycleImageVariant(msgIndex, 1);
    };

    controls.appendChild(prevVariant);
    controls.appendChild(variantLabel);
    controls.appendChild(nextVariant);
  }

  // — Regenerate: same message slot, new picture —
  const regen = imageControlButton(
    "Regenerate this image",
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg>',
  );
  regen.onclick = (e) => {
    e.stopPropagation();
    if (msgIndex < 0) return;
    if (typeof regenerateImageForMessage === "function") {
      regenerateImageForMessage(msgIndex);
    } else if (typeof generateImageForMessage === "function") {
      generateImageForMessage(msgIndex);
    }
  };

  controls.appendChild(regen);

  // — Delete: drop the picture (and every version), keep the reply text —
  if (msgIndex >= 0 && typeof deleteRenderedImage === "function") {
    const del = imageControlButton(
      "Delete this image",
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    );
    del.classList.add("image-control-danger");
    del.onclick = (e) => {
      e.stopPropagation();
      deleteRenderedImage(msgIndex);
    };
    controls.appendChild(del);
  }

  controls.appendChild(minus);
  controls.appendChild(label);
  controls.appendChild(plus);
  container.appendChild(controls);

  // Restore the saved size without writing it back on every render.
  applyZoom(zoom, false);
}

// Expose for other modules that only have an image id (e.g. future callers).
window.getImageZoom = getImageZoom;
window.setImageZoom = setImageZoom;

/* ── Mask inpainting (Anima LLLite) ───────────────────────────────

   A mask is painted here, in the browser, at the picture's *natural*
   resolution — never at the on-screen size. The graph resizes nothing: source
   and mask must be the same size, pixel for pixel, or `AnimaLLLiteApply`
   silently lines the mask up against the wrong region. So the canvas backing
   store is the bitmap's own width/height and only its CSS box is fitted to the
   viewport.

   The mask is exported as a **white-on-black RGB PNG**. `LoadImageMask` reads
   the red channel, so alpha is irrelevant — a transparent-background PNG would
   export as all-black and inpaint nothing while looking painted on screen.
   Painting on an opaque black canvas sidesteps that entirely.

   No library: a canvas, a pointer, and a destination-out eraser. */

/** Default instruction, matching what the backend graph was validated with. */
const INPAINT_DEFAULT_INSTRUCTION = "Change the masked area.";

/** Brush size bounds, in *image* pixels (the canvas is 1:1 with the bitmap). */
const INPAINT_BRUSH_MIN = 4;
const INPAINT_BRUSH_MAX = 200;

/**
 * Load an image element from a data URL, resolving once it has decodable size.
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadInpaintImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The picture could not be loaded."));
    img.src = src;
  });
}

/**
 * Open the mask editor for one message's picture.
 * @param {number} msgIndex
 */
async function openInpaintForMessage(msgIndex) {
  const msg = chatHistory[msgIndex];
  if (!msg || !msg.image || !msg.image.id) return;
  if (typeof imageInpaintSupported === "function" && !imageInpaintSupported()) {
    showToast(
      "Inpainting needs the Anima image model — switch to it first.",
      "error",
    );
    return;
  }
  const record = await getImage(msg.image.id).catch(() => null);
  if (!record || !record.dataUrl) {
    showToast(
      "That picture is no longer available — regenerate it first.",
      "error",
    );
    return;
  }
  openInpaintEditor({
    msgIndex: msgIndex,
    sourceImageId: msg.image.id,
    sourceDataUrl: record.dataUrl,
    instruction: msg.image.prompt || INPAINT_DEFAULT_INSTRUCTION,
  });
}

/**
 * The mask editor modal.
 *
 * Self-contained on purpose: it builds its own DOM, owns its own canvas state,
 * and removes itself on cancel/apply/escape. Nothing else in the app needs to
 * know it exists.
 *
 * Layout note: the canvas is fitted with CSS (`max-width`/`max-height`), while
 * its backing store stays at the bitmap's natural size — so pointer coordinates
 * are converted by the ratio of backing store to client rect, which is what
 * keeps a brush stroke landing where the cursor is at any zoom or window size.
 *
 * @param {object} opts
 * @param {number} [opts.msgIndex] Message the result belongs to (0 or -1 both mean "none")
 * @param {string} [opts.sourceImageId] Image id the result descends from
 * @param {string} opts.sourceDataUrl data: URL of the picture to inpaint
 * @param {string} [opts.instruction] Initial instruction text
 * @param {number} [opts.seed] Seed to reuse (regenerate of an inpaint result)
 */
function openInpaintEditor(opts) {
  if (document.getElementById("inpaint-overlay")) return;

  // Close panels that would otherwise sit behind/overlap the modal.
  document.getElementById("config-panel")?.classList.remove("open");
  document.getElementById("model-dropdown")?.classList.remove("open");

  const overlay = document.createElement("div");
  overlay.className = "story-settings-overlay";
  overlay.id = "inpaint-overlay";

  const modal = document.createElement("div");
  modal.className = "story-settings-modal inpaint-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Inpaint an image");

  // — Header —
  const head = document.createElement("div");
  head.className = "story-settings-head";
  head.innerHTML = "<span>Inpaint</span>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "config-panel-close";
  closeBtn.setAttribute("aria-label", "Close the mask editor");
  closeBtn.title = "Close";
  closeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  head.appendChild(closeBtn);

  // — Hint —
  const hint = document.createElement("p");
  hint.className = "inpaint-hint";
  hint.textContent =
    "Paint over what you want changed. White is repainted, black is kept. " +
    "Paint a little past the edge so the seam blends.";

  // — Canvas stage —
  const stage = document.createElement("div");
  stage.className = "inpaint-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "inpaint-canvas";
  stage.appendChild(canvas);

  // — Toolbar: brush / eraser / size / clear —
  const tools = document.createElement("div");
  tools.className = "inpaint-tools";

  const brushBtn = document.createElement("button");
  brushBtn.type = "button";
  brushBtn.className = "inpaint-tool active";
  brushBtn.textContent = "Brush";
  brushBtn.setAttribute("aria-pressed", "true");

  const eraserBtn = document.createElement("button");
  eraserBtn.type = "button";
  eraserBtn.className = "inpaint-tool";
  eraserBtn.textContent = "Eraser";
  eraserBtn.setAttribute("aria-pressed", "false");

  const sizeLabel = document.createElement("label");
  sizeLabel.className = "inpaint-size";
  sizeLabel.textContent = "Brush";
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range";
  sizeSlider.min = String(INPAINT_BRUSH_MIN);
  sizeSlider.max = String(INPAINT_BRUSH_MAX);
  sizeSlider.step = "1";
  sizeSlider.value = "48";
  sizeSlider.setAttribute("aria-label", "Brush size in pixels");
  sizeLabel.appendChild(sizeSlider);

  const sizeReadout = document.createElement("span");
  sizeReadout.className = "inpaint-size-readout";
  sizeReadout.textContent = "48px";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "inpaint-tool";
  clearBtn.textContent = "Clear";

  tools.appendChild(brushBtn);
  tools.appendChild(eraserBtn);
  tools.appendChild(sizeLabel);
  tools.appendChild(sizeReadout);
  tools.appendChild(clearBtn);

  // — Instruction —
  const instructionLabel = document.createElement("label");
  instructionLabel.className = "inpaint-instruction";
  const instructionCaption = document.createElement("span");
  instructionCaption.textContent = "Instruction";
  const instructionInput = document.createElement("input");
  instructionInput.type = "text";
  instructionInput.value = opts.instruction || INPAINT_DEFAULT_INSTRUCTION;
  instructionInput.placeholder = INPAINT_DEFAULT_INSTRUCTION;
  instructionInput.setAttribute("aria-label", "Inpaint instruction");
  instructionLabel.appendChild(instructionCaption);
  instructionLabel.appendChild(instructionInput);

  // — Footer —
  const footer = document.createElement("div");
  footer.className = "inpaint-actions";

  const status = document.createElement("div");
  status.className = "inpaint-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn-send inpaint-apply";
  applyBtn.textContent = "Apply";
  // Disabled until something is actually painted: an empty mask would ask
  // ComfyUI to repaint nothing and return the source unchanged, which reads as
  // a silent failure.
  applyBtn.disabled = true;

  footer.appendChild(status);
  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);

  modal.appendChild(head);
  modal.appendChild(hint);
  modal.appendChild(stage);
  modal.appendChild(tools);
  modal.appendChild(instructionLabel);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  /* ── Canvas state ─────────────────────────────────────────── */

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const mask = document.createElement("canvas");
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });

  const state = {
    painting: false,
    erasing: false,
    brush: 48,
    /** @type {HTMLImageElement|null} */
    source: null,
    width: 0,
    height: 0,
    /** Dirty flag maintained by the stroke handlers, so Apply can gate on it. */
    painted: false,
    /** Non-transparent pixel count, refreshed when a stroke ends. */
    paintedPixels: 0,
    busy: false,
    last: null,
  };

  /** Fit the canvas to the modal without touching its backing store. */
  const syncDisplaySize = () => {
    const maxH = Math.max(200, window.innerHeight - 260);
    const maxW = Math.max(240, modal.clientWidth - 8);
    const scale = Math.min(maxW / state.width, maxH / state.height, 1);
    canvas.style.width = Math.max(1, Math.round(state.width * scale)) + "px";
    canvas.style.height = Math.max(1, Math.round(state.height * scale)) + "px";
  };

  /** Repaint the visible composite: source picture, grey-black mask, live overlay. */
  const redraw = () => {
    if (!state.source) return;
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.drawImage(state.source, 0, 0, state.width, state.height);
    // The mask itself stays white-on-transparent for compositing; the exported
    // PNG is what must be white-on-black, and that happens at export time.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  };

  /**
   * Count painted (non-transparent) mask pixels.
   *
   * Done once per stroke rather than per pointermove: this walks the whole
   * bitmap, which is fine at the end of a stroke but not 60 times a second on
   * a 1024x1024 mask.
   * @returns {number}
   */
  const countPaintedPixels = () => {
    if (!state.width || !state.height) return 0;
    const data = maskCtx.getImageData(0, 0, state.width, state.height).data;
    let n = 0;
    // Every 4th byte is the alpha channel; 8 is a low enough threshold that a
    // feathered edge still counts as painted.
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) n++;
    }
    return n;
  };

  /** Reflect the mask's emptiness in the status line and the Apply button. */
  const syncMaskState = () => {
    state.paintedPixels = countPaintedPixels();
    state.painted = state.paintedPixels > 0;
    if (!state.busy) {
      applyBtn.disabled = !state.painted;
      status.textContent = state.painted
        ? `${state.paintedPixels.toLocaleString()} px selected`
        : "Paint over the part you want to change.";
    }
  };

  /** Convert a pointer position on screen into backing-store pixels. */
  const pointFromEvent = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? state.width / rect.width : 1;
    const sy = rect.height ? state.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  };

  /** Stroke one segment of the mask: source-over to paint, destination-out to erase. */
  const strokeSegment = (from, to) => {
    maskCtx.save();
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";
    maskCtx.lineWidth = state.brush;
    if (state.erasing) {
      maskCtx.globalCompositeOperation = "destination-out";
      maskCtx.strokeStyle = "rgba(0,0,0,1)";
      maskCtx.fillStyle = "rgba(0,0,0,1)";
    } else {
      maskCtx.globalCompositeOperation = "source-over";
      maskCtx.strokeStyle = "#ffffff";
      maskCtx.fillStyle = "#ffffff";
    }
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
    // A click with no movement should still leave a dot.
    maskCtx.beginPath();
    maskCtx.arc(to.x, to.y, state.brush / 2, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();
    redraw();
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (state.busy || !state.source) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    state.painting = true;
    const p = pointFromEvent(e);
    state.last = p;
    strokeSegment(p, p);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.painting || state.busy) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    strokeSegment(state.last || p, p);
    state.last = p;
  });

  const endStroke = (e) => {
    if (!state.painting) return;
    state.painting = false;
    state.last = null;
    try {
      if (e) canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* capture already gone */
    }
    syncMaskState();
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  /* ── Tool wiring ──────────────────────────────────────────── */

  const setTool = (erasing) => {
    state.erasing = erasing;
    brushBtn.classList.toggle("active", !erasing);
    eraserBtn.classList.toggle("active", erasing);
    brushBtn.setAttribute("aria-pressed", String(!erasing));
    eraserBtn.setAttribute("aria-pressed", String(erasing));
  };
  brushBtn.onclick = () => setTool(false);
  eraserBtn.onclick = () => setTool(true);

  sizeSlider.oninput = () => {
    state.brush = parseInt(sizeSlider.value, 10) || INPAINT_BRUSH_MIN;
    sizeReadout.textContent = state.brush + "px";
  };

  clearBtn.onclick = () => {
    if (state.busy) return;
    maskCtx.clearRect(0, 0, state.width, state.height);
    redraw();
    syncMaskState();
  };

  /* ── Export + apply ───────────────────────────────────────── */

  /**
   * Turn the painted mask into the PNG the graph wants: white where painted,
   * black everywhere else, at the picture's natural size.
   *
   * Drawn onto an opaque black canvas rather than relying on the mask's own
   * alpha, because `LoadImageMask` reads the red channel and ignores alpha.
   * @returns {string} data: URL of a white-on-black PNG
   */
  const exportMaskDataUrl = () => {
    const out = document.createElement("canvas");
    out.width = state.width;
    out.height = state.height;
    const outCtx = out.getContext("2d");
    outCtx.fillStyle = "#000000";
    outCtx.fillRect(0, 0, state.width, state.height);
    // Paint the mask in white, using the mask's alpha as the stencil.
    const white = document.createElement("canvas");
    white.width = state.width;
    white.height = state.height;
    const wc = white.getContext("2d");
    wc.drawImage(mask, 0, 0);
    wc.save();
    wc.globalCompositeOperation = "source-in";
    wc.fillStyle = "#ffffff";
    wc.fillRect(0, 0, state.width, state.height);
    wc.restore();
    outCtx.drawImage(white, 0, 0);
    return out.toDataURL("image/png");
  };

  const apply = async () => {
    if (state.busy || !state.painted) return;
    const instruction =
      instructionInput.value.trim() || INPAINT_DEFAULT_INSTRUCTION;
    state.busy = true;
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    instructionInput.disabled = true;
    status.textContent = "Inpainting…";

    // Close the modal *after* the mask is exported, but before the ~9 s render
    // finishes: the transcript's own loading row is the progress display, and a
    // frozen modal would hide it.
    let maskUrl;
    try {
      maskUrl = exportMaskDataUrl();
    } catch (err) {
      state.busy = false;
      applyBtn.disabled = !state.painted;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      instructionInput.disabled = false;
      status.textContent = "Could not export the mask: " + err.message;
      return;
    }

    closeInpaintEditor();

    try {
      await generateInpaintMessage(instruction, {
        initImage: opts.sourceDataUrl,
        maskImage: maskUrl,
        editOf: opts.sourceImageId,
        width: state.width,
        height: state.height,
        seed: opts.seed,
      });
    } catch (err) {
      // generateImageMessage() already reports its own failures; this only
      // catches a throw before that plumbing runs.
      showToast(err.message || String(err), "error");
    }
  };

  applyBtn.onclick = apply;
  cancelBtn.onclick = () => closeInpaintEditor();
  closeBtn.onclick = () => closeInpaintEditor();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeInpaintEditor();
  });
  const onKey = (e) => {
    if (e.key === "Escape") closeInpaintEditor();
  };
  document.addEventListener("keydown", onKey);
  overlay._inpaintCleanup = () =>
    document.removeEventListener("keydown", onKey);

  // — Load the picture, size both canvases to it, then paint —
  loadInpaintImage(opts.sourceDataUrl)
    .then((img) => {
      state.source = img;
      state.width = img.naturalWidth || img.width;
      state.height = img.naturalHeight || img.height;
      canvas.width = state.width;
      canvas.height = state.height;
      mask.width = state.width;
      mask.height = state.height;
      // Brush default scales with the picture: 48 px is a dab on 1024 and a
      // slab on a 256-wide thumbnail.
      const scaled = Math.round(Math.min(state.width, state.height) * 0.08);
      state.brush = Math.min(
        INPAINT_BRUSH_MAX,
        Math.max(INPAINT_BRUSH_MIN, scaled),
      );
      sizeSlider.value = String(state.brush);
      sizeReadout.textContent = state.brush + "px";
      syncDisplaySize();
      redraw();
      syncMaskState();
      canvas.focus();
    })
    .catch((err) => {
      status.textContent = err.message;
      applyBtn.disabled = true;
    });

  window.addEventListener("resize", syncDisplaySize);
  const prevCleanup = overlay._inpaintCleanup;
  overlay._inpaintCleanup = () => {
    prevCleanup();
    window.removeEventListener("resize", syncDisplaySize);
  };

  cancelBtn.focus();
}

/** Close the mask editor modal. */
function closeInpaintEditor() {
  const overlay = document.getElementById("inpaint-overlay");
  if (!overlay) return;
  if (typeof overlay._inpaintCleanup === "function") overlay._inpaintCleanup();
  overlay.remove();
}

// Exposed so a caller with an image id (not a message) can open the editor.
window.openInpaintEditor = openInpaintEditor;
window.openInpaintForMessage = openInpaintForMessage;
