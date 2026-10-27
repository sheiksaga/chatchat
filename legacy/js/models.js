/* ══════════════════════════════════════════════════════════════
   models.js — Model selector, unload, RP profiles, idle timer
   ══════════════════════════════════════════════════════════════ */

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!selectedModel) return;
  idleTimer = setTimeout(async () => {
    if (currentProvider().isLocal) {
      try {
        await fetch(`${API_BASE}/models/unload`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ model: selectedModel }),
        });
      } catch (e) {
        /* ignore */
      }
    }
    selectedModel = "";
    localStorage.removeItem("selectedModel");
    const nameEl = document.getElementById("current-model-name");
    if (nameEl) nameEl.textContent = "Select Model";
    idleTimer = null;
    updateEjectButton();
  }, IDLE_TIMEOUT);
}

/**
 * Render a filterable, keyboard-navigable list of model ids into `dropdown`
 * (which must already be empty). Shared by the text and image model
 * selectors so both stay consistent.
 * @param {HTMLElement} dropdown
 * @param {string[]} ids
 * @param {string} selectedId
 * @param {(id:string) => void} onSelect
 * @param {{badgeFor?: (id:string) => string, labelFor?: (id:string) => string}} [opts]
 *   Optional per-row badge (e.g. an image model's style) rendered at the end of
 *   the row, and an optional friendly-name callback whose return value becomes
 *   the visible row text. The raw id stays authoritative everywhere else: it
 *   remains in `dataset.modelId` / `title`, it is still what `onSelect`
 *   receives, and filtering matches the raw id *or* the friendly label. Without
 *   `labelFor` the row text is the id, i.e. the old behaviour.
 */
function renderModelDropdownList(dropdown, ids, selectedId, onSelect, opts) {
  // Type-to-filter box (sticky at top of the dropdown).
  const filter = document.createElement("input");
  filter.type = "text";
  filter.className = "model-filter-input";
  filter.placeholder = "Filter models…";
  filter.setAttribute("aria-label", "Filter models");
  dropdown.appendChild(filter);

  const listEl = document.createElement("div");
  listEl.className = "model-dropdown-list";
  dropdown.appendChild(listEl);

  function renderList(query) {
    const q = (query || "").toLowerCase();
    listEl.innerHTML = "";
    const filtered = q
      ? ids.filter(
          (id) =>
            id.toLowerCase().includes(q) ||
            // ALSO filter on the friendly name so "Anima Turbo" finds
            // `anima-turbo-v1.1.safetensors`. No labelFor means no second
            // test, so text-model filtering is unchanged.
            (typeof opts?.labelFor === "function" &&
              String(opts.labelFor(id) || "")
                .toLowerCase()
                .includes(q)),
        )
      : ids;
    if (!filtered.length) {
      listEl.innerHTML =
        '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">No matches</div>';
      return;
    }
    filtered.forEach((id, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "model-dropdown-item";
      item.setAttribute("role", "option");
      // Stable handle for tests and for anything that must target a model
      // whose id contains dots, slashes, or spaces.
      item.dataset.modelId = id;
      // Friendly text for humans, raw id for anything that has to find or
      // identify the row later.
      const label =
        typeof opts?.labelFor === "function" ? opts.labelFor(id) : id;
      item.textContent = label || id;
      item.title = id;
      if (opts && typeof opts.badgeFor === "function") {
        const badge = opts.badgeFor(id);
        if (badge) {
          const badgeEl = document.createElement("span");
          badgeEl.className = "model-dropdown-badge";
          badgeEl.textContent = badge;
          item.appendChild(badgeEl);
        }
      }
      if (id === selectedId) {
        item.classList.add("active");
        item.setAttribute("aria-selected", "true");
      }
      item.onclick = () => onSelect(id);
      // Cap the stagger so long cloud lists don't animate for seconds.
      if (i < 12)
        item.style.animation = `dropdownItemIn 200ms ${i * 40}ms both cubic-bezier(0.34, 1.56, 0.64, 1)`;
      listEl.appendChild(item);
    });
  }

  renderList("");
  filter.addEventListener("input", () => renderList(filter.value));
  filter.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      listEl.querySelector("button.model-dropdown-item")?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      listEl.querySelector("button.model-dropdown-item")?.click();
    }
  });
  filter.focus();
}

