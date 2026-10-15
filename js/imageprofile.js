/* ══════════════════════════════════════════════════════════════
   imageprofile.js — Per-chat visual continuity for generated images

   Diffusion models are stateless: the same character described two
   different ways is two different people. To keep a cast looking the
   same across a session, each chat owns a profile holding

     • a style suffix   — appended to every prompt in the chat
     • a seed           — reused so the model's look stays stable
     • character locks  — one fixed appearance per named character,
                          written once and substituted into prompts

   The profile lives in chat meta, so it travels with the chat and is
   removed when the chat is deleted.
   ══════════════════════════════════════════════════════════════ */

/** Appended to every prompt in a chat unless the user overrides it. */
const DEFAULT_IMAGE_STYLE =
  "cinematic photograph, natural lighting, shallow depth of field, " +
  "photorealistic, highly detailed, single frame, no text";

/** Read the current chat's image profile, creating it on first use. */
function getImageProfile() {
  if (!currentChatId) return newImageProfile();
  const meta = getChatMeta();
  const entry = meta[currentChatId] || (meta[currentChatId] = {});
  if (!entry.imageProfile) {
    entry.imageProfile = newImageProfile();
    setChatMeta(meta);
  }
  return entry.imageProfile;
}

/** Persist a modified profile back onto the current chat. */
function saveImageProfile(profile) {
  if (!currentChatId) return;
  const meta = getChatMeta();
  if (!meta[currentChatId]) meta[currentChatId] = {};
  meta[currentChatId].imageProfile = profile;
  setChatMeta(meta);
}

/**
 * A fresh profile. The seed is random per chat so two chats don't look
 * identical, but fixed within a chat so its images share a look.
 */
function newImageProfile() {
  return {
    style: localStorage.getItem("image_style") || DEFAULT_IMAGE_STYLE,
    seed: Math.floor(Math.random() * 2147483647),
    characters: {},
    discovered: false,
  };
}

/** Forget the cast and reroll the seed, keeping the style. */
function resetImageProfile() {
  const profile = getImageProfile();
  profile.characters = {};
  profile.discovered = false;
  profile.seed = Math.floor(Math.random() * 2147483647);
  saveImageProfile(profile);
}

/**
 * Ask the chat model to name the cast and fix each one's appearance.
 *
 * Runs at most once per chat: the whole point is that an appearance is
 * decided a single time and reused, so a later re-read can't quietly
 * restyle someone. Characters configured in story mode are seeded from
 * their traits first and are not re-invented.
 * @param {AbortSignal} [signal]
 * @param {(s:string)=>void} [onStatus]
 */
async function discoverCharacters(signal, onStatus) {
  const profile = getImageProfile();
  if (profile.discovered) return profile;

  // Story mode already carries an authored cast — prefer it over guessing.
  (storyConfig.characters || []).forEach((c) => {
    if (c && c.name) addCharacterLock(profile, c.name, c.traits || "");
  });
  // A cast card states its own appearance, so it beats both the manual rows
  // and anything the model would invent from the transcript.
  if (typeof getCast === "function") {
    getCast().forEach((c) => addCharacterLock(profile, c.name, c.appearance || ""));
  }

  const context = chatHistory
    .filter((m) => !m.image)
    .slice(-8)
    .map((m) => m.content)
    .join("\n\n")
    .slice(0, 6000);

  if (context.trim()) {
    if (typeof onStatus === "function")
      onStatus("Locking character appearances…");
    // Clothing is deliberately excluded. A lock is substituted into every
    // later prompt, so a fixed outfit would fight the scene's own state of
    // dress — and would put a jacket back on someone the scene undressed.
    // The lock owns the body; the scene owns what is or isn't on it.
    const instruction =
      "Identify each named person in the excerpt. For every one, invent a fixed " +
      "physical appearance: approximate age, build, hair, face, skin, distinguishing " +
      "marks. Body and features only — no clothing, no personality, no plot. " +
      "Reply with one line per person in exactly this format and nothing else:\n" +
      "Name | appearance phrases, comma separated";

    try {
      const raw = await requestCompletion(
        [
          { role: "system", content: instruction },
          { role: "user", content: context },
        ],
        { maxTokens: 300, temperature: 0.6, signal: signal },
      );

      raw.split("\n").forEach((line) => {
        const [name, look] = line.split("|");
        if (name && look) addCharacterLock(profile, name, look);
      });
    } catch (err) {
      // Continuity is an enhancement — a failure here must not block the
      // image. Style and seed still apply.
      console.warn("Character discovery failed:", err);
    }
  }

  // A pass that locked nobody must not be treated as final. It happens for a
  // real reason — the model answered in the wrong format, or the cast was not
  // configured yet — and marking it done would mean that chat never got its
  // character locks for the rest of its life. Only conclude the search when it
  // found someone, or when there was no cast to find.
  const hasCast = typeof getCast === "function" && getCast().length > 0;
  if (Object.keys(profile.characters).length > 0 || !hasCast) {
    profile.discovered = true;
  }
  saveImageProfile(profile);
  return profile;
}
/**
 * Lock a character card's appearance into this chat's image profile.
 *
 * Deliberately not routed through addCharacterLock(): that one guards
 * against the *discovery* path inventing a name out of prose, and rejects
 * anything long or multi-word. A card name is authored, so those guards
 * are simply wrong here.
 *
 * Skipped when the card yielded no appearance phrases, and never applied
 * over a hand-tuned lock unless the card itself carries an appearance.
 * @param {object} card
 */
function lockAppearanceForCard(card) {
  if (!card || !card.name || !card.appearance) return;
  const look = sanitiseScenePrompt(card.appearance);
  if (!look) return;
  const profile = getImageProfile();
  const key = card.name.trim().toLowerCase();
  profile.characters[key] = { name: card.name.trim(), appearance: look };
  saveImageProfile(profile);
}

