/* ══════════════════════════════════════════════════════════════
   state.js — Application state
   ══════════════════════════════════════════════════════════════ */

/* ── Model providers ──────────────────────────────────────────────
   Local LM Studio plus optional OpenAI-compatible cloud providers.
   The API key is stored in localStorage (browser-only app); treat it
   like any other saved credential on this machine. */
const API_PROVIDERS = {
  local: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    isLocal: true,
  },
  nanogpt: {
    label: "NanoGPT",
    baseUrl: "https://nano-gpt.com/api/v1",
    isLocal: false,
    images: true,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    isLocal: false,
    images: true,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    isLocal: false,
  },
};

const CUSTOM_PROVIDERS_KEY = "custom_providers";

/** @returns {Array<{id:string,label:string,baseUrl:string,key:string,images?:boolean}>} */
function getCustomProviders() {
  const list = safeGetJSON(CUSTOM_PROVIDERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** @param {Array} list */
function setCustomProviders(list) {
  safeSetItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(list));
}

/**
 * Add a user-defined OpenAI-compatible cloud provider.
 * @param {{label:string, baseUrl:string, key:string, images?:boolean}} cfg
 * @returns {string} The generated provider id
 */
function addCustomProvider(cfg) {
  const id = "custom_" + Date.now();
  const list = getCustomProviders();
  list.push({
    id: id,
    label: cfg.label,
    baseUrl: cfg.baseUrl,
    key: cfg.key || "",
    images: !!cfg.images,
  });
  setCustomProviders(list);
  return id;
}

/**
 * Remove a custom provider. Falls the active provider back to 'local' if it
 * was the one being removed.
 * @param {string} id
 */
function removeCustomProvider(id) {
  setCustomProviders(getCustomProviders().filter((p) => p.id !== id));
  if (activeProviderId === id) setActiveProvider("local");
}

let activeProviderId = localStorage.getItem("active_provider") || "local";

/** Resolve a provider's effective config (default baseUrl + any saved key/override). */
function getProviderConfig(id) {
  if (API_PROVIDERS[id]) {
    const base = API_PROVIDERS[id];
    const saved = safeGetJSON("provider_cfg_" + id, {}) || {};
    return {
      id: id,
      label: base.label,
      isLocal: base.isLocal,
      images: !!base.images,
      baseUrl: saved.baseUrl || base.baseUrl,
      key: saved.key || "",
    };
  }
  const custom = getCustomProviders().find((p) => p.id === id);
  if (custom) {
    return {
      id: custom.id,
      label: custom.label,
      isLocal: false,
      images: !!custom.images,
      baseUrl: custom.baseUrl,
      key: custom.key || "",
    };
  }
  return getProviderConfig("local");
}

/** The currently active provider's config. */
function currentProvider() {
  return getProviderConfig(activeProviderId);
}

/** @type {string} Active API base URL (mutable — updated on provider switch). */
let API_BASE = getProviderConfig(activeProviderId).baseUrl;

/** Build fetch headers, adding a Bearer token when the active provider has a key. */
function apiHeaders(extra) {
  const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
  const p = currentProvider();
  if (p.key) h["Authorization"] = "Bearer " + p.key;
  return h;
}

/** Switch the active provider and repoint API_BASE. */
function setActiveProvider(id) {
  activeProviderId = id;
  safeSetItem("active_provider", id);
  API_BASE = getProviderConfig(id).baseUrl;
}

/** Persist per-provider settings (e.g. { key }) and refresh API_BASE if active. */
function saveProviderConfig(id, cfg) {
  if (!API_PROVIDERS[id]) return;
  const existing = getProviderConfig(id);
  const merged = Object.assign(
    { baseUrl: existing.baseUrl, key: existing.key },
    cfg || {},
  );
  safeSetItem("provider_cfg_" + id, JSON.stringify(merged));
  if (id === activeProviderId) API_BASE = merged.baseUrl;
}

const DATA_VERSION = 1;

/** Migrate localStorage data schema between versions */
function migrateData() {
  const version = parseInt(localStorage.getItem("data_version") || "0");
  if (version < 1) {
    // v0 → v1: initial migration marker
    safeSetItem("data_version", "1");
  }
  // v1 → current: migrate old flat storyConfig character string to array
  const meta = safeGetJSON(CHAT_META_KEY, {});
  let changed = false;
  for (const chatId in meta) {
    if (
      meta[chatId]?.storyConfig &&
      typeof meta[chatId].storyConfig.characters === "string"
    ) {
      const oldChars = meta[chatId].storyConfig.characters;
      meta[chatId].storyConfig.characters = oldChars
        .split(/[,|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name: name, traits: "" }));
      if (!meta[chatId].storyConfig.firstPrompt) {
        meta[chatId].storyConfig.firstPrompt = "";
      }
      changed = true;
    }
  }
  // Backfill role on stored characters that predate the role field.
  for (const chatId in meta) {
    const chars = meta[chatId]?.storyConfig?.characters;
    if (Array.isArray(chars)) {
      chars.forEach((c) => {
        if (c && typeof c === "object" && c.role === undefined) {
          c.role = "";
          changed = true;
        }
      });
    }
  }
  // Backfill story style on stored configs that predate the style field.
  for (const chatId in meta) {
    const sc = meta[chatId]?.storyConfig;
    if (sc && typeof sc === "object" && !sc.style) {
      sc.style = "cyoa";
      changed = true;
    }
  }
  if (changed) {
    safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
  }
}

