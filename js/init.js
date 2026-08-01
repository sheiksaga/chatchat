/* ══════════════════════════════════════════════════════════════
   init.js — Bootstrap: DOM load, app init, event wiring
   ══════════════════════════════════════════════════════════════ */

/**
 * Render the story config form fields from storyConfig state.
 */
function renderStoryConfig() {
  const sceneEl = document.getElementById("story-scene");
  const tagsEl = document.getElementById("story-tags");
  const firstPromptEl = document.getElementById("story-first-prompt");
  const charList = document.getElementById("story-characters-list");

  if (sceneEl) sceneEl.value = storyConfig.scene || "";
  if (tagsEl) tagsEl.value = storyConfig.tags || "";
  if (firstPromptEl) firstPromptEl.value = storyConfig.firstPrompt || "";

  if (charList) {
    charList.innerHTML = "";
    (storyConfig.characters || []).forEach((char, i) => {
      const row = document.createElement("div");
      row.className = "story-char-row";
      row.innerHTML =
        '<input type="text" placeholder="Name" value="' +
        escapeHtml(char.name) +
        '" data-idx="' +
        i +
        '" data-field="name">' +
        '<input type="text" placeholder="Characteristics" value="' +
        escapeHtml(char.traits) +
        '" data-idx="' +
        i +
        '" data-field="traits">' +
        '<input type="text" placeholder="Relationship / Role" value="' +
        escapeHtml(char.role || "") +
        '" data-idx="' +
        i +
        '" data-field="role">' +
        '<button class="btn-del-char" onclick="removeCharacterRow(' +
        i +
        ')" aria-label="Remove character" title="Remove">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      charList.appendChild(row);
    });

    // Wire live input listeners on the new rows
    charList.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        var idx = parseInt(input.dataset.idx);
        var field = input.dataset.field;
        if (!storyConfig.characters[idx])
          storyConfig.characters[idx] = { name: "", traits: "" };
        storyConfig.characters[idx][field] = input.value;
        saveStoryConfig();
      });
    });
  }

  syncStoryStyleUI();
}

/** Minimal HTML escape helper */
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addCharacterRow() {
  if (!storyConfig.characters) storyConfig.characters = [];
  storyConfig.characters.push({ name: "", traits: "", role: "" });
  renderStoryConfig();
  saveStoryConfig();
}

function removeCharacterRow(index) {
  if (!storyConfig.characters) return;
  storyConfig.characters.splice(index, 1);
  renderStoryConfig();
  saveStoryConfig();
}

function useDefaultStory() {
  var style = currentStyle();
  var narration = storyConfig.narration === "third" ? "third" : "first";
  var firstPrompts = {
    cyoa: "Begin the story. Describe the opening scene vividly and present 2-3 clear choices for what happens next.",
    roleplay:
      "Set the scene, then open in character as your lead character. Leave room for me to respond.",
    gm: "Set up the opening situation as game master, then ask what I do.",
  };
  storyConfig = {
    style: style,
    narration: narration,
    scene:
      "A misty forest at twilight. Ancient trees loom overhead, and a narrow path winds deeper into the unknown.",
    characters: [
      {
        name: "The Guide",
        traits: "mysterious, wise, speaks in riddles",
        role: "Enigmatic mentor",
      },
    ],
    tags: "fantasy, mystery, adventure",
    firstPrompt: firstPrompts[style] || firstPrompts.cyoa,
  };
  renderStoryConfig();
  saveStoryConfig();
  // If hero input is empty, auto-send to start the chat
  var heroText = document.getElementById("hero-input-text")
    ? document.getElementById("hero-input-text").value.trim()
    : "";
  if (!heroText) {
    if (!currentChatId) startNewChat();
    showChatView();
    streamAssistantResponse();
  } else {
    sendHeroMessage();
  }
}

/**
 * Defensively parse a JSON object from an LLM response (handles code fences
 * and surrounding prose). Returns the parsed object or null.
 */
function parseStoryJson(raw) {
  if (!raw) return null;
  var s = String(raw)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch (e) {}
  var start = s.indexOf("{");
  var end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (e) {}
  }
  return null;
}

/**
 * Ask the local LLM for a complete, fresh, random story config and fill the form.
 */
