/* ══════════════════════════════════════════════════════════════
   sceneprompt.js — turning a moment of the story into an image prompt

   A transcript is prose, and prose makes a poor diffusion prompt: it
   says "she looked at him", which is two unnamed people, no clothing
   and no frame. So the moment is first summarised into visual phrases
   by the chat model.

   What the summariser is deliberately not allowed to decide is what
   anyone looks like. Identity, clothing and condition are appended
   afterwards, verbatim from the chat's story file, because they have
   to be identical between images for two pictures to read as the same
   person. The summariser composes the shot; the file supplies the cast.
   ══════════════════════════════════════════════════════════════ */

/**
 * Matches a leading /image or /img command; the trailing text is optional.
 *
 * /image is scene-aware, because in practice its argument is nearly always a
 * direction about the scene ("show the whole scene", "show me Jess") rather
 * than a standalone subject — and read literally those produce an image of
 * nothing in particular. /img is the verbatim escape hatch.
 */
const IMAGE_COMMAND_RE = /^\/(image|img)(?:\s+([\s\S]+))?$/i;

/**
 * Matches a leading /edit command; the instruction is required.
 *
 * /edit is the explicit edit path: it always takes the most recent picture and
 * asks FLUX.2 Klein to change it, where /image *decides* whether the direction
 * is an edit or a fresh draw. /img still draws fresh from literal text.
 */
const IMAGE_EDIT_COMMAND_RE = /^\/edit(?:\s+([\s\S]+))?$/i;

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
 * Parse an /edit command.
 * @param {string} text
 * @returns {{instruction:string, edit:true}|null}
 */
function parseImageEditCommand(text) {
  const m = IMAGE_EDIT_COMMAND_RE.exec((text || "").trim());
  if (!m) return null;
  return { instruction: (m[1] || "").trim(), edit: true };
}

/**
 * Words that can only be about a picture that already exists — they cannot be
 * part of a fresh description. "a castle instead" is still the current picture.
 *
 * Deliberately *not* a pronoun list. "it" and "this" are pronouns in a fresh
 * sentence too: "a castle flying in the sky, dragons flying around it" names its
 * own subject, and treating that "it" as a reference to the picture on screen
 * routed the direction into a 0.6-denoise img2img pass, which returned the old
 * woman-and-child picture with the castle as a painting on the wall.
 */
const IMAGE_EDIT_CONTINUATION_RE =
  /\b(instead|again|same|identical|similar|unchanged|keep|still|no longer|anymore)\b/i;

/**
 * Pronouns that usually reference the picture, but may also refer to someone
 * *inside* a fresh description ("a woman holding her bag") — so they only
 * count when no fresh subject leads the direction.
 */
const IMAGE_EDIT_PRONOUN_RE =
  /\b(it|its|itself|this|that|these|those|them|they|their|theirs|him|he|his|her|hers|she)\b/i;

/**
 * A direction opening with a fresh subject reads as a new picture.
 */
const IMAGE_FRESH_SUBJECT_RE =
  /^(a|an|two|three|four|five|six|seven|eight|nine|ten|\d+|portrait|close-?up|selfie|group|landscape|panorama|scene|image|photo|picture|drawing|painting|illustration|poster|cover|wallpaper)\b/i;

/**
 * An imperative naming a fresh object ("draw a castle") is a new picture; an
 * imperative whose object is a pronoun ("draw her with wings") is not.
 */
const IMAGE_FRESH_IMPERATIVE_RE =
  /^(show|draw|create|generate|render|paint|design|imagine|make me|give me)\s+(a|an|two|three|four|five|six|seven|eight|nine|ten|\d+|portrait|close-?up|selfie|group|landscape|panorama|scene|image|photo|picture|drawing|painting|illustration|poster|cover|wallpaper)\b/i;

