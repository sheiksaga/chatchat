#!/usr/bin/env node
/**
 * serve.js — zero-dependency static file server for tests and local dev.
 *
 *   node tools/serve.js [port] [root]
 *
 * Exists because the old Playwright config shelled out to `python -m
 * http.server`, and Python is not reliably on PATH: on Windows `python3`
 * usually resolves to the Microsoft Store stub, which exits immediately and
 * leaves the webServer waiting on a port that never opens. Node is always
 * present in a repo that runs Playwright, so this removes the dependency
 * rather than pinning a machine-specific interpreter path.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2]) || 8765;
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, ".."));

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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const target = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

  // Refuse anything that escapes ROOT, however it is spelled.
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(target, (err, body) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});
