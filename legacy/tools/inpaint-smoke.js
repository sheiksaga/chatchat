#!/usr/bin/env node
/**
 * inpaint-smoke.js — backend smoke test for chatchat's comfyInpaint().
 *
 * Loads the app's own js/comfy.js (plus the registry and bundled workflows) into
 * a Node VM with a minimal fetch/XHR shim, then calls the *real* comfyInpaint()
 * against a live ComfyUI. Nothing is reimplemented here: the graph, the
 * placeholder substitution, the upload, the poll and the data-URL decode are all
 * the app's code path. Only the browser APIs it touches are stubbed.
 *
 * Why a VM rather than a browser: `file://` pages cannot be scripted headlessly
 * without a browser, and the point of this test is the transport, not the DOM.
 *
 * Usage:
 *   node tools/inpaint-smoke.js \
 *     --source <png> --out <png> [--instruction "..."] [--seed 1234] \
 *     [--comfy http://127.0.0.1:8188]
 *
 * The mask is built here as a white-on-black rectangle at the source's exact
 * size — the same white = repaint / black = keep contract the mask editor
 * exports. `--mask <png>` overrides it with a real mask file.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_ROOT = path.join(__dirname, "..");

/* ── Minimal PNG codec (no dependencies) ───────────────────────────
   Only what the test needs: decode an 8-bit RGB/RGBA/grey PNG into raw RGBA,
   and encode raw RGBA as an 8-bit RGB PNG. Node's zlib does the compression. */

const zlib = require("zlib");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG buffer into { width, height, data: Buffer(RGBA) }. */
function decodePng(buf) {
  if (!buf.slice(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  const idat = [];
  let palette = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error("only 8-bit PNG supported here");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error("unsupported color type " + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(
      raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride),
    );
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
      }
      line[x] = v;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = line[x];
        out[o + 3] = 255;
      } else if (colorType === 2) {
        out[o] = line[x * 3];
        out[o + 1] = line[x * 3 + 1];
        out[o + 2] = line[x * 3 + 2];
        out[o + 3] = 255;
      } else if (colorType === 6) {
        out[o] = line[x * 4];
        out[o + 1] = line[x * 4 + 1];
        out[o + 2] = line[x * 4 + 2];
        out[o + 3] = line[x * 4 + 3];
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = line[x * 2];
        out[o + 3] = line[x * 2 + 1];
      } else if (colorType === 3 && palette) {
        const i = line[x] * 3;
        out[o] = palette[i];
        out[o + 1] = palette[i + 1];
        out[o + 2] = palette[i + 2];
        out[o + 3] = 255;
      }
    }
  }
  return { width: width, height: height, data: out };
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA data as an 8-bit RGB PNG (alpha dropped). */
function encodePngRgb(width, height, rgba) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = y * (stride + 1) + 1 + x * 3;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── Mask helper ─────────────────────────────────────────────────── */

/**
 * White-on-black RGB mask with one white rectangle.
 * White = repaint, black = keep — the same contract the mask editor exports.
 */
function rectMaskPng(width, height, box) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inside =
        x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1 ? 255 : 0;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = inside;
      rgba[o + 3] = 255;
    }
  }
  return encodePngRgb(width, height, rgba);
}

/* ── Arg parsing ─────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

/**
 * The smallest set of browser globals js/comfy.js actually touches.
 *
 * fetch() is Node's own, so the multipart upload, the /prompt POST, the
 * /history poll and the /view GET are all the app's real requests.
 */
