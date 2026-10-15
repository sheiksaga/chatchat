/* ══════════════════════════════════════════════════════════════
   comfy.js — ComfyUI transport

   ComfyUI does not speak the OpenAI image API. There is no
   /images/generations; a request is a *node graph* posted to /prompt,
   and the result has to be collected afterwards:

     1. POST /prompt {prompt: <graph>, client_id} -> {prompt_id}
     2. poll GET /history/<prompt_id> until the entry appears
     3. take the first {filename, subfolder, type} from its outputs
     4. GET /view?filename=..&type=.. -> the PNG bytes

   Step 2 is a poll rather than the /ws websocket. The websocket gives
   per-step progress, which is nicer, but it needs its own connection
   lifecycle (reconnect, ordering, a client_id shared with the POST) for
   a status line that is already accurate enough — a generation here is
   8-13s, and the app shows elapsed time meanwhile.

   Everything the graph needs is substituted into the workflow the user
   chose, using the same placeholder convention SillyTavern uses, so
   workflows already tuned in SillyTavern work here unmodified.
   ══════════════════════════════════════════════════════════════ */

/**
 * Aspect presets, in SDXL-friendly dimensions.
 *
 * SDXL is trained around ~1M pixels; feeding it an arbitrary square (say
 * 768x768) costs quality, so these are the standard buckets. The names match
 * the aspect vocabulary the app's character-card prompts use, so a card or a
 * scene description that says PORTRAIT maps to something concrete.
 */
const COMFY_ASPECTS = {
  PORTRAIT: [832, 1216],
  SQUARE: [1024, 1024],
  LANDSCAPE: [1216, 832],
  CINEMA: [1536, 640],
};

const DEFAULT_COMFY_ASPECT = "PORTRAIT";

/** Bundled default: the turbo workflow, which needs no LoRA to run. */
const DEFAULT_COMFY_WORKFLOW_ID = "wai-hswq-turbo-st";

const COMFY_WORKFLOW_KEY = "comfy_workflow";
const COMFY_WORKFLOW_ID_KEY = "comfy_workflow_id";
const COMFY_ASPECT_KEY = "comfy_aspect";

/**
 * Standard negative prompt for the anime/Illustrious checkpoints this path
 * targets. Their training data makes low-quality and text artefacts the
 * dominant failure mode, so a baseline is more useful than an empty field.
 */
const COMFY_DEFAULT_NEGATIVE =
  "bad quality, worst quality, lowres, jpeg artifacts, blurry, " +
  "bad anatomy, bad hands, extra digits, watermark, signature, text, username";

/** Common across the bundled workflows, so a fresh install still renders. */
const COMFY_DEFAULT_SAMPLER = "euler_ancestral";
const COMFY_DEFAULT_SCHEDULER = "normal";
const COMFY_DEFAULT_STEPS = 6;
const COMFY_DEFAULT_CFG = 1.0;
const COMFY_DEFAULT_DENOISE = 1.0;

/** How often (ms) to ask ComfyUI whether the queued job has finished. */
const COMFY_POLL_MS = 700;
/**
 * Give up after this long. Generous on purpose: the first generation after a
 * restart loads the checkpoint from disk, and on this class of machine that is
 * the slowest part of the whole request.
 */
const COMFY_TIMEOUT_MS = 300000;

/* ── Placeholder substitution ───────────────────────────────────── */

/**
 * Canonical variable names used by the bundled workflows, and the two
 * placeholder spellings that map onto them. SillyTavern's own extension writes
 * `"%prompt%"`; the ComfyInject extension writes `{{POSITIVE_PROMPT}}`. Both
 * appear in the wild (and in `workflows/workflows.js`), so both are understood
 * rather than forcing the user to edit their files.
 */
const COMFY_INJECT_ALIASES = {
  CHECKPOINT: "model",
  POSITIVE_PROMPT: "prompt",
  NEGATIVE_PROMPT: "negative_prompt",
  WIDTH: "width",
  HEIGHT: "height",
  SEED: "seed",
  STEPS: "steps",
  CFG: "scale",
  SAMPLER: "sampler",
  SCHEDULER: "scheduler",
  DENOISE: "denoise",
  TIPO_BAN: "ban_tags",
  BAN_TAGS: "ban_tags",
};

/** The active custom workflow, if the user pasted one. */
function getCustomComfyWorkflow() {
  return (localStorage.getItem(COMFY_WORKFLOW_KEY) || "").trim();
}

