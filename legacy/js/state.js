/* ══════════════════════════════════════════════════════════════
   state.js — Application state
   ══════════════════════════════════════════════════════════════ */

/* ── Model providers ──────────────────────────────────────────────
   Text (chat) and image generation are resolved independently — a
   provider can serve either or both. `chat: true` means it accepts
   OpenAI-compatible /chat/completions; `images: true` means
   /images/generations. `isLocal` providers never require an API key.
   The API key is stored in localStorage (browser-only app); treat it
   like any other saved credential on this machine. */
const API_PROVIDERS = {
  local: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    isLocal: true,
    chat: true,
    images: false,
    // LM Studio owns the model lifecycle: POST /v1/models/load and /unload.
    loadLifecycle: true,
  },
  llama_cpp: {
    label: "llama.cpp (local)",
    baseUrl: "http://localhost:8081/v1",
    isLocal: true,
    chat: true,
    images: false,
    // llama.cpp has no load/unload endpoints at all — a request naming a model
    // *is* the load. The router (--models-dir) spawns a child server on the
    // first request for that model and proxies to it, which takes ~10-30s, and
    // evicts the previous one when --models-max 1. Verified against the
    // shipped llama-server-impl.dll: zero `models/load` / `models/unload`
    // route strings exist.
    loadLifecycle: false,
    // Per-model sampler defaults live on the server (--models-preset), not in
    // a Hugging Face README, and are readable from GET /props as
    // `default_generation_settings.params` (or the flat older shape; router
    // mode needs ?model=). Reading them is what stops the request body from
    // silently clobbering the tuned per-model temp/min-p.
    samplerSource: "props",
  },
  local_image: {
    label: "Local image (MLX Omni)",
    baseUrl: "http://localhost:10240/v1",
    isLocal: true,
    chat: false,
    images: true,
  },
  comfyui: {
    label: "ComfyUI (local)",
    // Note: no /v1 — ComfyUI serves its own API at the root.
    baseUrl: "http://localhost:8188",
    isLocal: true,
    chat: false,
    images: true,
    // ComfyUI has no OpenAI-style image endpoint at all. A request is a node
    // graph posted to /prompt, and the result is collected from /history +
    // /view — so this provider needs its own transport (js/comfy.js) rather
    // than the shared /images/generations call.
    api: "comfyui",
    // No model to load or evict; the graph names its own checkpoint.
    loadLifecycle: false,
  },
  nanogpt: {
    label: "NanoGPT",
    baseUrl: "https://nano-gpt.com/api/v1",
    isLocal: false,
    chat: true,
    images: true,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    isLocal: false,
    chat: true,
    images: true,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    isLocal: false,
    chat: true,
    images: false,
  },
};

const CUSTOM_PROVIDERS_KEY = "custom_providers";

