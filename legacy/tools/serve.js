#!/usr/bin/env node
/**
 * serve.js — local app server + folder-backed chat storage.
 *
 *   node tools/serve.js [port] [root] [--open]
 *
 * The app no longer keeps chats in localStorage/IndexedDB. Everything lives in
 * a gitignored `chats/` folder next to this repo:
 *
 *   chats/index.json                  sidebar order + per-chat metadata
 *   chats/<id>/chat.json              messages + text generations
 *   chats/<id>/story.json             scene record (seed, player, cast)
 *   chats/images/<id>.bin + .json     generated pictures + MIME/chatId
 *
 * The HTTP API is intentionally tiny and local-only:
 *
 *   GET    /api/all                   everything the browser needs to boot
 *   PUT    /api/index                 order + metadata
 *   PUT    /api/chats/<id>            one chat's messages/generations
 *   PUT    /api/chats/<id>/story      one chat's scene record (null deletes)
 *   DELETE /api/chats/<id>            remove one chat folder
 *   DELETE /api/chats                 remove every chat
 *   PUT    /api/images/<id>           raw image bytes (Content-Type, X-Chat-Id)
 *   GET    /api/images/<id>           raw image bytes
 *   DELETE /api/images/<id>           remove one image
 *   POST   /api/images/<id>/fetch     download a hosted image URL to disk
 *   POST   /api/prune                 delete images no chat references
 *   GET    /api/health                liveness probe
 *
 * Security: bound to 127.0.0.1, checks Origin/Host, validates every id, limits
 * body sizes, blocks the private `chats/` tree from static serving, and writes
 * JSON atomically (temp file + rename). The folder is the source of truth, so
 * a failed write is surfaced rather than silently swallowed.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const { URL } = require("url");

/* ── Args / paths ──────────────────────────────────────────────── */

const rawArgs = process.argv.slice(2);
const OPEN = rawArgs.includes("--open");
const args = rawArgs.filter((arg) => arg !== "--open");
const START_PORT = Number(process.env.CHATCHAT_PORT) || Number(args[0]) || 8765;
const HOST = "127.0.0.1";
const ROOT = path.resolve(args[1] || path.join(__dirname, ".."));
const CHATS = path.join(ROOT, "chats");
const IMAGES = path.join(CHATS, "images");
const INDEX_FILE = path.join(CHATS, "index.json");

const MAX_JSON = 32 * 1024 * 1024; // 32 MiB per JSON body
const MAX_IMAGE = 64 * 1024 * 1024; // 64 MiB per image body
const MAX_FETCH_IMAGE = 64 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PORT_TRIES = 20;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** Current port, set after listen. Used for same-origin checks. */
let currentPort = START_PORT;

/* ── Filesystem helpers ────────────────────────────────────────── */

function ensureDirs() {
  fs.mkdirSync(IMAGES, { recursive: true });
}

function isId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

function chatDir(id) {
  return path.join(CHATS, id);
}

function chatFile(id) {
  return path.join(chatDir(id), "chat.json");
}

function storyFile(id) {
  return path.join(chatDir(id), "story.json");
}

function imageBin(id) {
  return path.join(IMAGES, id + ".bin");
}

function imageMeta(id) {
  return path.join(IMAGES, id + ".json");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

/**
 * Write JSON through a temp file and rename.
 *
 * Rename is atomic on the same filesystem, so a crash or a second tab can never
 * observe a half-written chat. The temp name includes pid + random so two
 * concurrent writes cannot collide.
 */
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp =
    file + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error("Request body too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ── HTTP helpers ──────────────────────────────────────────────── */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/**
 * Reject requests that did not originate from the app's own page.
 *
 * The server is bound to loopback, but a page on another origin can still POST
 * to localhost. Origin is absent for same-origin navigations and older clients,
 * so it is only enforced when present.
 */
function sameOrigin(req) {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (host && host !== "localhost" && host !== HOST) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return (
    origin === `http://${HOST}:${currentPort}` ||
    origin === `http://localhost:${currentPort}`
  );
}

/* ── Index ─────────────────────────────────────────────────────── */

function readIndex() {
  const index = readJson(INDEX_FILE, null);
  if (!index || typeof index !== "object") {
    return { order: [], meta: {} };
  }
  return {
    order: Array.isArray(index.order) ? index.order.filter(isId) : [],
    meta: index.meta && typeof index.meta === "object" ? index.meta : {},
  };
}

function writeIndex(order, meta) {
  writeJsonAtomic(INDEX_FILE, {
    order: (order || []).filter(isId),
    meta: meta && typeof meta === "object" ? meta : {},
  });
}

/** Rebuild index order from directories if the index was lost. */
function reconcileIndex() {
  const index = readIndex();
  const dirs = fs
    .readdirSync(CHATS, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name !== "images" && isId(entry.name),
    )
    .map((entry) => entry.name);
  const known = new Set(index.order);
  let changed = false;
  for (const id of dirs) {
    if (!known.has(id)) {
      index.order.push(id);
      changed = true;
    }
  }
  if (changed) writeIndex(index.order, index.meta);
  return index;
}

/* ── Images ───────────────────────────────────────────────────── */

/** Every image id referenced by one chat record. */
function collectImageIds(value, set) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectImageIds(item, set);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "id" || key === "sourceImageId" || key === "editOf") &&
      typeof child === "string" &&
      child.startsWith("img_")
    ) {
      set.add(child);
    }
    collectImageIds(child, set);
  }
}

