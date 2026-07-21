/* ══════════════════════════════════════════════════════════════
   init.js — Bootstrap: DOM load, app init, event wiring
   ══════════════════════════════════════════════════════════════ */

/**
 * Render the story config form fields from storyConfig state.
 */
function renderStoryConfig() {
    const sceneEl = document.getElementById('story-scene');
    const tagsEl = document.getElementById('story-tags');
    const firstPromptEl = document.getElementById('story-first-prompt');
    const charList = document.getElementById('story-characters-list');

    if (sceneEl) sceneEl.value = storyConfig.scene || '';
    if (tagsEl) tagsEl.value = storyConfig.tags || '';
    if (firstPromptEl) firstPromptEl.value = storyConfig.firstPrompt || '';

    if (charList) {
        charList.innerHTML = '';
        (storyConfig.characters || []).forEach((char, i) => {
            const row = document.createElement('div');
            row.className = 'story-char-row';
            row.innerHTML = '<input type="text" placeholder="Name" value="' + escapeHtml(char.name) + '" data-idx="' + i + '" data-field="name">' +
                '<input type="text" placeholder="Characteristics" value="' + escapeHtml(char.traits) + '" data-idx="' + i + '" data-field="traits">' +
                '<input type="text" placeholder="Relationship / Role" value="' + escapeHtml(char.role || '') + '" data-idx="' + i + '" data-field="role">' +
                '<button class="btn-del-char" onclick="removeCharacterRow(' + i + ')" aria-label="Remove character" title="Remove">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
            charList.appendChild(row);
        });

        // Wire live input listeners on the new rows
        charList.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', () => {
                var idx = parseInt(input.dataset.idx);
                var field = input.dataset.field;
                if (!storyConfig.characters[idx]) storyConfig.characters[idx] = { name: '', traits: '' };
                storyConfig.characters[idx][field] = input.value;
                saveStoryConfig();
            });
        });
    }

    syncStoryStyleUI();
}

/** Minimal HTML escape helper */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addCharacterRow() {
    if (!storyConfig.characters) storyConfig.characters = [];
    storyConfig.characters.push({ name: '', traits: '', role: '' });
    renderStoryConfig();
    saveStoryConfig();
}

function removeCharacterRow(index) {
    if (!storyConfig.characters) return;
    storyConfig.characters.splice(index, 1);
    renderStoryConfig();
    saveStoryConfig();
}

function useDefaultStory() {
    var style = currentStyle();
    var firstPrompts = {
        cyoa: 'Begin the story. Describe the opening scene vividly and present 2-3 clear choices for what happens next.',
        roleplay: 'Set the scene, then open in character as your lead character. Leave room for me to respond.',
        gm: 'Set up the opening situation as game master, then ask what I do.'
    };
    storyConfig = {
        style: style,
        scene: 'A misty forest at twilight. Ancient trees loom overhead, and a narrow path winds deeper into the unknown.',
        characters: [
            { name: 'The Guide', traits: 'mysterious, wise, speaks in riddles', role: 'Enigmatic mentor' }
        ],
        tags: 'fantasy, mystery, adventure',
        firstPrompt: firstPrompts[style] || firstPrompts.cyoa
    };
    renderStoryConfig();
    saveStoryConfig();
    // If hero input is empty, auto-send to start the chat
    var heroText = document.getElementById('hero-input-text') ? document.getElementById('hero-input-text').value.trim() : '';
    if (!heroText) {
        if (!currentChatId) startNewChat();
        showChatView();
        streamAssistantResponse();
    } else {
        sendHeroMessage();
    }
}

/**
 * Defensively parse a JSON object from an LLM response (handles code fences
 * and surrounding prose). Returns the parsed object or null.
 */
function parseStoryJson(raw) {
    if (!raw) return null;
    var s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(s.slice(start, end + 1)); } catch (e) {}
    }
    return null;
}

/**
 * Ask the local LLM for a complete, fresh, random story config and fill the form.
 */
