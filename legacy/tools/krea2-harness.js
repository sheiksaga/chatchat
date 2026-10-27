#!/usr/bin/env node
/**
 * krea2-harness.js — exercise the app's own Krea2 T2I route against a live
 * ComfyUI and verify the picture it returns.
 *
 * This is a test harness, not part of the app. It loads
 * workflows/workflows.js, js/imagemodels.js and js/comfy.js into a sandbox and
 * calls the real comfyGenerate(), with comfyRunGraph stubbed so the vars the app
 * would build can be inspected before anything is posted. The captured vars are
 * then substituted into the real bundled graph and posted to ComfyUI, so what is
 * rendered here is exactly what the app would render.
 *
 * It checks what the three Krea2 switches have to get right:
 *   unlockedBypass = true  -> lora_name fedor_bypass.safetensors, strength 3.0
 *   unlockedLora   = true  -> unlocked_lora_name snofs_krea_v1_nostrip.safetensors,
 *                             strength 0.8
 *   krea2Fast      = true  -> steps 6, width/height 768
 *   all off (fast false)   -> Fedor 0, SNOFS 0, steps 8, 1024x1024
 *
 * The test prompt is deliberately non-explicit. The harness asserts the LoRAs and the
 * fast profile are wired at the right strengths/sizes; it makes no claim about
 * picture content.
 *
 * Usage:
 *   node tools/krea2-harness.js [--base http://127.0.0.1:8188]
 *
 * It does not start ComfyUI; it expects one already listening.
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

const MODEL = "krea2_turbo_fp8_scaled.safetensors";
const LORA = "fedor_bypass.safetensors";
const UNLOCKED_LORA = "snofs_krea_v1_nostrip.safetensors";
const PROMPT =
  "a portrait of an adult woman in a red dress, standing in a sunlit room, natural light";
// The live render runs the fast profile explicitly (768x768, 6 steps), so the
// harness overrides nothing and lets comfyGenerate() decide the canvas.
const FAST = { width: 768, height: 768, steps: 6 };
const QUALITY = { width: 1024, height: 1024, steps: 8 };
const PREFIX = "bench_tests/phase4_krea2/krea2_app_harness";

const failures = [];
function check(ok, what, detail) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(what);
}

/** Load the app's own scripts into a sandbox that only exposes what they touch. */
function loadApp() {
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
    imageParams: {
      model: MODEL,
      unlockedBypass: true,
      unlockedLora: true,
      krea2Fast: true,
    },
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

/**
 * Run the app's comfyGenerate() with comfyRunGraph stubbed, so the vars it would
 * have posted come back instead of a network call.
 * @param {object} app Sandbox from loadApp()
 * @param {object} [overrides] Per-call overrides
 * @returns {Promise<object>} the opts comfyRunGraph received
 */
async function captureGenerate(app, overrides) {
  const capture = { opts: null };
  app.__capture = capture;
  vm.runInContext(
    `comfyRunGraph = async (opts) => { __capture.opts = opts; return "data:image/png;base64,AAAA"; };`,
    app,
  );
  const cfg = {
    api: "comfyui",
    baseUrl: BASE,
    images: true,
    isLocal: true,
  };
  app.__opts = { cfg: cfg, prompt: PROMPT, overrides: overrides };
  await vm.runInContext("comfyGenerate(__opts)", app);
  return capture.opts;
}

/** Set the three Krea2 switches in the sandbox at once. */
function setToggles(app, opts) {
  app.__toggles = opts;
  vm.runInContext(
    "imageParams.unlockedBypass = __toggles.bypass;" +
      "imageParams.unlockedLora = __toggles.lora;" +
      "imageParams.krea2Fast = __toggles.fast;",
    app,
  );
}

async function postGraph(graph) {
  const res = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "krea2-harness" }),
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
  const isPng = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  // IHDR width/height are big-endian at offsets 16 and 20.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return {
    bytes: buf.length,
    isPng,
    width,
    height,
    sha256: require("crypto").createHash("sha256").update(buf).digest("hex"),
    img,
  };
}