function pruneImages() {
  const live = new Set();
  let corrupt = false;
  let files = [];
  try {
    files = fs.readdirSync(CHATS, { withFileTypes: true });
  } catch (err) {
    return { removed: 0 };
  }
  for (const entry of files) {
    if (!entry.isDirectory() || entry.name === "images" || !isId(entry.name))
      continue;
    const file = chatFile(entry.name);
    const chat = readJson(file, null);
    if (!chat) {
      // A corrupt chat file must not make its pictures look unreferenced.
      try {
        if (fs.existsSync(file)) corrupt = true;
      } catch (err) {
        corrupt = true;
      }
      continue;
    }
    collectImageIds(chat, live);
  }
  if (corrupt) {
    console.warn("Image prune skipped: a chat.json could not be parsed.");
    return { removed: 0, skipped: true };
  }

  let removed = 0;
  let imageFiles = [];
  try {
    imageFiles = fs.readdirSync(IMAGES);
  } catch (err) {
    return { removed: 0 };
  }
  for (const name of imageFiles) {
    if (!name.endsWith(".bin")) continue;
    const id = name.slice(0, -4);
    if (!isId(id) || live.has(id)) continue;
    removeFile(imageBin(id));
    removeFile(imageMeta(id));
    removed++;
  }
  return { removed };
}

/** Download a hosted image to disk, following a few redirects. */
function downloadImage(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return reject(new Error("Invalid image URL"));
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reject(new Error("Only http/https image URLs are supported"));
    }
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      parsed,
      { headers: { "User-Agent": "chatchat-local-server" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (!redirectsLeft) return reject(new Error("Too many redirects"));
          const next = new URL(res.headers.location, parsed).toString();
          return resolve(downloadImage(next, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new Error("Image fetch failed: HTTP " + res.statusCode),
          );
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_FETCH_IMAGE) {
            req.destroy();
            reject(new Error("Image is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: res.headers["content-type"] || "image/png",
          }),
        );
      },
    );
    req.on("error", reject);
  });
}

/* ── API ──────────────────────────────────────────────────────── */