/** Which bundled workflow is selected. */
function getComfyWorkflowId() {
  return localStorage.getItem(COMFY_WORKFLOW_ID_KEY) || DEFAULT_COMFY_WORKFLOW_ID;
}

function setComfyWorkflowId(id) {
  safeSetItem(COMFY_WORKFLOW_ID_KEY, id);
}

/** Persist a hand-pasted workflow. An empty string clears the override. */
function setCustomComfyWorkflow(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    localStorage.removeItem(COMFY_WORKFLOW_KEY);
    return;
  }
  safeSetItem(COMFY_WORKFLOW_KEY, trimmed);
}

/** The bundled workflow list (absent if workflows/workflows.js failed to load). */
function builtinComfyWorkflows() {
  return typeof COMFY_BUILTIN_WORKFLOWS !== "undefined" && Array.isArray(COMFY_BUILTIN_WORKFLOWS)
    ? COMFY_BUILTIN_WORKFLOWS
    : [];
}

/**
 * Resolve which workflow graph to use.
 *
 * A pasted workflow wins over any bundled one — someone who pastes JSON has
 * clearly expressed an intent, and silently ignoring it in favour of a default
 * would be baffling.
 * @returns {{id:string,label:string,workflow:string}|null}
 */
function getActiveComfyWorkflow() {
  const custom = getCustomComfyWorkflow();
  if (custom) {
    return { id: "custom", label: "Custom (pasted)", workflow: custom };
  }
  const builtins = builtinComfyWorkflows();
  if (!builtins.length) return null;
  const wanted = getComfyWorkflowId();
  return (
    builtins.find((w) => w.id === wanted) ||
    builtins.find((w) => w.id === DEFAULT_COMFY_WORKFLOW_ID) ||
    builtins[0]
  );
}

/** Current aspect preset name. */
function getComfyAspect() {
  const saved = localStorage.getItem(COMFY_ASPECT_KEY);
  return COMFY_ASPECTS[saved] ? saved : DEFAULT_COMFY_ASPECT;
}

function setComfyAspect(name) {
  if (COMFY_ASPECTS[name]) safeSetItem(COMFY_ASPECT_KEY, name);
}

/** Width/height for the current aspect preset. */
function comfyDimensions() {
  return COMFY_ASPECTS[getComfyAspect()] || COMFY_ASPECTS[DEFAULT_COMFY_ASPECT];
}

/* ── Sampler settings ────────────────────────────────────────────
   These live here rather than in imageParams because they exist only for
   this transport: the OpenAI-shaped providers take a prompt and a size and
   nothing else. Defaults come from the checkpoint's own model card
   (WAI-illustrious HSWQ: CFG 1.0, Euler a) and are what its turbo graph
   expects. */

const COMFY_NEGATIVE_KEY = "comfy_negative_prompt";
const COMFY_CFG_KEY = "comfy_cfg";
const COMFY_SAMPLER_KEY = "comfy_sampler";
const COMFY_SCHEDULER_KEY = "comfy_scheduler";

function getComfyNegativePrompt() {
  const saved = localStorage.getItem(COMFY_NEGATIVE_KEY);
  return saved === null ? COMFY_DEFAULT_NEGATIVE : saved;
}

function setComfyNegativePrompt(text) {
  safeSetItem(COMFY_NEGATIVE_KEY, text || "");
}

function getComfyCfg() {
  const n = parseFloat(localStorage.getItem(COMFY_CFG_KEY));
  return Number.isFinite(n) ? n : COMFY_DEFAULT_CFG;
}

function setComfyCfg(value) {
  const n = parseFloat(value);
  if (Number.isFinite(n)) safeSetItem(COMFY_CFG_KEY, String(n));
}

function getComfySampler() {
  return localStorage.getItem(COMFY_SAMPLER_KEY) || COMFY_DEFAULT_SAMPLER;
}

function setComfySampler(name) {
  if (name) safeSetItem(COMFY_SAMPLER_KEY, name);
}

function getComfyScheduler() {
  return localStorage.getItem(COMFY_SCHEDULER_KEY) || COMFY_DEFAULT_SCHEDULER;
}

function setComfyScheduler(name) {
  if (name) safeSetItem(COMFY_SCHEDULER_KEY, name);
}

/**
 * Every value a bundled or pasted workflow can ask for.
 * @param {string} prompt Positive prompt
 * @param {number} seed Per-chat locked seed
 * @param {string} [banTags] Blacklist for tag-expansion nodes (e.g. TIPO)
 */
