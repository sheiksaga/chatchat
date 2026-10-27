/* ══════════════════════════════════════════════════════════════
   storyfile.js — the per-chat story file

   A story is more than a transcript. The image model has no memory,
   so everything it needs to keep the same person looking like the
   same person has to live in a record outside the prose.

   Each chat owns one file, created with its first story message and
   folded forward after every reply:

     {
       style,                          // look/render style
       scene, present[],               // where, and who is in it
       characters: {
         <name>: { appearance, clothing, condition, exited }
       }
     }

   The three character fields are separate on purpose. `appearance` is
   identity — build, face, hair — and only changes when something
   permanent happens (a scar, a haircut). `clothing` and `condition`
   change constantly (a wound becomes a bandage). Collapsing the three
   into one field is what lets a character's face drift between the
   images of a single scene.

   The record is written by a model, so nothing in it is trusted: every
   field is rebuilt through normalizeStoryFile() before it is stored,
   and merges only ever add detail rather than silently dropping it.
   ══════════════════════════════════════════════════════════════ */

const STORY_FILE_PREFIX = "chat_story_";
const STORY_FILE_VERSION = 3;

/** Caps, so a runaway model cannot fill the storage quota with one field. */
const STORY_TEXT_MAX = 400;
const STORY_MAX_CHARACTERS = 12;
const STORY_MAX_PRESENT = 12;

/**
 * The scene is split into the axes an image prompt actually needs.
 *
 * One free-text `scene` string was enough to keep prose consistent, but an
 * image needs each axis separately: a location that changed must not quietly
 * keep yesterday's weather, and "night" has to reach the prompt as a lighting
 * instruction even when nobody restated it. Model updates are merged per
 * field, so a turn that only changes the room leaves the rest intact.
 */
const STORY_SCENE_FIELDS = [
  "location",
  "timeOfDay",
  "weather",
  "lighting",
  "mood",
  "situation",
];

const STORY_SCENE_LABELS = {
  location: "Location",
  timeOfDay: "Time of day",
  weather: "Weather",
  lighting: "Lighting",
  mood: "Mood",
  situation: "Happening now",
};

const STORY_SCENE_HINTS = {
  location: "Room, building, landscape — where this is",
  timeOfDay: "Dawn, morning, midday, afternoon, dusk, night",
  weather: "Clear, rain, snow, fog, wind — or empty indoors",
  lighting: "Firelight, neon, moonlight, daylight through windows",
  mood: "Tense, tender, chaotic, quiet",
  situation: "The immediate action in one short phrase",
};

/** The largest seed a JSON number can hold exactly. */
const STORY_SEED_MAX = 9007199254740991;

/**
 * Labels a model reaches for when it means the person the user is playing.
 *
 * Transcript turns are labelled "User", and a roleplay model will carry that
 * into the record as though it were a character's name — producing an entry
 * with no appearance that no image prompt can ever resolve.
 */
const STORY_PLAYER_LABELS = [
  "user",
  "you",
  "player",
  "protagonist",
  "mc",
  "self",
];

/** Turns handed to the model in one update. Older ones are already folded in. */
const STORY_TURNS_MAX = 10;
const STORY_TRANSCRIPT_MAX = 6000;

function storyFileKey(chatId) {
  return STORY_FILE_PREFIX + chatId;
}

/** A blank scene: every axis known, every axis empty. */
function newStoryScene() {
  const scene = {};
  for (const field of STORY_SCENE_FIELDS) scene[field] = "";
  return scene;
}

/**
 * The player's own character, kept apart from the cast.
 *
 * The player is not an NPC, and treating them as one is what let a model copy
 * the lead character's appearance onto them: both were entries in the same
 * characters list, distinguished only by a name it had to infer. A separate
 * object makes the distinction structural instead of a naming convention.
 */
function newStoryPlayer() {
  return { name: "", appearance: "", clothing: "", condition: "" };
}

/** A blank file. */
function newStoryFile() {
  return {
    version: STORY_FILE_VERSION,
    createdAt: 0,
    updatedAt: 0,
    // Bumped only by a human edit. The image pipeline uses it to tell a record
    // the model wrote (a snapshot from the time of the picture is the truth)
    // from one the user just corrected (the correction should win).
    editedAt: 0,
    throughIndex: -1,
    // Locked when the chat is created and never changed by a draw. It is the
    // reason regenerating a scene reproduces the picture instead of drawing a
    // new variation of it.
    seed: 0,
    // Plain chats only track a scene once an image has been asked for. Story
    // chats always do (see storyTrackingEnabled).
    tracking: false,
    // Establish-from-setup pass has run for this chat.
    setupDone: false,
    style: "",
    scene: newStoryScene(),
    // The user's own character, deliberately NOT an entry in `characters`.
    player: newStoryPlayer(),
    present: [],
    characters: {},
    // Fields the user corrected by hand, so the next update cannot silently
    // undo the correction. Keyed by pin id (see storyPinId).
    pins: {},
  };
}

/** Coerce a stored seed to the only kind of number this app sends. */
function storySeedValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(STORY_SEED_MAX, Math.floor(n));
}

/** A fresh seed for a chat. Positive, integral, JSON-safe. */
function drawStorySeed() {
  return Math.floor(Math.random() * 1e15) + 1;
}

/** Characters are keyed by lower-cased name so "Jess" and "jess" are one person. */
function storyCharacterKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

/** Coerce one value to a trimmed, length-capped string. */
function storyText(value) {
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, STORY_TEXT_MAX);
}

/**
 * Coerce an arbitrary parsed object into a valid record.
 *
 * Rebuilt field by field rather than trusted, because the only guarantee
 * about the input is that a language model produced it (or that an older
 * version of this app wrote it). The result is safe to store and safe to
 * interpolate into a prompt.
 * @param {*} raw
 * @returns {object}
 */
/** The name the user configured for their own character, if any. */
function storyPlayerName() {
  const name = storyConfig && storyConfig.userName ? storyConfig.userName : "";
  return storyText(name);
}

/**
 * The player's name, preferring the configured name over one the model read.
 *
 * A configured name is a statement by the user and outranks anything extracted
 * from prose. When the field is blank, the model may establish it from the
 * story, which is what makes "I am S" work without filling in a form.
 * @param {object} [file]
 * @returns {string}
 */
function storyPlayerRecordName(file) {
  const configured = storyPlayerName();
  if (configured) return configured;
  return file && file.player ? storyText(file.player.name) : "";
}

/** Is this the placeholder a model uses for "the player"? */
function storyPlayerLabel(name) {
  return STORY_PLAYER_LABELS.indexOf(storyCharacterKey(name)) >= 0;
}

/**
 * The name a cast entry should actually be recorded under.
 *
 * The player is deliberately excluded from `characters`: they are not an NPC,
 * and putting them in the same list is what let a model copy the lead
 * character's look onto them. A placeholder ("User", "You") or the player's
 * own name returns "" so the caller skips the entry entirely; the player has
 * their own record in `file.player`.
 * @param {string} name
 * @param {object} [file]
 * @returns {string} "" when this entry is the player
 */
function storyRecordedName(name, file) {
  const text = storyText(name);
  if (!text) return "";
  if (storyPlayerLabel(text)) return "";
  const player = storyPlayerRecordName(file);
  if (player && storyCharacterKey(player) === storyCharacterKey(text))
    return "";
  return text;
}

/**
 * The name a `present` entry should be recorded under.
 *
 * Unlike a cast entry, the player *is* allowed here — being in the scene is
 * exactly what the image prompt needs to know. Placeholders are rewritten to
 * the player's name; when no name is known they are dropped rather than stored
 * as a person called "You".
 * @param {string} name
 * @param {object} [file]
 * @returns {string}
 */
function storyPresentName(name, file) {
  const text = storyText(name);
  if (!text) return "";
  if (storyPlayerLabel(text)) return storyPlayerRecordName(file);
  return text;
}

