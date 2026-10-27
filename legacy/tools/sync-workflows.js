#!/usr/bin/env node
/**
 * sync-workflows.js — bundle the FLUX.2 Klein API graphs into
 * `workflows/workflows.js`, a script-loadable manifest.
 *
 * Why generate a `.js` file instead of copying the JSON and fetching it?
 * chatchat has to keep working as a bare `file://` page (see AGENTS.md), and
 * `fetch()` on a `file://` URL is blocked by CORS. A `<script>` tag is not. So
 * the manifest is JS, not JSON — same reason `cards/cards.js` exists.
 *
 * Only these graphs are bundled:
 *
 *   flux2_klein_t2i.json     text to image (default)
 *   flux2_klein_edit.json    instruction edit of one source picture
 *   anima_turbo_t2i.json     anime text to image (T2I only — no edit graph)
 *   anima_lllite_inpaint.json  Anima + LLLite mask inpainting of one picture
 *   krea2_turbo_t2i.json     Krea2 Turbo text to image, with optional
 *                            unlocked-variant LoRAs (T2I only)
 *
 * Nothing is collected from SillyTavern or the ComfyInject extension any more:
 * the retired SDXL/WAI/TIPO workflows must never reach the dropdown, and a
 * scan of those folders would keep re-adding them.
 *
 * Usage:
 *   node tools/sync-workflows.js [path-to-workflow-folder]
 *
 * Default folder: <ComfyUI root>/user/default/workflows, resolving the ComfyUI
 * root from COMFYUI_ROOT or the two known portable install locations.
 */

const fs = require("fs");
const path = require("path");

/** The graphs this app ships, in dropdown order, with the id the app uses. */
const REQUIRED_WORKFLOWS = [
  {
    id: "flux2-klein-t2i",
    label: "FLUX.2 Klein T2I",
    file: "flux2_klein_t2i.json",
    needs: ["{{MODEL}}", "{{CLIP}}", "{{CLIP_TYPE}}", "{{VAE}}", "{{PROMPT}}"],
  },
  {
    id: "flux2-klein-edit",
    label: "FLUX.2 Klein Edit",
    file: "flux2_klein_edit.json",
    needs: [
      "{{MODEL}}",
      "{{CLIP}}",
      "{{CLIP_TYPE}}",
      "{{VAE}}",
      "{{INSTRUCTION}}",
      "{{INIT_IMAGE}}",
    ],
  },
  {
    id: "anima-turbo-t2i",
    label: "Anima Turbo T2I",
    file: "anima_turbo_t2i.json",
    needs: ["{{MODEL}}", "{{CLIP}}", "{{CLIP_TYPE}}", "{{VAE}}", "{{PROMPT}}"],
  },
  {
    id: "krea2-turbo-t2i",
    label: "Krea2 Turbo T2I",
    file: "krea2_turbo_t2i.json",
    needs: [
      "{{MODEL}}",
      "{{CLIP}}",
      "{{CLIP_TYPE}}",
      "{{VAE}}",
      "{{PROMPT}}",
      "{{LORA_NAME}}",
      "{{LORA_STRENGTH}}",
      "{{UNLOCKED_LORA_NAME}}",
      "{{UNLOCKED_LORA_STRENGTH}}",
      "{{WIDTH}}",
      "{{HEIGHT}}",
      "{{SEED}}",
      "{{STEPS}}",
      "{{CFG}}",
      "{{SAMPLER}}",
      "{{SCHEDULER}}",
      "{{FILENAME_PREFIX}}",
    ],
  },
  {
    id: "anima-lllite-inpaint",
    label: "Anima LLLite Inpaint",
    file: "anima_lllite_inpaint.json",
    needs: [
      "{{MODEL}}",
      "{{CLIP}}",
      "{{CLIP_TYPE}}",
      "{{VAE}}",
      "{{MODEL_PATCH}}",
      "{{INIT_IMAGE}}",
      "{{MASK_IMAGE}}",
      "{{INSTRUCTION}}",
      "{{WIDTH}}",
      "{{HEIGHT}}",
      "{{SEED}}",
      "{{STEPS}}",
      "{{CFG}}",
      "{{SAMPLER}}",
    ],
  },
];

/** SillyTavern's own Stable Diffusion extension placeholder syntax. */
const ST_PLACEHOLDER_RE = /"%([a-z_]+)%"/g;
/** ComfyInject's placeholder syntax (a third-party extension). */
const CI_PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

/**
 * Candidate ComfyUI install roots, most explicit first. The workflow folder is
 * `<root>/user/default/workflows`, which is where ComfyUI's own "Save" puts an
 * exported API graph.
 */