/**
 * Does an /image direction mean "change the current picture" rather than
 * "draw something new"?
 *
 * The direction alone decides. A follow-up that cannot stand on its own as a
 * picture request — "have it be surrounded by stormy water instead", "more
 * dramatic waves", "her in the rain" — is an edit of the picture that already
 * exists. A direction that names a fresh subject — "a man talking to a
 * woman" — draws fresh, or the old picture's composition bleeds through the
 * edit. Deliberately conservative: when in doubt it draws fresh.
 * @param {string} direction Text after /image
 * @returns {boolean}
 */
function imageDirectionEdits(direction) {
  const text = String(direction || "").trim();
  if (!text) return false;
  // Continuation words beat any subject — "a castle instead" is still about
  // the current picture.
  if (IMAGE_EDIT_CONTINUATION_RE.test(text)) return true;
  // A direction that opens by naming its own subject is a new picture, even
  // when a later pronoun points back into that same sentence ("...dragons
  // flying around it").
  if (IMAGE_FRESH_SUBJECT_RE.test(text)) return false;
  if (
    IMAGE_FRESH_IMPERATIVE_RE.test(text) &&
    !IMAGE_EDIT_PRONOUN_RE.test(text)
  ) {
    return false;
  }
  return true;
}

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
 * Words of a character's look kept per image.
 *
 * SDXL's text encoder takes 77 tokens per chunk across two chunks, so roughly
 * 118 words in total, and anything past that is silently dropped. The scene
 * plus the character locks already claim most of it, and the locks are
 * injected once per character — so without a cap a crowd pushes the actual
 * action out of the prompt. Leading words are kept: a look is written
 * build-first, which is the identifying part.
 */
const SCENE_LOOK_WORDS = 18;
const SCENE_DETAIL_WORDS = 12;

/** Escape a string for use inside a RegExp. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does this name appear in the scene text as a whole word? */
function sceneNamesCharacter(sceneText, name) {
  const needle = String(name || "")
    .trim()
    .toLowerCase();
  if (!needle) return false;
  const re = new RegExp(
    "(^|[^a-z0-9])" + escapeRegExp(needle) + "([^a-z0-9]|$)",
    "i",
  );
  return re.test(String(sceneText).toLowerCase());
}

/** Keep the first `max` words of a fragment. */
function truncateWords(text, max) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

/**
 * The transcript up to a moment, as labelled lines.
 *
 * Read synchronously by the caller before its first await, so a chat switch
 * while a request is in flight cannot mix two stories together.
 * @param {number} [atIndex] Last message to include (default: the whole chat)
 * @param {object} [file] The scene record, for the player's name
 * @returns {Array<{who:string, text:string}>}
 */
function storyMomentLines(atIndex, file) {
  const upto = Number.isInteger(atIndex) ? atIndex : chatHistory.length - 1;
  const playerName =
    typeof storyPlayerRecordName === "function"
      ? storyPlayerRecordName(file)
      : typeof storyPlayerName === "function"
        ? storyPlayerName()
        : "";
  const lines = [];
  for (let i = 0; i <= upto && i < chatHistory.length; i++) {
    const m = chatHistory[i];
    // Generated pictures are not prose — their prompts surface separately as
    // the CURRENT PICTURE block (see storyPicture), where they can anchor a
    // follow-up edit instead of crowding the moment window.
    if (!m || m.image) continue;
    const text = (m.content || "").trim();
    // Command lines are instructions to this app, not part of the story.
    if (!text || IMAGE_COMMAND_RE.test(text)) continue;
    lines.push({
      // Named where the user set a name, so the summariser writes the real name
      // into the prompt instead of the transcript's "User" placeholder.
      who:
        m.role === "user"
          ? playerName || "You"
          : m.name
            ? String(m.name)
            : "Story",
      text: text,
    });
  }
  return lines;
}