function normalizeStoryFile(raw) {
  const file = newStoryFile();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return file;

  file.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  file.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  file.editedAt = Number.isFinite(raw.editedAt) ? raw.editedAt : 0;
  file.throughIndex = Number.isInteger(raw.throughIndex)
    ? raw.throughIndex
    : -1;
  file.seed = storySeedValue(raw.seed);
  file.tracking = raw.tracking === true;
  file.setupDone = raw.setupDone === true;
  file.style = storyText(raw.style);

  // v1 stored `scene` as one string. Keep its words rather than discarding a
  // record the user may have edited by hand: it becomes the situation axis and
  // the next update fills the rest in around it.
  if (typeof raw.scene === "string") {
    file.scene.situation = storyText(raw.scene);
  } else if (raw.scene && typeof raw.scene === "object") {
    for (const field of STORY_SCENE_FIELDS) {
      file.scene[field] = storyText(raw.scene[field]);
    }
  }

  if (raw.pins && typeof raw.pins === "object" && !Array.isArray(raw.pins)) {
    for (const [id, on] of Object.entries(raw.pins)) {
      if (on === true) file.pins[id] = true;
    }
  }

  // The player has their own record. A configured name always wins; otherwise
  // keep whatever the model established, so "I am S" needs no form field.
  const player = newStoryPlayer();
  if (raw.player && typeof raw.player === "object") {
    player.name = storyText(raw.player.name);
    player.appearance = storyText(raw.player.appearance);
    player.clothing = storyText(raw.player.clothing);
    player.condition = storyText(raw.player.condition);
  }
  if (!player.name) player.name = storyPlayerName();
  file.player = player;

  if (Array.isArray(raw.present)) {
    file.present = raw.present
      .map((name) => storyPresentName(name, file))
      .filter(Boolean)
      .slice(0, STORY_MAX_PRESENT);
  }

  // The model emits an array (a JSON-schema-friendly shape); storage keeps an
  // object so lookup and merging are by name rather than by scanning.
  const entries = [];
  if (Array.isArray(raw.characters)) entries.push(...raw.characters);
  else if (raw.characters && typeof raw.characters === "object") {
    for (const [key, value] of Object.entries(raw.characters)) {
      if (value && typeof value === "object") {
        entries.push(Object.assign({ name: key }, value));
      }
    }
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const rawName = storyText(entry.name);
    const name = storyRecordedName(rawName, file);
    // A cast entry that resolves to the player is the conflation bug: do not
    // copy its appearance onto the player (that is how S inherited Jess's
    // look). Learn the name if it is new, then let the player's own record be
    // filled from the transcript by the next update.
    if (!name) {
      if (!file.player.name && rawName && !storyPlayerLabel(rawName)) {
        file.player.name = rawName;
      }
      continue;
    }
    const key = storyCharacterKey(name);
    if (!key) continue;
    if (
      Object.keys(file.characters).length >= STORY_MAX_CHARACTERS &&
      !file.characters[key]
    ) {
      break;
    }
    file.characters[key] = {
      name: name,
      appearance: storyText(entry.appearance),
      clothing: storyText(entry.clothing),
      condition: storyText(entry.condition),
      exited: entry.exited === true,
    };
  }

  // The player must never be a cast entry. A model that put them there, or an
  // old record written before the player had their own field, is corrected
  // here: the name is learned above, and the entry is removed rather than
  // copied (its look is exactly the conflation this separation prevents).
  const playerKey = storyCharacterKey(storyPlayerRecordName(file));
  if (playerKey && file.characters[playerKey]) {
    delete file.characters[playerKey];
  }

  // Anyone named as present but missing detail gets an empty shell rather than
  // being dropped: a name that vanishes from the record reads to the prompt as
  // "not in the scene", which is the opposite of what present means. The player
  // is the exception — they are not a cast entry.
  for (const name of file.present) {
    const key = storyCharacterKey(name);
    if (!key || file.characters[key]) continue;
    if (playerKey && key === playerKey) continue;
    if (Object.keys(file.characters).length >= STORY_MAX_CHARACTERS) break;
    file.characters[key] = {
      name: name,
      appearance: "",
      clothing: "",
      condition: "",
      exited: false,
    };
  }

  return file;
}

/** Read a chat's story file, or null when it has none yet. */
function getStoryFile(chatId) {
  const id = chatId || currentChatId;
  if (!id) return null;
  const raw = safeGetJSON(storyFileKey(id), null);
  return raw ? normalizeStoryFile(raw) : null;
}

/**
 * Read a chat's story file, creating it if this is the chat's first one.
 *
 * The file is meant to exist for the whole life of a story — it is created
 * alongside the first message, not lazily on the first image — so that
 * whatever the user types next already has somewhere to be recorded.
 * @param {string} [chatId]
 * @returns {object|null}
 */
function ensureStoryFile(chatId) {
  const id = chatId || currentChatId;
  if (!id) return null;
  const existing = getStoryFile(id);
  if (existing) {
    // A chat created before seeds were locked still needs one, and the first
    // read is the last moment this can happen without two images racing for
    // different numbers.
    if (!existing.seed) {
      existing.seed = drawStorySeed();
      saveStoryFile(existing, id);
    }
    return existing;
  }
  const file = newStoryFile();
  file.createdAt = Date.now();
  file.updatedAt = file.createdAt;
  file.seed = drawStorySeed();
  saveStoryFile(file, id);
  return file;
}

/**
 * The seed locked to a chat. Images in the same chat all use it, which is what
 * makes a rerun of a scene land on the same picture.
 * @param {string} [chatId]
 * @returns {number|null}
 */
function storySeedFor(chatId) {
  const id = chatId || currentChatId;
  if (!id) return null;
  const file = ensureStoryFile(id);
  return file && file.seed ? file.seed : null;
}

/**
 * Draw a new seed for this chat from now on.
 *
 * Only future pictures change: every stored picture keeps the seed it was
 * drawn with, so old scenes still reproduce.
 * @param {string} [chatId]
 * @returns {number|null}
 */
function rerollChatSeed(chatId) {
  const id = chatId || currentChatId;
  if (!id) return null;
  const file = ensureStoryFile(id);
  if (!file) return null;
  file.seed = drawStorySeed();
  file.updatedAt = Date.now();
  saveStoryFile(file, id);
  if (typeof renderStoryFilePanel === "function") renderStoryFilePanel();
  return file.seed;
}

/** Persist a story file. */
function saveStoryFile(file, chatId) {
  const id = chatId || currentChatId;
  if (!id || !file) return;
  safeSetItem(storyFileKey(id), JSON.stringify(file));
}

/** Drop a chat's story file (deleting the chat). */
function deleteStoryFile(chatId) {
  const id = chatId || currentChatId;
  if (!id) return;
  // Folder-backed: this schedules a PUT of null, which removes story.json.
  // (Deleting the whole chat uses chatStore.deleteChat instead, which removes
  // the folder in one request.)
  safeRemoveItem(storyFileKey(id));
}

/**
 * Drop story files whose chat no longer exists.
 *
 * With the folder store, the server owns the files and the reference sweep is
 * `chatStore.pruneImages()` / the chat folder delete itself. This remains only
 * for an old browser store and does nothing when the folder API is in use.
 * @returns {number} How many were removed
 */
function pruneOrphanStoryFiles() {
  if (typeof chatStore !== "undefined" && chatStore.ready) return 0;
  const live = new Set(safeGetJSON("chat_index", []));
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.indexOf(STORY_FILE_PREFIX) === 0) keys.push(key);
  }
  let removed = 0;
  for (const key of keys) {
    if (live.has(key.slice(STORY_FILE_PREFIX.length))) continue;
    try {
      localStorage.removeItem(key);
      removed++;
    } catch (e) {
      /* storage unavailable — leave it */
    }
  }
  return removed;
}

/* ── Reading the transcript ─────────────────────────────────────── */

/** Index of the newest transcript entry that is not a generated image. */
function lastStoryIndex() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (!chatHistory[i].image) return i;
  }
  return -1;
}

/** Does the file predate the transcript? */
function storyFileIsStale(file) {
  if (!file) return true;
  return file.throughIndex < lastStoryIndex();
}

/**
 * Render transcript entries from `fromIndex` as plain text for the model.
 *
 * Reads the global `chatHistory`, so callers must invoke it *before* awaiting
 * anything — otherwise a chat switch mid-flight would hand the model the wrong
 * conversation. updateStoryFile() does exactly that.
 * @param {number} fromIndex
 * @returns {string}
 */