async function generateStory() {
  var pill = document.getElementById("story-generate-pill");
  if (pill) {
    pill.disabled = true;
    pill.classList.add("is-loading");
  }
  try {
    var styleId = currentStyle();
    var styleHints = {
      cyoa: "The firstPrompt should tell the AI to describe the opening scene and present 2-3 numbered choices.",
      roleplay:
        "The firstPrompt should tell the AI to set the scene and open in character as the first-listed character, leaving room for the user to respond (no numbered choices).",
      gm: "The firstPrompt should tell the AI, acting as game master, to set up the opening situation and ask the player what they do (no numbered choices).",
    };
    var sys =
      'You are a creative writing assistant. Invent a completely original interactive-fiction premise. Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys: "setting" (a vivid 1-2 sentence setting), "characters" (array of 2-4 objects, each with "name", "traits", and "role"), "tags" (comma-separated genres), "firstPrompt" (a short instruction that kicks off the story). ' +
      (styleHints[styleId] || styleHints.cyoa);
    var user = "Generate a fresh, random story configuration now as JSON.";
    var response = await fetch(API_BASE + "/chat/completions", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: selectedModel || undefined,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.9,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    var data = await response.json();
    var parsed = parseStoryJson(
      data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content,
    );
    if (!parsed) throw new Error("could not parse story JSON");
    var narration = storyConfig.narration === "third" ? "third" : "first";
    storyConfig = {
      style: styleId,
      narration: narration,
      scene:
        typeof parsed.setting === "string"
          ? parsed.setting
          : parsed.scene || "",
      characters: Array.isArray(parsed.characters)
        ? parsed.characters.map(function (c) {
            return {
              name: (c && c.name) || "",
              traits: (c && c.traits) || "",
              role: (c && c.role) || "",
            };
          })
        : [],
      tags: parsed.tags || "",
      firstPrompt: parsed.firstPrompt || "",
    };
    renderStoryConfig();
    saveStoryConfig();
    if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
    showToast("Story generated", "success");
  } catch (err) {
    showToast("Generate failed: " + err.message, "error");
  } finally {
    if (pill) {
      pill.disabled = false;
      pill.classList.remove("is-loading");
    }
  }
}

/**
 * Set the active story style, persist it, and refresh style-dependent UI.
 * @param {'cyoa'|'roleplay'|'gm'} id
 */
function setStoryStyle(id) {
  if (!STORY_STYLES[id]) return;
  storyConfig.style = id;
  saveStoryConfig();
  syncStoryStyleUI();
  if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
}

/**
 * Set the roleplay narration voice, persist it, and refresh the pill UI.
 * @param {'first'|'third'} mode
 */
function setStoryNarration(mode) {
  if (mode !== "first" && mode !== "third") return;
  storyConfig.narration = mode;
  saveStoryConfig();
  syncStoryStyleUI();
  if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
}

/** Crossfade an element's text: fade out, swap textContent, fade back in. */
function fadeSwapText(el, newText) {
  if (!el) return;
  if (el.textContent === newText) return;
  el.classList.add("style-text-fade");
  if (el.dataset.fading === "1") {
    el.textContent = newText;
    return;
  }
  el.dataset.fading = "1";
  el.classList.add("fading");
  setTimeout(function () {
    el.textContent = newText;
    el.classList.remove("fading");
    el.dataset.fading = "0";
  }, 120);
}

/** Reflect the active story style in the pills, hero placeholder, and first-prompt hint. */
function syncStoryStyleUI() {
  var active = currentStyle();
  ["cyoa", "roleplay", "gm"].forEach(function (id) {
    var pill = document.getElementById("style-pill-" + id);
    if (pill) {
      pill.classList.toggle("active", id === active);
      pill.setAttribute("aria-pressed", String(id === active));
    }
  });
  // Narration voice pills only apply to (and only show for) roleplay style.
  var narrationGroup = document.getElementById("story-narration-pills");
  if (narrationGroup) {
    narrationGroup.classList.toggle("hidden", active !== "roleplay");
  }
  var activeNarration =
    storyConfig && storyConfig.narration === "third" ? "third" : "first";
  ["first", "third"].forEach(function (mode) {
    var pill = document.getElementById("narration-pill-" + mode);
    if (pill) {
      pill.classList.toggle("active", mode === activeNarration);
      pill.setAttribute("aria-pressed", String(mode === activeNarration));
    }
  });
  // Update textarea placeholder for story mode on hero load.
  var heroPlaceholder = document.getElementById("hero-placeholder");
  var ta = document.getElementById("hero-input-text");
  if (currentMode === "story" && ta) {
    ta.placeholder = storyHeroText();
  }
  // First-prompt textarea hint.
  var fp = document.getElementById("story-first-prompt");
  if (fp) {
    var hints = {
      cyoa: "Describe the opening scene and present the first choices for the player.",
      roleplay:
        "Set the opening scene and have your lead character open, in character.",
      gm: "Set up the opening situation and prompt the player for their first action.",
    };
    fp.placeholder = hints[active] || hints.cyoa;
  }
}

/**
 * Switch between chat, story, and image mode. Updates pills, toggles story
 * config visibility.
 * @param {'chat'|'story'|'image'} mode
 */
function setMode(mode) {
  currentMode = mode;
  const pills = {
    chat: document.getElementById("pill-chat-mode"),
    story: document.getElementById("pill-story-mode"),
    image: document.getElementById("pill-image-mode"),
  };
  const cfgPills = {
    chat: document.getElementById("cfg-pill-chat"),
    story: document.getElementById("cfg-pill-story"),
    image: document.getElementById("cfg-pill-image"),
  };
  const storyConfigEl = document.getElementById("story-config");
  const promptChips = document.getElementById("prompt-chips");
  const editStoryBtn = document.getElementById("edit-story-btn");
  const ta = document.getElementById("hero-input-text");

  Object.keys(pills).forEach((id) => {
    const active = id === mode;
    [pills[id], cfgPills[id]].forEach((el) => {
      if (!el) return;
      el.classList.toggle("active", active);
      el.setAttribute("aria-pressed", String(active));
    });
  });

  if (storyConfigEl) storyConfigEl.classList.toggle("hidden", mode !== "story");
  if (promptChips) promptChips.classList.toggle("hidden", mode !== "chat");
  if (editStoryBtn) editStoryBtn.style.display = mode === "story" ? "" : "none";

  if (mode === "story") renderStoryConfig();

  if (ta) {
    ta.placeholder =
      mode === "story"
        ? storyHeroText()
        : mode === "image"
          ? "Describe the image to generate…"
          : "Ask anything…";
  }

  // Persist the chosen mode so it survives reloads / chat switches.
  if (currentChatId) {
    const meta = safeGetJSON(CHAT_META_KEY, {});
    if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now() };
    meta[currentChatId].lastMode = mode;
    safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
  }

  if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
}

