#!/usr/bin/env node
/**
 * sync-workflows.js — bundle ComfyUI workflows from a SillyTavern install
 * into `workflows/workflows.js`, a script-loadable manifest.
 *
 * Why generate a `.js` file instead of copying the JSON and fetching it?
 * chatchat has to keep working as a bare `file://` page (see AGENTS.md), and
 * `fetch()` on a `file://` URL is blocked by CORS. A `<script>` tag is not. So
 * the manifest is JS, not JSON — same reason `cards/cards.js` exists.
 *
 * Usage:
 *   node tools/sync-workflows.js [path-to-sillytavern]
 *
 * Default path is `../sillytavern`, i.e. a sibling of this repo.
 */

const fs = require("fs");
const path = require("path");

/** SillyTavern's own Stable Diffusion extension placeholder syntax. */
const ST_PLACEHOLDER_RE = /"%([a-z_]+)%"/g;
/** ComfyInject's placeholder syntax (a third-party extension). */
const CI_PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

/**
 * Where workflows live, most-specific first.
 * - `user/workflows`      : what the user saved in SillyTavern's UI
 * - `default/content`     : SillyTavern's shipped defaults
 * - the ComfyInject extension's own `workflows/` folder
 */
function workflowSources(root) {
  return [
    { dir: path.join(root, "data", "default-user", "user", "workflows"), origin: "user" },
    { dir: path.join(root, "default", "content"), origin: "sillytavern" },
    {
      dir: path.join(root, "public", "scripts", "extensions", "third-party", "ComfyInject", "workflows"),
      origin: "comfyinject",
    },
  ];
}

/**
 * Resolve the SillyTavern root from an optional CLI argument.
 *
 * Accepts either the repo root or a directory inside it (e.g. the characters
 * or workflows folder), because pasting whichever path is to hand is the
 * common case.
 */
function resolveRoot(arg) {
  const candidates = [];
  candidates.push(arg || path.join(__dirname, "..", "..", "sillytavern"));

  for (const base of candidates.slice()) {
    const variants = [
      base,
      path.join(base, "sillytavern"),
      path.join(base, "data", "default-user"),
      path.join(base, "public"),
    ];
    for (const v of variants) {
      if (fs.existsSync(path.join(v, "data", "default-user", "user", "workflows"))) return v;
    }
    for (const v of variants) {
      if (fs.existsSync(path.join(v, "public", "scripts", "extensions", "stable-diffusion"))) {
        return v;
      }
    }
  }
  return candidates[0];
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
  return entries.length > 0 && entries.every((n) => n && typeof n.class_type === "string");
}

/** Names of LoRA loaders in a graph, so machine-specific workflows can be skipped. */
function loraNames(doc) {
  const found = new Set();
  for (const node of Object.values(doc)) {
    if (!/lora/i.test(node.class_type || "")) continue;
    const name = node.inputs && node.inputs.lora_name;
    if (typeof name === "string" && name) found.add(name);
  }
  return [...found];
}

/**
 * Does this graph take an input image? chatchat only does text-to-image, so an
 * img2img or character-avatar workflow would queue and then wait forever for an
 * image that never arrives.
 */
function imageInputNodes(doc) {
  return Object.values(doc)
    .map((n) => n.class_type || "")
    .filter((t) => /loadimage|loadvideo|loadimagebase64/i.test(t));
}

