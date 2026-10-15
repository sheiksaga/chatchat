/* ══════════════════════════════════════════════════════════════
   scenestate.js — Per-chat scene memory, maintained by the chat model

   A diffusion model has no memory of the story. imageprofile.js solves
   half of that by locking each character's *body* — hair, face, build —
   once per chat and substituting it into every prompt. What it
   deliberately does not cover is everything that changes: what someone
   is wearing now, what state they are in, where the scene is, and who
   is even present. Its own comment puts it as "the lock owns the body;
   the scene owns what is or isn't on it."

   This module owns the second half. After each reply the chat model
   folds the new turns into a small JSON record kept beside the chat:

     { "scene": "rain-soaked neon street, late evening",
       "present": ["Jess", "Maya"],
       "characters": { "jess": { "clothing": "white sundress, soaked",
                                 "state": "shivering, hair plastered down" } } }

   Two design points worth keeping:

   1. **It is advisory, never load-bearing.** Every path degrades to the
      previous record or to no scene at all. A model that answers with
      prose, a truncated JSON object, or nothing useful must never stop
      an image being generated — see parseSceneStateJSON().

   2. **The record is authoritative about presence and change.** "Who is
      in the scene" and "did anything change" are exactly the questions
      it exists to answer, so an update that omits a character means that
      character has left. Absent *fields* are carried forward; absent
      *characters* are not.
   ══════════════════════════════════════════════════════════════ */

const SCENE_KEY_PREFIX = "chat_scene_";
const SCENE_VERSION = 1;

/** Caps, so a runaway model cannot fill the localStorage quota with one field. */
const SCENE_TEXT_MAX = 400;
const SCENE_MAX_CHARACTERS = 12;
const SCENE_MAX_PRESENT = 12;
/** Turns handed to the model in one update. Older ones are already folded in. */
const SCENE_TURNS_MAX = 10;
const SCENE_TRANSCRIPT_MAX = 6000;

function sceneStorageKey(chatId) {
  return SCENE_KEY_PREFIX + chatId;
}

/** A blank record. */
function newSceneState() {
  return {
    version: SCENE_VERSION,
    updatedAt: 0,
    throughIndex: -1,
    scene: "",
    present: [],
    characters: {},
  };
}

/** Coerce one value to a trimmed, length-capped string. */
function sceneText(value) {
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, SCENE_TEXT_MAX);
}

/**
 * Coerce an arbitrary parsed object into a valid record.
 *
 * Everything is rebuilt field by field rather than trusted, because the only
 * guarantee about the input is that a language model produced it. A record
 * that has been through here is safe to write to storage and safe to
 * interpolate into a prompt.
 * @param {*} raw
 * @returns {object}
 */
function normalizeSceneState(raw) {
  const state = newSceneState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return state;

  state.scene = sceneText(raw.scene);
  state.throughIndex = Number.isInteger(raw.throughIndex)
    ? raw.throughIndex
    : -1;
  state.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;

  if (Array.isArray(raw.present)) {
    state.present = raw.present
      .map(sceneText)
      .filter(Boolean)
      .slice(0, SCENE_MAX_PRESENT);
  }

  const entries = [];
  if (raw.characters && typeof raw.characters === "object") {
    for (const [key, value] of Object.entries(raw.characters)) {
      if (!value || typeof value !== "object") continue;
      const name = sceneText(value.name) || sceneText(key);
      if (!name) continue;
      entries.push({
        name: name,
        clothing: sceneText(value.clothing),
        state: sceneText(value.state),
      });
    }
  }

  // Fill the present characters first. They are who the image has to show, so
  // they can never be crowded out of the cap by whatever else the record
  // happened to carry — and a name listed as present with no detail of its own
  // gets an empty shell rather than being dropped, because a dropped name reads
  // to the prompt as "not in the scene".
  for (const name of state.present) {
    const key = name.toLowerCase();
    if (state.characters[key]) continue;
    if (Object.keys(state.characters).length >= SCENE_MAX_CHARACTERS) break;
    state.characters[key] = { name: name, clothing: "", state: "" };
  }

  // Then anything else, upgrading a shell when the real detail shows up.
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (state.characters[key]) {
      state.characters[key] = entry;
      continue;
    }
    if (Object.keys(state.characters).length >= SCENE_MAX_CHARACTERS) break;
    state.characters[key] = entry;
  }

  return state;
}

/** Read a chat's scene record (or a blank one). */
function getSceneState(chatId) {
  const id = chatId || currentChatId;
  if (!id) return newSceneState();
  return normalizeSceneState(safeGetJSON(sceneStorageKey(id), null));
}

/** Persist a scene record. */
function saveSceneState(state, chatId) {
  const id = chatId || currentChatId;
  if (!id) return;
  safeSetItem(sceneStorageKey(id), JSON.stringify(state));
}

/** Drop a chat's scene record (deleting the chat). */
function deleteSceneState(chatId) {
  if (!chatId) return;
  localStorage.removeItem(sceneStorageKey(chatId));
}

