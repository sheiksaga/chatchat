/* ══════════════════════════════════════════════════════════════
   images.js — Image generation across cloud providers
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

/**
 * Generate an image via whichever provider {@link resolveImageProvider}
 * picks, using the OpenAI-compatible image request shape (prompt/model/
 * size/n) — the only shape this app supports, since every configured
 * provider is required to be OpenAI-compatible.
 * @param {string} prompt
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} A data: URL for the generated image
 */
async function requestImage(prompt, signal) {
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

  const body = {
    prompt: prompt,
    model: imageParams.model,
    size: imageParams.size,
    n: 1,
  };
  const response = await fetch(`${cfg.baseUrl}/images/generations`, {
    method: "POST",
    headers: imageProviderHeaders(cfg),
    body: JSON.stringify(body),
    signal: signal,
  });
  if (!response.ok) throw new Error(await apiErrorDetail(response));
  return extractImageUrl(await response.json());
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
 * @param {{raw?:boolean}} [opts] `raw` skips the summariser entirely.
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

    const dataUrl = await requestImage(
      composed.prompt,
      currentAbortController.signal,
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
   No provider-side discovery: with only the OpenAI-compatible shape
   supported, there's no clean generic way to shortlist a provider's image
   models from its plain /models list (OpenAI has ~3 known image model ids;
   NanoGPT alone has 200+, with no capability flag on the general list).
   The user just types the model id they want. */

/**
 * Open the image model id editor — a single text field pre-filled with the
 * current model, committed on Enter or blur.
 */
function openImageModelSelector() {
  const dropdown = document.getElementById("image-model-dropdown");
  if (!dropdown) return;
  if (dropdown.classList.contains("open")) {
    dropdown.classList.remove("open");
    return;
  }

  // Close sibling overlays
  document.getElementById("model-dropdown")?.classList.remove("open");
  document.getElementById("config-panel")?.classList.remove("open");

  dropdown.innerHTML = "";
  dropdown.classList.add("open");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "story-config-input image-model-input";
  input.placeholder = "Model id (e.g. gpt-image-1)";
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

/** Update visibility of the image model selector pill based on the resolved image provider. */
function updateImageModelVisibility() {
  const pill = document.getElementById("image-model-selector");
  if (!pill) return;
  const { cfg } = resolveImageProvider();
  const show = !!cfg && !!cfg.images && (!!cfg.key || !!cfg.isLocal);
  pill.classList.toggle("hidden", !show);
  // Also close the dropdown when hiding
  if (!show)
    document.getElementById("image-model-dropdown")?.classList.remove("open");
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
  if (!dropdown || !selector) return;
  const path = e.composedPath();
  if (!path.includes(dropdown) && !path.includes(selector)) {
    dropdown.classList.remove("open");
  }
});