(async () => {
  const app = loadApp();

  const registry = vm.runInContext("resolveImageModelMeta(imageParams.model)", app);
  console.log("registry:", JSON.stringify({
    model: registry.modelId,
    workflowId: registry.workflowId,
    editWorkflowId: registry.editWorkflowId,
    inpaintWorkflowId: registry.inpaintWorkflowId,
    steps: registry.settings.steps,
    cfg: registry.settings.cfg,
    loraName: registry.settings.loraName,
    loraStrength: registry.settings.loraStrength,
    unlockedLoraName: registry.settings.unlockedLoraName,
    unlockedLoraStrength: registry.settings.unlockedLoraStrength,
    fastSteps: registry.settings.fastSteps,
    fastWidth: registry.settings.fastWidth,
    fastHeight: registry.settings.fastHeight,
  }));
  check(registry.workflowId === "krea2-turbo-t2i", "registry routes to krea2-turbo-t2i", registry.workflowId);
  check(registry.editWorkflowId === null, "Krea2 has no edit workflow", String(registry.editWorkflowId));
  check(registry.inpaintWorkflowId === null, "Krea2 has no inpaint workflow", String(registry.inpaintWorkflowId));
  check(registry.settings.loraName === LORA, "registry names the Fedor LoRA", registry.settings.loraName);
  check(
    registry.settings.unlockedLoraName === UNLOCKED_LORA,
    "registry names the SNOFS LoRA",
    registry.settings.unlockedLoraName,
  );
  check(
    registry.settings.fastSteps === FAST.steps &&
      registry.settings.fastWidth === FAST.width &&
      registry.settings.fastHeight === FAST.height,
    "registry fast profile is 768x768 / 6 steps",
    `${registry.settings.fastWidth}x${registry.settings.fastHeight} / ${registry.settings.fastSteps}`,
  );

  // ── vars the app builds, everything ON ──────────────────────────────────
  setToggles(app, { bypass: true, lora: true, fast: true });
  const on = await captureGenerate(app);
  const onVars = on && on.vars;
  check(!!onVars, "comfyGenerate produced vars");
  check(onVars && onVars.lora_name === LORA, "bypass on: lora_name", onVars && onVars.lora_name);
  check(onVars && onVars.lora_strength === 3.0, "bypass on: lora_strength 3.0", onVars && String(onVars.lora_strength));
  check(
    onVars && onVars.unlocked_lora_name === UNLOCKED_LORA,
    "unlocked on: unlocked_lora_name",
    onVars && onVars.unlocked_lora_name,
  );
  check(
    onVars && onVars.unlocked_lora_strength === 0.8,
    "unlocked on: unlocked_lora_strength 0.8",
    onVars && String(onVars.unlocked_lora_strength),
  );
  check(onVars && onVars.clip_type === "krea2", "clip_type krea2", onVars && onVars.clip_type);
  check(
    onVars && onVars.steps === FAST.steps,
    "fast on: steps 6",
    onVars && String(onVars.steps),
  );
  check(
    onVars && onVars.width === FAST.width && onVars.height === FAST.height,
    "fast on: 768x768",
    onVars && `${onVars.width}x${onVars.height}`,
  );
  check(onVars && onVars.scale === 1.0, "CFG 1.0 unchanged", onVars && String(onVars.scale));

  // ── vars the app builds, every switch OFF (quality mode) ────────────────
  setToggles(app, { bypass: false, lora: false, fast: false });
  const off = await captureGenerate(app);
  const offVars = off && off.vars;
  check(offVars && offVars.lora_name === LORA, "all off: Fedor file still named", offVars && offVars.lora_name);
  check(offVars && offVars.lora_strength === 0, "all off: Fedor strength 0", offVars && String(offVars.lora_strength));
  check(
    offVars && offVars.unlocked_lora_name === UNLOCKED_LORA,
    "all off: SNOFS file still named",
    offVars && offVars.unlocked_lora_name,
  );
  check(
    offVars && offVars.unlocked_lora_strength === 0,
    "all off: SNOFS strength 0",
    offVars && String(offVars.unlocked_lora_strength),
  );
  check(
    offVars && offVars.steps === QUALITY.steps,
    "all off: steps 8",
    offVars && String(offVars.steps),
  );
  check(
    offVars && offVars.width === QUALITY.width && offVars.height === QUALITY.height,
    "all off: 1024x1024",
    offVars && `${offVars.width}x${offVars.height}`,
  );

  // ── the real graph, filled from the captured (everything ON) vars ───────
  const raw = vm.runInContext(
    `substituteComfyWorkflow(builtinComfyWorkflows().find(w => w.id === "krea2-turbo-t2i").workflow, ${JSON.stringify(
      Object.assign({}, onVars, { filename_prefix: PREFIX }),
    )}, "t2i")`,
    app,
  );
  const graph = vm.runInContext(`parseComfyWorkflow(${JSON.stringify(raw)})`, app);
  const nodeCount = Object.keys(graph).length;
  const loraNodes = Object.values(graph)
    .filter((n) => n.class_type === "LoraLoaderModelOnly")
    .sort((a, b) => Number(a.inputs.strength_model) - Number(b.inputs.strength_model));
  const fedorNode = loraNodes.find((n) => n.inputs.lora_name === LORA);
  const snofsNode = loraNodes.find((n) => n.inputs.lora_name === UNLOCKED_LORA);
  console.log(
    `graph: ${nodeCount} nodes, latent ${graph["6"].class_type}, ` +
      `fedor ${fedorNode ? fedorNode.inputs.strength_model : "MISSING"}, ` +
      `snofs ${snofsNode ? snofsNode.inputs.strength_model : "MISSING"}, ` +
      `size ${graph["6"].inputs.width}x${graph["6"].inputs.height}, ` +
      `steps ${graph["8"].inputs.steps}, ` +
      `prefix ${graph["10"].inputs.filename_prefix}`,
  );
  check(nodeCount === 11, "graph has 11 nodes", String(nodeCount));
  check(loraNodes.length === 2, "graph has two LoRA loader nodes", String(loraNodes.length));
  check(!!fedorNode, "graph loads fedor_bypass.safetensors");
  check(!!snofsNode, "graph loads snofs_krea_v1_nostrip.safetensors");
  check(
    !!fedorNode && fedorNode.inputs.strength_model === 3.0,
    "posted Fedor strength 3.0",
    fedorNode && String(fedorNode.inputs.strength_model),
  );
  check(
    !!snofsNode && snofsNode.inputs.strength_model === 0.8,
    "posted SNOFS strength 0.8",
    snofsNode && String(snofsNode.inputs.strength_model),
  );
  check(graph["6"].class_type === "EmptyLatentImage", "EmptyLatentImage canvas", graph["6"].class_type);
  check(
    graph["6"].inputs.width === FAST.width && graph["6"].inputs.height === FAST.height,
    "posted 768x768",
    `${graph["6"].inputs.width}x${graph["6"].inputs.height}`,
  );
  check(graph["8"].inputs.steps === FAST.steps, "posted 6 steps", String(graph["8"].inputs.steps));

  // ── one live generation (both LoRAs on, fast profile on) ───────────────
  const t0 = Date.now();
  const png = await verifyPng(firstImage(await waitFor(await postGraph(graph))));
  const wall = Date.now() - t0;
  console.log(
    `render: ${wall}ms (${(wall / 1000).toFixed(1)}s), ${png.width}x${png.height}, ${png.bytes} bytes, sha256 ${png.sha256.slice(0, 16)}`,
  );
  check(png.isPng, "output is a PNG");
  check(png.bytes > 50000, "output > 50000 bytes", String(png.bytes));
  check(
    png.width === FAST.width && png.height === FAST.height,
    "dimensions 768x768",
    `${png.width}x${png.height}`,
  );
  console.log(`file: ${png.img.subfolder ? png.img.subfolder + "/" : ""}${png.img.filename}`);

  console.log(failures.length ? `FAIL (${failures.join(", ")})` : "PASS");
  process.exitCode = failures.length ? 1 : 0;
})().catch((err) => {
  console.error("HARNESS FAILED:", err.message);
  process.exitCode = 1;
});
