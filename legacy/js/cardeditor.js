/* ══════════════════════════════════════════════════════════════
   cardeditor.js — Cast picker and character-card editor

   The cast belongs to the chat, not to the app: each stored chat
   carries its own `storyConfig.castIds`, the same way SillyTavern
   binds a chat to a character. The card library behind it is global,
   so editing a card updates every chat that casts it.
   ══════════════════════════════════════════════════════════════ */

/** id → data URL or relative path. Filled lazily; sync reads use it. */
const cardAvatarCache = new Map();

/** The card being edited (null when creating), and its unsaved avatar. */
let editingCardId = null;
let pendingCardAvatar = null;

/** Read the trimmed value of a card-editor field. */
function ceVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

/** Read a card-editor textarea as one non-empty entry per line. */
function ceLines(id) {
  return ceVal(id)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Write a value into a card-editor field. */
function ceSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value == null ? "" : value;
}

/* ── Avatars ───────────────────────────────────────────────────── */

/**
 * Fill the avatar cache. Synced cards carry a relative path in
 * `card.avatar` (an <img src> works on file://, a fetch would not);
 * user cards keep their data URL in IndexedDB.
 */
async function hydrateCardAvatars() {
  for (const card of getCards()) {
    if (cardAvatarCache.has(card.id)) continue;
    cardAvatarCache.set(card.id, card.avatar || (await getCardAvatar(card.id)) || "");
  }
}

/** @returns {string} Cached avatar URL for a card id, or "" */
function cardAvatarFor(id) {
  return cardAvatarCache.get(id) || "";
}

/** @returns {string} Avatar URL for a character name, or "" */
function cardAvatarByName(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "";
  const card = getCards().find((c) => c.name.trim().toLowerCase() === key);
  return card ? cardAvatarFor(card.id) : "";
}

/* ── Cast picker ───────────────────────────────────────────────── */

/**
 * Render the cast — and only the cast.
 *
 * The panel used to double as the card library, which made the list and the
 * story's cast two different things wearing one label: most rows had no ✕, and
 * pressing one on a cast row only greyed the row out, because "remove from the
 * cast" is not "remove the character". Now a row exists only while its card is
 * in the story, so ✕ takes the row away and the library lives behind the
 * "Add Character" picker underneath.
 *
 * Position 1 is the lead: its voice the model writes in.
 */
async function renderCastPicker() {
  const grid = document.getElementById("cast-grid");
  if (!grid) return;

  // Avatars are decoration. A failed IndexedDB read must not abort the paint,
  // because a grid that silently keeps its old contents is worse than cards
  // without portraits: every ✕ and ↑ in it acts on ids that no longer match
  // storyConfig, so the panel looks alive while doing nothing.
  try {
    await hydrateCardAvatars();
  } catch (e) {
    console.warn("Card avatars unavailable:", e);
  }

  const cards = getCards();
  const cast = storyConfig.castIds || [];
  const byId = new Map(cards.map((c) => [c.id, c]));

  const emptyEl = document.getElementById("cast-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", cards.length > 0);

  // Cast order, not library order — the lead is the first card the user put in
  // the scene, which is the one whose voice the story is written in.
  const castCards = cast.map((id) => byId.get(id)).filter(Boolean);

  const noneEl = document.getElementById("cast-none-cast");
  if (noneEl)
    noneEl.classList.toggle("hidden", castCards.length > 0 || !cards.length);

  grid.innerHTML = castCards.map(castCardMarkup).join("");
  renderCastAddPicker();
}

/**
 * One cast row: avatar, position badge, name, and its controls.
 * @param {object} card
 * @param {number} pos Index in storyConfig.castIds — 0 is the lead.
 * @returns {string}
 */
function castCardMarkup(card, pos) {
  const avatar = cardAvatarFor(card.id);
  const badge =
    pos === 0
      ? '<span class="cast-badge cast-badge-lead">lead</span>'
      : '<span class="cast-badge">' + (pos + 1) + "</span>";
  const leadBtn =
    pos > 0
      ? '<button type="button" class="cast-icon-btn" title="Make lead character" ' +
        'onclick="promoteCastCard(\'' +
        card.id +
        '\')">&#x2191;</button>'
      : "";
  return (
    '<div class="cast-card selected">' +
    '<div class="cast-card-main" title="' +
    escapeHtml(card.name) +
    '">' +
    '<span class="cast-avatar">' +
    (avatar
      ? '<img src="' + escapeHtml(avatar) + '" alt="" loading="lazy">'
      : '<span class="cast-avatar-fallback">' +
        escapeHtml(card.name.charAt(0).toUpperCase()) +
        "</span>") +
    badge +
    "</span>" +
    '<span class="cast-name">' +
    escapeHtml(card.name) +
    "</span>" +
    "</div>" +
    leadBtn +
    '<button type="button" class="cast-icon-btn" title="Edit character" onclick="openCardEditor(\'' +
    card.id +
    '\')">&#x270E;</button>' +
    '<button type="button" class="cast-icon-btn cast-icon-remove" ' +
    'title="Remove from the cast" aria-label="Remove from the cast" ' +
    'onclick="removeCastCard(\'' +
    card.id +
    '\')">&#x2715;</button>' +
    "</div>"
  );
}

