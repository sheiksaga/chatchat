/* ══════════════════════════════════════════════════════════════
   config.js — Sliders, config panel, sidebar toggle
   ══════════════════════════════════════════════════════════════ */

function initSliders() {
  const tempSlider = document.getElementById("temperature");
  const tempValue = document.getElementById("temp-value");
  if (tempSlider) {
    tempSlider.addEventListener("input", () => {
      apiParams.temperature = parseFloat(tempSlider.value);
      tempValue.textContent = tempSlider.value;
    });
  }

  const repSlider = document.getElementById("repetition-penalty");
  const repValue = document.getElementById("rep-value");
  if (repSlider) {
    repSlider.addEventListener("input", () => {
      apiParams.repetitionPenalty = parseFloat(repSlider.value);
      repValue.textContent = repSlider.value;
    });
  }

  applyAppearancePrefs();
  const widthSlider = document.getElementById("pref-width");
  const widthVal = document.getElementById("pref-width-val");
  if (widthSlider) {
    widthSlider.addEventListener("input", () => {
      document.documentElement.style.setProperty(
        "--content-max-width",
        widthSlider.value + "px",
      );
      if (widthVal) widthVal.textContent = widthSlider.value;
      safeSetItem("pref_content_width", widthSlider.value);
    });
  }
  const fontSlider = document.getElementById("pref-font");
  const fontVal = document.getElementById("pref-font-val");
  if (fontSlider) {
    fontSlider.addEventListener("input", () => {
      document.documentElement.style.setProperty(
        "--base-font-size",
        fontSlider.value + "px",
      );
      if (fontVal) fontVal.textContent = fontSlider.value;
      safeSetItem("pref_font_size", fontSlider.value);
    });
  }

  initProviderUI();
}

/** Apply saved appearance prefs (message width, font size) to CSS vars + sliders. */
function applyAppearancePrefs() {
  const width = localStorage.getItem("pref_content_width") || "720";
  const font = localStorage.getItem("pref_font_size") || "15";
  document.documentElement.style.setProperty(
    "--content-max-width",
    width + "px",
  );
  document.documentElement.style.setProperty("--base-font-size", font + "px");
  const ws = document.getElementById("pref-width"),
    wv = document.getElementById("pref-width-val");
  const fs = document.getElementById("pref-font"),
    fv = document.getElementById("pref-font-val");
  if (ws) ws.value = width;
  if (wv) wv.textContent = width;
  if (fs) fs.value = font;
  if (fv) fv.textContent = font;
}

/** Reset appearance prefs to defaults. */
function resetAppearancePrefs() {
  localStorage.removeItem("pref_content_width");
  localStorage.removeItem("pref_font_size");
  applyAppearancePrefs();
}

/* ── Model provider (local / cloud) ─────────────────────────────── */

/** Provider hint copy shown under the API key field, keyed by provider id. */
const PROVIDER_KEY_HINTS = {
  nanogpt: "Stored only in this browser (localStorage). Get a key at nano-gpt.com.",
  openai: "Stored only in this browser (localStorage). Get a key at platform.openai.com.",
  openrouter: "Stored only in this browser (localStorage). Get a key at openrouter.ai.",
};

/** Render the cloud provider pill row (presets + custom) into #cloud-provider-row. */
function renderCloudProviderRow() {
  const row = document.getElementById("cloud-provider-row");
  if (!row) return;
  row.innerHTML = "";

  const presetIds = ["nanogpt", "openai", "openrouter"];
  const entries = presetIds
    .map((id) => ({ id: id, label: API_PROVIDERS[id].label, custom: false }))
    .concat(
      getCustomProviders().map((p) => ({ id: p.id, label: p.label, custom: true })),
    );

  entries.forEach((entry) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-pill";
    btn.dataset.providerId = entry.id;
    btn.setAttribute("aria-pressed", String(activeProviderId === entry.id));
    if (activeProviderId === entry.id) btn.classList.add("active");
    btn.textContent = entry.label;
    btn.onclick = () => switchProvider(entry.id);
    row.appendChild(btn);

    if (entry.custom) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-del-char mini-pill-remove";
      del.title = "Remove " + entry.label;
      del.setAttribute("aria-label", "Remove " + entry.label);
      del.textContent = "×";
      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Remove provider "' + entry.label + '"?')) {
          removeCustomProvider(entry.id);
          initProviderUI();
        }
      };
      row.appendChild(del);
    }
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "mini-pill";
  addBtn.textContent = "+";
  addBtn.title = "Add custom provider";
  addBtn.onclick = () => {
    document.getElementById("add-provider-form")?.classList.toggle("hidden");
  };
  row.appendChild(addBtn);
}

/** Show/hide the cloud provider row; activates the first cloud preset if none is active yet. */
function toggleCloudRow() {
  const row = document.getElementById("cloud-provider-row");
  if (!row) return;
  const willShow = row.classList.contains("hidden");
  if (willShow && activeProviderId === "local") {
    switchProvider("nanogpt");
    return; // switchProvider() re-runs initProviderUI(), which opens the row
  }
  row.classList.toggle("hidden", !willShow);
  document.getElementById("prov-pill-cloud")?.classList.toggle("active", willShow);
  if (!willShow) document.getElementById("add-provider-form")?.classList.add("hidden");
}