/**
 * Surface the story-config form in a modal so it's editable mid-conversation.
 * Relocates the existing #story-config element (single source of truth, keeps IDs).
 */
function openStorySettings() {
  if (currentMode !== "story") setMode("story");
  const cfg = document.getElementById("story-config");
  if (!cfg) return;
  cfg.classList.remove("hidden");
  renderStoryConfig();

  // Close the config panel behind the modal.
  document.getElementById("config-panel")?.classList.remove("open");

  const overlay = document.createElement("div");
  overlay.className = "story-settings-overlay";
  overlay.id = "story-settings-overlay";

  const modal = document.createElement("div");
  modal.className = "story-settings-modal";

  const head = document.createElement("div");
  head.className = "story-settings-head";
  head.innerHTML = "<span>Story Settings</span>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "config-panel-close";
  closeBtn.setAttribute("aria-label", "Close story settings");
  closeBtn.title = "Close";
  closeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.onclick = closeStorySettings;
  head.appendChild(closeBtn);

  modal.appendChild(head);
  modal.appendChild(cfg); // physically moves the config into the modal
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeStorySettings();
  });
  document.body.appendChild(overlay);
}

/** Close the story-settings modal and return #story-config to its hero home. */
function closeStorySettings() {
  const overlay = document.getElementById("story-settings-overlay");
  if (!overlay) return;
  const cfg = document.getElementById("story-config");
  const heroInput = document.querySelector(".hero-input-wrapper");
  if (cfg && heroInput && heroInput.parentElement) {
    // Restore to its original slot (before the hero input) so the hero view stays intact.
    heroInput.parentElement.insertBefore(cfg, heroInput);
    if (currentMode !== "story") cfg.classList.add("hidden");
  }
  overlay.remove();
}