async function generateStory() {
    var pill = document.getElementById('story-generate-pill');
    if (pill) { pill.disabled = true; pill.classList.add('is-loading'); }
    try {
        var styleId = currentStyle();
        var styleHints = {
            cyoa: 'The firstPrompt should tell the AI to describe the opening scene and present 2-3 numbered choices.',
            roleplay: 'The firstPrompt should tell the AI to set the scene and open in character as the first-listed character, leaving room for the user to respond (no numbered choices).',
            gm: 'The firstPrompt should tell the AI, acting as game master, to set up the opening situation and ask the player what they do (no numbered choices).'
        };
        var sys = 'You are a creative writing assistant. Invent a completely original interactive-fiction premise. Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys: "setting" (a vivid 1-2 sentence setting), "characters" (array of 2-4 objects, each with "name", "traits", and "role"), "tags" (comma-separated genres), "firstPrompt" (a short instruction that kicks off the story). ' + (styleHints[styleId] || styleHints.cyoa);
        var user = 'Generate a fresh, random story configuration now as JSON.';
        var response = await fetch(API_BASE + '/chat/completions', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({
                model: selectedModel || undefined,
                messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
                temperature: 0.9,
                stream: false
            })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();
        var parsed = parseStoryJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
        if (!parsed) throw new Error('could not parse story JSON');
        storyConfig = {
            style: styleId,
            scene: typeof parsed.setting === 'string' ? parsed.setting : (parsed.scene || ''),
            characters: Array.isArray(parsed.characters)
                ? parsed.characters.map(function(c) { return { name: (c && c.name) || '', traits: (c && c.traits) || '', role: (c && c.role) || '' }; })
                : [],
            tags: parsed.tags || '',
            firstPrompt: parsed.firstPrompt || ''
        };
        renderStoryConfig();
        saveStoryConfig();
        if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
        showToast('Story generated', 'success');
    } catch (err) {
        showToast('Generate failed: ' + err.message, 'error');
    } finally {
        if (pill) { pill.disabled = false; pill.classList.remove('is-loading'); }
    }
}

/**
 * Set the active story style, persist it, and refresh style-dependent UI.
 * @param {'cyoa'|'roleplay'|'gm'} id
 */
function setStoryStyle(id) {
    if (!STORY_STYLES[id]) return;
    storyConfig.style = id;
    saveStoryConfig();
    syncStoryStyleUI();
    if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
}

/** Reflect the active story style in the pills, hero placeholder, and first-prompt hint. */
function syncStoryStyleUI() {
    var active = currentStyle();
    ['cyoa', 'roleplay', 'gm'].forEach(function(id) {
        var pill = document.getElementById('style-pill-' + id);
        if (pill) {
            pill.classList.toggle('active', id === active);
            pill.setAttribute('aria-pressed', String(id === active));
        }
    });
    // Hero placeholder (only meaningful while the hero view is in story mode).
    var heroPlaceholder = document.getElementById('hero-placeholder');
    if (heroPlaceholder && currentMode === 'story') {
        var span = heroPlaceholder.querySelector('span:last-child');
        if (span) span.textContent = storyHeroText();
    }
    // First-prompt textarea hint.
    var fp = document.getElementById('story-first-prompt');
    if (fp) {
        var hints = {
            cyoa: 'Describe the opening scene and present the first choices for the player.',
            roleplay: 'Set the opening scene and have your lead character open, in character.',
            gm: 'Set up the opening situation and prompt the player for their first action.'
        };
        fp.placeholder = hints[active] || hints.cyoa;
    }
}

/**
 * Switch between chat and story mode. Updates pills, toggles story config visibility.
 * @param {'chat'|'story'} mode
 */
function setMode(mode) {
    currentMode = mode;
    const chatPill = document.getElementById('pill-chat-mode');
    const storyPill = document.getElementById('pill-story-mode');
    const storyConfigEl = document.getElementById('story-config');
    const heroPlaceholder = document.getElementById('hero-placeholder');
    const promptChips = document.getElementById('prompt-chips');
    // Config-panel mirrors (let the user switch mode mid-chat)
    const cfgChat = document.getElementById('cfg-pill-chat');
    const cfgStory = document.getElementById('cfg-pill-story');
    const editStoryBtn = document.getElementById('edit-story-btn');

    if (mode === 'chat') {
        chatPill.classList.add('active');
        chatPill.setAttribute('aria-pressed', 'true');
        storyPill.classList.remove('active');
        storyPill.setAttribute('aria-pressed', 'false');
        if (storyConfigEl) storyConfigEl.classList.add('hidden');
        if (promptChips) promptChips.classList.remove('hidden');
        if (heroPlaceholder) {
            const span = heroPlaceholder.querySelector('span:last-child');
            if (span) span.textContent = 'Ask anything…';
        }
        if (cfgChat) { cfgChat.classList.add('active'); cfgChat.setAttribute('aria-pressed', 'true'); }
        if (cfgStory) { cfgStory.classList.remove('active'); cfgStory.setAttribute('aria-pressed', 'false'); }
        if (editStoryBtn) editStoryBtn.style.display = 'none';
    } else {
        storyPill.classList.add('active');
        storyPill.setAttribute('aria-pressed', 'true');
        chatPill.classList.remove('active');
        chatPill.setAttribute('aria-pressed', 'false');
        if (storyConfigEl) storyConfigEl.classList.remove('hidden');
        if (promptChips) promptChips.classList.add('hidden');
        renderStoryConfig();
        if (heroPlaceholder) {
            const span = heroPlaceholder.querySelector('span:last-child');
            if (span) span.textContent = storyHeroText();
        }
        if (cfgStory) { cfgStory.classList.add('active'); cfgStory.setAttribute('aria-pressed', 'true'); }
        if (cfgChat) { cfgChat.classList.remove('active'); cfgChat.setAttribute('aria-pressed', 'false'); }
        if (editStoryBtn) editStoryBtn.style.display = '';
    }

    // Persist the chosen mode so it survives reloads / chat switches.
    if (currentChatId) {
        const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
        if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now() };
        meta[currentChatId].lastMode = mode;
        localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    }

    if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
}

