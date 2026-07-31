/* ══════════════════════════════════════════════════════════════
   images.js — Image generation across cloud providers
   ══════════════════════════════════════════════════════════════ */

const OPENAI_IMAGE_MODELS = ["dall-e-2", "dall-e-3", "gpt-image-1"];

/**
 * Generate an image via whichever cloud provider is active.
 * @param {string} prompt
 * @param {AbortSignal} [signal]
 * @param {number} [seed] Reused across a chat to stabilise its look — only
 *   meaningful for the "nanogpt" shape; ignored for "openai".
 * @returns {Promise<string>} A data: URL for the generated image
 */
async function requestImage(prompt, signal, seed) {
  const cfg = currentProvider();
  if (!cfg.imageShape) {
    throw new Error(
      "Active provider has no image generation support — switch to a provider that does under Provider in settings",
    );
  }
  if (!cfg.key) {
    throw new Error(
      "No API key set for " + cfg.label + " — add one under Provider in settings",
    );
  }

  if (cfg.imageShape === "openai") {
    return await postOpenAIImage(prompt, signal);
  }
  return await requestNanoGPTImage(prompt, signal, seed);
}

/** NanoGPT's bespoke image shape — resolution/nImages/negative_prompt fields. */
async function requestNanoGPTImage(prompt, signal, seed) {
  // This route's canonical sizing field is `resolution` (not `size`) and its
  // count field is `nImages` (not `n`) — it is not the plain OpenAI shape.
  const body = {
    prompt: prompt,
    model: imageParams.model,
    resolution: imageParams.size,
    nImages: 1,
    // The baked-in terms come first so they survive any truncation; the
    // user's own negative prompt extends them rather than replacing them.
    negative_prompt: [
      BASE_NEGATIVE_PROMPT,
      (imageParams.negativePrompt || "").trim(),
    ]
      .filter(Boolean)
      .join(", "),
    showExplicitContent: !!imageParams.showExplicitContent,
  };
  // Only sent when the user set them — valid ranges are model-specific.
  if (imageParams.guidanceScale !== "")
    body.guidance_scale = parseFloat(imageParams.guidanceScale);
  if (imageParams.steps !== "")
    body.num_inference_steps = parseInt(imageParams.steps, 10);
  if (seed != null) body.seed = seed;

  try {
    return await postImage(body, signal);
  } catch (err) {
    // A subscription only covers generations at the standard settings, so a
    // custom seed can push an otherwise-included request onto paid balance
    // and fail there. Dropping it is a real loss of continuity, but a
    // slightly different face beats no image at all.
    if (seed != null && /insufficient balance/i.test(err.message)) {
      console.warn(
        "Seeded request was billed to balance and rejected; retrying without a seed.",
      );
      delete body.seed;
      return await postImage(body, signal);
    }
    throw err;
  }
}

/** Standard OpenAI image shape — prompt/model/size/n. */
async function postOpenAIImage(prompt, signal) {
  const body = {
    prompt: prompt,
    model: imageParams.model,
    size: imageParams.size,
    n: 1,
  };
  const response = await fetch(`${API_BASE}/images/generations`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
    signal: signal,
  });
  if (!response.ok) throw new Error(await apiErrorDetail(response));
  return extractImageUrl(await response.json());
}

/**
 * POST one image body to NanoGPT's generation endpoint and unwrap the result.
 * @param {object} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} data: URL or hosted image URL
 */
async function postImage(body, signal) {
  const response = await fetch(`${API_BASE}/images/generations`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
    signal: signal,
  });

  if (!response.ok) throw new Error(await apiErrorDetail(response));

  const data = await response.json();
  // paymentSource says whether the subscription or the paid balance covered
  // this one — the only way to tell which requests count as included.
  if (data.paymentSource !== undefined || data.cost !== undefined) {
    console.info(
      "Image billed via",
      data.paymentSource,
      "— cost",
      data.cost,
      "— remaining balance",
      data.remainingBalance,
    );
  }
  return extractImageUrl(data);
}

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
 * Generate an image and append it to the current chat. Mirrors
 * streamAssistantResponse()'s lifecycle: placeholder row, disabled inputs,
 * stop button, persistence on the way out.
 * @param {string} prompt A direction for the scene summariser, or — when
 *   `opts.raw` is set — the literal image prompt. Empty means "the scene as-is".
 * @param {{reroll?:boolean, raw?:boolean}} [opts] `reroll` picks a fresh seed —
 *   without it a regenerate would reproduce the identical image, since prompt
 *   and seed would both be unchanged. `raw` skips the summariser entirely.
 * @returns {Promise<number>} Index of the new message, or -1 on failure
 */
