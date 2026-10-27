#!/usr/bin/env node
/**
 * flux2-harness.js — submit the app's own substituted Flux.2 graphs to a live
 * ComfyUI and verify the PNGs it returns.
 *
 * This is a test harness, not part of the app. It loads js/comfy.js with a fake
 * window/WebSocket and calls the real substituteComfyWorkflow() and
 * parseComfyWorkflow(), so what is posted here is exactly what the app would
 * post. It does not start ComfyUI; it expects one already listening.
 *
 * Usage:
 *   node tools/flux2-harness.js [--base http://127.0.0.1:8188] [--source FILE]
 *
 * --source is a picture already inside ComfyUI/input/ to edit. Without it the
 * harness uses the T2I output it just produced (copied into input/).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = argOf("--base", "http://127.0.0.1:8188").replace(/\/+$/, "");

/** Load js/comfy.js into a sandbox that only exposes what it touches. */
function loadComfy() {
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    AbortSignal,
    AbortController,
    FormData: global.FormData,
    Blob: global.Blob,
    atob: global.atob,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { createElement: () => ({ getContext: () => null }) },
    fetchApi: (url, init) => fetch(url, init),
    imageProviderHeaders: () => ({ "Content-Type": "application/json" }),
    apiErrorDetail: async (r) => `HTTP ${r.status}`,
    safeGetJSON: () => ({}),
    safeSetItem: () => {},
    imageParams: { model: "flux2-klein-4b" },
    Image: function () {},
    FileReader: function () {},
    WebSocket: function () {
      this.close = () => {};
    },
    window: { location: { href: BASE + "/" } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["workflows/workflows.js", "js/imagemodels.js", "js/comfy.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, {
      filename: f,
    });
  }
  return sandbox;
}

async function postGraph(graph) {
  const res = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "flux2-harness" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.prompt_id) {
    throw new Error(
      `POST /prompt rejected (${res.status}): ${JSON.stringify(body).slice(0, 900)}`,
    );
  }
  return body.prompt_id;
}

async function waitFor(promptId, ms) {
  const deadline = Date.now() + (ms || 300000);
  for (;;) {
    const res = await fetch(`${BASE}/history/${promptId}`);
    const data = await res.json();
    const entry = data[promptId];
    if (entry) return entry;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${promptId}`);
    await new Promise((r) => setTimeout(r, 700));
  }
}

function firstImage(entry) {
  for (const out of Object.values(entry.outputs || {})) {
    for (const img of out.images || []) if (img && img.filename) return img;
  }
  return null;
}

/** Fetch a produced file and check it really is a PNG of a plausible size. */
async function verifyPng(img) {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output",
  });
  const res = await fetch(`${BASE}/view?${q}`);
  if (!res.ok) throw new Error(`GET /view failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sig = buf.subarray(0, 8).toString("hex");
  const isPng = sig === "89504e470d0a1a0a";
  // IHDR width/height are big-endian at offsets 16 and 20.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // A flat/black image compresses to almost nothing; a real render does not.
  const plausible = buf.length > 50000;
  return { bytes: buf.length, isPng, width, height, plausible, img };
}

async function uploadToInput(file) {
  const name = "harness-source-" + path.basename(file);
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), name);
  form.append("overwrite", "true");
  form.append("type", "input");
  const res = await fetch(`${BASE}/upload/image`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!body.name) throw new Error("upload failed: " + JSON.stringify(body));
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

(async () => {
  const comfy = loadComfy();
  const registry = vm.runInContext(
    "resolveImageModelMeta(imageParams.model)",
    comfy,
  );
  const settings = registry.settings;
  console.log("registry:", JSON.stringify({
    model: registry.modelId,
    workflowId: registry.workflowId,
    editWorkflowId: registry.editWorkflowId,
    settings,
  }));

  const prompt =
    "A woman in a red coat reading a book on a rainy balcony at night, " +
    "warm window light behind her, wet city lights blurred beyond the railing.";

  // ── T2I ─────────────────────────────────────────────────────────────────
  const t2iVars = vm.runInContext(
    `comfyVars(${JSON.stringify(prompt)}, 4242, imageParams.model, resolveImageModelMeta(imageParams.model).settings, {})`,
    comfy,
  );
  const t2iRaw = vm.runInContext(
    `substituteComfyWorkflow(builtinComfyWorkflows().find(w => w.id === "flux2-klein-t2i").workflow, ${JSON.stringify(t2iVars)})`,
    comfy,
  );
  const t2iGraph = vm.runInContext(
    `parseComfyWorkflow(${JSON.stringify(t2iRaw)})`,
    comfy,
  );
  console.log(`t2i: ${Object.keys(t2iGraph).length} nodes, seed ${t2iVars.seed}, ${t2iVars.width}x${t2iVars.height}`);
  const t0 = Date.now();
  const t2iPng = await verifyPng(firstImage(await waitFor(await postGraph(t2iGraph))));
  console.log(`t2i: ${Date.now() - t0}ms`, JSON.stringify(t2iPng));

  // ── edit ────────────────────────────────────────────────────────────────
  let sourceName = argOf("--source", null);
  if (!sourceName) {
    // Re-use the T2I result as the edit source; ComfyUI wrote it to output/.
    const outPath = path.join(
      process.env.COMFYUI_ROOT || "E:/Sangeeth/Quick_saves/llm/ComfyUI_windows_portable/ComfyUI",
      "output",
      t2iPng.img.subfolder || "",
      t2iPng.img.filename,
    );
    sourceName = await uploadToInput(outPath);
  }
  console.log("edit source:", sourceName);

  const instruction =
    "Change her coat to deep green. Keep her face, pose, book and the balcony unchanged.";
  const editVars = vm.runInContext(
    `Object.assign(comfyVars(${JSON.stringify(instruction)}, 4242, imageParams.model, resolveImageModelMeta(imageParams.model).settings, {}), comfyEditVars(${JSON.stringify(instruction)}, ${JSON.stringify(sourceName)}))`,
    comfy,
  );
  const editRaw = vm.runInContext(
    `substituteComfyWorkflow(builtinComfyWorkflows().find(w => w.id === "flux2-klein-edit").workflow, ${JSON.stringify(editVars)}, "edit")`,
    comfy,
  );
  const editGraph = vm.runInContext(
    `parseComfyWorkflow(${JSON.stringify(editRaw)})`,
    comfy,
  );
  console.log(`edit: ${Object.keys(editGraph).length} nodes, init_image ${editGraph["4"].inputs.image}`);
  const t1 = Date.now();
  const editPng = await verifyPng(firstImage(await waitFor(await postGraph(editGraph))));
  console.log(`edit: ${Date.now() - t1}ms`, JSON.stringify(editPng));

  const ok = [t2iPng, editPng].every((p) => p.isPng && p.plausible && p.width > 0);
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
})().catch((err) => {
  console.error("HARNESS FAILED:", err.message);
  process.exitCode = 1;
});