/**
 * Surface the story-config form in a modal so it's editable mid-conversation.
 * Relocates the existing #story-config element (single source of truth, keeps IDs).
 */
function openStorySettings() {
    if (currentMode !== 'story') setMode('story');
    const cfg = document.getElementById('story-config');
    if (!cfg) return;
    cfg.classList.remove('hidden');
    renderStoryConfig();

    // Close the config panel behind the modal.
    document.getElementById('config-panel')?.classList.remove('open');

    const overlay = document.createElement('div');
    overlay.className = 'story-settings-overlay';
    overlay.id = 'story-settings-overlay';

    const modal = document.createElement('div');
    modal.className = 'story-settings-modal';

    const head = document.createElement('div');
    head.className = 'story-settings-head';
    head.innerHTML = '<span>Story Settings</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'config-panel-close';
    closeBtn.setAttribute('aria-label', 'Close story settings');
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = closeStorySettings;
    head.appendChild(closeBtn);

    modal.appendChild(head);
    modal.appendChild(cfg); // physically moves the config into the modal
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeStorySettings(); });
    document.body.appendChild(overlay);
}

/** Close the story-settings modal and return #story-config to its hero home. */
function closeStorySettings() {
    const overlay = document.getElementById('story-settings-overlay');
    if (!overlay) return;
    const cfg = document.getElementById('story-config');
    const heroInput = document.querySelector('.hero-input-wrapper');
    if (cfg && heroInput && heroInput.parentElement) {
        // Restore to its original slot (before the hero input) so the hero view stays intact.
        heroInput.parentElement.insertBefore(cfg, heroInput);
        if (currentMode !== 'story') cfg.classList.add('hidden');
    }
    overlay.remove();
}

/** Persist story config to current chat metadata */
function saveStoryConfig() {
    if (!currentChatId) return;
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now() };
    meta[currentChatId].storyConfig = { ...storyConfig };
    localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
}

/**
 * Initialize app state from localStorage.
 */
function init() {
    migrateData();

    const storedChats = JSON.parse(localStorage.getItem('chat_index') || '[]');
    if (storedChats.length > 0) {
        currentChatId = storedChats[storedChats.length - 1];
        chatHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + currentChatId) || '[]');
        generationStore = JSON.parse(localStorage.getItem(GENERATIONS_PREFIX + currentChatId) || '{}');
        generationIdx = {};
    } else {
        startNewChat();
        return;
    }
    renderChatList();
    if (chatHistory.length > 0) {
        showChatView();
        renderMessages();
    } else {
        showHeroView();
    }

    // Focus the chat input after restoring a chat session
    if (chatHistory.length > 0) {
        document.getElementById('chat-input')?.focus();
    }

    // Wire story config inputs (scene, tags, firstPrompt)
    const sceneEl = document.getElementById('story-scene');
    const tagsEl = document.getElementById('story-tags');
    const firstPromptEl = document.getElementById('story-first-prompt');

    if (sceneEl) {
        sceneEl.addEventListener('input', function() {
            storyConfig.scene = sceneEl.value;
            saveStoryConfig();
        });
    }
    if (tagsEl) {
        tagsEl.addEventListener('input', function() {
            storyConfig.tags = tagsEl.value;
            saveStoryConfig();
        });
    }
    if (firstPromptEl) {
        firstPromptEl.addEventListener('input', function() {
            storyConfig.firstPrompt = firstPromptEl.value;
            saveStoryConfig();
            if (typeof refreshHeroSendButton === 'function') refreshHeroSendButton();
        });
    }

    // If hero is visible and in story mode, render story config fields
    var heroRegion = document.getElementById('hero-region');
    if (heroRegion && !heroRegion.classList.contains('hidden') && currentMode === 'story') {
        renderStoryConfig();
    }
}

