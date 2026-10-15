/* ══════════════════════════════════════════════════════════════
   rp.js — SillyTavern-style prompt assembly for character chats

   Three ideas are borrowed from SillyTavern here, and they are the
   three that actually change how a local RP model behaves:

   1. Names in content. Every turn is prefixed with its speaker
      ("Seraphina: …") instead of relying on the API's role field.
      Stheno-class models are trained on transcripts shaped this way.

   2. Names as stop strings. Without them the model happily writes
      your half of the scene too. Stopping at "\n" + name + ":" is
      the single biggest anti-"speaking for you" lever there is.

   3. Priming the last turn. The history ends with the character's
      name and nothing after it, so generation continues the scene
      rather than restarting it.

   Deliberately NOT ported: ST's reorderable Prompt Manager, the
   instruct/text-completion template engine, and the full World Info
   editor. See AGENTS.md for why.
   ══════════════════════════════════════════════════════════════ */

const DEFAULT_USER_NAME = "User";

/** ST's stock main prompt, used verbatim when a card does not override it. */
const RP_MAIN_PROMPT =
  "Write {{char}}'s next reply in a fictional roleplay between {{char}} and {{user}}.";

/** Mirrors ST's `personality_format` / `scenario_format` defaults. */
const RP_DESCRIPTION_FORMAT = "{{char}}'s description: {{description}}";
const RP_PERSONALITY_FORMAT = "{{char}}'s personality: {{personality}}";
const RP_SCENARIO_FORMAT = "Scenario: {{scenario}}";

/**
 * The framing rules that replace the freeform story styles in character
 * mode. Kept short and behavioural — the card supplies everything else.
 */
const RP_FRAME = [
  "This is an ongoing fictional roleplay. Stay in character at all times.",
  "Write {{char}}'s replies only. Never write {{user}}'s words, actions, thoughts, or feelings, and never decide what {{user}} does next.",
  "Honour what the scene has already established: who is present, where they are, what has been said, and how {{user}} has been characterised.",
  "Use {{char}}'s own voice, vocabulary, and mannerisms.",
  "Advance the scene with each reply and leave room for {{user}} to act.",
].join("\n");

/* ── Macros ────────────────────────────────────────────────────── */

/** Split `a,b,c` into macro arguments, honouring `::` as a literal comma. */
function splitMacroArgs(list) {
  return String(list)
    .split(",")
    .map((s) => s.trim().replace(/::/g, ","))
    .filter((s) => s.length);
}