function storyFileTranscript(fromIndex, playerName) {
  const from = Math.max(0, fromIndex | 0);
  const who = storyText(playerName) || storyPlayerName() || "You";
  return chatHistory
    .slice(from)
    .filter((m) => !m.image)
    .slice(-STORY_TURNS_MAX)
    .map((m) => {
      // The player's turns are labelled with their own name where one is set.
      // A transcript that says "User" is exactly what tempts the model to
      // record the player as a character called User.
      const speaker =
        m.role === "user" ? who : m.name ? String(m.name) : "Story";
      return `${speaker}: ${m.content || ""}`;
    })
    .join("\n\n")
    .slice(-STORY_TRANSCRIPT_MAX);
}

/* ── Parsing and merging ────────────────────────────────────────── */

/**
 * Pull a record out of whatever the model actually replied.
 *
 * A `response_format` schema makes this usually unnecessary, but the fallback
 * still has to cope with a fenced block, a sentence of preamble, or trailing
 * commas — the model is a roleplay fine-tune, not a JSON service.
 * @param {string} raw
 * @returns {object|null}
 */
function parseStoryFileJSON(raw) {
  if (!raw) return null;
  let text = String(raw);

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1];

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const body = text.slice(start, end + 1);
  for (const attempt of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      /* try the next, more forgiving, form */
    }
  }
  return null;
}

/**
 * Fold a parsed update into the previous record.
 *
 * Absent fields carry forward, but a field the update *does* include is
 * authoritative even when it is empty. That distinction matters: the schema
 * forces the model to send every field, so an empty `condition` is how a
 * healed wound gets cleared — whereas a model that simply omits the key is
 * saying nothing, and must not erase what is already known. `present` is
 * authoritative in the same way: anyone it omits is out of the shot (but keeps
 * their entry, because the same character may walk back in and should not be
 * redesigned when they do).
 *
 * `appearance` is only replaced when the update supplies one, and the
 * instruction tells the model to supply one only for a permanent change. That
 * is what stops a character's face from being quietly rewritten each turn.
 * @param {object} prev Normalized
 * @param {object} incoming Parsed, untrusted
 * @returns {object}
 */
/* ── Pins ────────────────────────────────────────────────────────
   The record is written by a model and corrected by a person. A pin is how
   the second of those wins: a field held by hand is one the next update
   merges around instead of overwriting. */

/** Whole-record pins: the scene, and who counts as present. */
const STORY_PIN_SCENE = "__scene";
const STORY_PIN_PRESENT = "__present";

/** A character pin id is "<characterKey>.<field>". */
function storyPinId(key, field) {
  return key + "." + field;
}

/** A scene pin is "__scene.<field>"; a bare `__scene` holds every axis. */
function storyScenePinId(field) {
  return storyPinId(STORY_PIN_SCENE, field);
}

function storySceneFieldPinned(file, field) {
  return (
    storyFilePinned(file, STORY_PIN_SCENE) ||
    storyFilePinned(file, storyScenePinId(field))
  );
}

/** Is this field held against the model's next update? */
function storyFilePinned(file, id) {
  return !!(file && file.pins && file.pins[id] === true);
}

/** Hold or release a field. */
function storyFileSetPin(file, id, on) {
  if (!file) return;
  if (!file.pins) file.pins = {};
  if (on) file.pins[id] = true;
  else delete file.pins[id];
}

function mergeStoryFile(prev, incoming) {
  const next = normalizeStoryFile(prev);
  if (!incoming || typeof incoming !== "object") return next;

  // Scene axes are merged one at a time. A model that only reports "the room
  // changed" must not wipe the time of day, and a pinned axis is never touched
  // by a model update at all.
  const incomingScene =
    typeof incoming.scene === "string"
      ? { situation: incoming.scene }
      : incoming.scene && typeof incoming.scene === "object"
        ? incoming.scene
        : null;
  if (incomingScene) {
    for (const field of STORY_SCENE_FIELDS) {
      if (!(field in incomingScene)) continue;
      if (storySceneFieldPinned(next, field)) continue;
      const value = storyText(incomingScene[field]);
      // Empty is authoritative: a room with no weather reported is how
      // "indoors" clears yesterday's rain.
      next.scene[field] = value;
    }
  }

  // The player is merged separately from the cast. A configured name is the
  // user's statement and is never overwritten by the model; the look fields
  // follow the same empty-is-authoritative rule as a character's.
  const incomingPlayer =
    incoming.player &&
    typeof incoming.player === "object" &&
    !Array.isArray(incoming.player)
      ? incoming.player
      : null;
  if (incomingPlayer) {
    for (const field of ["name", "appearance", "clothing", "condition"]) {
      if (!(field in incomingPlayer)) continue;
      if (storyFilePinned(next, storyPinId("__player", field))) continue;
      const value = storyText(incomingPlayer[field]);
      if (field === "name") {
        if (!storyPlayerName() && value) next.player.name = value;
        continue;
      }
      next.player[field] = value;
    }
  }

  // Merge character detail before present, so a name listed as present can
  // pick up the detail that arrived in the same update.
  const rawCharacters = Array.isArray(incoming.characters)
    ? incoming.characters
    : incoming.characters && typeof incoming.characters === "object"
      ? Object.entries(incoming.characters).map(([name, value]) =>
          Object.assign({ name: name }, value || {}),
        )
      : [];

  for (const entry of rawCharacters) {
    if (!entry || typeof entry !== "object") continue;
    // An entry that resolves to the player is not a cast member. Ignore it
    // entirely rather than merging its look into the player: that is exactly
    // how S ended up wearing Jess's clothes.
    const name = storyRecordedName(entry.name, next);
    if (!name) continue;
    const key = storyCharacterKey(name);

    const before = next.characters[key] || {
      name: name,
      appearance: "",
      clothing: "",
      condition: "",
      exited: false,
    };

    // Present-but-empty is how a field is cleared (a healed wound, a garment
    // put back on); absent means the model said nothing about it.
    const supplied = (value) => typeof value === "string";

    // Identity is locked once set. A model restating the same face in
    // different words must not be able to rewrite it, so a change is only
    // taken when the record has nothing yet (establishing it for the first
    // time) or when the update says outright that the change is permanent.
    const rewriteAppearance =
      (before.appearance === "" || entry.appearance_change === true) &&
      storyText(entry.appearance);

    const held = (field) => storyFilePinned(next, storyPinId(key, field));

    next.characters[key] = {
      name: name || before.name,
      appearance: held("appearance")
        ? before.appearance
        : rewriteAppearance
          ? storyText(entry.appearance)
          : before.appearance,
      clothing: held("clothing")
        ? before.clothing
        : supplied(entry.clothing)
          ? storyText(entry.clothing)
          : before.clothing,
      condition: held("condition")
        ? before.condition
        : supplied(entry.condition)
          ? storyText(entry.condition)
          : before.condition,
      exited: before.exited === true,
    };
  }

  if (
    Array.isArray(incoming.present) &&
    !storyFilePinned(next, STORY_PIN_PRESENT)
  ) {
    next.present = incoming.present
      .map((name) => storyPresentName(name, next))
      .filter(Boolean)
      // A character the user took out of the story stays out: the transcript
      // will keep mentioning them for a while, and resurrecting them on the
      // next turn is exactly what the ✕ is there to prevent.
      .filter((name) => {
        const entry = next.characters[storyCharacterKey(name)];
        return !entry || !entry.exited;
      })
      .slice(0, STORY_MAX_PRESENT);
  }

  // Everyone present needs an entry, present or not — except the player, who
  // is represented by next.player instead of a cast entry.
  const playerKey = storyCharacterKey(storyPlayerRecordName(next));
  if (playerKey && next.characters[playerKey]) {
    delete next.characters[playerKey];
  }
  for (const name of next.present) {
    const key = storyCharacterKey(name);
    if (!key || next.characters[key]) continue;
    if (playerKey && key === playerKey) continue;
    next.characters[key] = {
      name: name,
      appearance: "",
      clothing: "",
      condition: "",
      exited: false,
    };
  }

  // Trim, preferring to forget people who are not in the scene right now.
  const keys = Object.keys(next.characters);
  if (keys.length > STORY_MAX_CHARACTERS) {
    const presentKeys = new Set(next.present.map(storyCharacterKey));
    const drop = keys.filter((k) => !presentKeys.has(k));
    for (const key of drop) {
      if (Object.keys(next.characters).length <= STORY_MAX_CHARACTERS) break;
      delete next.characters[key];
    }
  }

  return next;
}