/** Index of the newest transcript entry that is not a generated image. */
function lastSceneIndex() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (!chatHistory[i] || chatHistory[i].image) continue;
    return i;
  }
  return -1;
}

/** Does the record predate the transcript? */
function sceneStateIsStale(state) {
  return (state.throughIndex ?? -1) < lastSceneIndex();
}

/**
 * Render transcript entries from `fromIndex` as plain text for the model.
 *
 * Reads the global `chatHistory`, so callers must invoke it *before* awaiting
 * anything — otherwise a chat switch mid-flight would hand the model the wrong
 * conversation. updateSceneState() does exactly that.
 */
function sceneTranscript(fromIndex) {
  const start = Math.max(0, fromIndex, chatHistory.length - SCENE_TURNS_MAX);
  return chatHistory
    .slice(start)
    .filter((m) => m && !m.image && (m.content || "").trim())
    .map((m) => {
      const who = m.name || (m.role === "user" ? "User" : "Story");
      return `${who}: ${m.content}`;
    })
    .join("\n\n")
    .slice(-SCENE_TRANSCRIPT_MAX);
}

/**
 * Pull a scene record out of whatever the model actually replied.
 *
 * Models answer a "reply with JSON" instruction with fenced code blocks,
 * a sentence of preamble, trailing prose, or trailing commas. Rather than
 * failing on any of that, this takes the outermost braces and tries
 * progressively more forgiving parses. Returns null when there is nothing
 * usable, and the caller keeps whatever it had before.
 * @param {string} raw
 * @returns {object|null}
 */
function parseSceneStateJSON(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let text = raw.trim();
  // Strip a fenced block if one is present, keeping its contents.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const candidate = text.slice(first, last + 1);

  const attempts = [candidate];
  // Trailing commas before a closing brace or bracket are the single most
  // common way a model produces almost-JSON.
  attempts.push(candidate.replace(/,\s*([}\]])/g, "$1"));

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      /* try the next form */
    }
  }
  return null;
}

/**
 * Fold a parsed update into the previous record.
 *
 * Absent fields carry forward: a model that reports only the clothing it
 * changed should not erase the scene description it left alone. Presence is
 * the exception — an update is authoritative about who is in the scene, so a
 * character the update omits is gone.
 * @param {object} prev
 * @param {object} incoming Parsed, untrusted
 * @returns {object}
 */
function mergeSceneState(prev, incoming) {
  const next = normalizeSceneState(prev);
  if (!incoming || typeof incoming !== "object") return next;

  if (typeof incoming.scene === "string" && incoming.scene.trim()) {
    next.scene = sceneText(incoming.scene);
  }

  if (Array.isArray(incoming.present)) {
    next.present = incoming.present
      .map(sceneText)
      .filter(Boolean)
      .slice(0, SCENE_MAX_PRESENT);
  }

  const carried = next.characters;
  const merged = {};
  const initial = incoming.characters;
  if (initial && typeof initial === "object") {
    for (const [key, value] of Object.entries(initial)) {
      if (!value || typeof value !== "object") continue;
      if (Object.keys(merged).length >= SCENE_MAX_CHARACTERS) break;
      const name = sceneText(value.name) || sceneText(key);
      if (!name) continue;
      const lookup = name.toLowerCase();
      const before = carried[lookup] || { clothing: "", state: "" };
      merged[lookup] = {
        name: name,
        // A field the update omits is not a field that became empty.
        clothing: sceneText(value.clothing) || before.clothing,
        state: sceneText(value.state) || before.state,
      };
    }
  }

  // Anyone still named as present keeps their earlier entry if the update
  // forgot them, so presence and detail cannot disagree.
  for (const name of next.present) {
    const lookup = name.toLowerCase();
    if (merged[lookup]) continue;
    if (Object.keys(merged).length >= SCENE_MAX_CHARACTERS) break;
    merged[lookup] = carried[lookup] || {
      name: name,
      clothing: "",
      state: "",
    };
  }

  next.characters = merged;
  return next;
}

/** The instruction that turns a transcript into a scene record. */
const SCENE_UPDATE_SYSTEM = [
  "You maintain a compact JSON record of the current scene for an image",
  "generator that has no memory of this story. Update the record from the new",
  "messages.",
  "",
  "Reply with ONE JSON object and nothing else. No prose, no code fences.",
  "",
  '{ "scene": "location, time of day, weather, immediate situation",',
  '  "present": ["Name"],',
  '  "characters": { "name": { "clothing": "...", "state": "..." } } }',
  "",
  "Rules:",
  "- present lists only who is physically in the scene at the end of the new",
  "  messages. Anyone who has left is omitted.",
  "- clothing is the CURRENT state of dress, carried forward from the previous",
  "  record unless the new messages changed it. If a garment was removed it is",
  "  gone. Name what they wear now, not what they wore earlier.",
  "- state covers physical condition, pose, expression, injuries and what they",
  "  are doing right now.",
  "- Keep values as short comma-separated fragments, not sentences.",
  "- Keep each name spelled exactly as it appears in the previous record.",
].join("\n");