/**
 * The most recent generated picture in the chat — or, with an explicit
 * `atIndex`, the one before that message.
 *
 * A follow-up /image edits this picture, and the prompt builder describes it
 * as a CURRENT PICTURE block — without it a direction like "have it be
 * surrounded by stormy water instead" has no "it" to resolve against and the
 * image model invents a subject of its own. With an explicit `atIndex` the
 * caller is regenerating that message, so its own picture is what is being
 * replaced and never the source. Read synchronously, before the first await,
 * for the same reason as storyMomentLines().
 * @param {number} [atIndex] Message being regenerated (default: whole chat)
 * @returns {{id:string, prompt:string, index:number}|null}
 */
function storyPicture(atIndex) {
  const explicit = Number.isInteger(atIndex);
  const upto = explicit ? atIndex : chatHistory.length - 1;
  const start = explicit ? upto - 1 : upto;
  for (let i = Math.min(start, chatHistory.length - 1); i >= 0; i--) {
    const m = chatHistory[i];
    if (!m || !m.image) continue;
    // Prefer the stored prompt; the caption is only a fallback for records
    // written before prompts were kept on the message.
    const prompt = String(m.image.prompt || m.content || "")
      .replace(/^\*+/, "")
      .replace(/\*+$/, "")
      .replace(/^generated image\s*—\s*/i, "")
      .trim();
    return { id: m.image.id, prompt: prompt, index: i };
  }
  return null;
}

/**
 * The locked look of everyone in the scene, as one comma-separated tail.
 *
 * The scene record's `present` list is the authority on who is in the shot;
 * a name the summariser also wrote is included too, so the cast survives a
 * prompt that forgot to name someone. Characters who are not present and not
 * named stay out — appending the whole cast is how a solo shot grows a crowd.
 * @param {object} file The chat's story file
 * @param {string} sceneText The summarised scene
 * @returns {string}
 */
function composeStoryLook(file, sceneText) {
  if (!file) return "";
  const present =
    typeof storyCharacterKey === "function"
      ? new Set((file.present || []).map(storyCharacterKey))
      : new Set();
  const parts = [];

  // The player is an image subject when they are in the scene, but they are
  // not in `characters`. Their look is appended from their own record, so the
  // lead NPC's face can never stand in for the user's.
  const player = file.player || {};
  const playerName =
    typeof storyPlayerRecordName === "function"
      ? storyPlayerRecordName(file)
      : player.name || "";
  const playerKey =
    typeof storyCharacterKey === "function"
      ? storyCharacterKey(playerName)
      : String(playerName).toLowerCase();
  if (
    playerName &&
    (present.has(playerKey) || sceneNamesCharacter(sceneText, playerName))
  ) {
    const bits = [
      truncateWords(player.appearance, SCENE_LOOK_WORDS),
      truncateWords(player.clothing, SCENE_DETAIL_WORDS),
      truncateWords(player.condition, SCENE_DETAIL_WORDS),
    ].filter(Boolean);
    if (bits.length) parts.push(`${playerName} (${bits.join(", ")})`);
  }

  for (const key of Object.keys(file.characters)) {
    const c = file.characters[key];
    if (c.exited) continue;
    if (playerKey && key === playerKey) continue;
    const inScene = present.has(key) || sceneNamesCharacter(sceneText, c.name);
    if (!inScene) continue;
    const bits = [
      truncateWords(c.appearance, SCENE_LOOK_WORDS),
      truncateWords(c.clothing, SCENE_DETAIL_WORDS),
      truncateWords(c.condition, SCENE_DETAIL_WORDS),
    ].filter(Boolean);
    if (bits.length) parts.push(`${c.name} (${bits.join(", ")})`);
  }
  return parts.join(", ");
}

/**
 * The last thing the player actually wrote, for pose and action only.
 *
 * The record says where and when; the player's own words say what they are
 * doing. Assistant prose is deliberately not read: it has already been folded
 * into the record, and re-reading it is how an old action bleeds into a new
 * picture.
 * @param {number} [atIndex]
 * @returns {string}
 */