/**
 * Arrow-key navigation within a model dropdown (Enter/Space fire the native
 * button click) — shared by the text and image model selectors.
 * @param {string} dropdownId
 */
function attachModelDropdownKeyNav(dropdownId) {
  document.getElementById(dropdownId)?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      document.querySelectorAll(`#${dropdownId} .model-dropdown-item`),
    ).filter((el) => el.tagName === "BUTTON");
    if (!items.length) return;
    e.preventDefault();
    const current = document.activeElement;
    let idx = items.indexOf(current);
    if (e.key === "ArrowDown") idx = (idx + 1) % items.length;
    else idx = (idx - 1 + items.length) % items.length;
    items[idx].focus();
  });
}

/**
 * Open model selector dropdown, fetch model list from LM Studio.
 */
async function openModelSelector() {
  const dropdown = document.getElementById("model-dropdown");
  if (dropdown.classList.contains("open")) {
    dropdown.classList.remove("open");
    return;
  }

  // Close the sibling overlay so the two panels never overlap.
  document.getElementById("config-panel")?.classList.remove("open");

  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Available models");
  dropdown.innerHTML =
    '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">Loading models...</div>';
  dropdown.classList.add("open");

  try {
    const response = await fetchApi(`${API_BASE}/models`, {
      headers: apiHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = data.data || [];

    dropdown.innerHTML = "";

    if (models.length === 0) {
      if (currentProvider().isLocal) {
        dropdown.innerHTML = `<div class="model-dropdown-empty">
          No models loaded in LM Studio yet.
          <div class="settings-hint">
            Search Hugging Face for a GGUF chat model (e.g. "Llama-3.1-8B-Instruct-GGUF")
            and download it from LM Studio's Discover tab.
          </div>
          <a href="https://huggingface.co/models?library=gguf&sort=trending" target="_blank" rel="noopener">Browse GGUF models on Hugging Face</a>
        </div>`;
      } else {
        dropdown.innerHTML =
          '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">No models returned by provider</div>';
      }
      return;
    }

    renderModelDropdownList(
      dropdown,
      models.map((m) => m.id),
      selectedModel,
      selectModel,
    );
  } catch (err) {
    dropdown.innerHTML = `<div class="model-dropdown-empty model-dropdown-error" style="color:var(--danger);">${escapeHtml(err.message)}</div>`;
  }
}

attachModelDropdownKeyNav("model-dropdown");

/**
 * Select and load a model, applying RP profiles if available.
 * @param {string} modelId
 */
async function selectModel(modelId) {
  const nameEl = document.getElementById("current-model-name");
  const selectorEl = document.getElementById("model-selector");

  document.getElementById("model-dropdown").classList.remove("open");

  // No load/unload lifecycle: cloud providers have no such endpoints, and
  // llama.cpp has none at all — a request naming a model *is* the load. Either
  // way, selecting is all there is to do here.
  if (!currentProvider().isLocal || currentProvider().loadLifecycle === false) {
    selectedModel = modelId;
    safeSetItem("selectedModel", modelId);
    nameEl.textContent = modelId;
    resetIdleTimer();
    updateEjectButton();
    applyModelProfile(await fetchModelProfile(modelId));

    // On an on-demand server the load happens on the next request, so say so
    // rather than let a 30-second first reply look like a hang.
    if (currentProvider().loadLifecycle === false && currentProvider().isLocal) {
      showToast(`${modelId} loads on first reply — this can take ~10-30s.`);
    }
    return;
  }

  nameEl.textContent = `Loading ${modelId}...`;
  selectorEl.classList.add("loading");
  disableInputs(true);

  // Unload previous model if there is one
  if (selectedModel) {
    try {
      await fetch(`${API_BASE}/models/unload`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ model: selectedModel }),
      });
    } catch (e) {
      /* ignore */
    }
  }

  try {
    // Request load of the new model
    await fetch(`${API_BASE}/models/load`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ model: modelId }),
    });

    selectedModel = modelId;
    safeSetItem("selectedModel", modelId);
    nameEl.textContent = modelId;
  } catch (err) {
    console.error("Failed to load model: ", err);
    showToast(
      `Model load failed: ${err.message}. Inference will trigger auto-load.`,
      "error",
    );
    // Fallback: set it anyway (inference call will trigger load if load endpoint failed)
    selectedModel = modelId;
    safeSetItem("selectedModel", modelId);
    nameEl.textContent = modelId;
  } finally {
    selectorEl.classList.remove("loading");
    disableInputs(false);
    resetIdleTimer();
  }

  // Fetch and apply RP model profile if available
  const profile = await fetchModelProfile(modelId);
  applyModelProfile(profile);
  updateEjectButton();
}