function workflowSources(arg) {
  const candidates = [];
  if (arg) candidates.push({ dir: arg, explicit: true });
  // chatchat's own bundled graphs. Always checked, so a plain
  // `node tools/sync-workflows.js` finds them without an explicit path.
  candidates.push({ dir: path.join(__dirname, "..", "workflows"), explicit: false });
  if (process.env.COMFYUI_ROOT) {
    candidates.push({
      dir: path.join(process.env.COMFYUI_ROOT, "user", "default", "workflows"),
      explicit: false,
    });
  }
  for (const root of [
    "E:/Sangeeth/Quick_saves/llm/ComfyUI_windows_portable/ComfyUI",
    path.join(__dirname, "..", "..", "ComfyUI"),
  ]) {
    candidates.push({
      dir: path.join(root, "user", "default", "workflows"),
      explicit: false,
    });
    candidates.push({ dir: root, explicit: false });
  }
  return candidates;
}

/**
 * Resolve the folder the graphs are read from. An explicit argument always wins
 * (the workflow files may live next to the app while being authored); otherwise
 * the first ComfyUI folder that actually contains both graphs.
 */
function resolveRoot(arg) {
  const sources = workflowSources(arg);
  for (const { dir, explicit } of sources) {
    if (!fs.existsSync(dir)) continue;
    const haveBoth = REQUIRED_WORKFLOWS.every((w) =>
      fs.existsSync(path.join(dir, w.file)),
    );
    if (haveBoth || explicit) return dir;
  }
  return sources[0].dir;
}

/** Which placeholder conventions a workflow file uses. */
function detectStyle(raw) {
  const st = (raw.match(ST_PLACEHOLDER_RE) || []).length;
  const ci = (raw.match(CI_PLACEHOLDER_RE) || []).length;
  if (!st && !ci) return "none";
  if (st && ci) return "mixed";
  return st ? "st" : "comfyinject";
}

/**
 * Is this ComfyUI's API graph format (what `POST /prompt` accepts) or the
 * editor's UI format (a `{nodes:[], links:[]}` document, which is a hard
 * error)? Only the former is usable outside the editor.
 */
function isApiGraph(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (Array.isArray(doc.nodes)) return false;
  const entries = Object.values(doc);
  return (
    entries.length > 0 &&
    entries.every((n) => n && typeof n.class_type === "string")
  );
}

const PLACEHOLDER_NAME_RE = /^\{\{[A-Z_]+\}\}$/;

/**
 * Names of LoRA loaders in a graph, so machine-specific workflows can be
 * skipped. A placeholder (`{{LORA_NAME}}`) is not a filename — a graph that
 * leaves the choice to the app is portable and must not be skipped for it.
 */
function loraNames(doc) {
  const found = new Set();
  for (const node of Object.values(doc)) {
    if (!/lora/i.test(node.class_type || "")) continue;
    const name = node.inputs && node.inputs.lora_name;
    if (typeof name !== "string" || !name) continue;
    if (PLACEHOLDER_NAME_RE.test(name)) continue;
    found.add(name);
  }
  return [...found];
}

/**
 * Read the two required graphs. Each one is validated (API format, placeholders
 * present) before it is bundled: a graph that would fail at POST time is worse
 * than a build failure that names the file.
 * @param {string} dir
 * @returns {{workflows: object[], notes: string[]}}
 */
function collect(dir) {
  const workflows = [];
  const notes = [];

  for (const spec of REQUIRED_WORKFLOWS) {
    const full = path.join(dir, spec.file);
    if (!fs.existsSync(full)) {
      notes.push(`${spec.file}: missing — run with the folder that holds it`);
      continue;
    }
    const raw = fs.readFileSync(full, "utf8");
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      notes.push(`${spec.file}: not valid JSON`);
      continue;
    }
    if (!isApiGraph(doc)) {
      notes.push(
        `${spec.file}: not API-graph format (editor exports cannot be posted to /prompt)`,
      );
      continue;
    }
    const style = detectStyle(raw);
    if (style === "none") {
      notes.push(`${spec.file}: no {{PLACEHOLDER}} fields`);
      continue;
    }
    const loras = loraNames(doc);
    if (loras.length) {
      notes.push(
        `${spec.file}: loads LoRA(s) ${loras.join(", ")} (machine-specific path)`,
      );
      continue;
    }
    const absent = (spec.needs || []).filter((p) => !raw.includes(p));
    if (absent.length) {
      notes.push(`${spec.file}: missing placeholder(s) ${absent.join(", ")}`);
      continue;
    }
    workflows.push({
      id: spec.id,
      label: spec.label,
      origin: "builtin",
      style,
      file: spec.file,
      workflow: raw,
    });
  }
  return { workflows, notes };
}