/* ── Explicit exits ─────────────────────────────────────────────── */

/**
 * Record that a character has left the story for good.
 *
 * Called when the user removes a card from the cast. The entry is kept — only
 * flagged and dropped from `present` — so that re-adding the same person later
 * reuses the appearance already established instead of inventing a new face.
 * @param {object|null} card
 */
function markCharacterExited(card) {
  if (!card || !currentChatId) return;
  const file = getStoryFile(currentChatId);
  if (!file) return;

  const key = storyCharacterKey(card.name);
  if (!key) return;
  // A cast card that happens to name the player is not an NPC and must not be
  // recorded as one.
  if (key === storyCharacterKey(storyPlayerRecordName(file))) return;

  const entry = file.characters[key] || {
    name: card.name,
    appearance: "",
    clothing: "",
    condition: "",
    exited: false,
  };
  entry.exited = true;
  file.characters[key] = entry;
  file.present = file.present.filter((name) => storyCharacterKey(name) !== key);
  file.updatedAt = Date.now();
  saveStoryFile(file, currentChatId);
}

/**
 * Undo markCharacterExited() when the card is cast again.
 * @param {object|null} card
 */
function markCharacterRestored(card) {
  if (!card || !currentChatId) return;
  const file = getStoryFile(currentChatId);
  if (!file) return;

  const key = storyCharacterKey(card.name);
  if (key === storyCharacterKey(storyPlayerRecordName(file))) return;
  const entry = file.characters[key];
  if (!entry || !entry.exited) return;
  entry.exited = false;
  file.updatedAt = Date.now();
  saveStoryFile(file, currentChatId);
}

/* ── The update pass ────────────────────────────────────────────── */

/** The instruction that turns a transcript into a story file update. */
const STORY_UPDATE_SYSTEM = [
  "You maintain a compact JSON record of the current scene for an image",
  "generator that has no memory of this story. Update the record from the new",
  "messages.",
  "",
  "Reply with ONE JSON object and nothing else. No prose, no code fences.",
  "",
  '{ "scene": {',
  '    "location": "where this is: room, building, landscape",',
  '    "timeOfDay": "dawn, morning, midday, afternoon, dusk, night",',
  '    "weather": "clear, rain, snow, fog — or empty when indoors",',
  '    "lighting": "firelight, neon, moonlight, daylight through windows",',
  '    "mood": "tense, tender, chaotic, quiet",',
  '    "situation": "the immediate action in one short phrase"',
  "  },",
  '  "present": ["Name"],',
  '  "player": { "name": "", "appearance": "", "clothing": "",',
  '               "condition": "" },',
  '  "characters": [',
  '    { "name": "Name", "appearance": "", "appearance_change": false,',
  '      "clothing": "", "condition": "" }',
  "  ] }",
  "",
  "Rules:",
  "- The player is the person the user is playing. `player` is their record and",
  "  they must NEVER appear in `characters`. The cast cards are other people,",
  "  even the first/lead card; do not copy a cast member's name, appearance or",
  "  clothing onto the player.",
  "- player.name is the name the player's character goes by. If STORY SETUP",
  "  supplies a player name, use it exactly; otherwise infer it from how the",
  "  story addresses them. Keep it stable once set.",
  "- player.appearance is the player's permanent identity and is LOCKED the same",
  "  way: repeat it, do not rewrite it from another person's description.",
  "- player.clothing and player.condition follow the same rules as a character's",
  "  and describe the player right now. Derive the opening outfit from the",
  "  player's persona and the opening scene when nothing is recorded yet; if the",
  "  story truly gives no basis, leave them empty rather than borrowing a cast",
  "  member's clothes.",
  "- present includes the player's name when the player is physically in the",
  "  scene, alongside the other names.",
  "- Never merge two people. If the prose names Jess and the player separately,",
  "  they are two records with different names, looks and clothes.",
  "- The scene object is the image's only view of the world. Every field must",
  "  describe RIGHT NOW. When a message moves the story to a new room,",
  "  location, time of day, weather or lighting, rewrite that field. Do not",
  "  leave an earlier value standing once it has changed.",
  "- When the scene genuinely has no such feature (indoors, no weather),",
  "  write an empty string rather than keeping an old value.",
  "- situation is what is happening at this moment, never a summary of the",
  "  story so far.",
  "- present lists only who is physically in the scene at the end of the new",
  "  messages. Anyone who has left is omitted. Spell names exactly as the",
  "  previous record spells them.",
  "- The transcript's User turns are the player themselves. Name them the way",
  '  the story names them. Never write "User" or "You" as a character name.',
  "- appearance is permanent identity: build, face, hair, eyes, skin. It is",
  "  LOCKED — repeat it exactly as the previous record has it, and it will be",
  "  ignored unless you also set appearance_change to true.",
  "- Set appearance_change to true ONLY when the new messages permanently",
  "  change how someone looks (a scar that will stay, a lost eye, a haircut).",
  "  When you do, write the COMPLETE new appearance. Never set it merely",
  "  because the prose found different words for the same face. An injury, a",
  "  bandage, dirt or sweat is condition, never appearance.",
  "- clothing is what they are wearing right now. Always write the current",
  "  state in full for every character you list — what they wear now, not what",
  "  they wore earlier. A garment that was removed is gone.",
  "- Establish clothing from STORY SETUP (the character card, the opening",
  "  scene, the first prompt) when a character has none yet. Infer a concrete,",
  "  consistent outfit from the card and the setting rather than leaving it",
  "  blank, and keep that outfit until the story changes it.",
  "- condition is the marks still on them: injuries, bandages, blood, dirt,",
  "  sweat, torn clothing, and the state of their body. It is NOT what they",
  "  are doing — poses, gestures, expressions and actions belong in the scene,",
  "  and putting them here pushes the injuries out.",
  "- Repeat every mark that is still there. A mark left out is treated as",
  "  healed and is forgotten, so carry a bandage forward until the messages",
  "  say it came off. When a wound is treated, replace the wound with the",
  "  treatment. When nothing remains, write an empty string.",
  "- Include a character in the array whenever they are named in the scene,",
  "  even if you are only repeating what the previous record already said.",
  "- Keep every value as short comma-separated fragments, not sentences.",
  "- Record only what the messages and setup establish. Never invent plot.",
].join("\n");

/** The strict schema handed to servers that support `response_format`. */
const STORY_FILE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "story_scene",
    strict: true,
    schema: {
      type: "object",
      properties: {
        scene: {
          type: "object",
          properties: {
            location: { type: "string" },
            timeOfDay: { type: "string" },
            weather: { type: "string" },
            lighting: { type: "string" },
            mood: { type: "string" },
            situation: { type: "string" },
          },
          required: [
            "location",
            "timeOfDay",
            "weather",
            "lighting",
            "mood",
            "situation",
          ],
          additionalProperties: false,
        },
        present: { type: "array", items: { type: "string" } },
        player: {
          type: "object",
          properties: {
            name: { type: "string" },
            appearance: { type: "string" },
            clothing: { type: "string" },
            condition: { type: "string" },
          },
          required: ["name", "appearance", "clothing", "condition"],
          additionalProperties: false,
        },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              appearance: { type: "string" },
              appearance_change: { type: "boolean" },
              clothing: { type: "string" },
              condition: { type: "string" },
            },
            required: [
              "name",
              "appearance",
              "appearance_change",
              "clothing",
              "condition",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["scene", "present", "player", "characters"],
      additionalProperties: false,
    },
  },
};

/** @type {Promise|null} In-flight background update, so only one runs at a time. */
let _storyUpdatePromise = null;

/** The record as the model should see it — the current state, minus bookkeeping. */
function storyFileForModel(file) {
  return {
    scene: Object.assign({}, file.scene),
    player: {
      name: file.player.name,
      appearance: file.player.appearance,
      clothing: file.player.clothing,
      condition: file.player.condition,
    },
    present: file.present,
    characters: Object.keys(file.characters).map((key) => {
      const c = file.characters[key];
      return {
        name: c.name,
        appearance: c.appearance,
        clothing: c.clothing,
        condition: c.condition,
      };
    }),
  };
}