/**
 * Fill the "Add Character" picker with the library cards that are not cast.
 *
 * Rendered on every cast repaint rather than only when the picker is opened,
 * so a card that is imported or edited while the picker is open shows up in it
 * without the user having to close and reopen the panel.
 */
function renderCastAddPicker() {
  const picker = document.getElementById("cast-add-picker");
  if (!picker) return;

  const cast = storyConfig.castIds || [];
  const available = getCards().filter((card) => cast.indexOf(card.id) < 0);

  if (!available.length) {
    picker.innerHTML =
      '<div class="cast-add-empty">' +
      (getCards().length
        ? "Every card is already in the cast."
        : "No cards in the library yet.") +
      "</div>";
    // Nothing left to add, so the panel closes itself instead of leaving an
    // empty box open. The button still reopens it to show the message above.
    toggleCastAddPicker(false);
    return;
  }

  picker.innerHTML = available
    .map((card) => {
      const avatar = cardAvatarFor(card.id);
      return (
        '<button type="button" class="cast-card cast-add-chip" ' +
        'title="Add ' +
        escapeHtml(card.name) +
        ' to the scene" onclick="toggleCastCard(\'' +
        card.id +
        '\')">' +
        '<span class="cast-avatar">' +
        (avatar
          ? '<img src="' + escapeHtml(avatar) + '" alt="" loading="lazy">'
          : '<span class="cast-avatar-fallback">' +
            escapeHtml(card.name.charAt(0).toUpperCase()) +
            "</span>") +
        "</span>" +
        '<span class="cast-name">' +
        escapeHtml(card.name) +
        "</span>" +
        '<span class="cast-add-plus" aria-hidden="true">+</span>' +
        "</button>"
      );
    })
    .join("");
}

/**
 * Show or hide the "Add Character" picker.
 * @param {boolean} [force] Open when true, close when false.
 */
function toggleCastAddPicker(force) {
  const picker = document.getElementById("cast-add-picker");
  const btn = document.getElementById("cast-add-btn");
  if (!picker) return;

  const open =
    typeof force === "boolean" ? force : picker.classList.contains("hidden");
  picker.classList.toggle("hidden", !open);
  if (btn) {
    btn.classList.toggle("active", open);
    btn.setAttribute("aria-expanded", String(open));
  }
}

/**
 * Add or remove a card from this story's cast.
 *
 * Casting is a draft edit: it changes what the *next* message will be written
 * from, and nothing else. It deliberately does not create a chat, open the
 * transcript, or write the lead's greeting — picking characters before you
 * start is a normal thing to want, and it used to be impossible because
 * casting the lead silently created a chat and jumped the view into it.
 *
 * Removal is routed through removeCastCard() so that un-casting a card and
 * pressing its ✕ behave identically.
 * @param {string} id
 */
function toggleCastCard(id) {
  if (!storyConfig.castIds) storyConfig.castIds = [];

  if (storyConfig.castIds.indexOf(id) >= 0) {
    removeCastCard(id);
    return;
  }

  storyConfig.castIds.push(id);
  const card = getCard(id);
  // Casting a character back in clears any exit recorded when they were
  // removed, so the story file stops treating them as gone.
  if (card && typeof markCharacterRestored === "function") {
    try {
      markCharacterRestored(card);
    } catch (e) {
      console.warn("Could not clear the recorded exit:", e);
    }
  }
  commitCastChange();
}

/**
 * Persist a cast change, then repaint every surface that shows the cast.
 *
 * Split out so that saving and repainting happen on one path for all three
 * cast edits (add/remove/promote), and so a storage failure cannot leave the
 * panel showing a cast the app no longer holds.
 */
function commitCastChange() {
  try {
    saveStoryConfig();
  } catch (e) {
    console.warn("Could not save the cast:", e);
  }
  if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
  // The story panel tags removed characters as having left, so it has to be
  // repainted on the same beat as the cast grid.
  if (typeof renderStoryFilePanel === "function") renderStoryFilePanel();
  return renderCastPicker();
}