/** Persist story config to current chat metadata */
function saveStoryConfig() {
  if (!currentChatId) return;
  const meta = safeGetJSON(CHAT_META_KEY, {});
  if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now() };
  meta[currentChatId].storyConfig = { ...storyConfig };
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
}

/**
 * Initialize app state from localStorage.
 */
function init() {
  migrateData();

  // Always land on the home screen on load/refresh — a stored chat's
  // transcript is restored only when the user picks it from the sidebar
  // (see switchChat in chatlist.js). The chat index still loads normally
  // so prior chats remain listed there.
  currentChatId = null;
  chatHistory = [];
  generationStore = {};
  generationIdx = {};
  renderChatList();
  showHeroView();

  // Wire story config inputs (scene, tags, firstPrompt)
  const sceneEl = document.getElementById("story-scene");
  const tagsEl = document.getElementById("story-tags");
  const firstPromptEl = document.getElementById("story-first-prompt");

  if (sceneEl) {
    sceneEl.addEventListener("input", function () {
      storyConfig.scene = sceneEl.value;
      saveStoryConfig();
    });
  }
  if (tagsEl) {
    tagsEl.addEventListener("input", function () {
      storyConfig.tags = tagsEl.value;
      saveStoryConfig();
    });
  }
  if (firstPromptEl) {
    firstPromptEl.addEventListener("input", function () {
      storyConfig.firstPrompt = firstPromptEl.value;
      saveStoryConfig();
      if (typeof refreshHeroSendButton === "function") refreshHeroSendButton();
    });
  }

  // If hero is visible and in story mode, render story config fields
  var heroRegion = document.getElementById("hero-region");
  if (
    heroRegion &&
    !heroRegion.classList.contains("hidden") &&
    currentMode === "story"
  ) {
    renderStoryConfig();
  }
}

function initTextareaAutoResize() {
  const inputs = ["chat-input", "hero-input-text"];
  inputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      });
    }
  });
}