/**
 * The setup the chat began with, as the model should see it.
 *
 * A story's opening prompt and cast cards establish clothing and setting before
 * a single reply exists. Without them the record would start empty and the
 * first image could only guess.
 * @returns {object}
 */
function storySetupForModel() {
  const cfg = storyConfig && typeof storyConfig === "object" ? storyConfig : {};
  const cast = typeof getCast === "function" ? getCast() : [];
  return {
    scene: storyText(cfg.scene),
    firstPrompt: storyText(cfg.firstPrompt),
    tags: storyText(cfg.tags),
    userName: storyPlayerName(),
    userPersona: storyText(cfg.userPersona),
    cast: cast
      .filter((card) => card && card.name)
      .slice(0, STORY_MAX_CHARACTERS)
      .map((card) => ({
        name: storyText(card.name),
        appearance: storyText(card.appearance),
        description: storyText(card.description).slice(0, 500),
        personality: storyText(card.personality).slice(0, 300),
        scenario: storyText(card.scenario).slice(0, 300),
      })),
  };
}

/** Render the setup for a prompt, or "" when there is nothing to say. */
function storySetupBlock() {
  const setup = storySetupForModel();
  const lines = [];
  if (setup.scene) lines.push("Opening scene: " + setup.scene);
  if (setup.tags) lines.push("Genre/tags: " + setup.tags);
  if (setup.firstPrompt) lines.push("First prompt: " + setup.firstPrompt);
  if (setup.userName) {
    lines.push(
      "Player character (the user, NOT a cast member): " + setup.userName,
    );
  }
  if (setup.userPersona) lines.push("Player persona: " + setup.userPersona);
  if (setup.cast.length) {
    lines.push("Cast cards below are other people, never the player:");
  }
  for (const person of setup.cast) {
    const bits = [
      person.appearance,
      person.description,
      person.personality,
      person.scenario,
    ].filter(Boolean);
    if (bits.length) lines.push(person.name + " (card): " + bits.join(" | "));
  }
  return lines.join("\n");
}

/**
 * The record as a plain snapshot — the state an image was actually drawn from.
 *
 * A regenerate replays this instead of the chat's current record, so scrolling
 * back to an old scene does not draw it with today's location and clothes.
 * @param {string} [chatId]
 * @returns {object|null}
 */
function storyFileSnapshot(chatId) {
  const file = getStoryFile(chatId || currentChatId);
  if (!file) return null;
  return {
    version: STORY_FILE_VERSION,
    seed: file.seed,
    editedAt: file.editedAt,
    style: file.style,
    scene: Object.assign({}, file.scene),
    player: JSON.parse(JSON.stringify(file.player)),
    present: file.present.slice(),
    characters: JSON.parse(JSON.stringify(file.characters)),
  };
}

/**
 * Fold the newest turns into a chat's story file.
 *
 * Everything the model needs is captured *synchronously* before the first
 * await: the transcript snapshot and the target chat id. Without that, a chat
 * switch while the request is in flight would fold the wrong conversation into
 * the wrong chat's record.
 * @param {{signal?:AbortSignal, onStatus?:(s:string)=>void,
 *   fromIndex?:number}} [opts] `fromIndex` re-reads from earlier in the
 *   transcript (used when a plain chat turns on tracking mid-story)
 * @returns {Promise<object|null>} The updated record, or null if it failed
 */
async function updateStoryFile(opts) {
  opts = opts || {};
  const chatId = currentChatId;
  if (!chatId) return null;

  const file = ensureStoryFile(chatId);
  if (!file) return null;

  const setupBlock = storySetupBlock();
  const includeSetup = !file.setupDone && setupBlock.trim() !== "";
  const fromIndex = Number.isInteger(opts.fromIndex)
    ? Math.max(0, opts.fromIndex)
    : file.throughIndex + 1;
  const transcript = storyFileTranscript(
    fromIndex,
    storyPlayerRecordName(file),
  );

  // Nothing new and nothing to establish: skip the call rather than spend one
  // restating the record back to itself.
  if (!transcript.trim() && !includeSetup) return file;

  const prompt =
    "CURRENT RECORD:\n" +
    JSON.stringify(storyFileForModel(file)) +
    (includeSetup
      ? "\n\nSTORY SETUP (how this chat began):\n" + setupBlock
      : "") +
    "\n\nNEW MESSAGES:\n" +
    (transcript ||
      "(no messages yet — establish the opening state from the setup)");

  let raw;
  try {
    raw = await requestCompletion(
      [
        { role: "system", content: STORY_UPDATE_SYSTEM },
        { role: "user", content: prompt },
      ],
      {
        maxTokens: 500,
        temperature: 0.2,
        signal: opts.signal,
        responseFormat: STORY_FILE_SCHEMA,
        onRetry: (ms) => {
          if (typeof opts.onStatus === "function") {
            opts.onStatus(
              `Rate limited — retrying in ${Math.round(ms / 1000)}s…`,
            );
          }
        },
      },
    );
  } catch (err) {
    // A failed update is not a failed story: keep the record we already had.
    console.warn("Story file update failed:", err);
    return null;
  }

  const parsed = parseStoryFileJSON(raw);
  if (!parsed) {
    console.warn("Story file update returned no usable JSON.");
    return null;
  }

  // Re-read rather than reuse `file`: another update may have landed while this
  // one was in flight, and the record on disk is the one worth merging into.
  const latest = getStoryFile(chatId) || file;
  const merged = mergeStoryFile(latest, parsed);
  merged.throughIndex = Math.max(merged.throughIndex, lastStoryIndex());
  if (includeSetup) merged.setupDone = true;
  merged.updatedAt = Date.now();
  saveStoryFile(merged, chatId);
  return merged;
}

/**
 * Is scene tracking on for this chat?
 *
 * Story mode always tracks: every reply can move the scene, and the image
 * prompt reads the record rather than the transcript. A plain chat only tracks
 * once it has asked for an image — a chat about the weather should not spend a
 * model call per turn building a scene record it will never draw.
 * @returns {boolean}
 */
function storyTrackingEnabled() {
  if (!currentChatId) return false;
  if (currentMode === "story") return true;
  const file = getStoryFile(currentChatId);
  return !!(file && file.tracking);
}

/**
 * Turn on scene tracking for a plain chat.
 *
 * Re-reads from the start of the transcript, because the prose that came
 * before the first image is exactly the prose the record is missing.
 * @returns {object|null}
 */
function storyFileEnableTracking() {
  if (!currentChatId) return null;
  const file = ensureStoryFile(currentChatId);
  if (!file) return null;
  if (file.tracking) return file;
  file.tracking = true;
  file.throughIndex = -1;
  saveStoryFile(file, currentChatId);
  return file;
}

/**
 * Make the record current before an image prompt is built.
 *
 * The prompt reads the record, not the transcript, so a reply that was never
 * folded in would draw the previous scene. Awaits an in-flight background
 * update instead of starting a second one, then folds in anything still
 * behind.
 * @param {{signal?:AbortSignal, onStatus?:(s:string)=>void}} [opts]
 * @returns {Promise<object|null>}
 */
async function prepareStoryFileForImage(opts) {
  opts = opts || {};
  const chatId = currentChatId;
  if (!chatId) return null;
  if (currentMode !== "story") storyFileEnableTracking();

  if (_storyUpdatePromise) {
    await _storyUpdatePromise.catch(() => null);
  }
  if (currentChatId !== chatId) return null;

  let file = getStoryFile(chatId);
  // Staleness is the only reason to spend a call: the transcript has moved on,
  // or the opening setup has never been folded in. Repeating a full update just
  // because one outfit field is still empty would cost a call per image.
  const needsUpdate =
    !file ||
    storyFileIsStale(file) ||
    (!file.setupDone && storySetupBlock().trim() !== "");
  if (needsUpdate) {
    const updated = await updateStoryFile({
      signal: opts.signal,
      onStatus: opts.onStatus,
    });
    if (updated) file = updated;
  }
  return getStoryFile(chatId) || file;
}