let currentChatId = null;
const STORAGE_KEY_PREFIX = "chat_";
const GENERATIONS_PREFIX = "chat_gen_";
const CHAT_META_KEY = "chat_meta";
let chatHistory = [];
let selectedModel = localStorage.getItem("selectedModel") || "";
let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let generationStore = {}; // { [msgIndex]: ['alt1', 'alt2', ...] }
let generationIdx = {}; // { [msgIndex]: 0 }

const RP_MODELS = {
  "llama-3some-8b-v2": { hfRepo: "TheDrummer/llama-3some-8b-v2" },
  "ministrations-8b-v1": { hfRepo: "TheDrummer/Ministrations-8B-v1" },
  "mn-12b-mag-mell-r1-uncensored-scale1.2-i1": {
    hfRepo: "marinara/mn-12b-mag-mell-r1-uncensored-scale1.2-i1",
  },
};

/** @type {'chat'|'story'} */
let currentMode = "chat";
/** @type {{style:('cyoa'|'roleplay'|'gm'), scene:string, characters:Array<{name:string, traits:string, role:string}>, tags:string, firstPrompt:string}} */
let storyConfig = {
  style: "cyoa",
  scene: "",
  characters: [],
  tags: "",
  firstPrompt: "",
};

const apiParams = {
  temperature: 0.7,
  repetitionPenalty: 1.1,
  topP: undefined, // set from RP model profiles when available
  topK: undefined,
};

/* ── Safe localStorage access ─────────────────────────────────────
   Every read/write goes through these two helpers. Raw setItem throws
   on a full quota and aborts its caller mid-save; raw JSON.parse throws
   on a corrupt value and can white-screen the app at boot. */

/**
 * localStorage.setItem wrapped with QuotaExceededError handling.
 * @param {string} key
 * @param {string} value
 */
function safeSetItem(key, value) {
  try {
    // The one place a raw setItem is correct — this is the wrapper.
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) {
      if (typeof showToast === "function") {
        showToast(
          "Storage full — could not save. Free up space or delete old chats.",
          "error",
        );
      } else {
        console.warn(
          'localStorage quota exceeded — could not save "' + key + '"',
        );
      }
    } else {
      console.error('localStorage write failed for "' + key + '":', e);
    }
  }
}

/**
 * Read and JSON-parse a localStorage value, falling back on corrupt data.
 * @param {string} key
 * @param {*} fallback Returned when the key is absent or unparseable
 * @returns {*}
 */
function safeGetJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn(
      'Corrupt localStorage value for "' + key + '" — using default:',
      e,
    );
    return fallback;
  }
}

/* ── Chat index / metadata accessors ──────────────────────────────
   The index is the ordered list of chat IDs; the meta map holds
   per-chat settings (name, mode, storyConfig, imageProfile). */

/** @returns {string[]} Ordered list of chat IDs. */
function getChatIndex() {
  const idx = safeGetJSON("chat_index", []);
  return Array.isArray(idx) ? idx : [];
}

/** @param {string[]} index */
function setChatIndex(index) {
  safeSetItem("chat_index", JSON.stringify(index));
}

/** @returns {Object<string, object>} Per-chat metadata, keyed by chat ID. */
function getChatMeta() {
  const meta = safeGetJSON(CHAT_META_KEY, {});
  return meta && typeof meta === "object" ? meta : {};
}

/** @param {Object<string, object>} meta */
function setChatMeta(meta) {
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
}

/* ── Image generation ─────────────────────────────────────────────
   Image requests target whichever cloud provider resolveImageProvider()
   (js/images.js) picks, and always use the OpenAI-compatible request
   shape (prompt/model/size/n). */

const DEFAULT_IMAGE_MODEL = "hidream";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const IMAGE_SIZE_MIN = 512;
const IMAGE_SIZE_MAX = 1024;

/** Clamp a "WxH" size string's side to the slider's supported range. */
function clampImageSize(size) {
  const side = parseInt(size, 10);
  if (!side) return DEFAULT_IMAGE_SIZE;
  const clamped = Math.min(IMAGE_SIZE_MAX, Math.max(IMAGE_SIZE_MIN, side));
  return `${clamped}x${clamped}`;
}

/** Global image-generation defaults; per-chat overrides live in the image profile. */
const imageParams = {
  model: localStorage.getItem("image_model") || DEFAULT_IMAGE_MODEL,
  size: clampImageSize(localStorage.getItem("image_size") || DEFAULT_IMAGE_SIZE),
};