/** Locale-formatted clock time, e.g. "9:04 PM". */
function macroTime() {
  try {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

/** Locale-formatted date, e.g. "Tuesday, 3 February 2026". */
function macroDate() {
  try {
    return new Date().toLocaleDateString([], {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch (e) {
    return "";
  }
}

/**
 * Substitute the macros cards and story configs actually use.
 *
 * Unknown macros are left untouched rather than blanked — a card that
 * references a macro we don't implement should show the literal text,
 * which is far easier to debug than a silent hole.
 *
 * @param {string} text
 * @param {Object<string,string>} ctx Named values ({char, user, description, …})
 * @returns {string}
 */
function applyMacros(text, ctx) {
  if (!text) return "";
  let out = String(text);
  const vars = ctx || {};

  out = out.replace(/\{\{\s*random:([^{}]*)\}\}/gi, (m, list) => {
    const opts = splitMacroArgs(list);
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : "";
  });

  out = out.replace(/\{\{\s*roll:(?:(\d+)\s*)?d\s*(\d+)\s*\}\}/gi, (m, count, faces) => {
    const n = Math.min(parseInt(count || "1", 10) || 1, 100);
    const max = Math.max(parseInt(faces, 10) || 6, 2);
    let total = 0;
    for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * max);
    return String(total);
  });

  const named = Object.assign({ time: macroTime, date: macroDate }, vars);

  out = out.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, key) => {
    const k = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(named, k)) return m;
    const v = named[k];
    return typeof v === "function" ? v() : v == null ? m : String(v);
  });

  // ST writes comments as {{// …}}; they never reach the model.
  out = out.replace(/\{\{\/\/[^{}]*\}\}/g, "");

  return out;
}

/** The macro values for the lead character of a chat. */
function characterMacros(card, cfg, userName) {
  return {
    char: (card && card.name) || "",
    user: userName || DEFAULT_USER_NAME,
    description: (card && card.description) || "",
    personality: (card && card.personality) || "",
    scenario: (card && card.scenario) || "",
    persona: (cfg && cfg.userPersona) || "",
  };
}

/* ── Lorebook ──────────────────────────────────────────────────── */

/**
 * Entries from every cast card's embedded `character_book` that fire for
 * the recent conversation: always-on constants, plus any whose keys
 * appear in the last few turns. Entries with `secondary_keys` also need
 * one of those to match (ST's AND_ANY logic).
 *
 * @param {Array<object>} cards
 * @param {Array<{role:string,content:string}>} history
 * @returns {string[]} Entry texts, in the cards' own insertion order
 */
function collectLorebookEntries(cards, history) {
  const recent = (history || [])
    .filter((m) => m && !m.image && m.content)
    .slice(-4)
    .map((m) => m.content)
    .join("\n");
  const lower = recent.toLowerCase();

  const hits = [];
  for (const card of cards) {
    const book = card.characterBook;
    if (!Array.isArray(book)) continue;

    for (const entry of book) {
      if (entry.constant) {
        hits.push(entry);
        continue;
      }
      if (!entry.keys.length) continue;

      const hay = entry.caseSensitive ? recent : lower;
      const keys = entry.caseSensitive ? entry.keys : entry.keys.map((k) => k.toLowerCase());
      if (!keys.some((k) => k && hay.includes(k))) continue;

      if (entry.secondaryKeys.length) {
        const sec = entry.caseSensitive
          ? entry.secondaryKeys
          : entry.secondaryKeys.map((k) => k.toLowerCase());
        if (!sec.some((k) => k && hay.includes(k))) continue;
      }
      hits.push(entry);
    }
  }

  return hits
    .sort((a, b) => a.insertionOrder - b.insertionOrder)
    .map((e) => applyMacros(e.content, characterMacros(cards[0], storyConfig, "")))
    .filter(Boolean);
}

/* ── Message assembly ──────────────────────────────────────────── */

/**
 * A supporting character in a group scene. They get a compact block —
 * the lead owns the detailed fields, because that is whose replies the
 * model is writing.
 */
function supportingCastBlock(card) {
  const lines = [card.name + " (also present):"];
  if (card.description) lines.push(card.description);
  if (card.personality) lines.push("Personality: " + card.personality);
  if (card.scenario) lines.push("Role in the scene: " + card.scenario);
  return lines.join("\n");
}

/**
 * Build the full message array for a character-mode turn.
 *
 * The history is rewritten with speaker prefixes and the final user turn
 * is primed with the lead character's name, so the model continues the
 * scene instead of starting a new one.
 *
 * @param {Array<object>} cards Cast, lead first
 * @param {object} cfg storyConfig
 * @param {Array<{role:string,content:string,name?:string,image?:object}>} history
 * @returns {Array<{role:string, content:string}>}
 */
function buildRPMessages(cards, cfg, history) {
  if (!cards.length) return [];

  const lead = cards[0];
  const userName = ((cfg && cfg.userName) || "").trim() || DEFAULT_USER_NAME;
  const macros = characterMacros(lead, cfg, userName);

  const blocks = [];
  const push = (text) => {
    const t = applyMacros(text, macros).trim();
    if (t) blocks.push(t);
  };

  push(lead.systemPrompt || RP_MAIN_PROMPT);
  push(RP_FRAME);
  push(lead.description ? RP_DESCRIPTION_FORMAT : "");
  push(lead.personality ? RP_PERSONALITY_FORMAT : "");
  push(lead.scenario ? RP_SCENARIO_FORMAT : "");
  cards.slice(1).forEach((c) => push(supportingCastBlock(c)));

  // The hand-written story fields still apply in character mode — they are
  // additive context, not a competing prompt, so casting a card does not
  // silently discard a scene or a supporting cast the user already wrote.
  if (cfg && cfg.scene) push("Scene: " + cfg.scene);
  if (cfg && cfg.tags) push("Genre and tone: " + cfg.tags);
  (cfg && cfg.characters ? cfg.characters : []).forEach((c) => {
    if (!c || !c.name) return;
    let line = c.name + ": " + (c.traits || "");
    if (c.role && c.role.trim()) line += ". Role: " + c.role.trim();
    push(line);
  });

  const lore = collectLorebookEntries(cards, history);
  if (lore.length) push("Known context:\n" + lore.join("\n"));

  if (cfg && cfg.userPersona && cfg.userPersona.trim()) {
    push("{{user}}: " + cfg.userPersona.trim());
  }

  const examples = parseMesExample(lead.mesExample).join("\n\n");
  if (examples) push(examples);

  if (cfg && cfg.firstPrompt && cfg.firstPrompt.trim()) {
    push(cfg.firstPrompt.trim());
  }

  // ST puts post-history instructions last, as their own message after the
  // transcript. Merged into the header block instead: a trailing system
  // message upsets strict Jinja chat templates on some llama.cpp builds,
  // and losing a little recency is cheaper than a 400 mid-roleplay.
  if (lead.postHistoryInstructions && lead.postHistoryInstructions.trim()) {
    push(applyMacros(lead.postHistoryInstructions, macros));
  }

  const messages = blocks.length ? [{ role: "system", content: blocks.join("\n\n") }] : [];

  const turns = [];
  for (const m of history || []) {
    if (!m || m.image || !m.content) continue;
    const speaker = m.role === "user" ? userName : m.name || lead.name;
    turns.push({ role: m.role, content: speaker + ": " + m.content });
  }

  // Prime the final turn so the model writes the reply, not the prompt.
  const last = turns[turns.length - 1];
  if (last && last.role === "user") {
    last.content += "\n" + lead.name + ":";
  }

  return messages.concat(turns);
}

/**
 * Stop strings for a character chat: one per speaker, so generation
 * halts the moment the model starts writing someone else's turn.
 * @param {Array<object>} cards
 * @param {string} userName
 * @returns {string[]}
 */
function rpStopStrings(cards, userName) {
  const names = cards.map((c) => c.name).concat([userName || DEFAULT_USER_NAME]);
  const stops = [];
  names.forEach((n) => {
    if (n && n.trim()) stops.push("\n" + n.trim() + ":");
  });
  return [...new Set(stops)];
}

/**
 * Drop a speaker prefix the model echoed back. With stop strings in
 * place this is rare, but some models open with "Name:" anyway and it
 * reads as a stutter once the UI already shows a name header.
 * @param {string} text
 * @param {Array<object>} cards
 * @param {string} userName
 * @returns {string}
 */
function stripLeadingSpeaker(text, cards, userName) {
  if (!text) return "";
  const names = cards
    .map((c) => c.name)
    .concat([userName || DEFAULT_USER_NAME])
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return text;
  return text.replace(new RegExp("^\\s*(?:" + names.join("|") + ")\\s*:\\s*", "i"), "");
}

/* ── Prompt preview ────────────────────────────────────────────── */

/**
 * The exact system prompt a character chat will send. Exposed so the
 * card editor can show it — the fastest way to debug a card that is
 * not behaving is to read what it actually produced.
 * @returns {string}
 */
function previewRPPrompt() {
  const cards = getCast();
  if (!cards.length) return "";
  const msgs = buildRPMessages(cards, storyConfig, chatHistory || []);
  return msgs.length ? msgs[0].content : "";
}
