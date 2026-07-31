/* ══════════════════════════════════════════════════════════════
   config.js — Sliders, config panel, sidebar toggle
   ══════════════════════════════════════════════════════════════ */

function initSliders() {
    const tempSlider = document.getElementById('temperature');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider) {
        tempSlider.addEventListener('input', () => {
            apiParams.temperature = parseFloat(tempSlider.value);
            tempValue.textContent = tempSlider.value;
        });
    }

    const repSlider = document.getElementById('repetition-penalty');
    const repValue = document.getElementById('rep-value');
    if (repSlider) {
        repSlider.addEventListener('input', () => {
            apiParams.repetitionPenalty = parseFloat(repSlider.value);
            repValue.textContent = repSlider.value;
        });
    }

    applyAppearancePrefs();
    const widthSlider = document.getElementById('pref-width');
    const widthVal = document.getElementById('pref-width-val');
    if (widthSlider) {
        widthSlider.addEventListener('input', () => {
            document.documentElement.style.setProperty('--content-max-width', widthSlider.value + 'px');
            if (widthVal) widthVal.textContent = widthSlider.value;
            safeSetItem('pref_content_width', widthSlider.value);
        });
    }
    const fontSlider = document.getElementById('pref-font');
    const fontVal = document.getElementById('pref-font-val');
    if (fontSlider) {
        fontSlider.addEventListener('input', () => {
            document.documentElement.style.setProperty('--base-font-size', fontSlider.value + 'px');
            if (fontVal) fontVal.textContent = fontSlider.value;
            safeSetItem('pref_font_size', fontSlider.value);
        });
    }

    initProviderUI();
}

/** Apply saved appearance prefs (message width, font size) to CSS vars + sliders. */
function applyAppearancePrefs() {
    const width = localStorage.getItem('pref_content_width') || '720';
    const font = localStorage.getItem('pref_font_size') || '15';
    document.documentElement.style.setProperty('--content-max-width', width + 'px');
    document.documentElement.style.setProperty('--base-font-size', font + 'px');
    const ws = document.getElementById('pref-width'), wv = document.getElementById('pref-width-val');
    const fs = document.getElementById('pref-font'), fv = document.getElementById('pref-font-val');
    if (ws) ws.value = width; if (wv) wv.textContent = width;
    if (fs) fs.value = font; if (fv) fv.textContent = font;
}

/** Reset appearance prefs to defaults. */
function resetAppearancePrefs() {
    localStorage.removeItem('pref_content_width');
    localStorage.removeItem('pref_font_size');
    applyAppearancePrefs();
}

/* ── Model provider (local / cloud) ─────────────────────────────── */

/** Reflect the active provider in the config UI (pills, key row, key value). */
function initProviderUI() {
    const local = document.getElementById('prov-pill-local');
    const nano = document.getElementById('prov-pill-nanogpt');
    if (local) { local.classList.toggle('active', activeProviderId === 'local'); local.setAttribute('aria-pressed', String(activeProviderId === 'local')); }
    if (nano) { nano.classList.toggle('active', activeProviderId === 'nanogpt'); nano.setAttribute('aria-pressed', String(activeProviderId === 'nanogpt')); }

    const keyRow = document.getElementById('provider-key-row');
    const keyInput = document.getElementById('provider-key');
    if (keyRow) keyRow.style.display = currentProvider().isLocal ? 'none' : '';
    if (keyInput && !keyInput.dataset.wired) {
        keyInput.dataset.wired = '1';
        keyInput.addEventListener('input', () => {
            saveProviderConfig(activeProviderId, { key: keyInput.value.trim() });
        });
    }
    if (keyInput) keyInput.value = currentProvider().key || '';
}

/** Switch model provider, reset model selection, and re-check reachability. */
function switchProvider(id) {
    if (!API_PROVIDERS[id] || id === activeProviderId) {
        setActiveProvider(id);
        initProviderUI();
        return;
    }
    setActiveProvider(id);

    // Model lists differ between providers — clear the current selection so the
    // user re-picks a valid model for this provider.
    if (selectedModel) {
        selectedModel = '';
        localStorage.removeItem('selectedModel');
        const nameEl = document.getElementById('current-model-name');
        if (nameEl) nameEl.textContent = 'Select Model';
        if (typeof idleTimer !== 'undefined' && idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (typeof updateEjectButton === 'function') updateEjectButton();
    }

    initProviderUI();

    // Refresh the offline banner against the new provider.
    if (typeof offlineBanner !== 'undefined' && offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
    if (typeof checkAPIHealth === 'function') checkAPIHealth();

    showToast('Switched to ' + currentProvider().label, 'success');
}

function toggleConfig() {
    const panel = document.getElementById('config-panel');
    // Close the sibling overlay so the two panels never overlap.
    document.getElementById('model-dropdown')?.classList.remove('open');
    panel.classList.toggle('open');
    // Ensure close button exists
    if (panel.classList.contains('open') && !panel.querySelector('.config-panel-close')) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'config-panel-close';
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.setAttribute('aria-label', 'Close configuration');
        closeBtn.title = 'Close';
        closeBtn.onclick = () => panel.classList.remove('open');
        panel.appendChild(closeBtn);
    }
}

/** Toggle the sidebar between expanded and collapsed (icon-rail). */
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

// Global escape key handler: close panels and dropdowns
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const panel = document.getElementById('config-panel');
        const dropdown = document.getElementById('model-dropdown');
        const storyOverlay = document.getElementById('story-settings-overlay');
        if (storyOverlay) {
            closeStorySettings();
            document.getElementById('edit-story-btn')?.focus();
            return;
        }
        if (panel && panel.classList.contains('open')) {
            panel.classList.remove('open');
            document.getElementById('config-btn')?.focus();
        }
        if (dropdown && dropdown.classList.contains('open')) {
            dropdown.classList.remove('open');
            document.getElementById('model-selector')?.focus();
        }
    }
});
document.addEventListener('click', (e) => {
    const panel = document.getElementById('config-panel');
    const btn = document.getElementById('config-btn');
    if (panel && btn && panel.classList.contains('open') && !panel.contains(e.target) && !btn.contains(e.target)) {
        panel.classList.remove('open');
    }
});