function comfyVars(prompt, seed, banTags) {
  const [width, height] = comfyDimensions();
  return {
    model: imageParams.model,
    prompt: prompt,
    negative_prompt: getComfyNegativePrompt(),
    width: width,
    height: height,
    seed: Number.isFinite(seed) ? seed : 0,
    steps: imageParams.steps,
    scale: getComfyCfg(),
    sampler: getComfySampler(),
    scheduler: getComfyScheduler(),
    denoise: COMFY_DEFAULT_DENOISE,
    ban_tags: banTags || "",
  };
}

/**
 * Fill a workflow's placeholders from `vars`.
 *
 * Both conventions are replaced in a single pass so a file mixing them (hand
 * edits often do) still works. Values are inserted with JSON.stringify, which is
 * what makes the quoted SillyTavern form correct: `"%width%"` becomes a bare
 * `1024` number while `"%prompt%"` keeps its quotes and gets properly escaped.
 *
 * An unmapped placeholder is a hard error rather than a warning. A leftover
 * `%seed%` reaches ComfyUI as the literal string `"%seed%"`, and the error it
 * returns names the node but not the real cause — so failing here, with the
 * placeholder named, is far more actionable.
 * @param {string} raw
 * @param {Object<string,*>} vars
 * @returns {string}
 */
function substituteComfyWorkflow(raw, vars) {
  const missing = new Set();
  let out = String(raw);

  /**
   * JSON.stringify is what makes this correct for both conventions. Every
   * placeholder in a workflow file is quoted — `"%width%"` as much as
   * `"{{WIDTH}}"` — because it sits in a JSON string. Replacing the whole
   * quoted run (quotes included) turns a numeric field into a real number,
   * while a text field keeps its quotes and gets its contents escaped.
   * Matching the placeholder alone would leave `""value""` behind: broken
   * JSON that ComfyUI rejects as a graph parse error.
   */
  const value = (canonical, label) => {
    const v = vars[canonical];
    if (v === undefined || v === null) {
      missing.add(label);
      return null;
    }
    return JSON.stringify(v);
  };

  const inject = (key) => COMFY_INJECT_ALIASES[key];

  // SillyTavern style, quoted.
  out = out.replace(/"[ \t]*%([a-z_]+)%[ \t]*"/g, (m, key) => value(key, `%${key}%`) ?? m);
  // The same, where an author dropped the quotes on a numeric field.
  out = out.replace(/%([a-z_]+)%/g, (m, key) => value(key, `%${key}%`) ?? m);
  // ComfyInject style, quoted.
  out = out.replace(/"[ \t]*\{\{([A-Z_]+)\}\}[ \t]*"/g, (m, key) => {
    const canonical = inject(key);
    if (canonical === undefined) {
      missing.add(`{{${key}}}`);
      return m;
    }
    return value(canonical, `{{${key}}}`) ?? m;
  });
  // ComfyInject style, unquoted.
  out = out.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
    const canonical = inject(key);
    if (canonical === undefined) {
      missing.add(`{{${key}}}`);
      return m;
    }
    return value(canonical, `{{${key}}}`) ?? m;
  });

  if (missing.size) {
    throw new Error(
      "The ComfyUI workflow needs values this app does not provide: " +
        [...missing].join(", ") +
        ". Edit the workflow to remove them, or replace them with a supported " +
        "placeholder (SillyTavern style: %prompt% %negative_prompt% %model% " +
        "%width% %height% %seed% %steps% %scale% %sampler% %scheduler%; " +
        "ComfyInject style: {{POSITIVE_PROMPT}} {{NEGATIVE_PROMPT}} " +
        "{{CHECKPOINT}} {{WIDTH}} {{HEIGHT}} {{SEED}} {{STEPS}} {{CFG}} " +
        "{{SAMPLER}} {{SCHEDULER}} {{DENOISE}} {{TIPO_BAN}}).",
    );
  }
  return out;
}

/**
 * Parse and sanity-check a workflow graph.
 *
 * The single most likely mistake is pasting ComfyUI's *editor* export
 * (`{nodes:[], links:[]}`) instead of the API export. ComfyUI's own error for
 * that is unhelpful, and the two files look similar in a text editor, so it is
 * detected here by name.
 * @param {string} raw
 * @returns {object} The graph, ready to POST
 */