/**
 * Drop a card from this chat's cast, leaving the card itself untouched.
 *
 * The cast belongs to the chat, not to the library: the same card can be cast
 * into another chat, or cast back into this one later, because nothing here
 * touches the stored card. What removal *does* have to do is reach the story
 * file — a character the user deliberately took out of the scene must not be
 * re-added from the transcript by the next update, so the removal is recorded
 * as an explicit exit.
 * @param {string} id
 */
function removeCastCard(id) {
  if (!storyConfig.castIds) storyConfig.castIds = [];
  const at = storyConfig.castIds.indexOf(id);
  if (at < 0) {
    // The grid can be holding a card this chat never cast — a panel painted
    // before a chat switch, or one whose card was re-saved under a new id.
    // Repaint instead of returning silently, or the ✕ looks broken: the same
    // stale card stays selected and every further press does nothing again.
    renderCastPicker();
    return;
  }
  storyConfig.castIds.splice(at, 1);
  // Recording the exit is bookkeeping for the next story update. It must not
  // decide whether the card actually leaves the cast: a story file that cannot
  // be read or written is no reason to trap the user with a character they
  // just removed.
  try {
    if (typeof markCharacterExited === "function") {
      markCharacterExited(getCard(id));
    }
  } catch (e) {
    console.warn("Could not record the character exit:", e);
  }
  commitCastChange();
}

/** Move a card to the front of the cast, making it the lead character. */
function promoteCastCard(id) {
  if (!storyConfig.castIds) storyConfig.castIds = [];
  storyConfig.castIds = [id].concat(
    storyConfig.castIds.filter((c) => c !== id),
  );
  commitCastChange();
}

/* ── Cast inputs ───────────────────────────────────────────────── */

/** Wire the player's own name and persona fields. */
function setupCastInputs() {
  const nameEl = document.getElementById("cast-user-name");
  const personaEl = document.getElementById("cast-user-persona");

  if (nameEl) {
    nameEl.addEventListener("input", () => {
      storyConfig.userName = nameEl.value;
      saveStoryConfig();
    });
  }
  if (personaEl) {
    personaEl.addEventListener("input", () => {
      storyConfig.userPersona = personaEl.value;
      saveStoryConfig();
    });
  }

  const grid = document.getElementById("cast-grid");
  if (grid) {
    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      grid.classList.add("drop-active");
    });
    grid.addEventListener("dragleave", () =>
      grid.classList.remove("drop-active"),
    );
    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      grid.classList.remove("drop-active");
      if (e.dataTransfer && e.dataTransfer.files.length) {
        handleCardFiles(e.dataTransfer.files);
      }
    });
  }
}

/** Push storyConfig's cast fields into the DOM (called on chat switch). */
function renderCastFields() {
  ceSet("cast-user-name", storyConfig.userName);
  ceSet("cast-user-persona", storyConfig.userPersona);
  renderCastPicker();
}

/* ── Card editor ───────────────────────────────────────────────── */

/**
 * Open the editor. With no id, starts a blank card.
 * @param {string} [id]
 */
function openCardEditor(id) {
  editingCardId = id || null;
  pendingCardAvatar = null;

  const card = id ? getCard(id) : null;
  const title = document.getElementById("card-editor-title");
  if (title) title.textContent = card ? card.name : "New Character";

  ceSet("ce-name", card ? card.name : "");
  ceSet("ce-description", card ? card.description : "");
  ceSet("ce-personality", card ? card.personality : "");
  ceSet("ce-scenario", card ? card.scenario : "");
  ceSet("ce-first-mes", card ? card.firstMes : "");
  ceSet(
    "ce-alt-greetings",
    card ? (card.alternateGreetings || []).join("\n") : "",
  );
  ceSet("ce-mes-example", card ? card.mesExample : "");
  ceSet("ce-appearance", card ? card.appearance : "");
  ceSet("ce-system-prompt", card ? card.systemPrompt : "");
  ceSet("ce-post-history", card ? card.postHistoryInstructions : "");
  ceSet("ce-tags", card ? (card.tags || []).join(", ") : "");

  const preview = document.getElementById("card-editor-preview");
  if (preview) {
    preview.textContent = "";
    preview.classList.add("hidden");
  }

  const delBtn = document.getElementById("card-editor-delete");
  if (delBtn) delBtn.classList.toggle("hidden", !card);

  updateEditorAvatar(card ? cardAvatarFor(card.id) : "");
  document.getElementById("card-editor-overlay")?.classList.remove("hidden");
  document.getElementById("ce-name")?.focus();
}

function closeCardEditor() {
  document.getElementById("card-editor-overlay")?.classList.add("hidden");
  editingCardId = null;
  pendingCardAvatar = null;
}