async function generateImageMessage(prompt, opts) {
  opts = opts || {};
  const messagesEl = document.getElementById("messages");

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message assistant loading-indicator";
  messagesEl.appendChild(loadingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  disableInputs(true);
  document
    .querySelectorAll(".btn-stop")
    .forEach((b) => b.classList.remove("hidden"));
  document
    .querySelectorAll(".btn-send")
    .forEach((b) => b.classList.add("hidden"));

  currentAbortController = new AbortController();

  try {
    if (opts.raw && !prompt)
      throw new Error(
        "/img needs a prompt — use /image on its own to illustrate the scene",
      );

    // Anything but /img goes through the summariser, with the user's text
    // steering the shot rather than replacing the scene.
    if (!opts.raw) {
      loadingDiv.classList.remove("loading-indicator");
      loadingDiv.className = "message assistant scene-prompt-pending";
      loadingDiv.textContent = "Reading the scene…";
      prompt = await buildScenePrompt(
        currentAbortController.signal,
        (status) => {
          loadingDiv.textContent = status;
        },
        prompt,
      );
      loadingDiv.className = "message assistant loading-indicator";
      loadingDiv.textContent = "";
    }

    // Character locks and style are applied to raw prompts too, so
    // "/img Jess smiling" matches the Jess a bare /image produced.
    const composed = await applyImageProfile(
      prompt,
      currentAbortController.signal,
      (status) => {
        loadingDiv.textContent = status;
      },
    );
    loadingDiv.className = "message assistant loading-indicator";
    loadingDiv.textContent = "";

    const seed = opts.reroll
      ? Math.floor(Math.random() * 2147483647)
      : composed.seed;
    const dataUrl = await requestImage(
      composed.prompt,
      currentAbortController.signal,
      seed,
    );

    const id = newImageId();
    await putImage({
      id: id,
      chatId: String(currentChatId),
      dataUrl: dataUrl,
      prompt: prompt,
      model: imageParams.model,
    });

    // content stays plain text so the LLM sees sensible context if the
    // conversation continues; the image itself hangs off `image`.
    chatHistory.push({
      role: "assistant",
      content: `*Generated image — ${prompt}*`,
      image: { id: id, prompt: prompt, model: imageParams.model },
    });
    const newIdx = chatHistory.length - 1;

    loadingDiv.classList.remove("loading-indicator");
    loadingDiv.dataset.msgIndex = newIdx;
    renderImageMessage(loadingDiv, chatHistory[newIdx]);
    addMessageToolbar(loadingDiv, newIdx);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    announceToSR(`Image generated for ${prompt}`);
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
    return -1;
  } finally {
    disableInputs(false);
    currentAbortController = null;
    document
      .querySelectorAll(".btn-stop")
      .forEach((b) => b.classList.add("hidden"));
    document
      .querySelectorAll(".btn-send")
      .forEach((b) => b.classList.remove("hidden"));
    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );
    renderChatList();
  }
}

/* ── Image model selector ─────────────────────────────────────────
   Cloud providers that support image generation expose a pickable
   list of diffusion / image models separate from text models. */

/**
 * Fetch available image models for the active provider's declared shape.
 * @returns {Promise<string[]>}
 */
async function fetchImageModels() {
  const cfg = currentProvider();
  if (cfg.imageShape === "openai") return await fetchOpenAIImageModels();
  if (cfg.imageShape === "nanogpt") return await fetchNanoGPTImageModels();
  return [];
}

/**
 * Fetch from NanoGPT's dedicated image-model catalogue (not the general
 * /models list, which is text LLMs plus the odd exception). Restricted to
 * pure text-to-image models — the app never uploads a source image, so
 * image-to-image/edit-only models would just fail at generation time.
 * @returns {Promise<string[]>}
 */