/** Read the add-provider form, create the provider, activate it, and reset the form. */
function submitAddProviderForm() {
  const label = document.getElementById("add-provider-label")?.value.trim();
  const baseUrl = document.getElementById("add-provider-baseurl")?.value.trim();
  const key = document.getElementById("add-provider-key")?.value.trim();
  const wantsImages = !!document.getElementById("add-provider-images")?.checked;
  if (!label || !baseUrl) {
    showToast("Provider name and base URL are required", "error");
    return;
  }
  const id = addCustomProvider({
    label: label,
    baseUrl: baseUrl,
    key: key,
    images: wantsImages,
  });
  document.getElementById("add-provider-label").value = "";
  document.getElementById("add-provider-baseurl").value = "";
  document.getElementById("add-provider-key").value = "";
  document.getElementById("add-provider-images").checked = false;
  document.getElementById("add-provider-form")?.classList.add("hidden");
  switchProvider(id);
}

/** Reflect the active provider in the config UI (pills, key row, key value). */
function initProviderUI() {
  const local = document.getElementById("prov-pill-local");
  const cloud = document.getElementById("prov-pill-cloud");
  const isLocal = currentProvider().isLocal;
  if (local) {
    local.classList.toggle("active", isLocal);
    local.setAttribute("aria-pressed", String(isLocal));
  }
  if (cloud) {
    cloud.classList.toggle("active", !isLocal);
    cloud.setAttribute("aria-pressed", String(!isLocal));
  }
  document.getElementById("cloud-provider-row")?.classList.toggle("hidden", isLocal);

  renderCloudProviderRow();

  const keyRow = document.getElementById("provider-key-row");
  const keyInput = document.getElementById("provider-key");
  const keyHint = document.getElementById("provider-key-hint");
  if (keyRow) keyRow.style.display = isLocal ? "none" : "";
  if (keyHint) {
    keyHint.textContent =
      PROVIDER_KEY_HINTS[activeProviderId] ||
      "Stored only in this browser (localStorage).";
  }
  if (keyInput && !keyInput.dataset.wired) {
    keyInput.dataset.wired = "1";
    keyInput.addEventListener("input", () => {
      if (API_PROVIDERS[activeProviderId]) {
        saveProviderConfig(activeProviderId, { key: keyInput.value.trim() });
      } else {
        // Custom provider — key lives inline in the customProviders array.
        const list = getCustomProviders();
        const entry = list.find((p) => p.id === activeProviderId);
        if (entry) {
          entry.key = keyInput.value.trim();
          setCustomProviders(list);
        }
      }
      updateImageModelVisibility();
    });
  }
  if (keyInput) keyInput.value = currentProvider().key || "";
  updateImageModelVisibility();
}

/** Switch model provider, reset model selection, and re-check reachability. */
function switchProvider(id) {
  if (id === activeProviderId) {
    setActiveProvider(id);
    initProviderUI();
    return;
  }
  setActiveProvider(id);

  // Model lists differ between providers — clear the current selection so the
  // user re-picks a valid model for this provider.
  if (selectedModel) {
    selectedModel = "";
    localStorage.removeItem("selectedModel");
    const nameEl = document.getElementById("current-model-name");
    if (nameEl) nameEl.textContent = "Select Model";
    if (typeof idleTimer !== "undefined" && idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (typeof updateEjectButton === "function") updateEjectButton();
  }

  initProviderUI();

  // Refresh the offline banner against the new provider.
  if (typeof offlineBanner !== "undefined" && offlineBanner) {
    offlineBanner.remove();
    offlineBanner = null;
  }
  if (typeof checkAPIHealth === "function") checkAPIHealth();

  updateImageModelVisibility();

  showToast("Switched to " + currentProvider().label, "success");
}

function toggleConfig() {
  const panel = document.getElementById("config-panel");
  // Close the sibling overlay so the two panels never overlap.
  document.getElementById("model-dropdown")?.classList.remove("open");
  panel.classList.toggle("open");
  // Ensure close button exists
  if (
    panel.classList.contains("open") &&
    !panel.querySelector(".config-panel-close")
  ) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "config-panel-close";
    closeBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.setAttribute("aria-label", "Close configuration");
    closeBtn.title = "Close";
    closeBtn.onclick = () => panel.classList.remove("open");
    panel.appendChild(closeBtn);
  }
}

/** Toggle the sidebar between expanded and collapsed (icon-rail). */
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

// Global escape key handler: close panels and dropdowns
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const panel = document.getElementById("config-panel");
    const dropdown = document.getElementById("model-dropdown");
    const storyOverlay = document.getElementById("story-settings-overlay");
    if (storyOverlay) {
      closeStorySettings();
      document.getElementById("edit-story-btn")?.focus();
      return;
    }
    if (panel && panel.classList.contains("open")) {
      panel.classList.remove("open");
      document.getElementById("config-btn")?.focus();
    }
    if (dropdown && dropdown.classList.contains("open")) {
      dropdown.classList.remove("open");
      document.getElementById("model-selector")?.focus();
    }
  }
});
document.addEventListener("click", (e) => {
  const panel = document.getElementById("config-panel");
  const btn = document.getElementById("config-btn");
  if (!panel || !btn || !panel.classList.contains("open")) return;
  // composedPath() is captured at dispatch time, before any handler on the
  // path (e.g. a provider pill's onclick rebuilding its own row) can detach
  // the clicked element — plain `panel.contains(e.target)` would see a
  // stale/detached target and false-positive as "clicked outside".
  const path = e.composedPath();
  if (!path.includes(panel) && !path.includes(btn)) {
    panel.classList.remove("open");
  }
});