/**
 * Record a character's appearance, never overwriting an existing lock.
 * @param {object} profile
 * @param {string} name
 * @param {string} appearance
 */
function addCharacterLock(profile, name, appearance) {
  const clean = String(name)
    .replace(/^[\s*\-–—•\d.]+/, "")
    .replace(/[\s*:]+$/, "")
    .trim();
  const look = sanitiseScenePrompt(appearance);
  // A bare name with no description is worse than no lock — it would
  // substitute a person out of the prompt and replace them with nothing.
  if (
    !clean ||
    !look ||
    clean.length > 40 ||
    (/\s/.test(clean) && clean.split(/\s+/).length > 3)
  )
    return;
  const key = clean.toLowerCase();
  if (profile.characters[key]) return;
  profile.characters[key] = { name: clean, appearance: look };
}

/**
 * Words of body description kept per character when building a prompt, and the
 * same for their clothing and state.
 *
 * These exist because the text encoder is small. SDXL's CLIP takes 77 tokens
 * per chunk across two chunks, so roughly 118 words total, and anything past
 * that is silently dropped — measured on a real three-character scene, the
 * prompt came to 308 tokens against a 154-token budget, so half of it never
 * reached the model. Character locks come from a card's own prose and can
 * easily run long, and they are injected once per character, so without a cap a
 * crowd pushes the actual action out of the prompt.
 *
 * Leading words are kept: the cards describe build, hair and eyes first, which
 * are the identifying features worth spending the budget on.
 */
const PROMPT_LOCK_WORDS = 16;
const PROMPT_DETAIL_WORDS = 12;

/** Keep at most `max` words, dropping any dangling separator. */
function trimWords(text, max) {
  const words = String(text || "").trim().split(/\s+/);
  if (words.length <= max) return String(text || "").trim();
  return words.slice(0, max).join(" ").replace(/[,;:]$/, "");
}

/**
 * Build the prompt actually sent to the image model.
 *
 * Character names mean nothing to a diffusion model, so each known name is
 * swapped for its locked appearance — that substitution is what makes the
 * same person recognisable across separate generations. The style suffix
 * goes last so it never displaces scene detail.
 *
 * The scene record fills the gap the locks deliberately leave open. A lock is
 * body-only (see discoverCharacters) because a fixed outfit would fight the
 * scene's state of dress, so what each character is wearing *now* and the
 * location they are standing in come from scenestate.js and are folded into
 * the same parenthetical. Nothing here is load-bearing: with no record, the
 * prompt is exactly what it was before.
 * @param {string} basePrompt
 * @param {object} [sceneState]
 * @returns {string}
 */
function composeImagePrompt(basePrompt, sceneState) {
  const profile = getImageProfile();
  let out = basePrompt;

  for (const key in profile.characters) {
    const lock = profile.characters[key];
    const scene = trimWords(sceneDetailFor(sceneState, lock.name), PROMPT_DETAIL_WORDS);
    // Word-boundary match so "Jess" doesn't fire inside "Jessica".
    const re = new RegExp(`\\b${escapeRegExp(lock.name)}(?:'s)?\\b`, "gi");
    let first = true;
    out = out.replace(re, () => {
      // Only the first mention carries the full description; later ones
      // get a short handle so a crowded scene doesn't blow the token budget.
      if (first) {
        first = false;
        const full = [trimWords(lock.appearance, PROMPT_LOCK_WORDS), scene]
          .filter(Boolean)
          .join(", ");
        return `${lock.name} (${full})`;
      }
      return lock.name;
    });
  }

  // A character the scene record knows about but that has no body lock would
  // otherwise lose its clothing and state entirely: the record would be
  // tracked turn after turn and then silently ignored at the one moment it
  // mattered. Substitute whatever the scene does know.
  if (sceneState && sceneState.characters) {
    for (const key of Object.keys(sceneState.characters)) {
      const entry = sceneState.characters[key];
      if (profile.characters[String(entry.name).toLowerCase()]) continue;
      const detail = trimWords(
        sceneDetailFor(sceneState, entry.name),
        PROMPT_DETAIL_WORDS,
      );
      if (!detail) continue;
      const re = new RegExp(`\\b${escapeRegExp(entry.name)}(?:'s)?\\b`, "gi");
      let first = true;
      out = out.replace(re, () => {
        if (first) {
          first = false;
          return `${entry.name} (${detail})`;
        }
        return entry.name;
      });
    }
  }

  // The location is not attached to any one character, so it trails the scene
  // description ahead of the style suffix.
  if (sceneState && sceneState.scene) {
    out = `${out}, ${sceneState.scene}`;
  }

  const style = (profile.style || "").trim();
  if (!style) return out;

  // A style containing {prompt} places the scene itself, so style words can
  // lead. Tokens near the start of a prompt carry more weight in a diffusion
  // model, so "photograph of {prompt}" reads very differently from the same
  // words trailing at the end. Without the placeholder, style is appended.
  return style.includes("{prompt}")
    ? style.replace(/\{prompt\}/g, out)
    : `${out}, ${style}`;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Full prompt pipeline for one generation: lock the cast, then compose.
 * @param {string} basePrompt
 * @param {AbortSignal} [signal]
 * @param {(s:string)=>void} [onStatus]
 * @param {object} [sceneState] The chat's scene record, if one was tracked
 * @returns {Promise<{prompt:string, seed:number}>}
 */
async function applyImageProfile(basePrompt, signal, onStatus, sceneState) {
  await discoverCharacters(signal, onStatus);
  return {
    prompt: composeImagePrompt(basePrompt, sceneState),
    seed: getImageProfile().seed,
  };
}
