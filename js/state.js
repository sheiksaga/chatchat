/* ══════════════════════════════════════════════════════════════
   state.js — Application state
   ══════════════════════════════════════════════════════════════ */

/* ── Model providers ──────────────────────────────────────────────
   Local LM Studio plus optional OpenAI-compatible cloud providers.
   The API key is stored in localStorage (browser-only app); treat it
   like any other saved credential on this machine. */
const API_PROVIDERS = {
    local:   { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1',  isLocal: true },
    nanogpt: { label: 'NanoGPT (cloud)',   baseUrl: 'https://nano-gpt.com/api/v1', isLocal: false }
};

let activeProviderId = localStorage.getItem('active_provider') || 'local';

/** Resolve a provider's effective config (default baseUrl + any saved key/override). */
function getProviderConfig(id) {
    const base = API_PROVIDERS[id] || API_PROVIDERS.local;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('provider_cfg_' + id) || '{}'); } catch (e) {}
    return {
        id: API_PROVIDERS[id] ? id : 'local',
        label: base.label,
        isLocal: base.isLocal,
        baseUrl: saved.baseUrl || base.baseUrl,
        key: saved.key || ''
    };
}

/** The currently active provider's config. */
function currentProvider() { return getProviderConfig(activeProviderId); }

/** @type {string} Active API base URL (mutable — updated on provider switch). */
let API_BASE = getProviderConfig(activeProviderId).baseUrl;

/** Build fetch headers, adding a Bearer token when the active provider has a key. */
function apiHeaders(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const p = currentProvider();
    if (p.key) h['Authorization'] = 'Bearer ' + p.key;
    return h;
}

/** Switch the active provider and repoint API_BASE. */
function setActiveProvider(id) {
    if (!API_PROVIDERS[id]) return;
    activeProviderId = id;
    localStorage.setItem('active_provider', id);
    API_BASE = getProviderConfig(id).baseUrl;
}

/** Persist per-provider settings (e.g. { key }) and refresh API_BASE if active. */
function saveProviderConfig(id, cfg) {
    if (!API_PROVIDERS[id]) return;
    const existing = getProviderConfig(id);
    const merged = Object.assign({ baseUrl: existing.baseUrl, key: existing.key }, cfg || {});
    localStorage.setItem('provider_cfg_' + id, JSON.stringify(merged));
    if (id === activeProviderId) API_BASE = merged.baseUrl;
}

const DATA_VERSION = 1;

/** Migrate localStorage data schema between versions */
function migrateData() {
    const version = parseInt(localStorage.getItem('data_version') || '0');
    if (version < 1) {
        // v0 → v1: initial migration marker
        localStorage.setItem('data_version', '1');
    }
    // v1 → current: migrate old flat storyConfig character string to array
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    let changed = false;
    for (const chatId in meta) {
        if (meta[chatId]?.storyConfig && typeof meta[chatId].storyConfig.characters === 'string') {
            const oldChars = meta[chatId].storyConfig.characters;
            meta[chatId].storyConfig.characters = oldChars
                .split(/[,|]/)
                .map(s => s.trim())
                .filter(Boolean)
                .map(name => ({ name: name, traits: '' }));
            if (!meta[chatId].storyConfig.firstPrompt) {
                meta[chatId].storyConfig.firstPrompt = '';
            }
            changed = true;
        }
    }
    // Backfill role on stored characters that predate the role field.
    for (const chatId in meta) {
        const chars = meta[chatId]?.storyConfig?.characters;
        if (Array.isArray(chars)) {
            chars.forEach(c => {
                if (c && typeof c === 'object' && c.role === undefined) {
                    c.role = '';
                    changed = true;
                }
            });
        }
    }
    if (changed) {
        localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    }
}

let currentChatId = null;
const STORAGE_KEY_PREFIX = 'chat_';
const GENERATIONS_PREFIX = 'chat_gen_';
const CHAT_META_KEY = 'chat_meta';
let chatHistory = [];
let selectedModel = localStorage.getItem('selectedModel') || '';
let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let generationStore = {}; // { [msgIndex]: ['alt1', 'alt2', ...] }
let generationIdx = {};  // { [msgIndex]: 0 }

const RP_MODELS = {
    'llama-3some-8b-v2': { hfRepo: 'TheDrummer/llama-3some-8b-v2' },
    'ministrations-8b-v1': { hfRepo: 'TheDrummer/Ministrations-8B-v1' },
    'mn-12b-mag-mell-r1-uncensored-scale1.2-i1': { hfRepo: 'marinara/mn-12b-mag-mell-r1-uncensored-scale1.2-i1' },
};

/** @type {'chat'|'story'} */
let currentMode = 'chat';
/** @type {{scene:string, characters:Array<{name:string, traits:string, role:string}>, tags:string, firstPrompt:string}} */
let storyConfig = { scene: '', characters: [], tags: '', firstPrompt: '' };

const apiParams = {
    temperature: 0.7,
    repetitionPenalty: 1.1,
    topP: undefined, // set from RP model profiles when available
    topK: undefined
};