/** A readable label from a filename: `WAI_HSWQ_Turbo_ST.json` -> `WAI HSWQ Turbo ST`. */
function labelFor(file) {
  return path
    .basename(file, ".json")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collect workflow candidates from every known source, de-duplicated by name. */
function collect(root) {
  const seen = new Map();
  const notes = [];

  for (const { dir, origin } of workflowSources(root)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const full = path.join(dir, file);
      let raw;
      try {
        raw = fs.readFileSync(full, "utf8");
      } catch (e) {
        notes.push(`skip ${file}: unreadable`);
        continue;
      }

      let doc;
      try {
        doc = JSON.parse(raw);
      } catch (e) {
        notes.push(`skip ${file}: not valid JSON`);
        continue;
      }

      if (!isApiGraph(doc)) {
        notes.push(`${file}: not API-graph format (editor-format exports cannot be posted to /prompt)`);
        continue;
      }

      const style = detectStyle(raw);
      if (style === "none") {
        notes.push(`${file}: no %placeholder% or {{PLACEHOLDER}} fields — would always render the same image`);
        continue;
      }

      // A workflow that loads a LoRA only present on the machine it came from
      // hard-fails (ComfyUI rejects the graph) everywhere else. Not bundling it
      // is friendlier than shipping a broken preset.
      const loras = loraNames(doc);
      if (loras.length) {
        notes.push(`${file}: skipped, loads LoRA(s) ${loras.join(", ")} (machine-specific path)`);
        continue;
      }

      // img2img / avatar workflows need an input image chatchat has no way to
      // supply, so they would queue and hang rather than fail cleanly.
      const imageInputs = imageInputNodes(doc);
      if (imageInputs.length) {
        notes.push(`${file}: skipped, needs an input image (${imageInputs.join(", ")}) — chatchat is text-to-image only`);
        continue;
      }

      // First writer wins: `user/` is deliberately scanned first so a user's
      // edited workflow beats the copy SillyTavern ships.
      const id = labelFor(file).toLowerCase().replace(/\s+/g, "-");
      if (seen.has(id)) {
        notes.push(`${file}: duplicate of an already-collected workflow, skipped`);
        continue;
      }
      seen.set(id, {
        id,
        label: labelFor(file),
        origin,
        style,
        file,
        workflow: raw,
      });
    }
  }
  return { workflows: [...seen.values()], notes };
}

function render(workflows, notes) {
  const header = [
    "/*",
    " * workflows.js — GENERATED FILE. Do not edit by hand.",
    " *",
    " * Regenerate with:  node tools/sync-workflows.js [path-to-sillytavern]",
    " *",
    " * Each entry holds a ComfyUI API-format graph with its placeholder fields",
    " * left intact, so the app substitutes them per generation. Two placeholder",
    " * conventions are carried through unchanged and both are understood at",
    " * runtime (see substituteComfyWorkflow in js/comfy.js):",
    " *",
    ' *   "%prompt%"            SillyTavern\'s Stable Diffusion extension',
    ' *   {{POSITIVE_PROMPT}}   the ComfyInject extension',
    " *",
    " * Loaded via <script src>, not fetch(), because the app must stay usable as",
    " * a bare file:// page.",
    " */",
    "",
    "const COMFY_BUILTIN_WORKFLOWS = [",
  ];

  const body = workflows.map((w) => {
    const lines = [
      "  {",
      `    id: ${JSON.stringify(w.id)},`,
      `    label: ${JSON.stringify(w.label)},`,
      `    origin: ${JSON.stringify(w.origin)},`,
      `    style: ${JSON.stringify(w.style)},`,
      `    sourceFile: ${JSON.stringify(w.file)},`,
      `    workflow: ${JSON.stringify(w.workflow)},`,
      "  },",
    ];
    return lines.join("\n");
  });

  const footer = ["];", "", "/* eslint-disable-next-line no-unused-vars */"];

  const noteBlock = notes.length
    ? [
        "",
        `/* Skipped during the last sync:`,
        ...notes.map((n) => ` *   ${n}`),
        " */",
      ]
    : [];

  return [...header, ...body, ...footer, ...noteBlock].join("\n") + "\n";
}

function main() {
  const root = resolveRoot(process.argv[2]);
  const { workflows, notes } = collect(root);
  const outDir = path.join(__dirname, "..", "workflows");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "workflows.js"), render(workflows, notes));

  console.log(`SillyTavern root: ${root}`);
  console.log(`Bundled ${workflows.length} workflow(s) -> workflows/workflows.js`);
  for (const w of workflows) console.log(`  - ${w.id} (${w.style}, from ${w.file})`);
  for (const n of notes) console.log(`  ! ${n}`);
}

module.exports = {
  collect,
  detectStyle,
  isApiGraph,
  loraNames,
  imageInputNodes,
  labelFor,
  render,
  resolveRoot,
};

if (require.main === module) main();