function render(workflows, notes) {
  const header = [
    "/*",
    " * workflows.js — bundled ComfyUI API-format graphs (FLUX.2 Klein 4B,",
    " * Anima Turbo 2B, Anima LLLite inpaint, Krea2 Turbo).",
    " *",
    " * GENERATED FILE — do not edit by hand.",
    " * Regenerate with:  node tools/sync-workflows.js [path-to-workflow-folder]",
    " *",
    " * Five graphs, matching what the app asks a diffusion model to do:",
    " *",
    " *   flux2-klein-t2i      text to image (default)",
    " *   flux2-klein-edit     instruction edit of one source picture; the only",
    " *                        graph /edit is offered for",
    " *   anima-turbo-t2i      anime text to image; T2I only, no edit graph",
    " *   krea2-turbo-t2i      Krea2 Turbo text to image; T2I only, and carries two",
    " *                        optional unlocked-variant LoRA slots (strength 0 = off)",
    " *   anima-lllite-inpaint Anima + LLLite mask inpainting of one picture:",
    " *                        source + white-on-black mask + one instruction",
    " *",
    " * Placeholders are ComfyInject's `{{PLACEHOLDER}}` form (SillyTavern's",
    ' * `"%placeholder%"` form is also understood at runtime, see',
    " * substituteComfyWorkflow in js/comfy.js):",
    " *",
    " *   {{MODEL}} {{CLIP}} {{CLIP_TYPE}} {{VAE}}      model files",
    " *   {{MODEL_PATCH}}                              LLLite inpainting adapter",
    " *   {{PROMPT}} {{INSTRUCTION}} {{INIT_IMAGE}}     what to draw / change",
    " *   {{MASK_IMAGE}}                               white = repaint, black = keep",
    " *   {{LORA_NAME}} {{LORA_STRENGTH}}               optional LoRA slot 1 (Krea2)",
    " *   {{UNLOCKED_LORA_NAME}} {{UNLOCKED_LORA_STRENGTH}}",
    " *                                                optional LoRA slot 2 (Krea2)",
    " *   {{WIDTH}} {{HEIGHT}} {{SEED}} {{STEPS}} {{CFG}} {{SAMPLER}}",
    " *   {{SCHEDULER}} {{FILENAME_PREFIX}}",
    " *",
    " * FLUX.2 Klein 4B distilled is guidance-distilled: 4 steps, CFG 1.0,",
    " * euler/simple. Anima Turbo is likewise distilled: 8 steps, CFG 1.0,",
    " * euler/simple, and its inpaint graph is the same 8/1/euler recipe with",
    " * the LLLite patch applied. Krea2 Turbo is again 8 steps / CFG 1.0 /",
    " * euler/simple on EmptyLatentImage. None of them takes a negative prompt —",
    " * at CFG 1 the unconditional branch is ConditioningZeroOut on the positive",
    " * conditioning, so no graph needs a negative-prompt socket.",
    " * Both Krea2 LoRA slots are LoraLoaderModelOnly: the 488-byte `.diff` Fedor",
    " * file and the SNOFS LoKr file. Strength 0 loads either as a no-op, which is",
    " * what the app sends when its checkbox is off.",
    " *",
    " * Loaded via <script src>, not fetch(), because the app must stay usable as",
    " * a bare file:// page.",
    " */",
    "",
    "const COMFY_BUILTIN_WORKFLOWS = [",
  ];

  const body = workflows.map((w) =>
    [
      "  {",
      `    id: ${JSON.stringify(w.id)},`,
      `    label: ${JSON.stringify(w.label)},`,
      `    origin: ${JSON.stringify(w.origin)},`,
      `    style: ${JSON.stringify(w.style)},`,
      `    sourceFile: ${JSON.stringify(w.file)},`,
      `    workflow: ${JSON.stringify(w.workflow)},`,
      "  },",
    ].join("\n"),
  );

  const footer = ["];", "", "/* eslint-disable-next-line no-unused-vars */"];

  const noteBlock = notes.length
    ? ["", "/* Skipped during the last sync:", ...notes.map((n) => ` *   ${n}`), " */"]
    : [];

  return [...header, ...body, ...footer, ...noteBlock].join("\n") + "\n";
}

function main() {
  const dir = resolveRoot(process.argv[2]);
  const { workflows, notes } = collect(dir);
  const outDir = path.join(__dirname, "..", "workflows");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "workflows.js"), render(workflows, notes));

  console.log(`Workflow source: ${dir}`);
  console.log(`Bundled ${workflows.length} workflow(s) -> workflows/workflows.js`);
  for (const w of workflows) console.log(`  - ${w.id} (${w.style}, from ${w.file})`);
  for (const n of notes) console.log(`  ! ${n}`);
  if (workflows.length !== REQUIRED_WORKFLOWS.length) process.exitCode = 1;
}

module.exports = {
  REQUIRED_WORKFLOWS,
  collect,
  detectStyle,
  isApiGraph,
  loraNames,
  render,
  resolveRoot,
};

if (require.main === module) main();
