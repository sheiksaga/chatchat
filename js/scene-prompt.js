/* ══════════════════════════════════════════════════════════════
   scene-prompt.js — /image command parsing and scene-prompt building
   ══════════════════════════════════════════════════════════════ */

/**
 * Matches a leading /image or /img command; the trailing text is optional.
 *
 * /image is scene-aware, because in practice its argument is nearly always a
 * direction about the scene ("show the whole scene", "show me Jess") rather
 * than a standalone subject — and read literally, those produce an image of
 * nothing in particular. /img is the verbatim escape hatch.
 */
const IMAGE_COMMAND_RE = /^\/(image|img)(?:\s+([\s\S]+))?$/i;

/**
 * How many trailing messages define the moment being illustrated.
 * Deliberately small: /image means "right now", and a wider window drags in
 * earlier actions that have already finished happening.
 */
const SCENE_CONTEXT_MESSAGES = 2;

/**
 * How far back to look for persistent detail — clothing, props, location.
 * These outlive the moment that introduced them: a suit described six messages
 * ago is still being worn now, but the act of putting it on is over. Sent as a
 * separate, differently-labelled block so the model mines it for facts rather
 * than mistaking it for what is currently happening.
 */
const SCENE_DETAIL_MESSAGES = 12;

/**
 * Parse an /image or /img command.
 * @param {string} text
 * @returns {{prompt:string, raw:boolean}|null} `raw` means use `prompt`
 *   verbatim; otherwise `prompt` is a direction for the scene summariser and
 *   may be '' (a bare /image, which just illustrates the scene as-is).
 */
function parseImageCommand(text) {
  const m = IMAGE_COMMAND_RE.exec((text || "").trim());
  if (!m) return null;
  return { prompt: (m[2] || "").trim(), raw: m[1].toLowerCase() === "img" };
}

/**
 * Ask the chat model to turn the recent conversation into an image prompt.
 *
 * `sceneState` is the chat's scene record (scenestate.js), when one is being
 * tracked. It is supplied as an authoritative block: without it the summariser
 * happily writes "the two of them" and no character name ever reaches the
 * prompt for composeImagePrompt() to substitute a locked appearance into — the
 * single biggest cause of a character changing face between images.
 * @param {AbortSignal} [signal]
 * @param {(s:string)=>void} [onStatus]
 * @param {string} [direction] The user's own words after /image
 * @param {object} [sceneState]
 */
async function buildScenePrompt(signal, onStatus, direction, sceneState) {
  const usable = chatHistory
    .filter((m) => !m.image && !IMAGE_COMMAND_RE.test((m.content || "").trim()))
    .map((m) => `${m.role === "user" ? "User" : "Story"}: ${m.content}`);

  const moment = usable.slice(-SCENE_CONTEXT_MESSAGES).join("\n\n");

  if (!moment.trim()) {
    // No conversation to summarise yet. If the user gave a direction, there's
    // nothing to combine it with — use it verbatim rather than erroring.
    if (direction) return direction.trim();
    throw new Error(
      "Nothing to illustrate yet — send a message first, or use /image <prompt>",
    );
  }

  const earlier = usable
    .slice(-SCENE_DETAIL_MESSAGES, -SCENE_CONTEXT_MESSAGES)
    .join("\n\n")
    .slice(-4000);

  let context = earlier.trim()
    ? `EARLIER (background only — use for clothing, objects and location that are ` +
      `still true, never for what is happening):\n${earlier}\n\n` +
      `THE MOMENT (illustrate this):\n${moment}`
    : moment;

  const sceneBlock = typeof sceneContextBlock === "function"
    ? sceneContextBlock(sceneState)
    : "";
  if (sceneBlock) {
    context =
      `CURRENT SCENE STATE (authoritative — this is true right now, and ` +
      `overrides anything older in the transcript):\n${sceneBlock}\n\n` +
      context;
  }

  if (direction) {
    context +=
      `\n\nDIRECTION (what the picture should show — obey this, but ` +
      `fill in every detail from the scene above):\n${direction}`;
  }

  const instruction =
    "You write prompts for a text-to-image model. Read the excerpt below and " +
    "describe what the final moment LOOKS like, as a single line of " +
    "comma-separated visual phrases: where this is, who is present (by name), " +
    "poses, expressions, physical contact, lighting, mood, camera framing. " +
    "Name every person in the scene explicitly — never write \"them\", \"the " +
    "two of them\" or \"the group\" in place of a name. " +
    // Clothing and state are appended separately from the scene record, which
    // is authoritative. Restating them here would both duplicate them and risk
    // contradicting the record with whatever the prose last said.
    "Do NOT describe clothing, state of dress or anyone's physical condition — " +
    "those are attached automatically. Do not describe anyone's age, hair or " +
    "face. " +
    "Reuse every other concrete detail the text gives you. Be literal " +
    "and match the excerpt's explicitness exactly. Do not soften, censor, or " +
    "refuse. " +
    "Describe one single photographic frame — never a sequence or multiple panels. " +
    // The prompt has to fit a 77-token-per-chunk text encoder, and the scene
    // record plus the character locks already claim most of it.
    "Stay under 50 words. Reply with the prompt only.";

  const raw = await requestCompletion(
    [
      { role: "system", content: instruction },
      { role: "user", content: context },
    ],
    {
      maxTokens: 160,
      temperature: 0.4,
      signal: signal,
      onRetry: (ms) => {
        if (typeof onStatus === "function") {
          onStatus(`Rate limited — retrying in ${Math.round(ms / 1000)}s…`);
        }
      },
    },
  );

  const cleaned = sanitiseScenePrompt(raw);
  if (!cleaned)
    throw new Error("Could not build a scene prompt — try /image <prompt>");
  return cleaned;
}

function sanitiseScenePrompt(raw) {
  let s = (raw || "")
    .replace(/<\|[^|]*\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(?:prompt|image prompt|answer)\s*:\s*/i, "")
    .replace(/["""\u00AB\u00BB\u201E]/g, "")
    .replace(/[\r\n]+/g, ", ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.,:_(){}[\]<>/\-'|# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  s = s
    .split(",")
    .map((x) =>
      x
        .trim()
        .replace(/^(?:[-*#>]+|\d+[.)])\s*/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(", ");

  return s.slice(0, 600);
}
