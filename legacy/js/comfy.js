/* ══════════════════════════════════════════════════════════════
   comfy.js — ComfyUI transport

   ComfyUI does not speak the OpenAI image API. There is no
   /images/generations; a request is a *node graph* posted to /prompt,
   and the result has to be collected afterwards:

     1. POST /prompt {prompt: <graph>, client_id} -> {prompt_id}
     2. poll GET /history/<prompt_id> until the entry appears
     3. take the first {filename, subfolder, type} from its outputs
     4. GET /view?filename=..&type=.. -> the PNG bytes

   Step 2 is a poll rather than the /ws websocket, so completion is
   detected one poll apart. The websocket is opened *alongside* it for the
   status line only: its per-step `progress` events are what turn a bare
   "Rendering…" into an estimate of the time left (see comfyEtaWatch). When
   the socket cannot be opened — a proxy strips it, or the browser refuses —
   the poll still finishes the job, and the estimate falls back to how long
   this same model/size/steps took last time.

   The workflow to run comes from the registry (js/imagemodels.js): each
   curated model names the bundled text-to-image graph and the bundled
   instruction-edit graph, and those graphs' placeholders are filled from the
   model's own settings. The bundled graphs use ComfyInject's
   `{{PLACEHOLDER}}` form, and SillyTavern's `"%placeholder%"` convention is
   also accepted, so files already tuned in either tool work here unmodified.

   There is no negative prompt and no img2img denoise: FLUX.2 Klein is
   guidance-distilled (CFG 1.0, 4 steps) and takes an instruction plus the
   source picture as a reference latent. An edit is the model's own edit
   workflow, not the text-to-image graph rewired.
   ══════════════════════════════════════════════════════════════ */

/**
 * Aspect presets. Used only when a caller asks for an aspect by name instead
 * of the model's own width/height.
 */
const COMFY_ASPECTS = {
  PORTRAIT: [832, 1216],
  SQUARE: [1024, 1024],
  LANDSCAPE: [1216, 832],
  CINEMA: [1536, 640],
};

/** How often (ms) to ask ComfyUI whether the queued job has finished. */
const COMFY_POLL_MS = 700;
/**
 * Give up after this long. Generous on purpose: the first generation after a
 * restart loads the checkpoint from disk, and on this class of machine that is
 * the slowest part of the whole request.
 */
const COMFY_TIMEOUT_MS = 300000;
/**
 * Roughly how long the tail after the last sampler step takes: VAE decode,
 * then writing the PNG. Added to the step-based estimate so the status line
 * does not promise 0s while the picture is still being decoded.
 */
const COMFY_TAIL_MS = 1500;
/** Where measured render times are remembered, per model/size/steps. */
const COMFY_TIMINGS_KEY = "chatchat_comfy_timings";
/** Samples kept per configuration — enough for a median, small enough to store. */
const COMFY_TIMING_SAMPLES = 8;

/* ── Placeholder substitution ───────────────────────────────────── */

/**
 * Canonical variable names used by the bundled workflows, and the two
 * placeholder spellings that map onto them. SillyTavern's own extension writes
 * `"%prompt%"`; the ComfyInject extension writes `{{POSITIVE_PROMPT}}`. Both
 * appear in the wild (and in `workflows/workflows.js`), so both are understood
 * rather than forcing the user to edit their files.
 */
const COMFY_INJECT_ALIASES = {
  MODEL: "model",
  CHECKPOINT: "model",
  CLIP: "clip",
  CLIP_TYPE: "clip_type",
  VAE: "vae",
  MODEL_PATCH: "model_patch",
  // Optional LoRAs applied by the graph's two LoraLoaderModelOnly nodes (Krea2
  // unlocked variants). A graph without those nodes never asks for these.
  LORA_NAME: "lora_name",
  LORA_STRENGTH: "lora_strength",
  UNLOCKED_LORA_NAME: "unlocked_lora_name",
  UNLOCKED_LORA_STRENGTH: "unlocked_lora_strength",
  POSITIVE_PROMPT: "prompt",
  PROMPT: "prompt",
  INSTRUCTION: "instruction",
  INIT_IMAGE: "init_image",
  MASK_IMAGE: "mask_image",
  WIDTH: "width",
  HEIGHT: "height",
  SEED: "seed",
  STEPS: "steps",
  CFG: "scale",
  SAMPLER: "sampler",
  SCHEDULER: "scheduler",
  FILENAME_PREFIX: "filename_prefix",
};

/**
 * Placeholders each kind of graph is expected to resolve. `{{INSTRUCTION}}`
 * and `{{INIT_IMAGE}}` belong to the edit and inpaint graphs only;
 * `{{MASK_IMAGE}}` and `{{MODEL_PATCH}}` belong to the inpaint graph only.
 * Requiring them of the text-to-image graph would reject a perfectly good T2I
 * workflow.
 */