function initTextareaAutoResize() {
    const inputs = ['chat-input', 'hero-input-text'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                el.style.height = 'auto';
                el.style.height = el.scrollHeight + 'px';
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    marked.setOptions({ breaks: true, gfm: true, renderer: codeRenderer });
    hljs.configure({ cssSelector: 'pre code' });
    initSliders();
    init();
    startOfflineDetection();
    document.getElementById('chat-input').addEventListener('keydown', handleChatKeydown);
    setupHeroInput();
    initTextareaAutoResize();
});

/* ══════════════════════════════════════════════════════════════
   Export / Import story config
   ══════════════════════════════════════════════════════════════ */

function exportStoryConfig(format) {
    var dateStr = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
        var data = { style: currentStyle(), scene: storyConfig.scene, characters: storyConfig.characters, tags: storyConfig.tags, firstPrompt: storyConfig.firstPrompt, exportedAt: new Date().toISOString() };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'story-config-' + dateStr + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Story config exported as JSON', 'success');
    } else {
        var charLines = (storyConfig.characters || [])
            .filter(function(c) { return c.name; })
            .map(function(c) {
                var line = '- ' + c.name + ': ' + (c.traits || 'unknown');
                if (c.role) line += ' (' + c.role + ')';
                return line;
            })
            .join('\n');
        var text = [
            'Style: ' + STORY_STYLES[currentStyle()].label,
            'Scene: ' + (storyConfig.scene || ''),
            '',
            'Characters:',
            charLines || '(none)',
            '',
            'Tags: ' + (storyConfig.tags || ''),
            '',
            'First Prompt:',
            storyConfig.firstPrompt || ''
        ].join('\n');
        var blob = new Blob([text], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'story-config-' + dateStr + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Story config exported as text', 'success');
    }
}

function triggerStoryImport() {
    document.getElementById('story-import-input').click();
}

function handleStoryImport(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            if (file.name.endsWith('.json')) {
                var data = JSON.parse(e.target.result);
                storyConfig = {
                    style: STORY_STYLES[data.style] ? data.style : 'cyoa',
                    scene: data.scene || '',
                    characters: Array.isArray(data.characters)
                        ? data.characters.map(function(c) { return { name: c.name || '', traits: c.traits || '', role: c.role || '' }; })
                        : [],
                    tags: data.tags || '',
                    firstPrompt: data.firstPrompt || ''
                };
            } else {
                var text = e.target.result;
                storyConfig = { style: 'cyoa', scene: '', characters: [], tags: '', firstPrompt: '' };
                var firstPromptLines = [];
                var inFirstPrompt = false;
                text.split('\n').forEach(function(line) {
                    var sceneMatch = line.match(/^Scene:\s*(.*)/i);
                    var tagMatch = line.match(/^Tags?:\s*(.*)/i);
                    var charMatch = line.match(/^-\s*(.+?)\s*:\s*(.*)/);
                    if (sceneMatch) {
                        storyConfig.scene = sceneMatch[1];
                        inFirstPrompt = false;
                    } else if (tagMatch) {
                        storyConfig.tags = tagMatch[1];
                        inFirstPrompt = false;
                    } else if (charMatch) {
                        var traitsRaw = charMatch[2].trim();
                        var roleMatch = traitsRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                        if (roleMatch) {
                            storyConfig.characters.push({ name: charMatch[1].trim(), traits: roleMatch[1].trim(), role: roleMatch[2].trim() });
                        } else {
                            storyConfig.characters.push({ name: charMatch[1].trim(), traits: traitsRaw, role: '' });
                        }
                        inFirstPrompt = false;
                    } else if (/^First Prompt:/i.test(line)) {
                        inFirstPrompt = true;
                    } else if (inFirstPrompt) {
                        firstPromptLines.push(line);
                    }
                });
                storyConfig.firstPrompt = firstPromptLines.join('\n').trim();
            }
            renderStoryConfig();
            saveStoryConfig();
            showToast('Story config imported', 'success');
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

/* ══════════════════════════════════════════════════════════════
   Global keyboard shortcuts
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', function(e) {
    // Ctrl+N / Cmd+N: New chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        startNewChat();
    }
    // Ctrl+Shift+E: Export chats
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        exportChats();
    }
    // Ctrl+Shift+I: Import chats
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function() { if (input.files[0]) importChats(input.files[0]); };
        input.click();
    }
    // Ctrl+Shift+S: Export story config JSON
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (currentMode === 'story') exportStoryConfig('json');
    }
    // Ctrl+Shift+L: Import story config
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        if (currentMode === 'story') triggerStoryImport();
    }
});