/** @returns {Array<{id:string,label:string,baseUrl:string,key:string,chat?:boolean,images?:boolean}>} */
function getCustomProviders() {
  const list = safeGetJSON(CUSTOM_PROVIDERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** @param {Array} list */
function setCustomProviders(list) {
  safeSetItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(list));
}

/**
 * Add a user-defined OpenAI-compatible provider.
 * @param {{label:string, baseUrl:string, key:string, chat?:boolean, images?:boolean, isLocal?:boolean}} cfg
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
    chat: cfg.chat !== false,
    images: !!cfg.images,
    isLocal: !!cfg.isLocal,
  });
  setCustomProviders(list);
  return id;
}

/**
 * Patch a custom provider's saved fields in place (baseUrl/key/chat/images).
 * No-op for built-in providers — use {@link saveProviderConfig} for those.
 * @param {string} id
 * @param {object} patch
 */
function updateCustomProvider(id, patch) {
  const list = getCustomProviders();
  const entry = list.find((p) => p.id === id);
  if (!entry) return;
  Object.assign(entry, patch);
  setCustomProviders(list);
}

/**
 * Remove a custom provider. Falls the active provider back to 'local' if it
 * was the one being removed.
 * @param {string} id
 */
function removeCustomProvider(id) {
  setCustomProviders(getCustomProviders().filter((p) => p.id !== id));
  if (activeProviderId === id) setActiveProvider("local");
  if (activeImageProviderId === id) setActiveImageProvider("auto");
}

let activeProviderId = localStorage.getItem("active_provider") || "local";

/** Resolve a provider's effective config (default baseUrl + any saved key/override). */
/**
 * Resolve a provider id to a usable config, layering any saved overrides
 * (a custom baseUrl or key) over the built-in registry entry.
 *
 * This projects explicitly rather than spreading the registry entry, which is
 * deliberate — saved values must not be able to override behaviour flags. The
 * cost is that a *new* flag added to `API_PROVIDERS` is silently dropped until
 * it is listed here, and dropping one does not fail loudly: it just stops
 * guarding whatever it guarded. Add new flags in both places.
 * @param {string} id
 * @returns {object}
 */
function getProviderConfig(id) {
  if (API_PROVIDERS[id]) {
    const base = API_PROVIDERS[id];
    const saved = safeGetJSON("provider_cfg_" + id, {}) || {};
    return {
      id: id,
      label: base.label,
      isLocal: base.isLocal,
      chat: !!base.chat,
      images: !!base.images,
      baseUrl: saved.baseUrl || base.baseUrl,
      key: saved.key || "",
      // Behaviour flags, owned by the registry and not user-editable.
      // Absent means "has a lifecycle", which is the LM Studio default.
      loadLifecycle: base.loadLifecycle !== false,
      samplerSource: base.samplerSource,
      // Which request shape this provider speaks. Omitted means the
      // OpenAI-compatible default.
      api: base.api,
    };
  }
  const custom = getCustomProviders().find((p) => p.id === id);
  if (custom) {
    return {
      id: custom.id,
      label: custom.label,
      isLocal: !!custom.isLocal,
      chat: custom.chat !== false,
      images: !!custom.images,
      baseUrl: custom.baseUrl,
      key: custom.key || "",
      // A user-added server is not known to be lifecycle-free, so it keeps the
      // load/unload behaviour rather than silently losing it.
      loadLifecycle: true,
      samplerSource: undefined,
      api: undefined,
    };
  }
  return getProviderConfig("local");
}

/** @returns {Array<object>} Every configured provider (built-in + custom) as a resolved config. */
function getAllProviderConfigs() {
  return Object.keys(API_PROVIDERS)
    .concat(getCustomProviders().map((p) => p.id))
    .map(getProviderConfig);
}

/** @returns {Array<object>} Providers usable for chat completions. */
function getChatCapableProviders() {
  return getAllProviderConfigs().filter((p) => p.chat);
}

/** @returns {Array<object>} Providers usable for image generation. */
function getImageCapableProviders() {
  return getAllProviderConfigs().filter((p) => p.images);
}

/** The currently active text/chat provider's config. */
function currentProvider() {
  return getProviderConfig(activeProviderId);
}

/** @type {string} "auto" (derive from the chat provider, legacy behavior) or an explicit provider id. */
let activeImageProviderId =
  localStorage.getItem("active_image_provider") || "auto";

/** Switch the explicit image provider ("auto" to go back to deriving from the chat provider). */
function setActiveImageProvider(id) {
  activeImageProviderId = id;
  safeSetItem("active_image_provider", id);
}

/** The currently active image provider's config, or null when in "auto" mode. */
function currentImageProvider() {
  if (!activeImageProviderId || activeImageProviderId === "auto") return null;
  return getProviderConfig(activeImageProviderId);
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
  // The 'character' style was merged into 'roleplay'; its cast lives on.
  for (const chatId in meta) {
    const sc = meta[chatId]?.storyConfig;
    if (sc && typeof sc === "object" && sc.style === "character") {
      sc.style = "roleplay";
      changed = true;
    }
  }
  // Backfill narration voice on stored configs that predate the narration field.
  for (const chatId in meta) {
    const sc = meta[chatId]?.storyConfig;
    if (sc && typeof sc === "object" && !sc.narration) {
      sc.narration = "first";
      changed = true;
    }
  }
  // Backfill the character-cast fields on configs that predate them.
  for (const chatId in meta) {
    const sc = meta[chatId]?.storyConfig;
    if (!sc || typeof sc !== "object") continue;
    if (!Array.isArray(sc.castIds)) {
      sc.castIds = [];
      changed = true;
    }
    if (typeof sc.userName !== "string") {
      sc.userName = "";
      changed = true;
    }
    if (typeof sc.userPersona !== "string") {
      sc.userPersona = "";
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

/** @type {'chat'|'story'|'image'} */
let currentMode = "chat";

/**
 * @typedef {object} StoryConfig
 * @property {'cyoa'|'roleplay'|'gm'} style
 * @property {'first'|'third'} narration
 * @property {string} scene
 * @property {Array<{name:string, traits:string, role:string}>} characters
 * @property {string} tags
 * @property {string} firstPrompt
 * @property {string[]} castIds   Character-card ids, lead first (see cards.js)
 * @property {string} userName    The player's name, for {{user}} and stop strings
 * @property {string} userPersona The player's own description (ST's "persona")
 */

/**
 * A fresh story config. Every path that needs a default goes through here —
 * hand-rolled literals drift and silently drop newly added fields.
 * @returns {StoryConfig}
 */
function defaultStoryConfig() {
  return {
    style: "cyoa",
    narration: "first",
    scene: "",
    characters: [],
    tags: "",
    firstPrompt: "",
    castIds: [],
    userName: "",
    userPersona: "",
  };
}

/** @type {StoryConfig} */
let storyConfig = defaultStoryConfig();

const apiParams = {
  // These are the app defaults, used for cloud providers and as the starting
  // position of the sliders. On llama.cpp, `temperatureAuto`/`repetitionAuto`
  // below decide whether they are actually sent: a server preset is
  // authoritative until the user moves the corresponding slider.
  temperature: 0.7,
  repetitionPenalty: 1.1,
  // topP/topK/minP have no slider UI. They come from the model's sampler
  // source (a Hugging Face README, or llama.cpp's /props) and are carried
  // straight into the request. `min-p` matters for the local RP models, whose
  // presets are tuned around it.
  topP: undefined,
  topK: undefined,
  minP: undefined,
};

/**
 * True when the server owns this sampler and the request must omit it.
 * llama.cpp's `--models-preset` values are the tuned defaults; sending the
 * app's 0.7/1.1 over them was silently discarding them. Cloud providers keep
 * the app defaults (there is no /props preset behind them).
 */
let temperatureAuto =
  getProviderConfig(activeProviderId).samplerSource === "props";
let repetitionAuto = temperatureAuto;

/** True once the user moves a slider, so a profile refresh cannot clobber it. */
let temperatureUserSet = false;
let repetitionUserSet = false;

/**
 * The server root for a provider — `baseUrl` without its trailing API version
 * segment.
 *
 * llama.cpp serves its non-OpenAI endpoints at the root (`/props`, `/slots`,
 * `/metrics`), not under `/v1`, so the OpenAI base URL cannot be reused
 * verbatim to reach them.
 * @param {{baseUrl?: string}} provider
 * @returns {string}
 */
function providerRoot(provider) {
  return String((provider && provider.baseUrl) || "")
    .replace(/\/+$/, "")
    .replace(/\/v\d+$/, "");
}

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
  // Chat keys are folder-backed. Everything else (providers, image settings,
  // UI preferences) stays in localStorage.
  if (typeof chatStore !== "undefined" && chatStore.handles(key)) {
    chatStore.setJSON(key, value);
    return;
  }
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
  if (typeof chatStore !== "undefined" && chatStore.handles(key)) {
    return chatStore.getJSON(key, fallback);
  }
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

/**
 * Raw-string read that routes chat keys to the folder store.
 *
 * Used by the delete/undo snapshot paths, which used to read localStorage
 * directly before chat storage moved to disk.
 * @param {string} key
 * @returns {string|null}
 */
function safeGetItem(key) {
  if (typeof chatStore !== "undefined" && chatStore.handles(key)) {
    return chatStore.getItem(key);
  }
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

/** Remove one key, routing chat keys to the folder store. */
function safeRemoveItem(key) {
  if (typeof chatStore !== "undefined" && chatStore.handles(key)) {
    chatStore.remove(key);
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch (e) {
    /* storage unavailable — nothing useful to do */
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

/* ── Image generation defaults ───────────────────────────────────
   Phase 1 of the Flux.2 migration: one model, one recipe, no negative
   prompt, no edit strength. The seed is the only per-generation knob. */

const DEFAULT_IMAGE_MODEL = "flux2-klein-4b";
/** Portrait default for FLUX.2 Klein. The model card's own ratio and the size
 *  the 15s warm budget was measured against; override with `imageParams.size`
 *  or a per-call `overrides`. */
const DEFAULT_IMAGE_SIZE = "832x1216";
const IMAGE_SIZE_MIN = 256;
const IMAGE_SIZE_MAX = 2048;

/** Seed used when a picture has no chat seed and the mode is "fixed".
 *
 * In practice every chat locks its own seed (see storySeedFor), so this is the
 * fallback for a draw with no chat open — a harness, a preview, a test. The
 * fixed/random/last policy below still applies there. */
const DEFAULT_IMAGE_SEED = 123456789;

/** Fallback seed modes for draws with no chat open. `last` reuses the seed the
 *  previous picture actually used; `random` draws a fresh one each time. */
const IMAGE_SEED_MODES = ["fixed", "random", "last"];

/** Clamp a "WxH" size string into the supported range, keeping the ratio. */
function clampImageSize(size) {
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(size || ""));
  if (!m) return DEFAULT_IMAGE_SIZE;
  const clamp = (n) => Math.min(IMAGE_SIZE_MAX, Math.max(IMAGE_SIZE_MIN, n));
  // Flux2 latents need multiples of 16; round rather than reject.
  const round = (n) => Math.round(n / 16) * 16;
  return `${round(clamp(parseInt(m[1], 10)))}x${round(clamp(parseInt(m[2], 10)))}`;
}

/** Global image-generation defaults; per-chat overrides live in the image profile. */
const imageParams = {
  model: localStorage.getItem("image_model") || DEFAULT_IMAGE_MODEL,
  size: clampImageSize(
    localStorage.getItem("image_size") || DEFAULT_IMAGE_SIZE,
  ),
  // Local-server LoRA (e.g. MLX Omni / mflux) — sent as extra body fields on
  // every image request so the generator picks it up without any manual
  // priming step. Ignored by providers that don't understand the field.
  loraPath: localStorage.getItem("image_lora_path") || "",
  loraScale: parseFloat(localStorage.getItem("image_lora_scale")) || 1.0,
  // Diffusion steps for the OpenAI-compatible local server. ComfyUI ignores
  // this and uses the model registry's steps instead.
  steps: parseInt(localStorage.getItem("image_steps"), 10) || 4,
  // Fallback seed policy for draws with no chat open (a chat's locked seed
  // takes precedence — see nextImageSeed). "fixed" reuses `seed`, "random"
  // draws a new one per picture, "last" reuses the previous picture's seed.
  seedMode: IMAGE_SEED_MODES.includes(localStorage.getItem("image_seed_mode"))
    ? localStorage.getItem("image_seed_mode")
    : "random",
  seed: parseInt(localStorage.getItem("image_seed"), 10) || DEFAULT_IMAGE_SEED,
  // The seed actually used for the most recent picture. Displayed in the UI and
  // reused by the "last" mode; never derived from an outfit or a character.
  lastSeed: parseInt(localStorage.getItem("image_last_seed"), 10) || null,
  // Krea2 only: the two "unlocked variants" switches plus the fast render
  // profile. All default off except fast, which is on because the quality
  // canvas (1024x1024, 8 steps) is slow on this class of machine. The
  // image-model dropdown exposes all three as checkboxes.
  unlockedBypass: localStorage.getItem("image_unlocked_bypass") === "1",
  unlockedLora: localStorage.getItem("image_unlocked_lora") === "1",
  krea2Fast: localStorage.getItem("image_krea2_fast") !== "0",
};

/**
 * The seed to draw the next picture with.
 *
 * A chat locks one seed for its whole life (see storySeedFor in
 * js/storyfile.js): every picture in the same chat uses it, so regenerating a
 * scene reproduces the picture instead of drawing a new variation. The old
 * fixed/random/last policy remains as the fallback for a picture drawn with no
 * chat open (a harness, a test).
 * @returns {number}
 */
function nextImageSeed() {
  if (typeof storySeedFor === "function") {
    const locked = storySeedFor(currentChatId);
    if (Number.isFinite(locked)) return locked;
  }
  if (imageParams.seedMode === "random") {
    return Math.floor(Math.random() * 1e15);
  }
  if (
    imageParams.seedMode === "last" &&
    Number.isFinite(imageParams.lastSeed)
  ) {
    return imageParams.lastSeed;
  }
  const n = parseInt(imageParams.seed, 10);
  return Number.isFinite(n) ? n : DEFAULT_IMAGE_SEED;
}

/**
 * Remember the seed a picture was actually drawn with.
 * @param {number} seed
 * @returns {number|null} The stored value
 */
function recordImageSeed(seed) {
  const n = parseInt(seed, 10);
  if (!Number.isFinite(n)) return imageParams.lastSeed;
  imageParams.lastSeed = n;
  safeSetItem("image_last_seed", String(n));
  return n;
}

/**
 * The seed the next picture will use, without consuming it. Shown in the UI so
 * "fixed" and "last" are visible as numbers rather than as a mode name.
 * @returns {number}
 */
function effectiveImageSeed() {
  if (typeof storySeedFor === "function") {
    const locked = storySeedFor(currentChatId);
    if (Number.isFinite(locked)) return locked;
  }
  if (
    imageParams.seedMode === "last" &&
    Number.isFinite(imageParams.lastSeed)
  ) {
    return imageParams.lastSeed;
  }
  if (imageParams.seedMode === "random") return NaN;
  return nextImageSeed();
}

/**
 * Persist the seed for future "fixed" generations.
 * @param {number|string} value
 * @returns {number} The stored value
 */
function setImageSeed(value) {
  const n = parseInt(value, 10);
  imageParams.seed = Number.isFinite(n) ? n : DEFAULT_IMAGE_SEED;
  safeSetItem("image_seed", String(imageParams.seed));
  return imageParams.seed;
}

/**
 * Persist the seed mode ("fixed" | "random" | "last").
 * @param {string} mode
 * @returns {string} The stored mode
 */
function setImageSeedMode(mode) {
  imageParams.seedMode = IMAGE_SEED_MODES.includes(mode) ? mode : "random";
  safeSetItem("image_seed_mode", imageParams.seedMode);
  return imageParams.seedMode;
}

/**
 * Persist the Krea2 unlocked-bypass toggle.
 *
 * Only Krea2 entries read this: when on, comfyGenerate() loads
 * `fedor_bypass.safetensors` at the model's loraStrength (3.0); when off the
 * strength is 0, so the LoRA node is a no-op. Other models ignore it.
 * @param {boolean} value
 * @returns {boolean} The stored value
 */
function setImageUnlockedBypass(value) {
  imageParams.unlockedBypass = !!value;
  safeSetItem("image_unlocked_bypass", imageParams.unlockedBypass ? "1" : "0");
  return imageParams.unlockedBypass;
}

/**
 * Persist the Krea2 unlocked-LoRA (SNOFS) toggle.
 *
 * Only Krea2 entries read this: when on, comfyGenerate() loads
 * `snofs_krea_v1_nostrip.safetensors` at the model's unlockedLoraStrength
 * (0.8); when off the strength is 0, so the second LoRA node is a no-op.
 * @param {boolean} value
 * @returns {boolean} The stored value
 */
function setImageUnlockedLora(value) {
  imageParams.unlockedLora = !!value;
  safeSetItem("image_unlocked_lora", imageParams.unlockedLora ? "1" : "0");
  return imageParams.unlockedLora;
}

/**
 * Persist the Krea2 fast-profile toggle.
 *
 * On (the default) comfyGenerate() renders at the model's fastSteps/fastWidth/
 * fastHeight (768x768, 6 steps) instead of the quality canvas (1024x1024,
 * 8 steps) — but only when the caller supplied no size or steps of its own.
 * The stored value is read as on unless it is exactly "0", so an untouched
 * profile defaults to on.
 * @param {boolean} value
 * @returns {boolean} The stored value
 */
function setImageKrea2Fast(value) {
  imageParams.krea2Fast = !!value;
  safeSetItem("image_krea2_fast", imageParams.krea2Fast ? "1" : "0");
  return imageParams.krea2Fast;
}