/** @param {string} url */
function updateEditorAvatar(url) {
  const img = document.getElementById("card-editor-avatar-img");
  if (!img) return;
  if (url) {
    img.src = url;
    img.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
  }
}

/** @param {HTMLInputElement} input */
async function handleCardAvatarPick(input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    pendingCardAvatar = await fileToDataUrl(file);
    updateEditorAvatar(pendingCardAvatar);
  } catch (e) {
    console.warn("Avatar read failed:", e);
    showToast("Could not read that image", "error");
  }
}

/**
 * Retire an id that a card used to have.
 *
 * Card identity is a hash of name + description, so editing either one
 * changes it. Without this the library would end up holding both the
 * edited card and the original it came from — and a later sync would
 * reintroduce the original anyway.
 */
function retireCardId(oldId, newId) {
  if (getSyncedCards().some((c) => c.id === oldId)) {
    const hidden = getHiddenCardIds();
    if (!hidden.includes(oldId)) {
      hidden.push(oldId);
      setHiddenCardIds(hidden);
    }
  }
  setStoredCards(getStoredCards().filter((c) => c.id !== oldId));
  if (storyConfig.castIds) {
    storyConfig.castIds = storyConfig.castIds.map((c) =>
      c === oldId ? newId : c,
    );
  }
}

async function saveCardEditor() {
  const name = ceVal("ce-name");
  if (!name) {
    showToast("A character needs a name", "error");
    return;
  }

  const card = normalizeCard({
    name: name,
    description: ceVal("ce-description"),
    personality: ceVal("ce-personality"),
    scenario: ceVal("ce-scenario"),
    first_mes: ceVal("ce-first-mes"),
    alternate_greetings: ceLines("ce-alt-greetings"),
    mes_example: ceVal("ce-mes-example"),
    system_prompt: ceVal("ce-system-prompt"),
    post_history_instructions: ceVal("ce-post-history"),
    appearance: ceVal("ce-appearance"),
    tags: ceVal("ce-tags")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const previousId = editingCardId;
  // Carry the old avatar across an identity change rather than dropping it.
  const avatar =
    pendingCardAvatar || (previousId ? await getCardAvatar(previousId) : null);

  if (previousId && previousId !== card.id) retireCardId(previousId, card.id);
  saveCard(card);
  if (avatar) await putCardAvatar(card.id, avatar);
  cardAvatarCache.set(card.id, avatar || "");

  saveStoryConfig();
  closeCardEditor();
  renderCastPicker();
  showToast(card.name + " saved", "success");
}

async function deleteEditingCard() {
  if (!editingCardId) return;
  const card = getCard(editingCardId);
  if (!card) return;
  if (!confirm('Delete "' + card.name + '"? This cannot be undone.')) return;

  const id = editingCardId;
  deleteCard(id);
  await deleteCardAvatar(id);
  cardAvatarCache.delete(id);

  saveStoryConfig();
  closeCardEditor();
  renderCastPicker();
  showToast(card.name + " deleted", "success");
}

/**
 * Show the exact system prompt the current cast produces. The fastest
 * way to debug a card that is not behaving is to read what it built.
 */
function previewCardPrompt() {
  const preview = document.getElementById("card-editor-preview");
  if (!preview) return;
  if (!preview.classList.contains("hidden")) {
    preview.classList.add("hidden");
    return;
  }
  const cast = getCast();
  if (!cast.length) {
    preview.textContent =
      "Add this character to the cast first — the preview shows the assembled prompt.";
  } else {
    preview.textContent = buildStoryPrompt() || "(empty prompt)";
  }
  preview.classList.remove("hidden");
}

/* ── Import ────────────────────────────────────────────────────── */

function triggerCardImport() {
  document.getElementById("card-import-input")?.click();
}

/** @param {HTMLInputElement} input */
async function handleCardImport(input) {
  const files = input.files;
  input.value = "";
  if (files && files.length) await handleCardFiles(files);
}

/** @param {FileList|File[]} files */
async function handleCardFiles(files) {
  const result = await importCardFiles(files);
  await renderCastPicker();

  const bits = [];
  if (result.added) bits.push(result.added + " added");
  if (result.updated) bits.push(result.updated + " updated");
  if (result.skipped.length) bits.push(result.skipped.length + " skipped");

  if (!bits.length) {
    showToast("No cards in those files", "error");
  } else {
    showToast(
      "Cards: " + bits.join(", "),
      result.added || result.updated ? "success" : "error",
    );
  }
  if (result.skipped.length) {
    console.warn("Skipped card files:", result.skipped);
  }
}
