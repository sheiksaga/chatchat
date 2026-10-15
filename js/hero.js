/* ══════════════════════════════════════════════════════════════
   hero.js — Hero input setup and interaction
   ══════════════════════════════════════════════════════════════ */

/** Wire up hero input box: click-to-focus, expand/collapse, Enter-to-send */
function setupHeroInput() {
  const inputBox = document.getElementById("hero-input-box");
  const textarea = document.getElementById("hero-input-text");
  const placeholder = document.getElementById("hero-placeholder");

  inputBox.addEventListener("click", (e) => {
    if (e.target === textarea) return;
    textarea.focus();
  });

  textarea.addEventListener("focus", () => {
    inputBox.classList.add("active");
  });

  textarea.addEventListener("blur", () => {
    if (!textarea.value.trim()) {
      inputBox.classList.remove("active");
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendHeroMessage();
    }
  });

  textarea.addEventListener("input", refreshHeroSendButton);
}

/** @returns {string} Current trimmed value of the hero textarea */
function getHeroInputValue() {
  return document.getElementById("hero-input-text").value.trim();
}

/**
 * Toggle the hero send button between "Send" and "Start" (story mode,
 * empty input, First Prompt present). Safe to call anytime.
 */
function refreshHeroSendButton() {
  const btn = document.getElementById("hero-send-btn");
  if (!btn) return;
  const ta = document.getElementById("hero-input-text");
  const empty = !ta || !ta.value.trim();
  const fp = storyConfig.firstPrompt && storyConfig.firstPrompt.trim();
  if (currentMode === "story" && empty && fp) {
    btn.textContent = "Start";
    btn.classList.add("is-start");
  } else {
    btn.textContent = "Send";
    btn.classList.remove("is-start");
  }
}

/**
 * Send a prompt-starter chip's text as a message (chat mode).
 * @param {HTMLElement} el - The clicked chip button
 */
function usePromptChip(el) {
  const prompt = (el.dataset.prompt || el.textContent || "").trim();
  if (prompt) sendMessage(prompt);
}

/**
 * Put an image command into a composer, for the discoverability chip/button.
 *
 * Deliberately *inserts* rather than sends. A bare `/image` is only valid once
 * there is something to illustrate — in an empty chat it fails — so a control
 * that fired immediately would be a button that sometimes just errors. It
 * would also teach nothing: a control that sends `/image` for you leaves the
 * user still not knowing the command exists. Inserting shows them, keeps the
 * caret ready, and makes Enter or a subject line equally immediate.
 *
 * An existing command is never doubled up, so clicking twice (or clicking
 * after typing `/img` by hand) is harmless, and a command typed second is
 * hoisted to the front where the parser expects it.
 *
 * @param {string} targetId - id of the textarea to fill
 * @param {string} [command] - defaults to `/image`
 */
function insertImageCommand(targetId, command) {
  const ta = document.getElementById(targetId);
  if (!ta) return;
  const token = command || "/image";
  if (!/^\s*\/(image|img)\b/i.test(ta.value)) {
    const rest = ta.value.trim();
    ta.value = rest ? `${token} ${rest}` : `${token} `;
  }
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  // `input` drives the send button state and the hero textarea's autosize.
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Keep the composer hints in step with the current mode.
 *
 * Named in the placeholder because `/image` is the only way to get a picture
 * once a chat is open, and nothing else in the UI would mention it.
 */
function updateComposerHints() {
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.placeholder =
      currentMode === "image"
        ? "Describe the image to generate…"
        : currentMode === "story"
          ? "Write your reply — or /image to illustrate"
          : "Message — or /image to illustrate";
  }
  // In image mode every message is already an image request, so the command
  // is redundant and the control would only be noise.
  for (const id of ["hero-image-chip", "chat-image-btn"]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", currentMode === "image");
  }
}

/** Send the hero input message and transition to chat view */
async function sendHeroMessage() {
  const btn = document.getElementById("hero-send-btn");
  let text = getHeroInputValue();
  if (
    !text &&
    btn &&
    btn.classList.contains("is-start") &&
    storyConfig.firstPrompt &&
    storyConfig.firstPrompt.trim()
  ) {
    text = storyConfig.firstPrompt.trim();
  }
  if (!text) return;
  await sendMessage(text);
  const ta = document.getElementById("hero-input-text");
  if (ta) {
    ta.value = "";
    ta.blur();
    ta.style.height = "auto";
  }
  document.getElementById("hero-input-box").classList.remove("active");
  refreshHeroSendButton();
}
