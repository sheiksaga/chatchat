#!/usr/bin/env node
/**
 * sync-cards.js — pull character cards out of a SillyTavern install.
 *
 *   node tools/sync-cards.js "E:\path\to\sillytavern"
 *   node tools/sync-cards.js "E:\path\to\sillytavern\data\default-user\characters"
 *
 * Accepts either the SillyTavern root or the characters directory itself
 * and writes two things:
 *
 *   cards/cards.js      window.CHATCHAT_CARDS = [ … ], loaded by <script>
 *   cards/avatars/*.png the card art, referenced by relative path
 *
 * A .js manifest rather than JSON on purpose: fetch() is blocked on a
 * bare file:// page and chatchat has to keep opening as one. A <script>
 * assignment has no such problem.
 *
 * Cards are read straight out of the PNG tEXt chunks — `ccv3` (spec v3)
 * wins over `chara` (spec v2), matching SillyTavern's own precedence.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "cards");
const AVATAR_DIR = path.join(OUT_DIR, "avatars");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ── PNG text chunks ───────────────────────────────────────────── */

/** Read a NUL-terminated latin1 string; returns { text, next }. */
function readCString(buf, start) {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return { text: buf.toString("latin1", start, end), next: end + 1 };
}

/** Decode one tEXt / zTXt / iTXt chunk into { keyword, value }. */
function decodeTextChunk(type, chunk) {
  if (type === "tEXt") {
    const key = readCString(chunk, 0);
    return { keyword: key.text, value: chunk.toString("latin1", key.next) };
  }
  if (type === "zTXt") {
    const key = readCString(chunk, 0);
    const body = zlib.inflateSync(chunk.subarray(key.next + 1));
    return { keyword: key.text, value: body.toString("latin1") };
  }
  if (type === "iTXt") {
    const key = readCString(chunk, 0);
    const compressed = chunk[key.next] === 1;
    const lang = readCString(chunk, key.next + 2);
    const translated = readCString(chunk, lang.next);
    const body = chunk.subarray(translated.next);
    return {
      keyword: key.text,
      value: (compressed ? zlib.inflateSync(body) : body).toString("utf8"),
    };
  }
  return null;
}

/** Extract the raw card JSON from a PNG buffer. */
function readCardJsonFromPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");

  const found = {};
  let off = 8;
  while (off + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString("latin1", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (type === "IEND" || dataEnd > buffer.length) break;

    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      try {
        const text = decodeTextChunk(type, buffer.subarray(dataStart, dataEnd));
        if (text && (text.keyword === "chara" || text.keyword === "ccv3")) {
          found[text.keyword] = text.value;
        }
      } catch (e) {
        // Unreadable chunk is not fatal — the other one may still parse.
      }
    }
    off = dataEnd + 4;
  }

  const payload = found.ccv3 || found.chara;
  if (!payload) throw new Error("no chara/ccv3 chunk");
  return JSON.parse(Buffer.from(payload.replace(/\s/g, ""), "base64").toString("utf8"));
}

/* ── Normalisation (mirrors normalizeCard in js/cards.js) ──────── */

const asString = (v) => (typeof v === "string" ? v : "");
const asStringArray = (v) =>
  typeof v === "string" ? (v ? [v] : []) : Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : [];

/** Stable content hash — must stay identical to cardId() in js/cards.js. */
function cardId(card) {
  const src = (card.name || "") + "\u0000" + (card.description || "");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return "card_" + (h >>> 0).toString(36);
}

function normalizeCharacterBook(book) {
  if (!book) return null;
  let entries = book.entries;
  if (entries && !Array.isArray(entries)) entries = Object.values(entries);
  if (!Array.isArray(entries) || !entries.length) return null;
  return entries
    .filter((e) => e && typeof e === "object" && asString(e.content))
    .map((e) => ({
      keys: asStringArray(e.keys || e.key),
      secondaryKeys: asStringArray(e.secondary_keys || e.keysecondary),
      content: asString(e.content),
      constant: !!e.constant,
      enabled: e.enabled !== false,
      caseSensitive: !!e.case_sensitive,
      insertionOrder: typeof e.insertion_order === "number" ? e.insertion_order : 100,
    }))
    .filter((e) => e.enabled);
}