async function handleApi(req, res, url) {
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: "Forbidden origin" });
    return;
  }

  const parts = url.pathname.split("/").filter(Boolean); // api, ...
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/all") {
    const index = reconcileIndex();
    const chats = {};
    const stories = {};
    for (const id of index.order) {
      chats[id] = readJson(chatFile(id), {
        messages: [],
        generations: {},
      });
      const story = readJson(storyFile(id), null);
      if (story) stories[id] = story;
    }
    sendJson(res, 200, {
      order: index.order,
      meta: index.meta,
      chats,
      stories,
    });
    return;
  }

  if (method === "PUT" && url.pathname === "/api/index") {
    let body;
    try {
      body = JSON.parse((await readBody(req, MAX_JSON)).toString("utf8"));
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      return;
    }
    writeIndex(body.order, body.meta);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/prune") {
    sendJson(res, 200, pruneImages());
    return;
  }

  if (parts[0] !== "api" || parts[1] !== "chats") {
    // continue to image routes below
  } else if (parts.length === 2) {
    if (method === "DELETE") {
      fs.rmSync(CHATS, { recursive: true, force: true });
      ensureDirs();
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  } else {
    const id = parts[2];
    if (!isId(id)) {
      sendJson(res, 400, { error: "Invalid chat id" });
      return;
    }
    const isStory = parts[3] === "story";

    if (method === "PUT" && parts.length === 3 && !isStory) {
      let body;
      try {
        body = JSON.parse((await readBody(req, MAX_JSON)).toString("utf8"));
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON: " + err.message });
        return;
      }
      writeJsonAtomic(chatFile(id), {
        messages: Array.isArray(body.messages) ? body.messages : [],
        generations:
          body.generations && typeof body.generations === "object"
            ? body.generations
            : {},
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "PUT" && parts.length === 4 && isStory) {
      let body;
      try {
        const raw = (await readBody(req, MAX_JSON)).toString("utf8");
        body = raw.trim() === "null" ? null : JSON.parse(raw);
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON: " + err.message });
        return;
      }
      if (body === null) removeFile(storyFile(id));
      else writeJsonAtomic(storyFile(id), body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "DELETE" && parts.length === 3) {
      fs.rmSync(chatDir(id), { recursive: true, force: true });
      const index = readIndex();
      const order = index.order.filter((chatId) => chatId !== id);
      const meta = Object.assign({}, index.meta);
      delete meta[id];
      writeIndex(order, meta);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Unknown chat route" });
    return;
  }

  if (parts[1] === "images" && parts[2]) {
    const id = parts[2];
    if (!isId(id)) {
      sendJson(res, 400, { error: "Invalid image id" });
      return;
    }

    if (method === "PUT" && parts.length === 3) {
      let body;
      try {
        body = await readBody(req, MAX_IMAGE);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
        return;
      }
      if (!body.length) {
        sendJson(res, 400, { error: "Empty image body" });
        return;
      }
      let contentType = String(req.headers["content-type"] || "image/png");
      if (!/^image\//i.test(contentType)) contentType = "image/png";
      const chatId = String(req.headers["x-chat-id"] || "");
      await fsp.writeFile(imageBin(id), body);
      writeJsonAtomic(imageMeta(id), {
        contentType,
        chatId: isId(chatId) ? chatId : "",
        createdAt: Date.now(),
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && parts[3] === "fetch") {
      let body;
      try {
        body = JSON.parse((await readBody(req, MAX_JSON)).toString("utf8"));
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON: " + err.message });
        return;
      }
      try {
        const downloaded = await downloadImage(String(body.url || ""), 4);
        await fsp.writeFile(imageBin(id), downloaded.body);
        writeJsonAtomic(imageMeta(id), {
          contentType: downloaded.contentType,
          chatId: isId(body.chatId) ? body.chatId : "",
          createdAt: Date.now(),
        });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    if (method === "GET" && parts.length === 3) {
      let stat;
      try {
        stat = fs.statSync(imageBin(id));
      } catch (err) {
        sendJson(res, 404, { error: "Image not found" });
        return;
      }
      const meta = readJson(imageMeta(id), { contentType: "image/png" });
      res.writeHead(200, {
        "Content-Type": meta.contentType || "image/png",
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(imageBin(id)).pipe(res);
      return;
    }

    if (method === "DELETE" && parts.length === 3) {
      removeFile(imageBin(id));
      removeFile(imageMeta(id));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Unknown image route" });
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

/* ── Static files ─────────────────────────────────────────────── */

function serveStatic(req, res, url) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(url.pathname || "/");
  } catch (err) {
    sendText(res, 400, "Bad request");
    return;
  }

  // The private chat folder is never part of the public app.
  if (urlPath === "/chats" || urlPath.startsWith("/chats/")) {
    sendText(res, 404, "Not found");
    return;
  }

  const target = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

  // Refuse anything that escapes ROOT, however it is spelled.
  if (
    !target.startsWith(ROOT + path.sep) &&
    target !== path.join(ROOT, "index.html")
  ) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(target, (err, body) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type":
        TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  });
}

/* ── Server ───────────────────────────────────────────────────── */

function createServer() {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", `http://${HOST}:${currentPort}`);
    } catch (err) {
      sendText(res, 400, "Bad request");
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url);
      } catch (err) {
        console.error("API error:", err);
        if (!res.headersSent) {
          sendJson(res, err.statusCode || 500, {
            error: err.message || "Internal error",
          });
        }
      }
      return;
    }

    serveStatic(req, res, url);
  });
}

function openBrowser(target) {
  const command =
    process.platform === "win32"
      ? `start "" "${target}"`
      : process.platform === "darwin"
        ? `open "${target}"`
        : `xdg-open "${target}"`;
  exec(command, () => {});
}

function listen(port, triesLeft) {
  const server = createServer();
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && triesLeft > 0) {
      server.close();
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error("Could not start server:", err.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    currentPort = server.address().port;
    ensureDirs();
    reconcileIndex();
    const target = `http://${HOST}:${currentPort}/`;
    console.log(`Serving ${ROOT} at ${target}`);
    console.log(`Chats are stored in ${CHATS}`);
    if (OPEN) openBrowser(target);
  });
}

ensureDirs();
listen(START_PORT, PORT_TRIES);
