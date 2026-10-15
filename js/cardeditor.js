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
 * Render the card library as a grid of toggleable chips. A card in the
 * cast is highlighted and badged with its position — position 1 is the
 * lead, whose replies the model writes and whose greeting opens the chat.
 */
async function renderCastPicker() {
  const grid = document.getElementById("cast-grid");
  if (!grid) return;

  await hydrateCardAvatars();

  const cards = getCards();
  const cast = storyConfig.castIds || [];
  const emptyEl = document.getElementById("cast-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", cards.length > 0);

  grid.innerHTML = cards
    .map((card) => {
      const pos = cast.indexOf(card.id);
      const avatar = cardAvatarFor(card.id);
      const badge =
        pos === 0
          ? '<span class="cast-badge cast-badge-lead">lead</span>'
          : pos > 0
            ? '<span class="cast-badge">' + (pos + 1) + "</span>"
            : "";
      const leadBtn =
        pos > 0
          ? '<button type="button" class="cast-icon-btn" title="Make lead character" ' +
            'onclick="promoteCastCard(\'' +
            card.id +
            '\')">&#x2191;</button>'
          : "";
      return (
        '<div class="cast-card' +
        (pos >= 0 ? " selected" : "") +
        '">' +
        '<button type="button" class="cast-card-main" aria-pressed="' +
        (pos >= 0) +
        '" onclick="toggleCastCard(\'' +
        card.id +
        '\')" title="' +
        escapeHtml(cast.length && pos < 0 ? "Add to the scene" : card.name) +
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
        "</button>" +
        leadBtn +
        '<button type="button" class="cast-icon-btn" title="Edit character" onclick="openCardEditor(\'' +
        card.id +
        '\')">&#x270E;</button>' +
        "</div>"
      );
    })
    .join("");
}

/**
 * Add or remove a card from this chat's cast.
 *
 * Casting the first card into an empty chat also opens the scene with
 * the card's greeting, which is what makes picking a character feel like
 * starting a roleplay rather than filling in a form.
 * @param {string} id
 */
function toggleCastCard(id) {
  if (!storyConfig.castIds) storyConfig.castIds = [];
  const at = storyConfig.castIds.indexOf(id);

  if (at >= 0) {
    storyConfig.castIds.splice(at, 1);
  } else {
    if (!currentChatId) startNewChat();
    storyConfig.castIds.push(id);
    const card = getCard(id);
    // Only the lead's greeting opens the scene — supporting cards join a
    // scene that already exists.
    if (card && storyConfig.castIds.length === 1) {
      lockAppearanceForCard(card);
      if (seedGreeting(card)) {
        showChatView();
        renderMessages();
      }
    }
  }

  saveStoryConfig();
  if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
  renderCastPicker();
}

/** Move a card to the front of the cast, making it the lead character. */
function promoteCastCard(id) {
  if (!storyConfig.castIds) return;
  storyConfig.castIds = [id].concat(storyConfig.castIds.filter((c) => c !== id));
  saveStoryConfig();
  renderCastPicker();
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
    grid.addEventListener("dragleave", () => grid.classList.remove("drop-active"));
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
  ceSet("ce-alt-greetings", card ? (card.alternateGreetings || []).join("\n") : "");
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
    storyConfig.castIds = storyConfig.castIds.map((c) => (c === oldId ? newId : c));
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
  const avatar = pendingCardAvatar || (previousId ? await getCardAvatar(previousId) : null);

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
    const msgs = buildRPMessages(cast, storyConfig, chatHistory);
    preview.textContent = msgs.length ? msgs[0].content : "(empty prompt)";
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
