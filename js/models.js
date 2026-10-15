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
 */
function renderModelDropdownList(dropdown, ids, selectedId, onSelect) {
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
    const filtered = q ? ids.filter((id) => id.toLowerCase().includes(q)) : ids;
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
      item.textContent = id;
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
 * Apply an RP model profile's sampling params to state + sliders.
 * @param {?object} profile
 */
function applyModelProfile(profile) {
  if (profile) {
    if (profile.temperature != null) {
      apiParams.temperature = profile.temperature;
      const tempSlider = document.getElementById("temperature");
      const tempValue = document.getElementById("temp-value");
      if (tempSlider) tempSlider.value = profile.temperature;
      if (tempValue) tempValue.textContent = profile.temperature;
    }
    if (profile.repetitionPenalty != null) {
      apiParams.repetitionPenalty = profile.repetitionPenalty;
      const repSlider = document.getElementById("repetition-penalty");
      const repValue = document.getElementById("rep-value");
      if (repSlider) repSlider.value = profile.repetitionPenalty;
      if (repValue) repValue.textContent = profile.repetitionPenalty;
    }
    // top_p / top_k / min_p have no slider UI; carry them straight into the
    // request params.
    apiParams.topP = profile.top_p != null ? profile.top_p : undefined;
    apiParams.topK = profile.top_k != null ? profile.top_k : undefined;
    apiParams.minP = profile.min_p != null ? profile.min_p : undefined;
  } else {
    // No profile for this model — clear any params inherited from a previous one.
    apiParams.topP = undefined;
    apiParams.topK = undefined;
    apiParams.minP = undefined;
  }
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
    // Still cache, so switching models does not re-probe every time.
    const cached = safeGetJSON(`rp_profile_${modelId}`, null);
    if (cached) return cached;
    const fromProps = await fetchPropsProfile(provider);
    if (fromProps) safeSetItem(`rp_profile_${modelId}`, JSON.stringify(fromProps));
    return fromProps;
  }

  const profile = RP_MODELS[modelId];
  if (!profile) return null;
  const cacheKey = `rp_profile_${modelId}`;
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