/**
 * Kick off a background update after a reply, if one is not already running.
 *
 * Deliberately fire-and-forget: it is an extra model call, and making the user
 * wait for it before they can read the reply they just got would be the wrong
 * trade. At most one runs at a time.
 * @returns {Promise|null}
 */
function scheduleStoryFileUpdate() {
  if (!storyTrackingEnabled()) return null;
  if (_storyUpdatePromise) return _storyUpdatePromise;

  const promise = updateStoryFile({})
    .catch(() => null)
    .finally(() => {
      _storyUpdatePromise = null;
      if (typeof renderStoryFilePanel === "function") renderStoryFilePanel();
    });

  _storyUpdatePromise = promise;
  return promise;
}

/**
 * The record as a block of authoritative context for a prompt builder.
 *
 * This is what stops a summariser writing "the two of them" and losing every
 * name the appearance locks are keyed on. The scene is labelled axis by axis so
 * "night" reaches the prompt as lighting rather than as a remembered word.
 * @param {object} file
 * @returns {string}
 */
function storyFileContextBlock(file) {
  if (!file) return "";
  const lines = [];
  const scene = file.scene || {};
  const labels = [
    ["location", "Location"],
    ["timeOfDay", "Time of day"],
    ["weather", "Weather"],
    ["lighting", "Lighting"],
    ["mood", "Mood"],
    ["situation", "Happening now"],
  ];
  for (const [field, label] of labels) {
    if (scene[field]) lines.push(`${label}: ${scene[field]}`);
  }
  if (file.present.length) {
    lines.push(`Present: ${file.present.join(", ")}`);
  }
  const presentKeys = new Set(
    (file.present || []).map((name) => storyCharacterKey(name)),
  );
  const playerName = storyPlayerRecordName(file);
  const playerKey = storyCharacterKey(playerName);
  // Always name the player so the summariser can resolve a pronoun to them,
  // but describe their look only when they are actually in the shot.
  if (playerName) {
    lines.push(`Player: ${playerName}`);
    if (playerKey && presentKeys.has(playerKey)) {
      const p = file.player || {};
      const bits = [p.appearance, p.clothing, p.condition].filter(Boolean);
      if (bits.length) lines.push(`${playerName} (player): ${bits.join("; ")}`);
    }
  }
  // Only people in the scene are described. A character who is elsewhere still
  // has a record (they may walk back in) but describing them here is how a solo
  // shot quietly grows a second person.
  const describeAll = presentKeys.size === 0;
  for (const key of Object.keys(file.characters)) {
    const c = file.characters[key];
    if (c.exited) continue;
    if (playerKey && key === playerKey) continue;
    if (!describeAll && !presentKeys.has(key)) continue;
    const bits = [c.appearance, c.clothing, c.condition].filter(Boolean);
    if (bits.length) lines.push(`${c.name}: ${bits.join("; ")}`);
  }
  return lines.join("\n");
}

/* ══════════════════════════════════════════════════════════════
   The panel

   The record is written by a model, which means it is sometimes
   wrong — a wound remembered as a scar, a character who left still
   listed as present. Every field is therefore editable, and an edit
   is final: it is written straight to the file and the next update
   merges *around* it rather than over it. Without this the only way
   to correct a bad extraction would be to delete the chat.
   ══════════════════════════════════════════════════════════════ */

/** Human-readable age of a timestamp. */
function storyFileAge(ts) {
  if (!ts) return "never";
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return secs + "s ago";
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + "m ago";
  return Math.round(mins / 60) + "h ago";
}

/**
 * One line describing where the record stands.
 *
 * "Behind" is counted in messages rather than in seconds on purpose: the only
 * thing that makes the record wrong is unread prose, and a record can sit
 * untouched for an hour and still be perfectly current.
 */
function storyFileStatusText(file) {
  if (_storyUpdatePromise) return "updating…";
  if (!file) return "";
  const behind = lastStoryIndex() - file.throughIndex;
  if (behind > 0) {
    return "behind by " + behind + (behind === 1 ? " message" : " messages");
  }
  return "updated " + storyFileAge(file.updatedAt);
}

/**
 * The clickable caption above a field, which doubles as its pin control.
 *
 * A button rather than a plain label because it does something: it holds the
 * value against the model's next update. The wording changes with the state so
 * the behaviour is visible rather than a hidden consequence of having typed.
 */
function storyFilePinButton(file, id, label) {
  const pinned = storyFilePinned(file, id);
  return (
    '<button type="button" class="story-file-field-label' +
    (pinned ? " pinned" : "") +
    '" data-story-pin="' +
    escapeHtml(id) +
    '" title="' +
    (pinned
      ? "Held — the next update will not overwrite this. Click to release."
      : "Click to hold this value against the next update") +
    '">' +
    label +
    (pinned ? " · held" : "") +
    "</button>"
  );
}

/** One labelled, editable text field for a character in the record. */
function storyFileField(file, key, field, label, value) {
  return (
    '<div class="story-file-field">' +
    storyFilePinButton(file, storyPinId(key, field), label) +
    '<input type="text" data-story-key="' +
    escapeHtml(key) +
    '" data-story-field="' +
    field +
    '" value="' +
    escapeHtml(value) +
    '" placeholder="—">' +
    "</div>"
  );
}