/** Make the orb's specular highlight follow the mouse while it's nearby. */
function initOrbTracking() {
  const orb = document.querySelector(".orb");
  if (!orb) return;
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;

  document.addEventListener("mousemove", (e) => {
    const rect = orb.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const radius = Math.max(rect.width, rect.height) * 3;
    // Map the cursor offset to a highlight position within a comfortable
    // band around the orb's default specular spot (32%, 26%), fading the
    // pull back to the default spot as the cursor moves further away.
    const pull = 1 - Math.min(dist / radius, 1);
    const mx = 32 + (dx / radius) * 40 * pull;
    const my = 26 + (dy / radius) * 40 * pull;
    orb.style.setProperty("--mx", Math.max(5, Math.min(95, mx)) + "%");
    orb.style.setProperty("--my", Math.max(5, Math.min(95, my)) + "%");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  marked.setOptions({ breaks: true, gfm: true, renderer: codeRenderer });
  hljs.configure({ cssSelector: "pre code" });
  initSliders();
  initImageModelName();
  updateImageModelVisibility();
  init();
  startOfflineDetection();
  document
    .getElementById("chat-input")
    .addEventListener("keydown", handleChatKeydown);
  setupHeroInput();
  initTextareaAutoResize();
  initOrbTracking();

  // Clean up sidebar state when resizing across breakpoints
  window.addEventListener("resize", () => {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) {
      // Moving to desktop: remove mobile overlay classes
      sidebar.classList.remove("open");
      const backdrop = document.getElementById("sidebar-backdrop");
      if (backdrop) backdrop.classList.remove("visible");
    } else {
      // Moving to mobile/tablet: remove desktop collapsed state
      sidebar.classList.remove("collapsed");
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   Export / Import story config
   ══════════════════════════════════════════════════════════════ */

function exportStoryConfig(format) {
  var dateStr = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    var data = {
      style: currentStyle(),
      scene: storyConfig.scene,
      characters: storyConfig.characters,
      tags: storyConfig.tags,
      firstPrompt: storyConfig.firstPrompt,
      exportedAt: new Date().toISOString(),
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "story-config-" + dateStr + ".json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Story config exported as JSON", "success");
  } else {
    var charLines = (storyConfig.characters || [])
      .filter(function (c) {
        return c.name;
      })
      .map(function (c) {
        var line = "- " + c.name + ": " + (c.traits || "unknown");
        if (c.role) line += " (" + c.role + ")";
        return line;
      })
      .join("\n");
    var text = [
      "Style: " + STORY_STYLES[currentStyle()].label,
      "Scene: " + (storyConfig.scene || ""),
      "",
      "Characters:",
      charLines || "(none)",
      "",
      "Tags: " + (storyConfig.tags || ""),
      "",
      "First Prompt:",
      storyConfig.firstPrompt || "",
    ].join("\n");
    var blob = new Blob([text], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "story-config-" + dateStr + ".txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Story config exported as text", "success");
  }
}

function triggerStoryImport() {
  document.getElementById("story-import-input").click();
}

function handleStoryImport(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      if (file.name.endsWith(".json")) {
        var data = JSON.parse(e.target.result);
        storyConfig = {
          style: STORY_STYLES[data.style] ? data.style : "cyoa",
          scene: data.scene || "",
          characters: Array.isArray(data.characters)
            ? data.characters.map(function (c) {
                return {
                  name: c.name || "",
                  traits: c.traits || "",
                  role: c.role || "",
                };
              })
            : [],
          tags: data.tags || "",
          firstPrompt: data.firstPrompt || "",
        };
      } else {
        var text = e.target.result;
        storyConfig = {
          style: "cyoa",
          scene: "",
          characters: [],
          tags: "",
          firstPrompt: "",
        };
        var firstPromptLines = [];
        var inFirstPrompt = false;
        text.split("\n").forEach(function (line) {
          var sceneMatch = line.match(/^Scene:\s*(.*)/i);
          var tagMatch = line.match(/^Tags?:\s*(.*)/i);
          var charMatch = line.match(/^-\s*(.+?)\s*:\s*(.*)/);
          if (sceneMatch) {
            storyConfig.scene = sceneMatch[1];
            inFirstPrompt = false;
          } else if (tagMatch) {
            storyConfig.tags = tagMatch[1];
            inFirstPrompt = false;
          } else if (charMatch) {
            var traitsRaw = charMatch[2].trim();
            var roleMatch = traitsRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
            if (roleMatch) {
              storyConfig.characters.push({
                name: charMatch[1].trim(),
                traits: roleMatch[1].trim(),
                role: roleMatch[2].trim(),
              });
            } else {
              storyConfig.characters.push({
                name: charMatch[1].trim(),
                traits: traitsRaw,
                role: "",
              });
            }
            inFirstPrompt = false;
          } else if (/^First Prompt:/i.test(line)) {
            inFirstPrompt = true;
          } else if (inFirstPrompt) {
            firstPromptLines.push(line);
          }
        });
        storyConfig.firstPrompt = firstPromptLines.join("\n").trim();
      }
      renderStoryConfig();
      saveStoryConfig();
      showToast("Story config imported", "success");
    } catch (err) {
      showToast("Import failed: " + err.message, "error");
    }
  };
  reader.readAsText(file);
  input.value = "";
}

/* ══════════════════════════════════════════════════════════════
   Global keyboard shortcuts
   ══════════════════════════════════════════════════════════════ */
document.addEventListener("keydown", function (e) {
  // Ctrl+N / Cmd+N: New chat
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    startNewChat();
  }
  // Ctrl+Shift+E: Export chats
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "E") {
    e.preventDefault();
    exportChats();
  }
  // Ctrl+Shift+I: Import chats
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I") {
    e.preventDefault();
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = function () {
      if (input.files[0]) importChats(input.files[0]);
    };
    input.click();
  }
  // Ctrl+Shift+S: Export story config JSON
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
    e.preventDefault();
    if (currentMode === "story") exportStoryConfig("json");
  }
  // Ctrl+Shift+L: Import story config
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "L") {
    e.preventDefault();
    if (currentMode === "story") triggerStoryImport();
  }
});
