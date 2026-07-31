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
    const response = await fetch(`${API_BASE}/models`, {
      headers: apiHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = data.data || [];

    dropdown.innerHTML = "";

    if (models.length === 0) {
      const empty = currentProvider().isLocal
        ? "No models loaded in LM Studio"
        : "No models returned by provider";
      dropdown.innerHTML = `<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">${empty}</div>`;
      return;
    }

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
        ? models.filter((m) => m.id.toLowerCase().includes(q))
        : models;
      if (!filtered.length) {
        listEl.innerHTML =
          '<div class="model-dropdown-item" style="color:var(--text-muted);pointer-events:none;">No matches</div>';
        return;
      }
      filtered.forEach((model, i) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "model-dropdown-item";
        item.setAttribute("role", "option");
        item.textContent = model.id;
        if (model.id === selectedModel) {
          item.classList.add("active");
          item.setAttribute("aria-selected", "true");
        }
        item.onclick = () => selectModel(model.id);
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
  } catch (err) {
    dropdown.innerHTML = `<div class="model-dropdown-item" style="color:var(--danger);">Error: ${err.message}</div>`;
  }
}

// Arrow-key navigation within the model dropdown (Enter/Space fire the native button click).
document.getElementById("model-dropdown")?.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = Array.from(
    document.querySelectorAll("#model-dropdown .model-dropdown-item"),
  ).filter((el) => el.tagName === "BUTTON");
  if (!items.length) return;
  e.preventDefault();
  const current = document.activeElement;
  let idx = items.indexOf(current);
  if (e.key === "ArrowDown") idx = (idx + 1) % items.length;
  else idx = (idx - 1 + items.length) % items.length;
  items[idx].focus();
});

/**
 * Select and load a model, applying RP profiles if available.
 * @param {string} modelId
 */
async function selectModel(modelId) {
  const nameEl = document.getElementById("current-model-name");
  const selectorEl = document.getElementById("model-selector");

  document.getElementById("model-dropdown").classList.remove("open");

  // Cloud providers (OpenAI-compatible) have no load/unload lifecycle — just select.
  if (!currentProvider().isLocal) {
    selectedModel = modelId;
    safeSetItem("selectedModel", modelId);
    nameEl.textContent = modelId;
    resetIdleTimer();
    updateEjectButton();
    const cloudProfile = await fetchModelProfile(modelId);
    applyModelProfile(cloudProfile);
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
    // top_p / top_k have no slider UI; carry them straight into the request params.
    apiParams.topP = profile.top_p != null ? profile.top_p : undefined;
    apiParams.topK = profile.top_k != null ? profile.top_k : undefined;
  } else {
    // No profile for this model — clear any params inherited from a previous one.
    apiParams.topP = undefined;
    apiParams.topK = undefined;
  }
}

/** Show or hide the eject button based on whether a model is loaded */
function updateEjectButton() {
  const btn = document.getElementById("btn-eject");
  if (btn) btn.classList.toggle("hidden", !selectedModel);
}

/** Manually unload the current model (local) or clear the cloud selection. */
async function unloadModel() {
  if (!selectedModel) return;
  if (currentProvider().isLocal) {
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
  const profile = RP_MODELS[modelId];
  if (!profile) return null;
  const cacheKey = `rp_profile_${modelId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

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