/** Rebuild the story file panel from the current chat's record. */
function renderStoryFilePanel() {
  const panel = document.getElementById("story-file");
  if (!panel) return;
  const body = document.getElementById("story-file-body");
  const statusEl = document.getElementById("story-file-status");
  if (!body) return;

  const file = currentChatId ? getStoryFile(currentChatId) : null;
  const visible = currentMode === "story" && !!file;
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;

  if (statusEl) statusEl.textContent = storyFileStatusText(file);

  // Rebuilding discards whatever is in the inputs, and a background update can
  // land mid-edit. Remember where the caret was so typing survives it.
  const active = document.activeElement;
  const restore =
    active &&
    panel.contains(active) &&
    active.dataset &&
    active.dataset.storyKey
      ? {
          key: active.dataset.storyKey,
          field: active.dataset.storyField,
          pos: active.selectionStart,
        }
      : null;

  const playerName = storyPlayerRecordName(file);
  const playerKey = storyCharacterKey(playerName);
  const playerPresent =
    !!playerKey && file.present.some((n) => storyCharacterKey(n) === playerKey);
  const keys = Object.keys(file.characters).filter(
    (key) => !playerKey || key !== playerKey,
  );
  const rows = keys
    .map((key) => {
      const c = file.characters[key];
      const present = file.present.some((n) => storyCharacterKey(n) === key);
      return (
        '<div class="story-file-char' +
        (present ? "" : " absent") +
        (c.exited ? " exited" : "") +
        '">' +
        '<div class="story-file-char-head">' +
        '<button type="button" class="story-file-name' +
        (present ? " on" : "") +
        '" data-story-present="' +
        escapeHtml(c.name) +
        '" title="' +
        (present
          ? "In the scene — click to remove"
          : "Not in the scene — click to add") +
        '">' +
        escapeHtml(c.name) +
        "</button>" +
        (c.exited ? '<span class="story-file-tag">left</span>' : "") +
        '<button type="button" class="cast-icon-btn cast-icon-remove" data-story-forget="' +
        escapeHtml(key) +
        '" title="Forget this character">&#x2715;</button>' +
        "</div>" +
        storyFileField(
          file,
          key,
          "appearance",
          "Permanent look",
          c.appearance,
        ) +
        storyFileField(file, key, "clothing", "Clothing", c.clothing) +
        storyFileField(
          file,
          key,
          "condition",
          "Condition & injuries",
          c.condition,
        ) +
        "</div>"
      );
    })
    .join("");

  // The player gets their own block. They are not a cast member, and keeping
  // them visually separate is what stops a model-written cast entry from being
  // mistaken for the person the user is playing.
  const playerSection =
    '<div class="story-file-char story-file-player">' +
    '<div class="story-file-char-head">' +
    (playerName
      ? '<button type="button" class="story-file-name' +
        (playerPresent ? " on" : "") +
        '" data-story-present="' +
        escapeHtml(playerName) +
        '" title="' +
        (playerPresent
          ? "In the scene — click to remove"
          : "Not in the scene — click to add") +
        '">' +
        escapeHtml(playerName) +
        "</button>"
      : '<span class="story-file-name">Player</span>') +
    '<span class="story-file-tag">player</span>' +
    (playerName
      ? '<span class="story-file-tag">' +
        (playerPresent ? "in scene" : "off-screen") +
        "</span>"
      : "") +
    "</div>" +
    storyFileField(file, "__player", "name", "Player name", file.player.name) +
    storyFileField(
      file,
      "__player",
      "appearance",
      "Permanent look",
      file.player.appearance,
    ) +
    storyFileField(
      file,
      "__player",
      "clothing",
      "Clothing",
      file.player.clothing,
    ) +
    storyFileField(
      file,
      "__player",
      "condition",
      "Condition & injuries",
      file.player.condition,
    ) +
    "</div>";

  const sceneFields = STORY_SCENE_FIELDS.map((field) => {
    const value = file.scene[field] || "";
    const placeholder = escapeHtml(STORY_SCENE_HINTS[field] || "");
    const control =
      field === "situation"
        ? '<textarea rows="2" data-story-key="__scene" data-story-field="' +
          field +
          '" placeholder="' +
          placeholder +
          '">' +
          escapeHtml(value) +
          "</textarea>"
        : '<input type="text" data-story-key="__scene" data-story-field="' +
          field +
          '" value="' +
          escapeHtml(value) +
          '" placeholder="' +
          placeholder +
          '">';
    return (
      '<div class="story-file-field">' +
      storyFilePinButton(
        file,
        storyScenePinId(field),
        STORY_SCENE_LABELS[field] || field,
      ) +
      control +
      "</div>"
    );
  }).join("");

  body.innerHTML =
    '<div class="story-file-toolbar">' +
    '<button type="button" class="story-file-btn" onclick="refreshStoryFile()" ' +
    'title="Re-read the conversation and update the record now">Refresh</button>' +
    '<button type="button" class="story-file-btn" onclick="rerollStorySeed()" ' +
    'title="Draw a new seed for future pictures in this chat">Seed \u21bb</button>' +
    '<span class="story-file-seed" title="Locked per chat — every picture in this chat uses it">' +
    (file.seed || "—") +
    "</span>" +
    '<button type="button" class="story-file-btn" onclick="openSceneJsonEditor()" ' +
    'title="Open the raw record that image prompts are built from">JSON</button>' +
    "</div>" +
    sceneFields +
    '<div class="story-file-hint">Click a name to move them in or out of the scene. ' +
    "Changes are saved as you type. The player is kept apart from the cast. " +
    storyFilePinButton(file, STORY_PIN_PRESENT, "Hold the scene's cast") +
    "</div>" +
    '<div class="story-file-chars">' +
    playerSection +
    rows +
    "</div>" +
    (rows
      ? ""
      : '<div class="story-file-empty">No other characters yet — they fill in ' +
        "after the next reply.</div>");

  if (restore) {
    const sel = panel.querySelector(
      '[data-story-key="' +
        restore.key +
        '"][data-story-field="' +
        restore.field +
        '"]',
    );
    if (sel) {
      sel.focus();
      try {
        sel.setSelectionRange(restore.pos, restore.pos);
      } catch (e) {
        /* not a text-like input — focus alone is enough */
      }
    }
  }
}

/**
 * A field edited by hand, written straight through to the file.
 *
 * `updatedAt` is deliberately left alone: it means "when the model last read
 * the story", and stamping it here would make the status line claim the record
 * was refreshed when it was only corrected.
 */
function onStoryFileInput(e) {
  const el = e.target;
  if (!el || !el.dataset || !el.dataset.storyField || !currentChatId) return;

  const file = getStoryFile(currentChatId);
  if (!file) return;

  const key = el.dataset.storyKey;
  const field = el.dataset.storyField;

  if (key === "__scene") {
    if (!(field in file.scene)) return;
    file.scene[field] = storyText(el.value);
  } else if (key === "__player") {
    if (!(field in file.player)) return;
    file.player[field] = storyText(el.value);
    // The panel's player name and the cast/persona field are the same fact;
    // keep them in sync so a correction here is not overruled by the old one.
    if (field === "name") {
      storyConfig.userName = file.player.name;
      if (typeof saveStoryConfig === "function") saveStoryConfig();
    }
  } else if (file.characters[key]) {
    file.characters[key][field] = storyText(el.value);
  } else {
    return;
  }

  // A hand edit is a correction, so it is held: the next update merges around
  // it rather than quietly putting the old value back.
  const pinId =
    key === "__scene" ? storyScenePinId(field) : storyPinId(key, field);
  const alreadyHeld = storyFilePinned(file, pinId);
  storyFileSetPin(file, pinId, true);
  file.editedAt = Date.now();
  saveStoryFile(file, currentChatId);

  // The caption is the only place the hold is visible, so mark it now instead
  // of waiting for the next background update to redraw the whole panel.
  if (!alreadyHeld) {
    const panel = e.currentTarget;
    const btn =
      panel && panel.querySelector
        ? panel.querySelector('[data-story-pin="' + pinId + '"]')
        : null;
    if (btn) {
      btn.classList.add("pinned");
      btn.textContent = btn.textContent + " · held";
      btn.title =
        "Held — the next update will not overwrite this. Click to release.";
    }
  }
}

function onStoryFileClick(e) {
  const el = e.target.closest(
    "[data-story-present],[data-story-forget],[data-story-pin]",
  );
  if (!el) return;
  if (el.dataset.storyPin != null) {
    storyFileTogglePin(el.dataset.storyPin);
    return;
  }
  if (el.dataset.storyForget != null) {
    storyFileForgetCharacter(el.dataset.storyForget);
    return;
  }
  if (el.dataset.storyPresent != null) {
    storyFileTogglePresent(el.dataset.storyPresent);
  }
}

/** Hold or release a field against the model's next update. */
function storyFileTogglePin(id) {
  const file = getStoryFile(currentChatId);
  if (!file) return;
  storyFileSetPin(file, id, !storyFilePinned(file, id));
  saveStoryFile(file, currentChatId);
  renderStoryFilePanel();
}

/** Move a character in or out of the scene without touching the cast. */
function storyFileTogglePresent(name) {
  const file = getStoryFile(currentChatId);
  if (!file) return;
  const key = storyCharacterKey(name);
  const at = file.present.findIndex((n) => storyCharacterKey(n) === key);
  if (at >= 0) file.present.splice(at, 1);
  else file.present.push(storyText(name));
  // Moving someone by hand is a statement about the scene, so it is held: the
  // next update would otherwise put them straight back.
  storyFileSetPin(file, STORY_PIN_PRESENT, true);
  saveStoryFile(file, currentChatId);
  renderStoryFilePanel();
}

/**
 * Drop a character from the record entirely — the wrong-person case.
 *
 * Distinct from ✕ on a cast card, which keeps the entry so the same face comes
 * back: here the record itself is wrong and the detail is worth discarding.
 */
function storyFileForgetCharacter(key) {
  const file = getStoryFile(currentChatId);
  if (!file || !file.characters[key]) return;
  // The player is not removable from the cast panel; they are not a cast entry.
  if (key === storyCharacterKey(storyPlayerRecordName(file))) return;
  const name = file.characters[key].name;
  delete file.characters[key];
  file.present = file.present.filter(
    (n) => storyCharacterKey(n) !== storyCharacterKey(name),
  );
  // Their pins go with them, or a later character reusing the name would
  // inherit a lock nobody set.
  for (const id of Object.keys(file.pins || {})) {
    if (id.indexOf(key + ".") === 0) delete file.pins[id];
  }
  saveStoryFile(file, currentChatId);
  renderStoryFilePanel();
}

/** Draw a new seed for this chat's future pictures. */
function rerollStorySeed() {
  const seed = rerollChatSeed();
  if (Number.isFinite(seed)) {
    showToast("New chat seed " + seed, "success");
  }
  renderStoryFilePanel();
}