async function fetchNanoGPTImageModels() {
  try {
    const resp = await fetch(`${API_BASE}/images/models`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const models = data.data || [];

    return models
      .filter((m) => {
        const modality = m.architecture && m.architecture.modality;
        return (
          m.capabilities &&
          m.capabilities.image_generation &&
          typeof modality === "string" &&
          modality.startsWith("text->image")
        );
      })
      .map((m) => m.id);
  } catch (e) {
    console.warn("Failed to fetch NanoGPT image models:", e);
    return [];
  }
}

/**
 * OpenAI's /v1/models has no image-vs-text capability flag, so intersect
 * the account's actual model list with a fixed allowlist of known OpenAI
 * image model ids — never show one the account doesn't have access to.
 * @returns {Promise<string[]>}
 */
async function fetchOpenAIImageModels() {
  try {
    const resp = await fetch(`${API_BASE}/models`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const available = new Set((data.data || []).map((m) => m.id));
    return OPENAI_IMAGE_MODELS.filter((id) => available.has(id));
  } catch (e) {
    console.warn("Failed to fetch OpenAI image models:", e);
    return [];
  }
}

/**
 * Open the image model selector dropdown, fetching models for the active
 * provider's image shape if this is the first open.
 */
async function openImageModelSelector() {
  const dropdown = document.getElementById("image-model-dropdown");
  if (!dropdown) return;
  if (dropdown.classList.contains("open")) {
    dropdown.classList.remove("open");
    return;
  }

  // Close sibling overlays
  document.getElementById("model-dropdown")?.classList.remove("open");
  document.getElementById("config-panel")?.classList.remove("open");

  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Available image models");
  dropdown.innerHTML =
    '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">Loading image models…</div>';
  dropdown.classList.add("open");

  try {
    const models = await fetchImageModels();
    dropdown.innerHTML = "";

    if (models.length === 0) {
      dropdown.innerHTML =
        '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">No image models found</div>';
      return;
    }

    models.forEach((modelId, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "model-dropdown-item";
      item.setAttribute("role", "option");
      item.textContent = modelId;
      if (modelId === imageParams.model) {
        item.classList.add("active");
        item.setAttribute("aria-selected", "true");
      }
      item.onclick = () => selectImageModel(modelId);
      if (i < 12)
        item.style.animation =
          `dropdownItemIn 200ms ${i * 40}ms both cubic-bezier(0.34, 1.56, 0.64, 1)`;
      dropdown.appendChild(item);
    });
  } catch (err) {
    dropdown.innerHTML =
      `<div class="model-dropdown-item" style="color:var(--danger);">Error: ${err.message}</div>`;
  }
}

/**
 * Select an image model and persist the choice.
 * @param {string} modelId
 */
function selectImageModel(modelId) {
  imageParams.model = modelId;
  safeSetItem("image_model", modelId);
  const nameEl = document.getElementById("current-image-model-name");
  if (nameEl) nameEl.textContent = modelId;
  document.getElementById("image-model-dropdown")?.classList.remove("open");
}

/** Update visibility of the image model selector pill based on active provider. */
function updateImageModelVisibility() {
  const pill = document.getElementById("image-model-selector");
  if (!pill) return;
  const cfg = currentProvider();
  const show = !cfg.isLocal && !!cfg.imageShape && !!cfg.key;
  pill.classList.toggle("hidden", !show);
  // Also close the dropdown when hiding
  if (!show) document.getElementById("image-model-dropdown")?.classList.remove("open");
}

/** Initialise the persistent image model name label. */
function initImageModelName() {
  const el = document.getElementById("current-image-model-name");
  if (el && imageParams.model) el.textContent = imageParams.model;
}

// Close image model dropdown when clicking outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("image-model-dropdown");
  const selector = document.getElementById("image-model-selector");
  if (
    dropdown &&
    selector &&
    !selector.contains(e.target) &&
    !dropdown.contains(e.target)
  ) {
    dropdown.classList.remove("open");
  }
});