/**
 * Format a sampler value for the narrow slider readout. llama.cpp reports
 * float32s (1.1699999570846558), which would otherwise fill the label.
 * @param {number|string} value
 * @returns {string}
 */
function formatSamplerValue(value) {
  const text = Number(value).toFixed(2);
  return text.endsWith("0") ? text.slice(0, -1) : text;
}

/**
 * Reflect apiParams (or "auto") in the two sampler sliders.
 *
 * "auto" means the value is not sent at all; the server's launch preset is
 * authoritative. Moving a slider replaces it with a concrete override.
 */
function renderSamplerSliders() {
  const tempSlider = document.getElementById("temperature");
  const tempValue = document.getElementById("temp-value");
  if (tempSlider && tempValue) {
    if (temperatureAuto) {
      tempSlider.value = tempSlider.defaultValue || "0.7";
      tempValue.textContent = "auto";
    } else {
      tempSlider.value = apiParams.temperature;
      tempValue.textContent = formatSamplerValue(apiParams.temperature);
    }
  }

  const repSlider = document.getElementById("repetition-penalty");
  const repValue = document.getElementById("rep-value");
  if (repSlider && repValue) {
    if (repetitionAuto) {
      repSlider.value = repSlider.defaultValue || "1.1";
      repValue.textContent = "auto";
    } else {
      repSlider.value = apiParams.repetitionPenalty;
      repValue.textContent = formatSamplerValue(apiParams.repetitionPenalty);
    }
  }
}

/**
 * Apply an RP model profile's sampling params to state + sliders.
 * @param {?object} profile
 */
function applyModelProfile(profile) {
  const llamaCpp = currentProvider().samplerSource === "props";

  if (profile) {
    if (profile.temperature != null) {
      apiParams.temperature = profile.temperature;
      temperatureAuto = false;
      temperatureUserSet = false;
    } else if (!temperatureUserSet) {
      temperatureAuto = llamaCpp;
      if (!llamaCpp) apiParams.temperature = 0.7;
    }
    if (profile.repetitionPenalty != null) {
      apiParams.repetitionPenalty = profile.repetitionPenalty;
      repetitionAuto = false;
      repetitionUserSet = false;
    } else if (!repetitionUserSet) {
      repetitionAuto = llamaCpp;
      if (!llamaCpp) apiParams.repetitionPenalty = 1.1;
    }
    // top_p / top_k / min_p have no slider UI; carry them straight into the
    // request params.
    apiParams.topP = profile.top_p != null ? profile.top_p : undefined;
    apiParams.topK = profile.top_k != null ? profile.top_k : undefined;
    apiParams.minP = profile.min_p != null ? profile.min_p : undefined;
  } else {
    // No profile for this model. On llama.cpp let the server's preset win; a
    // cloud provider keeps the app's 0.7/1.1 defaults.
    if (!temperatureUserSet) {
      temperatureAuto = llamaCpp;
      if (!llamaCpp) apiParams.temperature = 0.7;
    }
    if (!repetitionUserSet) {
      repetitionAuto = llamaCpp;
      if (!llamaCpp) apiParams.repetitionPenalty = 1.1;
    }
    apiParams.topP = undefined;
    apiParams.topK = undefined;
    apiParams.minP = undefined;
  }

  renderSamplerSliders();
}

/**
 * Show or hide the eject button.
 *
 * Ejecting means "unload", which only exists on a provider that owns a model
 * lifecycle. On llama.cpp the button would fire a request that 404s and leave
 * the model resident anyway — a control that visibly does nothing is worse
 * than no control, so it is hidden instead.
 */
function updateEjectButton() {
  const btn = document.getElementById("btn-eject");
  const canUnload = currentProvider().loadLifecycle !== false;
  if (btn) btn.classList.toggle("hidden", !selectedModel || !canUnload);
}