const COMFY_GRAPH_T2I = "t2i";
const COMFY_GRAPH_EDIT = "edit";
const COMFY_GRAPH_INPAINT = "inpaint";

/** The bundled workflow list (absent if workflows/workflows.js failed to load). */
function builtinComfyWorkflows() {
  return typeof COMFY_BUILTIN_WORKFLOWS !== "undefined" &&
    Array.isArray(COMFY_BUILTIN_WORKFLOWS)
    ? COMFY_BUILTIN_WORKFLOWS
    : [];
}

/**
 * Look up a bundled workflow by id, falling back to the app default and then
 * to whatever the manifest ships first.
 * @param {string} [id]
 * @returns {{id:string,label:string,workflow:string}|null}
 */
function getComfyWorkflowById(id) {
  const builtins = builtinComfyWorkflows();
  if (!builtins.length) return null;
  return (
    builtins.find((w) => w.id === id) ||
    builtins.find((w) => w.id === IMAGE_DEFAULT_WORKFLOW_ID) ||
    builtins[0]
  );
}

/** Dimensions for an aspect preset name, defaulting to PORTRAIT. */
function comfyDimensions(aspect) {
  return COMFY_ASPECTS[aspect] || COMFY_ASPECTS.PORTRAIT;
}

/**
 * Every value a bundled or pasted workflow can ask for, assembled from the
 * model's registry settings.
 * @param {string} prompt Positive prompt
 * @param {number} seed Per-chat locked seed
 * @param {string} model The selected checkpoint id
 * @param {object} settings Resolved model settings (see imagemodels.js)
 * @param {object} [overrides] Per-call overrides (e.g. an explicit size)
 * @returns {Object<string,*>}
 */
