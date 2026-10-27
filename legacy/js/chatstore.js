/* ══════════════════════════════════════════════════════════════
   chatstore.js — chats live in the gitignored `chats/` folder

   The browser cannot write to a folder, so tools/serve.js exposes a small
   local API and this module is the single bridge to it. Chats are no longer
   persisted in localStorage or IndexedDB:

     chats/index.json                 order + metadata
     chats/<id>/chat.json             messages + text generations
     chats/<id>/story.json            scene record
     chats/images/<id>.bin + .json    generated pictures

   The UI is synchronous, so the whole store is hydrated once at boot into
   memory. `safeGetJSON` / `safeSetItem` (js/state.js) route the existing
   `chat_*` keys here instead of localStorage, and writes are debounced to the
   server. That keeps the rest of the app unchanged while making the folder the
   source of truth.

   The API is local-only, but a failed write is still surfaced in the console
   rather than silently leaving the folder stale.
   ══════════════════════════════════════════════════════════════ */

const CHAT_STORE_API = "/api";
const CHAT_STORE_WRITE_DELAY = 200;
const CHAT_STORE_WRITE_TIMEOUT = 15000;
const CHAT_STORE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function chatStoreClone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function chatStoreParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return undefined;
  }
}

function chatStoreIsId(value) {
  return typeof value === "string" && CHAT_STORE_ID_RE.test(value);
}