/** @type {Promise|null} In-flight background update, so only one runs at a time. */
let _sceneUpdatePromise = null;

/**
 * Fold the newest turns into a chat's scene record.
 *
 * Everything the model needs is captured *synchronously* before the first
 * await: the transcript snapshot and the target chat id. Without that, a chat
 * switch while the request is in flight would fold the wrong conversation into
 * the wrong chat's record.
 * @param {{signal?:AbortSignal, onStatus?:(s:string)=>void}} [opts]
 * @returns {Promise<object|null>} The updated record, or null if it failed
 */
async function updateSceneState(opts) {
  opts = opts || {};
  const chatId = currentChatId;
  if (!chatId) return null;

  const prev = getSceneState(chatId);
  const throughIndex = lastSceneIndex();
  if (throughIndex < 0) return prev;

  const transcript = sceneTranscript(prev.throughIndex + 1);
  if (!transcript.trim()) return prev;

  const userContent =
    "PREVIOUS RECORD:\n" +
    JSON.stringify({
      scene: prev.scene,
      present: prev.present,
      characters: prev.characters,
    }) +
    "\n\nNEW MESSAGES:\n" +
    transcript;

  try {
    if (typeof opts.onStatus === "function") opts.onStatus("Tracking the scene…");
    const raw = await requestCompletion(
      [
        { role: "system", content: SCENE_UPDATE_SYSTEM },
        { role: "user", content: userContent },
      ],
      { maxTokens: 700, temperature: 0.2, signal: opts.signal },
    );

    const parsed = parseSceneStateJSON(raw);
    if (!parsed) {
      console.warn("Scene update returned no usable JSON; keeping previous state.");
      return null;
    }

    const merged = mergeSceneState(prev, parsed);
    merged.throughIndex = throughIndex;
    merged.updatedAt = Date.now();
    saveSceneState(merged, chatId);
    return merged;
  } catch (err) {
    // Scene tracking is an enhancement. A failure here must never surface as a
    // generation error — the image still gets the previous record and the
    // locked character bodies.
    if (err && err.name !== "AbortError") {
      console.warn("Scene state update failed:", err);
    }
    return null;
  }
}

/**
 * Bring a chat's scene record up to date, if it is behind.
 * @param {AbortSignal} [signal]
 * @param {(s:string)=>void} [onStatus]
 * @returns {Promise<object>} The current record (possibly still stale)
 */
async function refreshSceneState(signal, onStatus) {
  const state = getSceneState();
  if (!sceneStateIsStale(state)) return state;
  const updated = await updateSceneState({ signal: signal, onStatus: onStatus });
  return updated || state;
}

/**
 * Is scene tracking on for this chat?
 *
 * Only a cast chat tracks a scene: the record exists to keep named characters
 * consistent across images, and a plain chat gains nothing from an extra model
 * call on every turn.
 */
function sceneTrackingEnabled() {
  if (typeof getCast !== "function") return false;
  try {
    return getCast().length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Kick off a background update after a reply, if one is not already running.
 *
 * Deliberately fire-and-forget: it is an extra model call, and making the user
 * wait for it before they can read the reply they just got would be the wrong
 * trade. Run once per reply at most.
 */
function scheduleSceneStateUpdate() {
  if (!sceneTrackingEnabled()) return;
  if (!currentChatId) return;
  if (_sceneUpdatePromise) return;
  _sceneUpdatePromise = updateSceneState({})
    .catch(() => null)
    .finally(() => {
      _sceneUpdatePromise = null;
    });
}

/**
 * The scene, as a block of context for the prompt *summariser*.
 *
 * Handing this to buildScenePrompt() is what makes the summariser put the
 * right people in the picture: without it, "the two of them" stays "the two
 * of them", and no character name ever reaches the prompt for
 * composeImagePrompt() to substitute a locked appearance into.
 * @param {object} state
 * @returns {string}
 */
function sceneContextBlock(state) {
  if (!state) return "";
  const lines = [];
  if (state.scene) lines.push(`Where: ${state.scene}`);
  if (state.present.length) {
    lines.push(`Present: ${state.present.join(", ")}`);
  }
  for (const key of Object.keys(state.characters)) {
    const c = state.characters[key];
    const bits = [c.clothing, c.state].filter(Boolean);
    if (bits.length) lines.push(`${c.name}: ${bits.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Clothing and current state for the characters named in a prompt.
 *
 * Returned as one comma-separated fragment so it can be folded into the same
 * parenthetical as the locked body description.
 * @param {object} state
 * @param {string} name
 * @returns {string}
 */
function sceneDetailFor(state, name) {
  if (!state || !name) return "";
  const entry = state.characters[String(name).toLowerCase()];
  if (!entry) return "";
  return [entry.clothing, entry.state].filter(Boolean).join(", ");
}