function comfyVars(prompt, seed, model, settings, overrides) {
  const o = overrides || {};
  const size = o.aspect ? comfyDimensions(o.aspect) : null;
  return {
    model: settings.unet || model,
    clip: settings.clip,
    clip_type: settings.clipType,
    vae: settings.vae,
    // The LLLite inpainting side-adapter, loaded by ModelPatchLoader. Only the
    // anima-lllite-inpaint graph asks for it, so a T2I/edit graph that never
    // references the key is unaffected.
    model_patch: o.modelPatch || settings.modelPatch,
    // The optional LoRAs the graph loads through its two LoraLoaderModelOnly
    // nodes — the Krea2 unlocked-variant files. Strength 0 makes each node a
    // no-op, which is what the toggle-off path sends.
    lora_name: o.loraName || settings.loraName || "",
    lora_strength:
      o.loraStrength !== undefined
        ? o.loraStrength
        : (settings.loraStrength ?? 0),
    unlocked_lora_name:
      o.unlockedLoraName || settings.unlockedLoraName || "",
    unlocked_lora_strength:
      o.unlockedLoraStrength !== undefined
        ? o.unlockedLoraStrength
        : (settings.unlockedLoraStrength ?? 0),
    prompt: prompt,
    // Where ComfyUI writes the PNG. The model's own prefix (`Anima`, `ComfyInject`)
    // so files on disk say which route drew them; a per-call override is used by
    // the smoke harness.
    filename_prefix: o.filenamePrefix || settings.filenamePrefix,
    width: o.width || (size && size[0]) || settings.width,
    height: o.height || (size && size[1]) || settings.height,
    // The seed policy lives in one place (js/state.js): an explicit seed from
    // the caller, otherwise whatever the fixed/random/last setting says.
    seed: Number.isFinite(seed)
      ? seed
      : typeof nextImageSeed === "function"
        ? nextImageSeed()
        : Math.floor(Math.random() * 1e15),
    steps: o.steps || settings.steps,
    scale: o.cfg !== undefined ? o.cfg : settings.cfg,
    sampler: o.sampler || settings.sampler,
    scheduler: o.scheduler || settings.scheduler,
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
 * @param {string} [kind] {@link COMFY_GRAPH_T2I} or {@link COMFY_GRAPH_EDIT};
 *   an edit graph may not leave its instruction or source picture unfilled
 * @returns {string}
 */
function substituteComfyWorkflow(raw, vars, kind) {
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
  out = out.replace(
    /"[ \t]*%([a-z_]+)%[ \t]*"/g,
    (m, key) => value(key, `%${key}%`) ?? m,
  );
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
        "placeholder ({{MODEL}} {{CLIP}} {{CLIP_TYPE}} {{VAE}} {{PROMPT}} " +
        "{{LORA_NAME}} {{LORA_STRENGTH}} " +
        "{{UNLOCKED_LORA_NAME}} {{UNLOCKED_LORA_STRENGTH}} " +
        "{{WIDTH}} {{HEIGHT}} {{SEED}} {{STEPS}} {{CFG}} {{SAMPLER}}" +
        (kind === COMFY_GRAPH_EDIT || kind === COMFY_GRAPH_INPAINT
          ? ", {{INSTRUCTION}}, {{INIT_IMAGE}}"
          : "") +
        (kind === COMFY_GRAPH_INPAINT
          ? ", {{MASK_IMAGE}}, {{MODEL_PATCH}})."
          : ")."),
    );
  }
  if (kind === COMFY_GRAPH_EDIT) {
    // A prompt the user typed instead of a change instruction would render a
    // picture that ignores the source, which reads as a broken edit.
    if (vars.instruction === undefined || vars.instruction === null) {
      throw new Error(
        "This workflow has no {{INSTRUCTION}} field, so it can't take an edit " +
          "instruction. Pick the flux2-klein-edit workflow.",
      );
    }
    if (!vars.init_image) {
      throw new Error(
        "This workflow has no {{INIT_IMAGE}} field, so it can't take a picture " +
          "to edit. Pick the flux2-klein-edit workflow.",
      );
    }
  }
  if (kind === COMFY_GRAPH_INPAINT) {
    // Same reasoning as an edit, plus the mask: an inpaint graph with no mask
    // would repaint the whole picture on every step and return something that
    // looks like a broken redraw rather than a change.
    if (vars.instruction === undefined || vars.instruction === null) {
      throw new Error(
        "This workflow has no {{INSTRUCTION}} field, so it can't take an " +
          "inpaint instruction. Pick the anima-lllite-inpaint workflow.",
      );
    }
    if (!vars.init_image) {
      throw new Error(
        "This workflow has no {{INIT_IMAGE}} field, so it can't take a picture " +
          "to inpaint. Pick the anima-lllite-inpaint workflow.",
      );
    }
    if (!vars.mask_image) {
      throw new Error(
        "This workflow has no {{MASK_IMAGE}} field, so it has nothing to " +
          "paint. Pick the anima-lllite-inpaint workflow.",
      );
    }
    if (!vars.model_patch) {
      throw new Error(
        "This workflow loads no {{MODEL_PATCH}} adapter, so it is not an " +
          "inpaint graph. Pick the anima-lllite-inpaint workflow.",
      );
    }
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
    throw new Error("The ComfyUI workflow is not valid JSON: " + err.message);
  }
  if (doc && Array.isArray(doc.nodes)) {
    throw new Error(
      'That is ComfyUI\'s editor-format workflow (it has a top-level "nodes" ' +
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
  if (!data || typeof data !== "object")
    return "ComfyUI rejected the workflow.";
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
 * Diffusion models ComfyUI can load.
 *
 * FLUX.2 is loaded by `UNETLoader` (`models/diffusion_models`), not by
 * CheckpointLoaderSimple, so that node's `unet_name` list is what the image
 * model dropdown shows. Falls back to CheckpointLoaderSimple when a ComfyUI
 * install has no UNETLoader node, so an older install still lists something.
 * Uses the single-node `/object_info/<node>` form rather than the full
 * `/object_info`: the latter is megabytes on a normal install.
 * @param {object} cfg Resolved provider config
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function comfyCheckpoints(cfg, signal) {
  const base = comfyBase(cfg);
  const namesFor = async (node, field) => {
    const response = await fetchApi(`${base}/object_info/${node}`, { signal });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const info = data && data[node];
    const list =
      info &&
      info.input &&
      info.input.required &&
      info.input.required[field];
    const names = Array.isArray(list) && Array.isArray(list[0]) ? list[0] : [];
    return names.filter((n) => typeof n === "string");
  };

  const unets = await namesFor("UNETLoader", "unet_name");
  if (unets && unets.length) return unets;
  const checkpoints = await namesFor(
    "CheckpointLoaderSimple",
    "ckpt_name",
  );
  return checkpoints || [];
}

/* ── Generation ─────────────────────────────────────────────────── */

/** A stable-ish id for this page load; ComfyUI only uses it to group events. */
let _comfyClientId = null;
function comfyClientId() {
  if (!_comfyClientId) {
    _comfyClientId =
      "chatchat-" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);
  }
  return _comfyClientId;
}

/* ── Time-remaining estimate ────────────────────────────────────── */

/**
 * Key under which a render's duration is remembered. Everything that changes
 * how long a graph takes belongs in it: another checkpoint or a bigger canvas
 * makes the stored median meaningless.
 */
function comfyTimingKey(model, settings, kind) {
  return [
    model,
    kind || COMFY_GRAPH_T2I,
    `${settings.width}x${settings.height}`,
    `steps:${settings.steps}`,
  ].join("|");
}

/** Stored durations (ms) for one configuration, oldest first. */
function comfyTimingSamples(key) {
  const all = safeGetJSON(COMFY_TIMINGS_KEY, {});
  const list = all && typeof all === "object" ? all[key] : null;
  return Array.isArray(list)
    ? list.filter((n) => Number.isFinite(n) && n > 0)
    : [];
}

/**
 * How long this configuration has taken before — the median of recent runs, so
 * one generation that queued behind a long job does not skew the next estimate.
 * @returns {number|null} milliseconds, or null when nothing is known yet
 */
function comfyExpectedMs(key) {
  const samples = comfyTimingSamples(key).sort((a, b) => a - b);
  if (!samples.length) return null;
  return samples[Math.floor((samples.length - 1) / 2)];
}

/** Remember one completed render, keeping only the most recent few. */
function comfyRecordMs(key, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const all = safeGetJSON(COMFY_TIMINGS_KEY, {});
  const store = all && typeof all === "object" ? all : {};
  store[key] = comfyTimingSamples(key)
    .concat(Math.round(ms))
    .slice(-COMFY_TIMING_SAMPLES);
  safeSetItem(COMFY_TIMINGS_KEY, JSON.stringify(store));
}

/** Websocket URL for the configured ComfyUI, sharing the POST's client_id. */
function comfyWsUrl(cfg) {
  const url = new URL(comfyBase(cfg) || ".", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/+$/, "") + "/ws";
  url.search = "?clientId=" + encodeURIComponent(comfyClientId());
  url.hash = "";
  return url.toString();
}

/**
 * Follow a running prompt's `progress` events and turn them into a live
 * "time left" estimate.
 *
 * ComfyUI reports steps, not time, so the estimate comes from the observed
 * cadence: how long the last few steps took, multiplied by the steps still to
 * run, minus the time since the last event (which is why the number keeps
 * counting down between events). It is smoothed, because a single slow step —
 * a page fault, another job on the GPU — would otherwise swing the estimate by
 * seconds.
 * @param {object} cfg Resolved provider config
 * @param {string} promptId The prompt to follow
 * @returns {{remainingMs: () => (number|null), stop: () => void}}
 */
function comfyEtaWatch(cfg, promptId) {
  const state = {
    stepsDone: 0,
    stepsTotal: 0,
    msPerStep: 0,
    lastAt: 0,
  };

  let ws = null;
  if (typeof WebSocket === "function") {
    try {
      ws = new WebSocket(comfyWsUrl(cfg));
    } catch (e) {
      ws = null;
    }
  }

  if (ws) {
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      const d = msg && msg.data;
      if (!d) return;
      // Older ComfyUI omits prompt_id on progress; newer versions include it.
      if (d.prompt_id && d.prompt_id !== promptId) return;
      if (msg.type !== "progress") return;

      const done = Number(d.value);
      const total = Number(d.max);
      if (!(total > 0) || !(done > 0)) return;

      const now = Date.now();
      // A second sampler restarts its own count; drop the old cadence rather
      // than averaging two unrelated step times together.
      if (done < state.stepsDone) state.msPerStep = 0;
      if (state.lastAt && done > state.stepsDone) {
        const sample = (now - state.lastAt) / (done - state.stepsDone);
        state.msPerStep = state.msPerStep
          ? state.msPerStep * 0.7 + sample * 0.3
          : sample;
      }
      state.stepsDone = done;
      state.stepsTotal = total;
      state.lastAt = now;
    };
    ws.onerror = () => {}; // The estimate simply stays unavailable.
  }

  return {
    /** @returns {number|null} Milliseconds expected to remain, or null. */
    remainingMs: () => {
      if (!state.stepsTotal || !state.msPerStep) return null;
      const stepsLeft = Math.max(0, state.stepsTotal - state.stepsDone);
      const sinceLast = state.lastAt ? Date.now() - state.lastAt : 0;
      const tail = stepsLeft ? COMFY_TAIL_MS : 0;
      return Math.max(0, stepsLeft * state.msPerStep - sinceLast + tail);
    },
    stop: () => {
      if (!ws) return;
      try {
        ws.close();
      } catch (e) {
        /* already closed */
      }
      ws = null;
    },
  };
}

/**
 * The status line: expected time to finish, never the time already spent.
 * Falls back to the remembered duration until the first progress event gives a
 * measurement, and to no number at all when neither is available.
 */
function comfyEtaLabel(eta, expectedMs, startedAt) {
  let remaining = eta.remainingMs();
  if (remaining === null && expectedMs) {
    remaining = expectedMs - (Date.now() - startedAt);
  }
  if (remaining === null) return "Rendering…";
  // A remembered duration that has already run out (the job is queued behind
  // something long) is no estimate at all — better to show no number than to
  // promise "1s left" for a minute.
  if (remaining < 0) return "Rendering…";
  const seconds = Math.max(1, Math.round(remaining / 1000));
  return `Rendering… ~${seconds}s left`;
}

/**
 * Poll /history until our prompt shows up.
 * @param {{remainingMs: () => (number|null), stop: () => void}} eta
 * @returns {Promise<object>} The history entry
 */
async function comfyAwaitHistory(
  base,
  promptId,
  cfg,
  signal,
  onStatus,
  eta,
  expectedMs,
) {
  const startedAt = Date.now();
  for (;;) {
    if (signal && signal.aborted)
      throw new DOMException("Aborted", "AbortError");

    const response = await fetchApi(
      `${base}/history/${encodeURIComponent(promptId)}`,
      {
        headers: imageProviderHeaders(cfg),
        signal,
      },
    );
    if (!response.ok) throw new Error(await apiErrorDetail(response));

    const data = await response.json();
    const entry = data && data[promptId];
    if (entry) return entry;

    if (Date.now() - startedAt > COMFY_TIMEOUT_MS) {
      throw new Error(
        `ComfyUI did not finish within ${Math.round(COMFY_TIMEOUT_MS / 1000)}s. ` +
          "Check the ComfyUI console — the prompt may still be queued behind " +
          "another job, or a node may be waiting for input.",
      );
    }
    if (onStatus) onStatus(comfyEtaLabel(eta, expectedMs, startedAt));
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
    reader.onerror = () =>
      reject(new Error("Could not read the image ComfyUI returned"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload a source picture to ComfyUI's input folder for img2img.
 *
 * ComfyUI loads pictures by name from its input directory — there is no way
 * to hand it bytes inside the graph — so an edit posts the picture to
 * /upload/image first and references what comes back.
 * @param {object} cfg Resolved provider config
 * @param {string} dataUrl data: URL of the picture
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} Name to reference from a LoadImage node
 */
async function comfyUploadImage(cfg, dataUrl, signal, role) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match || !match[2]) {
    throw new Error(
      role === "mask"
        ? "The mask isn't available as image data — paint it again."
        : "The picture to edit isn't available as image data any more — regenerate it first.",
    );
  }
  const mime = match[1] || "image/png";
  const extension = (mime.split("/")[1] || "png").replace("jpeg", "jpg");
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // `role` keeps a source and its mask from sharing a name when both are
  // uploaded for one inpaint request.
  const name =
    "chatchat-" +
    (role || "edit") +
    "-" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6) +
    "." +
    extension;

  const form = new FormData();
  form.append("image", new Blob([bytes], { type: mime }), name);
  form.append("overwrite", "true");
  form.append("type", "input");

  // Deliberately not imageProviderHeaders(): that sets a JSON content type,
  // and multipart/form-data must let the browser draw its own boundary.
  const headers = {};
  if (cfg.key) headers["Authorization"] = "Bearer " + cfg.key;
  const response = await fetchApi(`${comfyBase(cfg)}/upload/image`, {
    method: "POST",
    headers: headers,
    body: form,
    signal,
  });
  if (!response.ok) throw new Error(await apiErrorDetail(response));

  const body = await response.json().catch(() => ({}));
  if (!body || !body.name) {
    throw new Error("ComfyUI did not confirm the picture upload.");
  }
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/* ── Generation ────────────────────────────────────────────────── */

/**
 * Run one image generation through ComfyUI.
 *
 * Shared by {@link comfyGenerate} (text to image) and {@link comfyEdit}
 * (instruction edit): both submit a graph, follow its websocket ETA, poll
 * /history, and return the first picture it saved. Only the graph and the
 * placeholders differ — no negative prompt, no denoise, no VAE probe.
 * @param {object} opts
 * @param {object} opts.cfg Resolved image provider config
 * @param {string} opts.model The selected diffusion model id
 * @param {string} opts.kind {@link COMFY_GRAPH_T2I} or {@link COMFY_GRAPH_EDIT}
 * @param {object} opts.workflow The bundled workflow entry
 * @param {object} opts.settings Resolved model settings
 * @param {object} opts.vars Placeholder values
 * @param {AbortSignal} [opts.signal]
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>} data: URL of the generated image
 */
async function comfyRunGraph(opts) {
  const cfg = opts.cfg;
  const base = comfyBase(cfg);
  const settings = opts.settings;

  const graph = parseComfyWorkflow(
    substituteComfyWorkflow(opts.workflow.workflow, opts.vars, opts.kind),
  );

  // One line per render: a wrong recipe is usually invisible in the picture but
  // obvious here. FLUX.2 Klein is distilled — anything but cfg 1 / 4 steps
  // burns the picture.
  console.debug(
    `[image] ${opts.model} (${opts.kind}): cfg ${opts.vars.scale}, ` +
      `${opts.vars.steps} steps, ` +
      `${opts.vars.sampler}/${opts.vars.scheduler}, ` +
      `${opts.vars.width}x${opts.vars.height}`,
  );

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

  const timingKey = comfyTimingKey(opts.model, settings, opts.kind);
  // Opened before the await so the socket is listening when ComfyUI starts the
  // graph — the first steps are the ones with no estimate to show yet.
  const eta = comfyEtaWatch(cfg, promptId);
  const startedAt = Date.now();

  try {
    if (opts.onStatus) opts.onStatus("Queued in ComfyUI…");
    const entry = await comfyAwaitHistory(
      base,
      promptId,
      cfg,
      opts.signal,
      opts.onStatus,
      eta,
      comfyExpectedMs(timingKey),
    );

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
    // Only a render that actually produced a picture is worth remembering — a
    // graph that failed early would drag the next estimate far too low.
    comfyRecordMs(timingKey, Date.now() - startedAt);
    return await comfyViewAsDataUrl(base, img, cfg, opts.signal);
  } finally {
    eta.stop();
  }
}

/**
 * Resolve a model id plus caller overrides into a settings object.
 * @param {string} model
 * @param {object} [overrides]
 * @returns {{meta:object, settings:object}}
 */
function comfyResolveModel(model, overrides) {
  const meta = resolveImageModelMeta(model);
  return {
    meta: meta,
    settings: Object.assign({}, meta.settings, overrides || {}),
  };
}

/**
 * Look up a bundled workflow by id; the manifest must actually contain it.
 * @param {string} id
 * @param {string} purpose Description used in the error message
 * @returns {object}
 */
function comfyRequireWorkflow(id, purpose) {
  const workflows = builtinComfyWorkflows();
  if (!workflows.length) {
    throw new Error(
      "No ComfyUI workflow available — workflows/workflows.js did not load.",
    );
  }
  const workflow = workflows.find((w) => w.id === id);
  if (!workflow) {
    throw new Error(
      `The ${purpose} workflow "${id}" is not bundled in ` +
        "workflows/workflows.js — re-run node tools/sync-workflows.js.",
    );
  }
  return workflow;
}

/**
 * Extra values the edit graph needs on top of the T2I vars.
 * @param {string} instruction Natural-language edit instruction
 * @param {string} imageName Name returned by {@link comfyUploadImage}
 * @returns {{instruction:string, init_image:string}}
 */
function comfyEditVars(instruction, imageName) {
  return { instruction: instruction, init_image: imageName };
}

/**
 * Edits render on their own canvas, not the T2I one: FLUX.2 Klein's edit graph
 * takes 16.53 s at 832x1216 and 9.20 s at 832x1152 @ 4 steps, so the registry
 * entry carries `editWidth`/`editHeight` (see _notes/PHASE2_EDIT_LATENCY.md).
 * Entries without them fall back to the T2I size.
 * @param {object} meta Resolved registry entry
 * @param {object} [overrides] Per-call overrides; an explicit size still wins
 * @returns {object} Vars overrides for {@link comfyVars}
 */
function comfyEditSizeVars(meta, overrides) {
  const o = overrides || {};
  if (o.width || o.height || o.aspect) return {};
  return { width: meta.editWidth, height: meta.editHeight };
}

/**
 * Draw one picture from a prompt through ComfyUI (text to image).
 * @param {object} opts
 * @param {object} opts.cfg Resolved image provider config
 * @param {string} opts.model The selected diffusion model id
 * @param {string} opts.prompt Natural-language prompt
 * @param {object} [opts.settings] Model settings; defaults to the registry's
 * @param {string} [opts.workflowId] Override the registry's workflow choice
 * @param {number} [opts.seed]
 * @param {object} [opts.overrides] Per-call sampler/size overrides
 * @param {AbortSignal} [opts.signal]
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>} data: URL of the generated image
 */
async function comfyGenerate(opts) {
  const model = opts.model || imageParams.model;
  const resolved = comfyResolveModel(model, opts.settings);
  const workflow = comfyRequireWorkflow(
    opts.workflowId || resolved.meta.workflowId,
    "text-to-image",
  );

  // Krea2 ships two optional unlocked-variant LoRAs and a fast render profile.
  // The registry names the files; the on/off decisions are the user's checkboxes
  // (imageParams.unlockedBypass / .unlockedLora / .krea2Fast), so a strength is
  // only non-zero when its toggle is on. Models whose entry names neither LoRA
  // are untouched — their graphs have no LoRA nodes anyway.
  const overrides = Object.assign({}, opts.overrides);
  if (resolved.settings.loraName) {
    if (overrides.loraName === undefined) overrides.loraName = resolved.settings.loraName;
    if (overrides.loraStrength === undefined) {
      overrides.loraStrength = (typeof imageParams !== "undefined" && imageParams.unlockedBypass)
        ? (resolved.settings.loraStrength || 3.0)
        : 0;
    }
  }
  if (resolved.settings.unlockedLoraName) {
    if (overrides.unlockedLoraName === undefined) {
      overrides.unlockedLoraName = resolved.settings.unlockedLoraName;
    }
    if (overrides.unlockedLoraStrength === undefined) {
      overrides.unlockedLoraStrength =
        (typeof imageParams !== "undefined" && imageParams.unlockedLora)
          ? (resolved.settings.unlockedLoraStrength || 0.8)
          : 0;
    }
  }
  // Fast profile: a smaller canvas and fewer steps, so a Krea2 render finishes
  // sooner. It only fills in what the caller left out — an explicit size or step
  // count still wins, and the harness relies on that to test both modes.
  if (
    resolved.settings.fastSteps &&
    typeof imageParams !== "undefined" &&
    imageParams.krea2Fast
  ) {
    if (overrides.steps === undefined) overrides.steps = resolved.settings.fastSteps;
    if (overrides.width === undefined) overrides.width = resolved.settings.fastWidth;
    if (overrides.height === undefined) overrides.height = resolved.settings.fastHeight;
  }

  return await comfyRunGraph({
    cfg: opts.cfg,
    model: model,
    kind: COMFY_GRAPH_T2I,
    workflow: workflow,
    settings: resolved.settings,
    vars: comfyVars(
      opts.prompt,
      opts.seed,
      model,
      resolved.settings,
      overrides,
    ),
    signal: opts.signal,
    onStatus: opts.onStatus,
  });
}

/**
 * Edit one picture with a natural-language instruction through ComfyUI.
 *
 * FLUX.2 Klein does instruction editing natively: the source picture is
 * uploaded, encoded to a latent, and attached to the instruction's
 * conditioning as a reference — there is no denoise strength to set. The
 * graph scales the source to the target pixel count on the way in, so the
 * composition survives unless the instruction changes it.
 * @param {object} opts
 * @param {object} opts.cfg Resolved image provider config
 * @param {string} opts.model The selected diffusion model id
 * @param {string} opts.instruction What to change ("make her hair red")
 * @param {string} opts.initImage data: URL of the picture to edit
 * @param {object} [opts.settings] Model settings; defaults to the registry's
 * @param {string} [opts.workflowId] Override the registry's edit workflow
 * @param {number} [opts.seed]
 * @param {object} [opts.overrides] Per-call sampler/size overrides
 * @param {AbortSignal} [opts.signal]
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>} data: URL of the edited image
 */
async function comfyEdit(opts) {
  const model = opts.model || imageParams.model;
  const instruction = String(opts.instruction || "").trim();
  if (!opts.initImage) {
    throw new Error("There is no picture to edit — generate one first.");
  }
  if (!instruction) {
    throw new Error(
      "An edit needs an instruction — e.g. /edit make her hair red",
    );
  }
  const resolved = comfyResolveModel(model, opts.settings);
  // Anima is text-to-image only. Running its T2I graph here would return a
  // fresh picture that ignores the source, which reads as a broken edit — so
  // name the limitation instead of drawing anything.
  const editWorkflowId = opts.workflowId || resolved.meta.editWorkflowId;
  if (!editWorkflowId) {
    throw new Error(
      `${resolved.meta.label} is T2I-only; switch to FLUX.2 to edit.`,
    );
  }
  const workflow = comfyRequireWorkflow(editWorkflowId, "edit");

  if (opts.onStatus) opts.onStatus("Uploading source image…");
  const imageName = await comfyUploadImage(
    opts.cfg,
    opts.initImage,
    opts.signal,
  );

  return await comfyRunGraph({
    cfg: opts.cfg,
    model: model,
    kind: COMFY_GRAPH_EDIT,
    workflow: workflow,
    settings: resolved.settings,
    vars: Object.assign(
      comfyVars(
        instruction,
        opts.seed,
        model,
        resolved.settings,
        Object.assign(
          comfyEditSizeVars(resolved.meta, opts.overrides),
          opts.overrides,
        ),
      ),
      comfyEditVars(instruction, imageName),
    ),
    signal: opts.signal,
    onStatus: opts.onStatus,
  });
}

/**
 * Extra values the inpaint graph needs on top of the T2I vars.
 *
 * The source and mask both travel through `/upload/image` and are referenced by
 * name — ComfyUI cannot take bytes inside a graph. The instruction reuses the
 * `instruction` slot the edit graph already uses: same meaning (what should be
 * there afterwards), different graph.
 * @param {string} instruction What the masked area should become
 * @param {string} imageName Uploaded source picture name
 * @param {string} maskName Uploaded white-on-black mask name
 * @returns {{instruction:string, init_image:string, mask_image:string}}
 */
function comfyInpaintVars(instruction, imageName, maskName) {
  return {
    instruction: instruction,
    init_image: imageName,
    mask_image: maskName,
  };
}

/**
 * State the source picture's natural size.
 *
 * The validated inpaint graph derives its latent from the source through
 * `VAEEncodeForInpaint`, so `{{WIDTH}}`/`{{HEIGHT}}` no longer drive a node —
 * but they must still be supplied, and they must be the source's own size, not
 * the registry canvas. A 832x1216 portrait rendered at the Anima T2I default of
 * 1024x1024 would silently claim a canvas the mask was never drawn for.
 * @param {number} width
 * @param {number} height
 * @returns {{width:number, height:number}}
 */
function comfyInpaintSizeVars(width, height) {
  return { width: width, height: height };
}

/**
 * Repaint part of a picture through ComfyUI's Anima LLLite inpaint graph.
 *
 * A different feature from {@link comfyEdit}, on purpose:
 *
 *   comfyEdit    FLUX.2 only. One instruction, no mask, the model decides
 *                what changes. Recorded with `editWorkflowId`.
 *   comfyInpaint Anima only. One instruction *scoped by a mask*: white pixels
 *                are repainted, black pixels are kept.
 *
 * The mask is painted in the browser at the picture's natural resolution and
 * exported as a white-on-black PNG — `LoadImageMask` reads the red channel, so
 * there is no alpha to get wrong. Both files are uploaded, then the graph runs
 * at a fixed 8 steps / CFG 1.0 / euler/simple with LLLite at strength 1.0. That
 * is the recipe measured at ~9 s warm at both 832x1216 and 1024x1024
 * (_notes/PHASE3_ANIMA_INPAINT_BACKEND.md); strength, steps and cfg barely move
 * the result, so mask quality is the only lever worth exposing.
 *
 * There is deliberately no fallback to FLUX.2 here: a model with no inpaint
 * graph is refused by name rather than handed an instruction it would ignore.
 *
 * @param {object} opts
 * @param {object} opts.cfg Resolved image provider config
 * @param {string} [opts.model] Model id; defaults to the selected one
 * @param {string} opts.instruction What the masked area should become
 * @param {string} opts.initImage data: URL of the picture to inpaint
 * @param {string} opts.maskImage data: URL of the white-on-black mask PNG
 * @param {number} [opts.width] Source width in pixels (falls back to settings)
 * @param {number} [opts.height] Source height in pixels (falls back to settings)
 * @param {number} [opts.seed]
 * @param {object} [opts.settings] Model settings; defaults to the registry's
 * @param {string} [opts.workflowId] Override the registry's inpaint workflow
 * @param {AbortSignal} [opts.signal]
 * @param {(status:string)=>void} [opts.onStatus]
 * @returns {Promise<string>} data: URL of the inpainted image
 */
async function comfyInpaint(opts) {
  const model = opts.model || imageParams.model;
  const instruction = String(opts.instruction || "").trim();
  if (!opts.initImage) {
    throw new Error("There is no picture to inpaint — generate one first.");
  }
  if (!opts.maskImage) {
    throw new Error(
      "Inpainting needs a mask — paint over the part you want to change.",
    );
  }

  const resolved = comfyResolveModel(model, opts.settings);
  // No silent FLUX.2 substitution: a model with no LLLite graph cannot mask.
  const inpaintWorkflowId =
    opts.workflowId || resolved.meta.inpaintWorkflowId;
  if (!inpaintWorkflowId) {
    throw new Error(
      `${resolved.meta.label} can't inpaint; switch to Anima to paint a mask.`,
    );
  }
  const modelPatch = resolved.meta.modelPatch;
  if (!modelPatch) {
    throw new Error(
      `${resolved.meta.label} has no inpainting model patch — check the ` +
        "registry entry in js/imagemodels.js.",
    );
  }
  const workflow = comfyRequireWorkflow(inpaintWorkflowId, "inpaint");

  const settings = resolved.settings;
  // The graph takes its latent from the source image, so the natural source
  // size is the honest number to state. The mask modal measures the bitmap and
  // passes it; without one, the registry canvas is used.
  const width = Number(opts.width) || settings.width;
  const height = Number(opts.height) || settings.height;

  if (opts.onStatus) opts.onStatus("Uploading source and mask…");
  const imageName = await comfyUploadImage(
    opts.cfg,
    opts.initImage,
    opts.signal,
    "inpaint-src",
  );
  const maskName = await comfyUploadImage(
    opts.cfg,
    opts.maskImage,
    opts.signal,
    "inpaint-mask",
  );

  return await comfyRunGraph({
    cfg: opts.cfg,
    model: model,
    kind: COMFY_GRAPH_INPAINT,
    workflow: workflow,
    settings: Object.assign({}, settings, { width: width, height: height }),
    vars: Object.assign(
      comfyVars(
        instruction,
        opts.seed,
        model,
        Object.assign({}, settings, {
          width: width,
          height: height,
          modelPatch: modelPatch,
          // 8 steps / CFG 1 / euler / simple is the validated recipe. The
          // scheduler is hard-coded to `simple` in this graph on purpose (it is
          // not a placeholder there), so it is not passed in here.
          steps: resolved.meta.inpaintSteps || settings.steps,
          cfg: 1.0,
          sampler: "euler",
        }),
        comfyInpaintSizeVars(width, height),
      ),
      comfyInpaintVars(instruction, imageName, maskName),
    ),
    signal: opts.signal,
    onStatus: opts.onStatus,
  });
}
