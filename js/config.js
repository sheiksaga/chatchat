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

/* ── Model providers (text + image, independently selectable) ──────
   Each "kind" ('text' | 'image') gets its own pill row + detail panel
   (Base URL/API key), rendered generically from PROVIDER_KIND below.
   Text switches trigger model-reset/health-check side effects that
   don't apply to images, so switchProvider() stays kind-specific. */

/** Provider hint copy shown under the API key field, keyed by provider id. */
const PROVIDER_KEY_HINTS = {
  local:
    "LM Studio needs no key. Point Base URL at another machine's address to use it over your LAN.",
  local_image:
    "No key needed. Point Base URL at another machine's address to use it over your LAN — see Help for setup steps.",
  nanogpt: "Get a key at nano-gpt.com.",
  openai: "Get a key at platform.openai.com.",
  openrouter: "Get a key at openrouter.ai.",
};

/** Per-kind DOM ids and form field ids driving the generic render functions. */
const PROVIDER_KIND = {
  text: {
    row: "provider-row-text",
    detail: "provider-detail-text",
    form: "add-provider-form-text",
    formLabel: "add-provider-label-text",
    formBaseUrl: "add-provider-baseurl-text",
    formKey: "add-provider-key-text",
    formAltFlag: "add-provider-images-text",
    formLocalFlag: "add-provider-local-text",
    altField: "images",
    listProviders: getChatCapableProviders,
    hasAuto: false,
  },
  image: {
    row: "provider-row-image",
    detail: "provider-detail-image",
    form: "add-provider-form-image",
    formLabel: "add-provider-label-image",
    formBaseUrl: "add-provider-baseurl-image",
    formKey: "add-provider-key-image",
    formAltFlag: "add-provider-chat-image",
    formLocalFlag: "add-provider-local-image",
    altField: "chat",
    listProviders: getImageCapableProviders,
    hasAuto: true,
  },
};

/** The active provider id for a kind ('auto' is only meaningful for images). */
function activeProviderIdFor(kind) {
  return kind === "image" ? activeImageProviderId || "auto" : activeProviderId;
}

/** Render the pill row for a provider kind ('text' | 'image'). */
function renderProviderRow(kind) {
  const spec = PROVIDER_KIND[kind];
  const row = document.getElementById(spec.row);
  if (!row) return;
  row.innerHTML = "";
  const activeId = activeProviderIdFor(kind);

  if (spec.hasAuto) {
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "mini-pill";
    const isActive = activeId === "auto";
    auto.setAttribute("aria-pressed", String(isActive));
    if (isActive) auto.classList.add("active");
    auto.textContent = "Auto";
    auto.title =
      "Follow the text provider when it supports images, or the only other configured image provider";
    auto.onclick = () => selectProvider(kind, "auto");
    row.appendChild(auto);
  }

  spec.listProviders().forEach((cfg) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-pill";
    btn.dataset.providerId = cfg.id;
    const isActive = activeId === cfg.id;
    btn.setAttribute("aria-pressed", String(isActive));
    if (isActive) btn.classList.add("active");
    btn.textContent = cfg.label;
    btn.onclick = () => selectProvider(kind, cfg.id);
    row.appendChild(btn);

    if (!API_PROVIDERS[cfg.id]) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-del-char mini-pill-remove";
      del.title = "Remove " + cfg.label;
      del.setAttribute("aria-label", "Remove " + cfg.label);
      del.textContent = "×";
      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Remove provider "' + cfg.label + '"?')) {
          removeCustomProvider(cfg.id);
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
    document.getElementById(spec.form)?.classList.toggle("hidden");
  };
  row.appendChild(addBtn);
}