function storyLastPlayerLine(atIndex) {
  const upto = Number.isInteger(atIndex) ? atIndex : chatHistory.length - 1;
  for (let i = Math.min(upto, chatHistory.length - 1); i >= 0; i--) {
    const m = chatHistory[i];
    if (!m || m.image || m.role !== "user") continue;
    const text = String(m.content || "").trim();
    if (!text || IMAGE_COMMAND_RE.test(text)) continue;
    return truncateWords(text, 60);
  }
  return "";
}

/**
 * Does this edit instruction touch how somebody looks or is dressed?
 *
 * The story file's cast block exists so a character keeps the same face across
 * pictures. It is exactly wrong for an instruction that *changes* that face,
 * hair, clothing or build: the old look would be restated as authoritative and
 * fight the instruction. Which the user's instruction wins over is not a
 * decision worth making silently, so when it is about appearance the block is
 * left out and the picture the source carries supplies the identity instead.
 * @param {string} instruction
 * @returns {boolean}
 */
function editInstructionChangesAppearance(instruction) {
  const text = String(instruction || "");
  const appearance =
    /\b(hair|hairstyle|bangs|fringe|beard|moustache|mustache|makeup|make-up|eyes?|iris|face|skin|complexion|tan|freckles|scars?|tattoos?|piercing|body|build|muscular|slim|curvy|fat|thin|tall|short|age|older|younger|appearance|outfit|clothes|clothing|dress|shirt|skirt|trousers|pants|jeans|jacket|coat|shoes|boots|hat|cap|glasses|jewel|necklace|earring|uniform|lingerie|bikini|costume)\b/i;
  return appearance.test(text);
}

/** A natural-language edit instruction, with the preservation rule appended. */
const SCENE_EDIT_INSTRUCTION = [
  "You turn an edit request about an existing picture into one instruction for",
  "an image editing model.",
  "",
  "Write it as a short imperative sentence: say what the picture should show",
  'AFTER the change, not what changed. Never write "instead of", "replaced with",',
  '"no longer", "changed to" or name what used to be there.',
  "",
  "Keep every detail the request does not ask to change implicit: the person's",
  "identity, face, pose and the background must survive untouched.",
  "",
  "When the CURRENT PICTURE block is given, use it only to resolve what the",
  "request refers to (a pronoun, an object, a garment). Describe the result,",
  "not the old picture.",
  "",
  "Be literal and match the request's explicitness exactly. Do not soften,",
  "censor, or refuse. Stay under 40 words. Reply with the instruction only.",
].join("\n");

/** The instruction that turns a scene record and direction into a visual prompt. */
const SCENE_PROMPT_INSTRUCTION = [
  "You write prompts for a text-to-image model. Describe what the moment LOOKS",
  "like, as one natural-language description: where this is, who is present (by",
  "name), poses, expressions, physical contact, clothing where the action shows",
  "it, lighting, mood, camera framing.",
  "",
  "When a CURRENT SCENE STATE block is supplied, it is the world of the picture.",
  "It already records the location, time of day, weather, lighting and who is",
  "present — use those facts exactly. Do not move the scene, change the time of",
  "day, restate different clothing, or add people, unless the DIRECTION asks for",
  "it.",
  "",
  'Name every person in the scene explicitly — never write "them", "the two',
  'of them" or "the group" in place of a name.',
  "",
  'The transcript labels the player\'s own turns "User". Use the name the',
  'story gives them — never "User" or "You" as a name in the prompt.',
  "",
  "Nobody's identity, hair or face needs describing: the character record is",
  "attached automatically and restating it risks contradicting it. Describe",
  "the moment.",
  "",
  "A PLAYER'S LAST MESSAGE block supplies pose and action only. It never",
  "overrides the scene state.",
  "",
  "Reuse every other concrete detail the text gives you. Be literal and match",
  "the excerpt's explicitness exactly. Do not soften, censor, or refuse.",
  "",
  "Write one single photographic frame — never a sequence or multiple panels.",
  "Stay under 50 words. Reply with the prompt only.",
].join("\n");