/** Force a re-read of the conversation, rather than waiting for the next reply. */
async function refreshStoryFile() {
  if (!currentChatId) return;
  ensureStoryFile(currentChatId);
  const statusEl = document.getElementById("story-file-status");
  if (statusEl) statusEl.textContent = "updating…";

  const updated = await updateStoryFile({
    // Refresh means "re-read it all", not "read what arrived since the last
    // pass" — the whole point is to repair a record that drifted.
    fromIndex: 0,
    onStatus: (s) => {
      if (statusEl) statusEl.textContent = s;
    },
  });

  if (!updated) showToast("Could not update the story record.", "error");
  renderStoryFilePanel();
}

/* ── The raw JSON editor ──────────────────────────────────────────
   The record is what image prompts are built from, so when a picture is
   wrong the fastest diagnostic is to look at the record itself. The form
   above is the friendly view; this is the whole file, fields and pins and
   seed together, for the cases the form cannot express.
   ──────────────────────────────────────────────────────────────── */

/** The record as the editor shows it: everything, including bookkeeping. */
function storyFileEditorJSON(file) {
  return JSON.stringify(
    {
      version: STORY_FILE_VERSION,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      editedAt: file.editedAt,
      throughIndex: file.throughIndex,
      seed: file.seed,
      tracking: file.tracking,
      setupDone: file.setupDone,
      style: file.style,
      scene: Object.assign({}, file.scene),
      player: JSON.parse(JSON.stringify(file.player)),
      present: file.present.slice(),
      characters: JSON.parse(JSON.stringify(file.characters)),
      pins: Object.assign({}, file.pins),
    },
    null,
    2,
  );
}

/** Close the JSON editor if it is open. */
function closeSceneJsonEditor() {
  const overlay = document.getElementById("scene-json-overlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", sceneJsonEditorKeydown);
}

function sceneJsonEditorKeydown(e) {
  if (e.key === "Escape") closeSceneJsonEditor();
}

/** Re-read the record into the open editor, discarding local changes. */
function resetSceneJsonEditor() {
  const area = document.getElementById("scene-json-text");
  const file = currentChatId ? getStoryFile(currentChatId) : null;
  if (!area || !file) return;
  area.value = storyFileEditorJSON(file);
  const err = document.getElementById("scene-json-error");
  if (err) err.textContent = "";
}

/**
 * Save the editor's text back over the record.
 *
 * The parsed object goes through normalizeStoryFile() like any other model
 * output, so a missing field cannot leave the record in a shape the prompt
 * builder cannot read. A hand save is marked as an edit, which is how a
 * regenerate knows the correction should outrank a stored scene snapshot.
 */
function saveSceneJsonEditor() {
  const area = document.getElementById("scene-json-text");
  const errorEl = document.getElementById("scene-json-error");
  if (!area || !currentChatId) return;

  const existing = ensureStoryFile(currentChatId);
  let parsed;
  try {
    parsed = JSON.parse(area.value);
  } catch (err) {
    if (errorEl) errorEl.textContent = "Not valid JSON: " + err.message;
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    if (errorEl) errorEl.textContent = "The record must be a JSON object.";
    return;
  }

  const file = normalizeStoryFile(parsed);
  const before = normalizeStoryFile(existing);
  // Bookkeeping the editor is not meant to invent stays with the chat.
  if (!file.seed) file.seed = existing.seed || drawStorySeed();
  if (!file.createdAt) file.createdAt = existing.createdAt;
  if (file.throughIndex < 0 && existing.throughIndex > 0) {
    file.throughIndex = existing.throughIndex;
  }
  // A hand edit is final for the values it actually changed — hold those, and
  // only those, so an unrelated fix does not freeze the whole record against
  // the story moving on.
  let changed = file.seed !== before.seed;
  for (const field of STORY_SCENE_FIELDS) {
    if (file.scene[field] !== before.scene[field]) {
      storyFileSetPin(file, storyScenePinId(field), true);
      changed = true;
    }
  }
  if (JSON.stringify(file.present) !== JSON.stringify(before.present)) {
    storyFileSetPin(file, STORY_PIN_PRESENT, true);
    changed = true;
  }
  for (const field of ["name", "appearance", "clothing", "condition"]) {
    if (file.player[field] !== before.player[field]) {
      storyFileSetPin(file, storyPinId("__player", field), true);
      changed = true;
    }
  }
  // A player name edited here is the same fact as the cast/persona field.
  if (file.player.name !== before.player.name) {
    storyConfig.userName = file.player.name;
    if (typeof saveStoryConfig === "function") saveStoryConfig();
  }
  for (const key of Object.keys(file.characters)) {
    const old = before.characters[key];
    for (const field of ["appearance", "clothing", "condition"]) {
      if (!old || file.characters[key][field] !== old[field]) {
        storyFileSetPin(file, storyPinId(key, field), true);
        changed = true;
      }
    }
  }
  // Opening and saving the editor without touching a value is not an edit: it
  // must not make the next regenerate rebuild a prompt for nothing.
  file.editedAt = changed ? Date.now() : before.editedAt;

  saveStoryFile(file, currentChatId);
  if (typeof renderStoryFilePanel === "function") renderStoryFilePanel();
  closeSceneJsonEditor();
  showToast(changed ? "Scene record saved" : "No changes to save", "success");
}

/** Copy the editor's current text to the clipboard. */
async function copySceneJson() {
  const area = document.getElementById("scene-json-text");
  if (!area) return;
  try {
    await navigator.clipboard.writeText(area.value);
    showToast("Copied", "success");
  } catch (e) {
    area.select();
    document.execCommand && document.execCommand("copy");
    showToast("Copied", "success");
  }
}

/**
 * Open the raw record editor — the composer's document icon.
 *
 * Available in any chat, story or not: a plain chat gets a record the first
 * time it asks for an image, and this is how that record is inspected.
 */
function openSceneJsonEditor() {
  if (!currentChatId) {
    showToast("Start a chat first", "error");
    return;
  }
  const file = ensureStoryFile(currentChatId);
  if (!file) return;
  if (document.getElementById("scene-json-overlay")) return;

  const overlay = document.createElement("div");
  overlay.className = "scene-json-overlay";
  overlay.id = "scene-json-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSceneJsonEditor();
  });

  const modal = document.createElement("div");
  modal.className = "scene-json-modal";

  const head = document.createElement("div");
  head.className = "scene-json-head";
  const title = document.createElement("span");
  title.textContent = "Scene record";
  head.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "config-panel-close";
  closeBtn.setAttribute("aria-label", "Close scene record editor");
  closeBtn.title = "Close";
  closeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.onclick = closeSceneJsonEditor;
  head.appendChild(closeBtn);

  const hint = document.createElement("p");
  hint.className = "scene-json-hint";
  hint.textContent =
    "Image prompts are built from this record, not from the previous message. " +
    "The seed is locked to the chat; every generated picture in it uses that seed. " +
    "Saving holds only the fields you changed, so the next automatic update " +
    "cannot overwrite a correction while the rest of the record keeps tracking the story.";

  const area = document.createElement("textarea");
  area.className = "scene-json-text";
  area.id = "scene-json-text";
  area.spellcheck = false;
  area.value = storyFileEditorJSON(file);

  const errorEl = document.createElement("div");
  errorEl.className = "scene-json-error";
  errorEl.id = "scene-json-error";

  const actions = document.createElement("div");
  actions.className = "scene-json-actions";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "story-file-btn";
  resetBtn.textContent = "Revert";
  resetBtn.title = "Reload the stored record and discard your changes";
  resetBtn.onclick = resetSceneJsonEditor;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "story-file-btn";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = copySceneJson;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "story-file-btn primary";
  saveBtn.textContent = "Save";
  saveBtn.onclick = saveSceneJsonEditor;

  actions.appendChild(resetBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(saveBtn);

  modal.appendChild(head);
  modal.appendChild(hint);
  modal.appendChild(area);
  modal.appendChild(errorEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", sceneJsonEditorKeydown);
  area.focus();
  area.setSelectionRange(0, 0);
}

/** Wire the panel's delegated listeners once, at startup. */
function initStoryFilePanel() {
  const panel = document.getElementById("story-file");
  if (!panel) return;
  panel.addEventListener("input", onStoryFileInput);
  panel.addEventListener("click", onStoryFileClick);
}

document.addEventListener("DOMContentLoaded", () => {
  initStoryFilePanel();
});