function parseComfyWorkflow(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "The ComfyUI workflow is not valid JSON. Paste the exact contents of a " +
        "workflow saved with Workflow → Export (API). (" +
        err.message +
        ")",
    );
  }

  if (doc && Array.isArray(doc.nodes)) {
    throw new Error(
      "That is ComfyUI's editor-format workflow (it has a top-level \"nodes\" " +
        "array), not the API format. In ComfyUI use Workflow → Export (API) " +
        "and paste that file instead.",
    );
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(
      "The ComfyUI workflow must be a JSON object mapping node ids to nodes.",
    );
  }

  const entries = Object.entries(doc);
  if (!entries.length) throw new Error("The ComfyUI workflow has no nodes.");

  const bad = entries.filter(([, n]) => !n || typeof n.class_type !== "string");
  if (bad.length) {
    throw new Error(
      "The ComfyUI workflow has " +
        bad.length +
        " node(s) without a class_type (ids: " +
        bad
          .slice(0, 5)
          .map(([id]) => id)
          .join(", ") +
        "). That usually means it is a UI export or a partial file.",
    );
  }
  return doc;
}

/** Strip trailing slashes so `${base}/prompt` never doubles up. */
function comfyBase(cfg) {
  return String(cfg.baseUrl || "").replace(/\/+$/, "");
}

/* ── Error reporting ────────────────────────────────────────────── */

/**
 * Turn ComfyUI's validation error into something readable.
 *
 * The response nests the useful part two levels deep:
 *   {error:{message}, node_errors:{<id>:{errors:[{message, details,
 *    extra_info:{input_name}}]}}}
 * Reporting "node 1 field ckpt_name: Value not in list — 'x' not in [...]" is
 * the difference between a five-second fix and a puzzled hour.
 * @param {object} data Parsed error body
 * @returns {string}
 */
function comfyValidationError(data) {
  if (!data || typeof data !== "object") return "ComfyUI rejected the workflow.";
  const head =
    (data.error && (data.error.message || data.error.type)) ||
    "ComfyUI rejected the workflow";

  const parts = [];
  for (const [nodeId, info] of Object.entries(data.node_errors || {})) {
    for (const e of (info && info.errors) || []) {
      const field = e.extra_info && e.extra_info.input_name;
      parts.push(
        `node ${nodeId}${field ? ` field ${field}` : ""}: ${e.message}` +
          (e.details ? ` — ${e.details}` : ""),
      );
    }
  }
  return parts.length ? `${head}: ${parts.join("; ")}` : head;
}

/**
 * A failure that happened while *running* the graph (as opposed to being
 * rejected up front) — e.g. an out-of-memory, or a checkpoint deleted since it
 * was listed.
 * @param {object} entry A /history entry
 * @returns {string|null}
 */
function comfyExecutionError(entry) {
  const messages = (entry && entry.status && entry.status.messages) || [];
  for (const m of messages) {
    if (!Array.isArray(m)) continue;
    if (m[0] === "execution_error") {
      const d = m[1] || {};
      const where = d.node_type ? ` (${d.node_type}, node ${d.node_id})` : "";
      return `ComfyUI failed while running${where}: ${
        d.exception_message || d.exception_type || "unknown error"
      }`;
    }
  }
  return null;
}

/** Read the error body without letting a malformed one mask the real failure. */
async function comfyReadError(response) {
  const status = `HTTP ${response.status}`;
  let text = "";
  try {
    text = await response.text();
  } catch (e) {
    return status;
  }
  try {
    return comfyValidationError(JSON.parse(text));
  } catch (e) {
    return text ? `${status}: ${text.slice(0, 200)}` : status;
  }
}

/* ── Discovery ──────────────────────────────────────────────────── */

/**
 * Checkpoints ComfyUI can load.
 *
 * Uses the single-node form `/object_info/CheckpointLoaderSimple` rather than
 * the full `/object_info`: the latter is ~2MB on a normal install (1177 node
 * types here) and mostly irrelevant to this call, while the targeted one is
 * under a kilobyte.
 * @param {object} cfg Resolved provider config
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function comfyCheckpoints(cfg, signal) {
  const response = await fetchApi(
    `${comfyBase(cfg)}/object_info/CheckpointLoaderSimple`,
    { signal },
  );
  if (!response.ok) throw new Error(await apiErrorDetail(response));
  const data = await response.json();
  const list =
    data &&
    data.CheckpointLoaderSimple &&
    data.CheckpointLoaderSimple.input &&
    data.CheckpointLoaderSimple.input.required &&
    data.CheckpointLoaderSimple.input.required.ckpt_name;
  const names = Array.isArray(list) && Array.isArray(list[0]) ? list[0] : [];
  return names.filter((n) => typeof n === "string");
}

/* ── Generation ─────────────────────────────────────────────────── */