/** Manually unload the current model (local) or clear the cloud selection. */
async function unloadModel() {
  if (!selectedModel) return;
  // Only a provider that owns a model lifecycle can actually unload. On
  // llama.cpp this is a no-op server-side, so just drop the selection.
  if (currentProvider().isLocal && currentProvider().loadLifecycle !== false) {
    try {
      await fetch(`${API_BASE}/models/unload`, {
        method: "POST",
        headers: apiHeaders(),
        body: "{}",
      });
    } catch (e) {
      /* ignore */
    }
  }
  selectedModel = "";
  localStorage.removeItem("selectedModel");
  const nameEl = document.getElementById("current-model-name");
  if (nameEl) nameEl.textContent = "Select Model";
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  updateEjectButton();
}

async function fetchModelProfile(modelId) {
  const provider = currentProvider();

  // A server that reports its own sampler defaults is authoritative; nothing
  // scraped from a README can know how this particular model was launched.
  if (provider.samplerSource === "props") {
    // No cache: a preset edit should take effect the next time the model is
    // picked, and a router may not have sampler values until the model is
    // loaded. One /props call per selection is cheap.
    return await fetchPropsProfile(provider, modelId);
  }

  const profile = RP_MODELS[modelId];
  if (!profile) return null;
  const cacheKey = `rp_profile_v2_${modelId}`;
  // safeGetJSON, not a raw parse: a corrupt cache value would otherwise throw
  // out of model selection.
  const cached = safeGetJSON(cacheKey, null);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://huggingface.co/${profile.hfRepo}/raw/main/README.md`,
    );
    if (!resp.ok) return null;
    const text = await resp.text();
    const params = {};
    const tempMatch = text.match(/temperature[:\s]*([\d.]+)/i);
    const topPMatch = text.match(/top_p[:\s]*([\d.]+)/i);
    const topKMatch = text.match(/top_k[:\s]*(\d+)/i);
    const repMatch = text.match(/repeat(?:ition)?[_\s]*penalty[:\s]*([\d.]+)/i);
    if (tempMatch) params.temperature = parseFloat(tempMatch[1]);
    if (topPMatch) params.top_p = parseFloat(topPMatch[1]);
    if (topKMatch) params.top_k = parseInt(topKMatch[1]);
    if (repMatch) params.repetitionPenalty = parseFloat(repMatch[1]);
    safeSetItem(cacheKey, JSON.stringify(params));
    return params;
  } catch (e) {
    return null;
  }
}

// Close model dropdown when clicking outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("model-dropdown");
  const selector = document.getElementById("model-selector");
  if (
    dropdown &&
    selector &&
    !selector.contains(e.target) &&
    !dropdown.contains(e.target)
  ) {
    dropdown.classList.remove("open");
  }
});

// Initialize model name on load
document.addEventListener("DOMContentLoaded", () => {
  if (selectedModel) {
    const nameEl = document.getElementById("current-model-name");
    if (nameEl) nameEl.textContent = selectedModel;

    // Restore the saved model's profile before the first reply. Without this,
    // a reload would silently fall back to the app's old 0.7/1.1 defaults.
    fetchModelProfile(selectedModel)
      .then((profile) => applyModelProfile(profile))
      .catch(() => {});
  }
  updateEjectButton();
});

// Clean up idle timer on unload
window.addEventListener("beforeunload", () => {
  if (idleTimer) clearTimeout(idleTimer);
});

/* ══════════════════════════════════════════════════════════════
   Offline detection — periodic health check
   ══════════════════════════════════════════════════════════════ */
let offlineBanner = null;

function showOfflineBanner() {
  if (offlineBanner) return;
  offlineBanner = document.createElement("div");
  offlineBanner.className = "offline-banner";
  const icon = document.createElement("span");
  icon.className = "offline-banner-icon";
  icon.textContent = "\u26A0";
  const text = document.createElement("span");
  text.textContent = currentProvider().label + " is unreachable";
  offlineBanner.append(icon, text);
  document.body.prepend(offlineBanner);
}

async function checkAPIHealth() {
  try {
    const resp = await fetch(`${API_BASE}/models`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      if (offlineBanner) {
        offlineBanner.remove();
        offlineBanner = null;
      }
    } else {
      showOfflineBanner();
    }
  } catch (e) {
    showOfflineBanner();
  }
}

function startOfflineDetection() {
  checkAPIHealth();
  setInterval(checkAPIHealth, 15000); // every 15s
}