/**
 * Clean a model-written prompt into something a text encoder can use.
 * @param {string} raw
 * @returns {string}
 */
function sanitiseScenePrompt(raw) {
  // First drop any reasoning trace (Gemma's `<|channel>thought …
  // <|channel>final`, <think> blocks): the prompt is the final answer only.
  // stripThinkTags lives in api.js; guard for load order.
  const cleaned =
    typeof stripThinkTags === "function"
      ? stripThinkTags(raw)
      : String(raw || "");
  // The strict pass keeps only the ASCII vocabulary an SD text encoder is
  // tuned for. If it empties a reply that is not actually empty — a thinking
  // model answering in accented or non-Latin script — fall back to a
  // permissive clean rather than treating the prompt as missing.
  const strict = sanitiseScenePromptStrict(cleaned);
  if (strict) return strict;
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 600);
}

function sanitiseScenePromptStrict(raw) {
  let s = String(raw || "")
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

/**
 * Build an image prompt for one moment of the story.
 *
 * The scene record is the authority. The summariser is handed the record first
 * and the player's latest action second, and is told not to invent a different
 * place, time or outfit. Assistant prose is deliberately not sent: it has
 * already been folded into the record, and re-reading it is how a finished
 * action bleeds into the next picture.
 *
 * The old transcript-based context is kept only as a fallback for a chat with
 * no record yet (an old image, or a plain chat before its first image).
 *
 * @param {{atIndex?:number, direction?:string, edit?:boolean,
 *   file?:object, signal?:AbortSignal, onStatus?:(s:string)=>void}} [opts]
 *   `file` replays a stored scene snapshot instead of the chat's current
 *   record; `edit` marks that the output prompts an edit of the current
 *   picture (see storyPicture)
 * @returns {Promise<string>} The finished prompt, cast appended
 */
async function buildStoryImagePrompt(opts) {
  opts = opts || {};
  const file =
    opts.file || (currentChatId ? getStoryFile(currentChatId) : null);

  // Read the transcript synchronously, before the first await.
  const lines = storyMomentLines(opts.atIndex, file);
  const picture = storyPicture(opts.atIndex);
  const direction = String(opts.direction || "").trim();
  if (!file && !lines.length && !direction && !(opts.edit && picture)) {
    throw new Error("Nothing to illustrate yet — send a message first.");
  }

  const moment = lines
    .slice(-SCENE_CONTEXT_MESSAGES)
    .map((l) => `${l.who}: ${l.text}`)
    .join("\n\n");

  const earlier = lines
    .slice(-SCENE_DETAIL_MESSAGES, -SCENE_CONTEXT_MESSAGES)
    .map((l) => `${l.who}: ${l.text}`)
    .join("\n\n")
    .slice(-4000);

  let context;
  const block =
    file && typeof storyFileContextBlock === "function"
      ? storyFileContextBlock(file)
      : "";

  if (block) {
    context =
      "CURRENT SCENE STATE (authoritative — the picture is built from this " +
      "record, not from the previous message):\n" +
      block;

    const playerLine =
      typeof storyLastPlayerLine === "function"
        ? storyLastPlayerLine(opts.atIndex)
        : "";
    if (playerLine) {
      context +=
        "\n\nPLAYER'S LAST MESSAGE (pose, gesture and action only — it does " +
        "not change the location, time, weather or clothing):\n" +
        playerLine;
    }
  } else {
    // No record yet: fall back to the prose so an old chat still draws.
    context = earlier.trim()
      ? "EARLIER (background only — use for clothing, objects and location that " +
        "are still true, never for what is happening):\n" +
        earlier +
        "\n\nTHE MOMENT (illustrate this):\n" +
        moment
      : moment;
  }

  // The picture being edited. Its prompt is the one thing that makes a
  // relative direction ("have it be surrounded by stormy water instead")
  // resolvable — without it "it" names nothing and the image model invents a
  // subject. Only for edits: for a fresh draw the picture is the *old* subject
  // and must not leak into the prompt.
  if (opts.edit && picture && picture.prompt) {
    context =
      "CURRENT PICTURE (what the most recent generated image shows — the " +
      "output is an edit of it: keep everything the DIRECTION does not ask " +
      "to change):\n" +
      picture.prompt +
      "\n\n" +
      context;
  }

  if (direction) {
    context +=
      "\n\nDIRECTION (what the picture should show — obey this, but fill in " +
      "every detail from the scene above):\n" +
      direction;
  }

  let raw;
  try {
    raw = await requestCompletion(
      [
        { role: "system", content: SCENE_PROMPT_INSTRUCTION },
        { role: "user", content: context },
      ],
      {
        // Room for a thinking model: Gemma-class models spend part of the
        // budget on hidden reasoning, and a 180-token cap truncates them
        // mid-thought so nothing usable comes back.
        maxTokens: 320,
        temperature: 0.4,
        signal: opts.signal,
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
    if (err && err.name === "AbortError") throw err;
    throw new Error(
      "Could not build a prompt for that moment — " + (err.message || err),
    );
  }

  const scene = sanitiseScenePrompt(raw);
  if (!scene) {
    throw new Error("Could not build a prompt for that moment.");
  }

  const cast = composeStoryLook(file, scene);
  return cast ? scene + ", " + cast : scene;
}

/**
 * Build the instruction for an edit of the current picture.
 *
 * Different from buildStoryImagePrompt in what it is allowed to add. An edit
 * instruction says what should change; the source picture already carries
 * everything else. So the chat model is asked for one imperative sentence, and
 * the cast's locked look is deliberately NOT appended: the whole point of an
 * edit is usually that the look changes, and restating the old hair or dress as
 * fact makes the model fight the instruction. The story file is still used for
 * one thing — who the picture's subject is — as a hint for resolving pronouns.
 *
 * Without a chat model (cloud provider down, aborted) the user's own words are
 * used verbatim: an edit instruction is already natural language, so the
 * fallback loses little.
 * @param {object} opts
 * @param {string} opts.instruction What the user asked for
 * @param {string} [opts.picturePrompt] The current picture's prompt
 * @param {AbortSignal} [opts.signal]
 * @param {(s:string)=>void} [opts.onStatus]
 * @returns {Promise<string>}
 */
async function buildEditInstruction(opts) {
  opts = opts || {};
  const instruction = String(opts.instruction || "").trim();
  if (!instruction) {
    throw new Error(
      "/edit needs an instruction — e.g. /edit make her hair red",
    );
  }

  const file =
    opts.file || (currentChatId ? getStoryFile(currentChatId) : null);
  const present = file
    ? Object.values(file.characters)
        .filter((c) => c && !c.exited && c.name)
        .map((c) => c.name)
        .slice(0, 8)
    : [];

  const context = [
    opts.picturePrompt
      ? "CURRENT PICTURE (the image being edited):\n" + opts.picturePrompt
      : "",
    present.length ? "PEOPLE IN THIS STORY: " + present.join(", ") : "",
    "EDIT REQUEST (what the user wants changed):\n" + instruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await requestCompletion(
      [
        { role: "system", content: SCENE_EDIT_INSTRUCTION },
        { role: "user", content: context },
      ],
      {
        maxTokens: 200,
        temperature: 0.3,
        signal: opts.signal,
        onRetry: (ms) => {
          if (typeof opts.onStatus === "function") {
            opts.onStatus(
              `Rate limited — retrying in ${Math.round(ms / 1000)}s…`,
            );
          }
        },
      },
    );
    const cleaned = sanitiseScenePrompt(raw);
    return cleaned || instruction;
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    // The instruction is already a sentence; a failed rewrite must not lose the
    // user's request.
    return instruction;
  }
}