/** A stable-ish id for this page load; ComfyUI only uses it to group events. */
let _comfyClientId = null;
function comfyClientId() {
  if (!_comfyClientId) {
    _comfyClientId =
      "chatchat-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  return _comfyClientId;
}

/**
 * Poll /history until our prompt shows up.
 * @returns {Promise<object>} The history entry
 */
async function comfyAwaitHistory(base, promptId, cfg, signal, onStatus) {
  const startedAt = Date.now();
  for (;;) {
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");

    const response = await fetchApi(`${base}/history/${encodeURIComponent(promptId)}`, {
      headers: imageProviderHeaders(cfg),
      signal,
    });
    if (!response.ok) throw new Error(await apiErrorDetail(response));

    const data = await response.json();
    const entry = data && data[promptId];
    if (entry) return entry;

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (Date.now() - startedAt > COMFY_TIMEOUT_MS) {
      throw new Error(
        `ComfyUI did not finish within ${Math.round(COMFY_TIMEOUT_MS / 1000)}s. ` +
          "Check the ComfyUI console — the prompt may still be queued behind " +
          "another job, or a node may be waiting for input.",
      );
    }
    if (onStatus) onStatus(`Rendering… ${elapsed}s`);
    await new Promise((r) => setTimeout(r, COMFY_POLL_MS));
  }
}

/** First image produced by the graph, from whichever node saved one. */
function comfyFirstImage(entry) {
  for (const output of Object.values((entry && entry.outputs) || {})) {
    for (const img of (output && output.images) || []) {
      if (img && img.filename) return img;
    }
  }
  return null;
}

/** Fetch a produced image and return it as a data: URL. */
async function comfyViewAsDataUrl(base, img, cfg, signal) {
  const query = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output",
  });
  const response = await fetchApi(`${base}/view?${query}`, {
    headers: imageProviderHeaders(cfg),
    signal,
  });
  if (!response.ok) throw new Error(await apiErrorDetail(response));

  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image ComfyUI returned"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Run one image generation through ComfyUI.
 * @param {object} opts
 * @param {object} opts.cfg Resolved image provider config
 * @param {Object<string,*>} opts.vars Placeholder values
 * @param {AbortSignal} [opts.signal]
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>} data: URL of the generated image
 */
async function comfyGenerate(opts) {
  const cfg = opts.cfg;
  const base = comfyBase(cfg);

  const active = getActiveComfyWorkflow();
  if (!active) {
    throw new Error(
      "No ComfyUI workflow available — workflows/workflows.js did not load, " +
        "so paste a workflow under Image settings.",
    );
  }

  const graph = parseComfyWorkflow(substituteComfyWorkflow(active.workflow, opts.vars));

  const post = await fetchApi(`${base}/prompt`, {
    method: "POST",
    headers: imageProviderHeaders(cfg),
    body: JSON.stringify({ prompt: graph, client_id: comfyClientId() }),
    signal: opts.signal,
  });
  if (!post.ok) throw new Error(await comfyReadError(post));

  const body = await post.json().catch(() => ({}));
  const promptId = body && body.prompt_id;
  if (!promptId) {
    throw new Error("ComfyUI accepted the request but returned no prompt_id.");
  }
  if (body.node_errors && Object.keys(body.node_errors).length) {
    throw new Error(comfyValidationError(body));
  }

  if (opts.onStatus) opts.onStatus("Queued in ComfyUI…");
  const entry = await comfyAwaitHistory(base, promptId, cfg, opts.signal, opts.onStatus);

  const failure = comfyExecutionError(entry);
  if (failure) throw new Error(failure);

  if (entry.status && entry.status.status_str === "error") {
    throw new Error(
      "ComfyUI reported an error while running the workflow (see the ComfyUI console).",
    );
  }

  const img = comfyFirstImage(entry);
  if (!img) {
    throw new Error(
      "The ComfyUI workflow finished but produced no image. It needs a " +
        "SaveImage or PreviewImage node at the end.",
    );
  }
  return await comfyViewAsDataUrl(base, img, cfg, opts.signal);
}