/** Render the Base URL / API key detail panel for whichever provider is active in this kind. */
function renderProviderDetail(kind) {
  const spec = PROVIDER_KIND[kind];
  const detail = document.getElementById(spec.detail);
  if (!detail) return;
  detail.innerHTML = "";

  const id = activeProviderIdFor(kind);
  if (kind === "image" && id === "auto") {
    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent =
      "Uses the text provider's image support when available, or the only other configured image provider if there's exactly one.";
    detail.appendChild(hint);
    return;
  }

  const cfg = getProviderConfig(id);
  const isCustom = !API_PROVIDERS[id];

  const baseUrlLabel = document.createElement("label");
  baseUrlLabel.className = "settings-label";
  const baseUrlId = "provider-detail-baseurl-" + kind;
  baseUrlLabel.htmlFor = baseUrlId;
  baseUrlLabel.textContent = "Base URL";
  const baseUrlInput = document.createElement("input");
  baseUrlInput.type = "text";
  baseUrlInput.id = baseUrlId;
  baseUrlInput.className = "story-config-input";
  baseUrlInput.autocomplete = "off";
  baseUrlInput.spellcheck = false;
  baseUrlInput.value = cfg.baseUrl;
  baseUrlInput.addEventListener("change", () => {
    const val = baseUrlInput.value.trim();
    if (!val) {
      baseUrlInput.value = cfg.baseUrl;
      return;
    }
    if (isCustom) updateCustomProvider(id, { baseUrl: val });
    else saveProviderConfig(id, { baseUrl: val });
  });

  const keyLabel = document.createElement("label");
  keyLabel.className = "settings-label";
  const keyId = "provider-detail-key-" + kind;
  keyLabel.htmlFor = keyId;
  keyLabel.textContent = "API Key";
  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.id = keyId;
  keyInput.className = "story-config-input";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.placeholder = cfg.isLocal
    ? "Optional for local/LAN servers"
    : "Paste your API key";
  keyInput.value = cfg.key || "";
  keyInput.addEventListener("input", () => {
    if (isCustom) updateCustomProvider(id, { key: keyInput.value.trim() });
    else saveProviderConfig(id, { key: keyInput.value.trim() });
  });

  const hint = document.createElement("div");
  hint.className = "settings-hint";
  hint.textContent =
    (PROVIDER_KEY_HINTS[id] ? PROVIDER_KEY_HINTS[id] + " " : "") +
    "Stored only in this browser (localStorage).";

  detail.appendChild(baseUrlLabel);
  detail.appendChild(baseUrlInput);
  detail.appendChild(keyLabel);
  detail.appendChild(keyInput);
  detail.appendChild(hint);
}

/** Select the provider for a kind. Text switches carry extra side effects (model reset, health check). */
function selectProvider(kind, id) {
  if (kind === "text") {
    switchProvider(id);
    return;
  }
  setActiveImageProvider(id);
  renderProviderRow("image");
  renderProviderDetail("image");
  const label = id === "auto" ? "Auto" : getProviderConfig(id).label;
  showToast("Image provider: " + label, "success");
}

/** Read an add-provider form, create the provider, activate it, and reset the form. */
function submitAddProviderForm(kind) {
  const spec = PROVIDER_KIND[kind];
  const label = document.getElementById(spec.formLabel)?.value.trim();
  const baseUrl = document.getElementById(spec.formBaseUrl)?.value.trim();
  const key = document.getElementById(spec.formKey)?.value.trim();
  const altFlag = !!document.getElementById(spec.formAltFlag)?.checked;
  const isLocalFlag = !!document.getElementById(spec.formLocalFlag)?.checked;
  if (!label || !baseUrl) {
    showToast("Provider name and base URL are required", "error");
    return;
  }
  const cfg = {
    label: label,
    baseUrl: baseUrl,
    key: key,
    isLocal: isLocalFlag,
    chat: kind === "text" ? true : altFlag,
    images: kind === "image" ? true : altFlag,
  };
  const id = addCustomProvider(cfg);
  document.getElementById(spec.formLabel).value = "";
  document.getElementById(spec.formBaseUrl).value = "";
  document.getElementById(spec.formKey).value = "";
  document.getElementById(spec.formAltFlag).checked = false;
  document.getElementById(spec.formLocalFlag).checked = false;
  document.getElementById(spec.form)?.classList.add("hidden");
  selectProvider(kind, id);
}

/** Reflect both active providers in the config UI (pills + detail panels). */
function initProviderUI() {
  renderProviderRow("text");
  renderProviderDetail("text");
  renderProviderRow("image");
  renderProviderDetail("image");
}

/** Switch the text/chat provider, reset model selection, and re-check reachability. */
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

/**
 * Toggle the sidebar.
 * On mobile/tablet (< 1024px): overlay slides in from left with backdrop.
 * On desktop (>= 1024px): collapse to narrow icon rail.
 */
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const isDesktop = window.matchMedia("(min-width: 1024px)").matches;

  if (isDesktop) {
    sidebar.classList.toggle("collapsed");
  } else {
    // Mobile/tablet overlay mode
    const isOpen = sidebar.classList.contains("open");
    if (isOpen) {
      closeSidebar();
    } else {
      sidebar.classList.add("open");
      if (backdrop) backdrop.classList.add("visible");
      // Focus the sidebar for keyboard nav
      sidebar.querySelector(".btn-new-chat")?.focus();
    }
  }
}

/** Close the mobile sidebar overlay. */
function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("visible");
  // Return focus to the hamburger
  document.querySelector(".mobile-menu-btn")?.focus();
}

// Global escape key handler: close panels and dropdowns
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const sidebar = document.getElementById("sidebar");
    const panel = document.getElementById("config-panel");
    const dropdown = document.getElementById("model-dropdown");
    const storyOverlay = document.getElementById("story-settings-overlay");
    const helpOverlay = document.getElementById("help-overlay");

    // Close sidebar overlay first (mobile/tablet)
    if (sidebar && sidebar.classList.contains("open")) {
      closeSidebar();
      return;
    }

    if (helpOverlay) {
      closeHelp();
      document.getElementById("help-btn")?.focus();
      return;
    }
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