function makeSandbox() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    URLSearchParams,
    fetch,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    FormData,
    Blob,
    // No WebSocket: the ETA estimate is optional and the poll finishes anyway.
    WebSocket: undefined,
    FileReader: class {
      readAsDataURL(blob) {
        blob
          .arrayBuffer()
          .then((ab) => {
            const b64 = Buffer.from(ab).toString("base64");
            this.result = `data:${blob.type || "image/png"};base64,${b64}`;
            if (this.onload) this.onload();
          })
          .catch((e) => this.onerror && this.onerror(e));
      }
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null },
    imageParams: { model: "anima-turbo-2b" },
    // The app's helpers comfy.js reaches for at call time.
    safeGetJSON: () => ({}),
    safeSetItem: () => {},
    nextImageSeed: () => 1,
    showToast: () => {},
    imageProviderHeaders: (cfg) => (cfg && cfg.key ? { Authorization: "Bearer " + cfg.key } : {}),
    fetchApi: (url, opts) => fetch(url, opts),
    apiErrorDetail: async (r) => "HTTP " + r.status,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadApp(sandbox) {
  for (const rel of ["workflows/workflows.js", "js/imagemodels.js", "js/comfy.js"]) {
    const full = path.join(APP_ROOT, rel);
    const code = fs.readFileSync(full, "utf8");
    // These are <script src> files in the browser — plain scripts sharing one
    // global scope. Same here: one context, run in order.
    vm.runInContext(code, sandbox, { filename: rel });
  }
}

/* ── Main ────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv);
  const comfyUrl = args.comfy || "http://127.0.0.1:8188";
  if (!args.source) {
    console.error("--source <png> is required");
    process.exit(2);
  }

  const sandbox = makeSandbox();
  loadApp(sandbox);

  const srcBuf = fs.readFileSync(args.source);
  const src = decodePng(srcBuf);
  console.log(`source: ${args.source}`);
  console.log(`source size: ${src.width}x${src.height}`);

  // Mask: supplied, or a rectangle over the upper-middle of the picture at the
  // source's own resolution. No content is described — it is geometry only.
  let maskBuf;
  let maskNote;
  if (args.mask) {
    maskBuf = fs.readFileSync(args.mask);
    const m = decodePng(maskBuf);
    maskNote = `${args.mask} (${m.width}x${m.height})`;
    if (m.width !== src.width || m.height !== src.height) {
      throw new Error(
        `mask is ${m.width}x${m.height} but the source is ${src.width}x${src.height} — they must match`,
      );
    }
  } else {
    const x0 = Math.round(src.width * 0.3);
    const x1 = Math.round(src.width * 0.7);
    const y0 = Math.round(src.height * 0.15);
    const y1 = Math.round(src.height * 0.45);
    maskBuf = rectMaskPng(src.width, src.height, { x0, y0, x1, y1 });
    maskNote = `generated white rect ${x0},${y0} -> ${x1},${y1} at ${src.width}x${src.height}`;
  }
  console.log(`mask: ${maskNote}`);

  const instruction = args.instruction || "Change the masked area.";
  const seed = args.seed ? Number(args.seed) : 424242;

  const cfg = {
    api: "comfyui",
    baseUrl: comfyUrl,
    label: "ComfyUI (local)",
    images: true,
    isLocal: true,
  };

  const t0 = Date.now();
  const dataUrl = await sandbox.comfyInpaint({
    cfg: cfg,
    model: "anima-turbo-2b",
    instruction: instruction,
    initImage: `data:image/png;base64,${srcBuf.toString("base64")}`,
    maskImage: `data:image/png;base64,${maskBuf.toString("base64")}`,
    width: src.width,
    height: src.height,
    seed: seed,
    onStatus: (s) => console.log(`  status: ${s}`),
  });
  const wall = (Date.now() - t0) / 1000;

  const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("comfyInpaint did not return a base64 data URL");
  const outBuf = Buffer.from(m[2], "base64");
  const out = decodePng(outBuf);

  console.log(`\nresult: ${out.width}x${out.height} ${m[1]} ${outBuf.length} bytes`);
  console.log(`wall: ${wall.toFixed(2)} s`);

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, outBuf);
    console.log(`saved: ${args.out}`);
  }
  if (args["mask-out"]) {
    fs.mkdirSync(path.dirname(args["mask-out"]), { recursive: true });
    fs.writeFileSync(args["mask-out"], maskBuf);
    console.log(`saved mask: ${args["mask-out"]}`);
  }

  const ok = out.width === src.width && out.height === src.height;
  console.log(`size match: ${ok ? "PASS" : "FAIL"} (${out.width}x${out.height})`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack.split("\n").slice(1, 5).join("\n"));
  process.exitCode = 1;
});
