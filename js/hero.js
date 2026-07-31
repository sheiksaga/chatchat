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