const chatStore = {
  /** True once /api/all has hydrated the in-memory store. */
  ready: false,
  /** Sidebar order. */
  order: [],
  /** chatId -> { createdAt, lastMode, storyConfig, name, ... } */
  meta: {},
  /** chatId -> { messages: [], generations: {} } */
  chats: {},
  /** chatId -> scene record */
  stories: {},

  /** Pending debounced writes, keyed by "index" | "chat:<id>" | "story:<id>". */
  _timers: new Map(),
  /** In-flight writes, so a delete can wait for them instead of racing. */
  _inflight: new Map(),
  /** In-flight deletes, so an undo can wait for the folder removal. */
  _deleting: new Map(),
  /** Throttle for write-failure toasts. */
  _lastWriteWarning: 0,

  /** Does this localStorage key belong to the folder-backed chat store? */
  handles(key) {
    if (typeof key !== "string") return false;
    if (key === "chat_index" || key === "chat_meta") return true;
    return (
      key.startsWith("chat_story_") ||
      key.startsWith("chat_gen_") ||
      (key.startsWith("chat_") && key !== "chat_meta" && key !== "chat_index")
    );
  },

  /** Parse a storage key into { kind, id }. */
  _keyInfo(key) {
    if (key === "chat_index") return { kind: "index" };
    if (key === "chat_meta") return { kind: "meta" };
    if (key.startsWith("chat_story_")) {
      return { kind: "story", id: key.slice("chat_story_".length) };
    }
    if (key.startsWith("chat_gen_")) {
      return { kind: "generations", id: key.slice("chat_gen_".length) };
    }
    if (key.startsWith("chat_")) {
      return { kind: "chat", id: key.slice("chat_".length) };
    }
    return null;
  },

  /** Synchronous read used by safeGetJSON. */
  getJSON(key, fallback) {
    const info = this._keyInfo(key);
    if (!info) return chatStoreClone(fallback);
    if (!this.ready) return chatStoreClone(fallback);

    if (info.kind === "index") return this.order.slice();
    if (info.kind === "meta") return chatStoreClone(this.meta);
    if (info.kind === "chat") {
      const chat = this.chats[info.id];
      return chatStoreClone(chat ? chat.messages : fallback);
    }
    if (info.kind === "generations") {
      const chat = this.chats[info.id];
      return chatStoreClone(
        chat && chat.generations ? chat.generations : fallback,
      );
    }
    if (info.kind === "story") {
      return chatStoreClone(
        Object.prototype.hasOwnProperty.call(this.stories, info.id)
          ? this.stories[info.id]
          : fallback,
      );
    }
    return chatStoreClone(fallback);
  },

  /** Raw-string read used by safeGetItem. */
  getItem(key) {
    const info = this._keyInfo(key);
    if (!info || !this.ready) return null;
    const value = this.getJSON(key, null);
    return value === null || value === undefined ? null : JSON.stringify(value);
  },

  /** Synchronous write used by safeSetItem. */
  setJSON(key, raw) {
    const info = this._keyInfo(key);
    if (!info) return;

    if (info.kind === "index") {
      const order = chatStoreParse(raw);
      this.order = Array.isArray(order) ? order.filter(chatStoreIsId) : [];
      this._schedule("index");
      return;
    }
    if (info.kind === "meta") {
      const meta = chatStoreParse(raw);
      this.meta = meta && typeof meta === "object" ? meta : {};
      this._schedule("index");
      return;
    }

    if (!chatStoreIsId(info.id)) return;
    const id = info.id;
    if (!this.chats[id]) this.chats[id] = { messages: [], generations: {} };

    if (info.kind === "chat") {
      const messages = chatStoreParse(raw);
      this.chats[id].messages = Array.isArray(messages) ? messages : [];
      this._ensureListed(id);
      this._schedule("chat:" + id);
      return;
    }
    if (info.kind === "generations") {
      const generations = chatStoreParse(raw);
      this.chats[id].generations =
        generations && typeof generations === "object" ? generations : {};
      this._schedule("chat:" + id);
      return;
    }
    if (info.kind === "story") {
      const story = chatStoreParse(raw);
      if (story === null) delete this.stories[id];
      else if (story && typeof story === "object") this.stories[id] = story;
      this._schedule("story:" + id);
    }
  },

  /** A new chat must appear in the sidebar even if registration was skipped. */
  _ensureListed(id) {
    if (!this.order.includes(id)) {
      this.order.push(id);
      this._schedule("index");
    }
    if (!this.meta[id]) {
      this.meta[id] = {
        createdAt: Date.now(),
        lastMode: typeof currentMode === "string" ? currentMode : "chat",
      };
      this._schedule("index");
    }
  },

  /** Remove a storage key, mirroring the old localStorage semantics. */
  remove(key) {
    const info = this._keyInfo(key);
    if (!info) return;
    if (info.kind === "chat") {
      this.deleteChat(info.id);
      return;
    }
    if (info.kind === "generations") {
      if (this.chats[info.id]) this.chats[info.id].generations = {};
      this._schedule("chat:" + info.id);
      return;
    }
    if (info.kind === "story") {
      delete this.stories[info.id];
      this._schedule("story:" + info.id);
      return;
    }
    if (info.kind === "index") {
      this.order = [];
      this._schedule("index");
      return;
    }
    if (info.kind === "meta") {
      this.meta = {};
      this._schedule("index");
    }
  },

  /* ── Boot ────────────────────────────────────────────────────── */

  /**
   * Load the whole folder store.
   *
   * All chats are small (images are separate files), so one request is
   * simpler and keeps the synchronous UI working without per-chat loading
   * states. Throws when the API is missing, which is how the app tells the
   * user to start the local server instead of silently using browser storage.
   * @returns {Promise<void>}
   */
  async init() {
    this.ready = false;
    const res = await fetch(CHAT_STORE_API + "/all", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Chat storage API unavailable (HTTP " + res.status + ")");
    }
    const data = await res.json();

    this.order = Array.isArray(data.order)
      ? data.order.filter(chatStoreIsId)
      : [];
    this.meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    this.chats = {};
    this.stories = {};

    for (const [id, chat] of Object.entries(data.chats || {})) {
      if (!chatStoreIsId(id)) continue;
      this.chats[id] = {
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        generations:
          chat.generations && typeof chat.generations === "object"
            ? chat.generations
            : {},
      };
    }
    for (const [id, story] of Object.entries(data.stories || {})) {
      if (!chatStoreIsId(id)) continue;
      if (story && typeof story === "object") this.stories[id] = story;
    }

    // The index is authoritative for order, but a chat file left behind by an
    // older build should still be reachable.
    for (const id of Object.keys(this.chats)) {
      if (!this.order.includes(id)) this.order.push(id);
    }
    for (const id of this.order) {
      if (!this.chats[id]) this.chats[id] = { messages: [], generations: {} };
      if (!this.meta[id]) {
        this.meta[id] = { createdAt: Date.now(), lastMode: "chat" };
      }
    }

    // One-time move of the old browser-local chats into the folder. Without
    // this, switching to folder storage would look like every chat vanished.
    if (!this.order.length) {
      const legacy = this._readLegacyBrowserStore();
      if (legacy) {
        const overlay = document.getElementById("boot-overlay");
        if (overlay) overlay.textContent = "Importing existing chats…";
        this.order = legacy.order;
        this.meta = legacy.meta;
        this.chats = legacy.chats;
        this.stories = legacy.stories;
        this.ready = true;
        await this._importLegacyBrowserStore(legacy);
      }
    }

    this.ready = true;

    // Images were stored separately (IndexedDB) before folder storage. Run the
    // copy on any boot where it has not completed, so a first import that ran
    // before any pictures existed still gets retried once they appear.
    if (
      this.order.length &&
      localStorage.getItem("chatchat_legacy_images_imported") !== "1"
    ) {
      this._importLegacyImages(this.order).catch((err) => {
        console.warn("Old image import skipped:", err);
      });
    }
  },

  /**
   * Read the pre-folder localStorage layout, once.
   *
   * Returns null when there is nothing to import or a previous import already
   * ran. Raw localStorage is used deliberately: safeGetJSON now routes chat
   * keys here, which would otherwise recurse.
   * @returns {{order:string[], meta:object, chats:object, stories:object}|null}
   */
  _readLegacyBrowserStore() {
    try {
      if (localStorage.getItem("chatchat_legacy_imported") === "1") {
        return null;
      }
      const order = chatStoreParse(localStorage.getItem("chat_index") || "[]");
      if (!Array.isArray(order) || !order.length) return null;
      const ids = order.filter(chatStoreIsId);
      if (!ids.length) return null;

      const metaRaw = chatStoreParse(localStorage.getItem("chat_meta") || "{}");
      const meta = metaRaw && typeof metaRaw === "object" ? metaRaw : {};
      const chats = {};
      const stories = {};

      for (const id of ids) {
        const messages = chatStoreParse(
          localStorage.getItem("chat_" + id) || "[]",
        );
        const generations = chatStoreParse(
          localStorage.getItem("chat_gen_" + id) || "{}",
        );
        chats[id] = {
          messages: Array.isArray(messages) ? messages : [],
          generations:
            generations && typeof generations === "object" ? generations : {},
        };
        const story = chatStoreParse(
          localStorage.getItem("chat_story_" + id) || "null",
        );
        if (story && typeof story === "object") stories[id] = story;
        if (!meta[id]) meta[id] = { createdAt: Date.now(), lastMode: "chat" };
      }
      return { order: ids, meta: meta, chats: chats, stories: stories };
    } catch (err) {
      console.warn("Legacy chat import could not read browser storage:", err);
      return null;
    }
  },

  /** Write a pre-folder store into chats/ before the app starts. */
  async _importLegacyBrowserStore(legacy) {
    for (const id of legacy.order) {
      await this._writeResource("chat:" + id);
      if (Object.prototype.hasOwnProperty.call(this.stories, id)) {
        await this._writeResource("story:" + id);
      }
    }
    await this._writeResource("index");
    localStorage.setItem("chatchat_legacy_imported", "1");

    // The folder now owns these chats. Drop the old browser copies so the two
    // stores cannot drift; they were the only source before this migration.
    for (const id of legacy.order) {
      localStorage.removeItem("chat_" + id);
      localStorage.removeItem("chat_gen_" + id);
      localStorage.removeItem("chat_story_" + id);
    }
    localStorage.removeItem("chat_index");
    localStorage.removeItem("chat_meta");
  },

  /**
   * Copy old IndexedDB images referenced by imported chats into chats/images/.
   *
   * Runs after the JSON import and does not block the boot; a large library
   * would otherwise leave the app on the loading screen for a long time. If a
   * picture is still uploading when its chat is opened, a reload picks it up.
   * @param {string[]} chatIds
   */
  async _importLegacyImages(chatIds) {
    if (localStorage.getItem("chatchat_legacy_images_imported") === "1") {
      return;
    }
    if (typeof indexedDB === "undefined" || typeof putImage !== "function") {
      return;
    }
    const wanted = new Set(chatIds.map(String));
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("chatchat-images", 1);
        req.onupgradeneeded = () => {
          // A missing legacy DB: create the shape so the read below is safe.
          const db = req.result;
          if (!db.objectStoreNames.contains("images")) {
            const store = db.createObjectStore("images", { keyPath: "id" });
            store.createIndex("chatId", "chatId", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () =>
          reject(new Error("Old image database is open in another tab"));
      });

    const db = await open();
    try {
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const req = tx.objectStore("images").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      let imported = 0;
      let failed = 0;
      for (const record of records) {
        if (!record || !record.id || !record.dataUrl) continue;
        if (!wanted.has(String(record.chatId || ""))) continue;
        try {
          await putImage(record);
          imported++;
        } catch (err) {
          failed++;
          console.warn("Old image import failed for " + record.id + ":", err);
        }
      }
      // Mark it done only when nothing failed; a retry is harmless because the
      // server overwrites the same image id.
      if (!failed) {
        localStorage.setItem("chatchat_legacy_images_imported", "1");
      }
      if (imported && chatIds.includes(currentChatId)) {
        if (typeof renderMessages === "function") renderMessages();
      }
    } finally {
      db.close();
    }
  },

  /* ── Writes ──────────────────────────────────────────────────── */

  _schedule(resource) {
    if (!this.ready) return;
    const existing = this._timers.get(resource);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this._timers.delete(resource);
      this._writeResource(resource).catch((err) => {
        console.warn("Chat save failed (" + resource + "):", err);
        this._warnWriteFailed();
      });
    }, CHAT_STORE_WRITE_DELAY);
    this._timers.set(resource, timer);
  },

  /** Tell the reader once in a while that the folder write is not landing. */
  _warnWriteFailed() {
    const now = Date.now();
    if (now - this._lastWriteWarning < 15000) return;
    this._lastWriteWarning = now;
    if (typeof showToast === "function") {
      showToast(
        "Could not save to the chats folder — check the local server window.",
        "error",
      );
    }
  },

  async _request(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CHAT_STORE_WRITE_TIMEOUT,
    );
    const init = Object.assign(
      { cache: "no-store", signal: controller.signal },
      options || {},
    );
    if (init.body !== undefined && typeof init.body !== "string") {
      // Binary uploads set their own Content-Type.
    } else if (init.body !== undefined) {
      init.headers = Object.assign(
        { "Content-Type": "application/json" },
        (options && options.headers) || {},
      );
    }
    try {
      const res = await fetch(CHAT_STORE_API + path, init);
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 300);
        } catch (e) {
          /* ignore */
        }
        throw new Error("HTTP " + res.status + (detail ? " — " + detail : ""));
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Write one resource, tracking it so delete/restore can order themselves.
   *
   * A story PUT that was already in flight when a chat is deleted would
   * otherwise land after the DELETE and recreate `chats/<id>/story.json` with
   * no `chat.json`. deleteChat() waits on this map before removing the folder.
   */
  _writeResource(resource) {
    const run = this._writeResourceNow(resource);
    this._inflight.set(resource, run);
    return run.finally(() => {
      if (this._inflight.get(resource) === run) this._inflight.delete(resource);
    });
  },

  async _writeResourceNow(resource) {
    if (resource === "index") {
      await this._request("/index", {
        method: "PUT",
        body: JSON.stringify({ order: this.order, meta: this.meta }),
      });
      return;
    }

    const sep = resource.indexOf(":");
    const kind = resource.slice(0, sep);
    const id = resource.slice(sep + 1);
    if (!chatStoreIsId(id)) return;

    if (kind === "chat") {
      const chat = this.chats[id] || { messages: [], generations: {} };
      await this._request("/chats/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify({
          messages: Array.isArray(chat.messages) ? chat.messages : [],
          generations:
            chat.generations && typeof chat.generations === "object"
              ? chat.generations
              : {},
        }),
      });
      return;
    }

    if (kind === "story") {
      const story = Object.prototype.hasOwnProperty.call(this.stories, id)
        ? this.stories[id]
        : null;
      await this._request("/chats/" + encodeURIComponent(id) + "/story", {
        method: "PUT",
        body: JSON.stringify(story),
      });
    }
  },

  /** Flush pending debounced writes, e.g. when the tab is hidden. */
  async flush() {
    const tasks = [];
    for (const [resource, timer] of Array.from(this._timers.entries())) {
      clearTimeout(timer);
      this._timers.delete(resource);
      tasks.push(this._writeResource(resource).catch(() => {}));
    }
    if (tasks.length) await Promise.all(tasks);
  },

  /* ── Chat lifecycle ──────────────────────────────────────────── */

  /** A deep copy of everything needed to undo a delete. */
  snapshotChat(id) {
    const chat = this.chats[id];
    return {
      chatId: id,
      position: this.order.indexOf(id),
      wasCurrent:
        id === (typeof currentChatId !== "undefined" ? currentChatId : null),
      meta: chatStoreClone(this.meta[id] || null),
      messages: chat ? chatStoreClone(chat.messages) : null,
      generations: chat ? chatStoreClone(chat.generations) : null,
      story: Object.prototype.hasOwnProperty.call(this.stories, id)
        ? chatStoreClone(this.stories[id])
        : null,
    };
  },

  /** Delete one chat folder. Images are left for the prune sweep. */
  deleteChat(id) {
    if (!chatStoreIsId(id)) return Promise.resolve();
    delete this.chats[id];
    delete this.stories[id];
    this.order = this.order.filter((chatId) => chatId !== id);
    delete this.meta[id];
    this._cancel("chat:" + id);
    this._cancel("story:" + id);
    const pending = ["chat:" + id, "story:" + id]
      .map((resource) => this._inflight.get(resource))
      .filter(Boolean);

    const write = (async () => {
      // A write that was already in flight must land before the delete, or it
      // can recreate the folder after it is removed.
      await Promise.all(pending.map((promise) => promise.catch(() => {})));
      await this._request("/chats/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await this._writeResource("index");
    })().finally(() => {
      this._deleting.delete(id);
    });
    this._deleting.set(id, write);
    return write;
  },

  /** Restore a chat from snapshotChat(). Images were never deleted. */
  async restoreChat(snapshot) {
    if (!snapshot || !chatStoreIsId(snapshot.chatId)) return;
    const id = snapshot.chatId;
    const at =
      Number.isInteger(snapshot.position) &&
      snapshot.position >= 0 &&
      snapshot.position <= this.order.length
        ? snapshot.position
        : this.order.length;
    if (!this.order.includes(id)) this.order.splice(at, 0, id);
    if (snapshot.meta) this.meta[id] = snapshot.meta;
    if (snapshot.messages != null) {
      this.chats[id] = {
        messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
        generations:
          snapshot.generations && typeof snapshot.generations === "object"
            ? snapshot.generations
            : {},
      };
    }
    if (snapshot.story != null) this.stories[id] = snapshot.story;
    else delete this.stories[id];

    const deleting = this._deleting.get(id);
    if (deleting) await deleting.catch(() => {});
    await Promise.all([
      this._writeResource("chat:" + id),
      this._writeResource("story:" + id),
      this._writeResource("index"),
    ]);
  },

  /** Delete every chat (not undoable). */
  async clearAll() {
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
    // Let any write that is already on the wire finish before removing the
    // tree; otherwise a late PUT can recreate a chat folder after the sweep.
    const pending = [
      ...Array.from(this._inflight.values()),
      ...Array.from(this._deleting.values()),
    ];
    await Promise.all(pending.map((promise) => promise.catch(() => {})));
    this.order = [];
    this.meta = {};
    this.chats = {};
    this.stories = {};
    await this._request("/chats", { method: "DELETE" });
    await this._writeResource("index");
  },

  /** Delete image files no remaining chat references. */
  async pruneImages() {
    const res = await this._request("/prune", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return Number(data.removed) || 0;
  },

  _cancel(resource) {
    const timer = this._timers.get(resource);
    if (!timer) return;
    clearTimeout(timer);
    this._timers.delete(resource);
  },
};

// A tab going away should not lose the last debounce window. `flush` uses
// ordinary fetch, so the browser may still cancel it during teardown; the
// debounce is short enough that this is a last-resort net, not the main path.
window.addEventListener("pagehide", () => {
  if (typeof chatStore !== "undefined" && chatStore.ready) chatStore.flush();
});
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "hidden" &&
    typeof chatStore !== "undefined" &&
    chatStore.ready
  ) {
    chatStore.flush();
  }
});