const APPEARANCE_CUES =
  /\b(hair|eyes?|skin|complexion|tall|short|height|build|slender|lean|muscular|curvy|petite|statuesque|frame|face|freckles?|scar|tattoo|piercing|ears?|tail|horns?|wings?|fur|scales|fangs?|claws?|beard|stubble|braid|ponytail|bun|curls?|blonde|brunette|raven|silver|white-haired|ginger|auburn|amber|emerald|azure|violet|crimson|pale|porcelain|tan|olive|dark-skinned|elf|orc|demon|angel|vampire|werewolf|kitsune|neko|dragon|centaur|tiefling|humanoid|mid-?twenties|mid-?thirties|teen|young woman|young man)\b/i;

/** Mirrors APPEARANCE_NOISE in js/cards.js. */
const APPEARANCE_NOISE =
  /\{\{|\}\}|\b(lock|locked|token|prompt|instructions?|negative|render|subject features|every later|every subsequent|step \d|aspect ratio|style|do not|don't|never|always|must|should)\b/i;

/** Must stay byte-identical in behaviour to extractAppearance() in js/cards.js. */
function extractAppearance(card) {
  let text = String(card.description || "");
  text = text.split(/\{\{char\}\}\s*:/i)[0].split(/\{\{user\}\}\s*:/i)[0];
  text = text.replace(/\*[^*]*\*/g, " ");
  text = text.replace(/\[([^\]]*)\]/g, "$1");

  const headed = text.match(/appearance\s*[:\-]\s*([\s\S]{0,500})/i);
  const source = headed
    ? headed[1].split(/\n\s*\**[A-Z][A-Za-z' ]{2,24}\**[\s\S]{0,2}[:\-]/)[0]
    : text;

  const clauses = source
    .split(/[,;\n]|\.\s+/)
    .map((s) =>
      s
        // A structured block loses its brackets above, leaving a
        // "Seraphina's body= \"pink hair\"" prefix on the first clause.
        .replace(/^[\s*\-–—•]+/, "")
        .replace(/^\S+'?s?\s+(?:body|appearance|look|physique)\s*[=:]\s*/i, "")
        .replace(/^["“”'‘’]+/, "")
        .replace(/["“”'‘’]+$/, "")
        .trim(),
    )
    .filter(Boolean);

  const hits = clauses.filter(
    (c) => c.length >= 2 && c.length <= 90 && APPEARANCE_CUES.test(c) && !APPEARANCE_NOISE.test(c),
  );

  // Drop whole clauses rather than slicing mid-word: this string is injected
  // into every image prompt for the character, so a dangling "…with strands
  // esca" is worse than one fewer trait. The final slice is a backstop for a
  // single clause that is already over the cap on its own.
  const kept = [...new Set(hits)];
  let out = kept.join(", ");
  while (out.length > 300 && kept.length > 1) {
    kept.pop();
    out = kept.join(", ");
  }
  return out.slice(0, 300).trim();
}

function normalizeCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const d = raw.data && typeof raw.data === "object" ? raw.data : raw;
  const name = asString(d.name).trim();
  if (!name) return null;

  const card = {
    name,
    description: asString(d.description),
    personality: asString(d.personality),
    scenario: asString(d.scenario),
    firstMes: asString(d.first_mes),
    mesExample: asString(d.mes_example),
    systemPrompt: asString(d.system_prompt),
    postHistoryInstructions: asString(d.post_history_instructions),
    alternateGreetings: asStringArray(d.alternate_greetings),
    groupOnlyGreetings: asStringArray(d.group_only_greetings),
    tags: asStringArray(d.tags),
    creator: asString(d.creator),
    characterVersion: asString(d.character_version),
    creatorNotes: asString(d.creator_notes),
    characterBook: normalizeCharacterBook(d.character_book),
    spec: raw.spec || (d === raw ? "chara_card_v1" : "chara_card_v2"),
  };
  card.appearance = asString(d.appearance) || extractAppearance(card);
  card.id = cardId(card);
  return card;
}

/* ── Main ──────────────────────────────────────────────────────── */

/**
 * Accept either an ST root or a characters directory.
 *
 * Specific subpaths are tried before the argument itself: passing the ST
 * root would otherwise match on the first candidate and start reading
 * package.json as if it were a card.
 */
function resolveCharactersDir(arg) {
  const candidates = [
    path.join(arg, "data", "default-user", "characters"),
    path.join(arg, "characters"),
    arg,
  ];
  for (const c of candidates) {
    let names;
    try {
      if (!fs.statSync(c).isDirectory()) continue;
      names = fs.readdirSync(c);
    } catch (e) {
      continue;
    }
    // Require actual card files. A SillyTavern checkout has PNGs and JSON
    // at its root too, so mere existence is not enough to identify the
    // characters folder.
    if (names.some((f) => /\.png$/i.test(f)) || names.some((f) => /\.json$/i.test(f))) {
      return c;
    }
  }
  return null;
}

/**
 * A JSON file is only a card if it looks like one. Without this, every
 * package.json / jsconfig.json in the tree becomes a "character".
 */
function looksLikeCard(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj.spec || obj.data) return true;
  return ["description", "first_mes", "personality", "mes_example", "scenario"].some(
    (k) => typeof obj[k] === "string" && obj[k].length,
  );
}

function main() {
  const arg = process.argv[2] || process.env.SILLYTAVERN_DIR;
  if (!arg) {
    console.error(
      "Usage: node tools/sync-cards.js <sillytavern-root-or-characters-dir>\n" +
        "   or: SILLYTAVERN_DIR=<path> node tools/sync-cards.js",
    );
    process.exit(1);
  }

  const dir = resolveCharactersDir(arg);
  if (!dir) {
    console.error("No characters directory found under: " + arg);
    process.exit(1);
  }

  fs.mkdirSync(AVATAR_DIR, { recursive: true });

  const files = fs.readdirSync(dir).filter((f) => /\.(png|json)$/i.test(f));
  const problems = [];

  /**
   * Score a candidate when two files describe the same character.
   *
   * A characters folder routinely holds both `Jess_1.png` and
   * `jess-card.json` for the same person — ST's own exports leave a
   * `.json` sidecar next to the card art. Prefer the one carrying artwork,
   * then the newer spec, then the longer text.
   */
  const score = (card) =>
    (card.avatar ? 1e6 : 0) +
    (card.spec === "chara_card_v3" ? 1000 : card.spec === "chara_card_v2" ? 500 : 0) +
    (card.description || "").length +
    (card.firstMes || "").length;

  const byName = new Map();

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      let card;
      if (/\.png$/i.test(file)) {
        card = normalizeCard(readCardJsonFromPng(fs.readFileSync(full)));
      } else {
        const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
        const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!looksLikeCard(candidate)) throw new Error("not a character card");
        card = normalizeCard(candidate);
      }
      if (!card) throw new Error("no usable character name");

      if (/\.png$/i.test(file)) {
        const avatarName = card.id + ".png";
        fs.copyFileSync(full, path.join(AVATAR_DIR, avatarName));
        card.avatar = "cards/avatars/" + avatarName;
      }

      const key = card.name.trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { card, file });
      } else if (score(card) > score(existing.card)) {
        problems.push(existing.file + ": superseded by a richer card for \"" + card.name + "\"");
        byName.set(key, { card, file });
      } else {
        problems.push(file + ": same character as " + existing.file + ", skipped");
      }
    } catch (e) {
      problems.push(file + ": " + e.message);
    }
  }

  const cards = [...byName.values()].map((v) => v.card);
  cards.sort((a, b) => a.name.localeCompare(b.name));

  const manifest =
    "/* Generated by tools/sync-cards.js — do not edit by hand. */\n" +
    "window.CHATCHAT_CARDS = " +
    JSON.stringify(cards, null, 2) +
    ";\n";
  fs.writeFileSync(path.join(OUT_DIR, "cards.js"), manifest, "utf8");

  // Prune avatars whose card no longer exists, so the folder cannot grow
  // an orphan for every card the user deletes upstream.
  const live = new Set(cards.map((c) => c.id + ".png"));
  for (const f of fs.readdirSync(AVATAR_DIR)) {
    if (!live.has(f)) fs.unlinkSync(path.join(AVATAR_DIR, f));
  }

  console.log("Synced " + cards.length + " card(s) from " + dir);
  console.log("  → cards/cards.js");
  console.log("  → cards/avatars/ (" + cards.length + " file(s))");
  if (problems.length) {
    console.log("\nSkipped:");
    problems.forEach((p) => console.log("  " + p));
  }
}

// Exported for test/sync-cards.spec.js, which pins the shared parser against
// the browser copy in js/cards.js — the two must not drift.
module.exports = {
  extractAppearance,
  normalizeCard,
  normalizeCharacterBook,
  cardId,
  looksLikeCard,
  resolveCharactersDir,
};

// Only run the CLI when invoked directly, so requiring this file is side-free.
if (require.main === module) main();
