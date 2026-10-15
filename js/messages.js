/* ══════════════════════════════════════════════════════════════
   messages.js — Message rendering, markdown, toolbar builder
   ══════════════════════════════════════════════════════════════ */

const codeRenderer = new marked.Renderer();
codeRenderer.code = function (code, language) {
  const escapedCode = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  // No inline onclick here — a delegated listener handles copies. Inline handlers
  // would be stripped by DOMPurify (see renderMarkdown) and never fire.
  return `<div class="code-block-wrapper">
        <div class="code-block-header">
            <span class="code-block-lang">${language || "code"}</span>
            <button class="btn-copy-code" type="button">Copy</button>
        </div>
        <pre><code>${escapedCode}</code></pre>
    </div>`;
};

// Delegated copy-to-clipboard for code blocks (survives DOMPurify sanitization).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest && e.target.closest(".btn-copy-code");
  if (!btn) return;
  const codeEl = btn.closest(".code-block-wrapper")?.querySelector("pre code");
  if (!codeEl) return;
  try {
    await navigator.clipboard.writeText(codeEl.textContent);
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 2000);
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }
});

/**
 * Render markdown content to sanitized HTML.
 * @param {string} content - Raw markdown text
 * @returns {string} Sanitized HTML string
 */
function renderMarkdown(content) {
  if (!content) return "";
  const html = marked.parse(content);
  // Model/user text is rendered via innerHTML — sanitize to neutralize injected
  // markup (e.g. <img onerror>). Falls back to raw HTML only if DOMPurify is absent.
  return typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html;
}

/**
 * Wrap quoted speech runs ("..." or curly quotes) in <span class="story-speech">,
 * skipping code/pre and already-wrapped spans. Operates on text nodes only.
 */
function wrapSpeechInNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (
      node.parentElement &&
      node.parentElement.closest("code, pre, .story-speech")
    )
      continue;
    if (/[“"][^“”"]+[”"]/.test(node.nodeValue)) targets.push(node);
  }
  targets.forEach((textNode) => {
    const frag = document.createDocumentFragment();
    const parts = textNode.nodeValue.split(/([“"][^“”"]+[”"])/g);
    parts.forEach((part) => {
      if (part && /^[“"][^“”"]+[”"]$/.test(part)) {
        const span = document.createElement("span");
        span.className = "story-speech";
        span.textContent = part;
        frag.appendChild(span);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

/**
 * Apply story-mode text styling to a rendered assistant message element.
 * Speech = quotes, actions = *asterisks* (<em>), thoughts = `backticks` (inline <code>).
 */
function applyStoryFormatting(el) {
  if (!el) return;
  el.querySelectorAll("em").forEach((n) => n.classList.add("story-action"));
  el.querySelectorAll("code").forEach((n) => {
    if (!n.closest("pre")) n.classList.add("story-thought");
  });
  wrapSpeechInNode(el);
}

function addMessageToolbar(div, msgIndex) {
  const alts = generationStore[msgIndex] || [];
  // The list now holds every generation for this slot, so >1 means alternatives exist.
  const hasAlts = alts.length > 1;
  let curIdx = generationIdx[msgIndex];
  if (curIdx === undefined) curIdx = alts.length ? alts.length - 1 : 0;
  const toolbar = document.createElement("div");
  toolbar.className = "msg-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Message actions");

  // Regenerate button
  const regenBtn = document.createElement("button");
  regenBtn.setAttribute("aria-label", "Regenerate response");
  regenBtn.title = "Regenerate";
  regenBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg>';
  regenBtn.onclick = () => regenerateMessage(msgIndex);
  toolbar.appendChild(regenBtn);

  if (hasAlts) {
    const prevBtn = document.createElement("button");
    prevBtn.setAttribute("aria-label", "Previous generation");
    prevBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      cycleGeneration(msgIndex, -1);
    };
    toolbar.appendChild(prevBtn);

    const count = document.createElement("span");
    count.className = "gen-count";
    count.setAttribute(
      "aria-label",
      `Generation ${curIdx + 1} of ${alts.length}`,
    );
    count.textContent = `${curIdx + 1}/${alts.length}`;
    toolbar.appendChild(count);

    const nextBtn = document.createElement("button");
    nextBtn.setAttribute("aria-label", "Next generation");
    nextBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      cycleGeneration(msgIndex, 1);
    };
    toolbar.appendChild(nextBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.setAttribute("aria-label", "Delete this message pair");
  deleteBtn.title = "Delete message";
  deleteBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteMessage(msgIndex);
  };
  toolbar.appendChild(deleteBtn);
  div.appendChild(toolbar);
}

/**
 * Append a "Retry" action to a failed-generation placeholder so the user can
 * resend without retyping — the user turn is already in chatHistory, only
 * the assistant/image side failed to land.
 * @param {HTMLElement} div The error placeholder (never part of chatHistory).
 * @param {() => void} onRetry Called after the placeholder is removed.
 */
function addRetryButton(div, onRetry) {
  const toolbar = document.createElement("div");
  toolbar.className = "msg-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Message actions");

  const retryBtn = document.createElement("button");
  retryBtn.setAttribute("aria-label", "Retry generation");
  retryBtn.title = "Retry";
  retryBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg> Retry';
  retryBtn.onclick = () => {
    div.remove();
    onRetry();
  };
  toolbar.appendChild(retryBtn);
  div.appendChild(toolbar);
}

function addUserMessageToolbar(div, msgIndex) {
  const toolbar = document.createElement("div");
  toolbar.className = "msg-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Message actions");
  const editBtn = document.createElement("button");
  editBtn.setAttribute("aria-label", "Edit message");
  editBtn.title = "Edit message";
  editBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  editBtn.onclick = () => editMessage(msgIndex);
  toolbar.appendChild(editBtn);
  div.appendChild(toolbar);
}

function renderMessages() {
  const messagesEl = document.getElementById("messages");
  messagesEl.innerHTML = "";

  if (chatHistory.length === 0) {
    showHeroView();
    return;
  }

  const fragment = document.createDocumentFragment();
  // renderImageMessage() is async (it reads the blob out of IndexedDB), so its
  // <img> does not exist yet when the transcript is scrolled to the bottom
  // below. Collect the promises to re-pin once the images have real heights.
  const imageRenders = [];

  for (let i = 0; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    const div = document.createElement("div");
    div.className = `message ${msg.role}`;
    if (msg.image) {
      // Image messages carry their blob in IndexedDB, not in the
      // message text — render from the store rather than markdown.
      div.dataset.msgIndex = i;
      imageRenders.push(renderImageMessage(div, msg));
      addMessageToolbar(div, i);
    } else if (msg.role === "assistant") {
      // A named assistant turn is a character reply. The name is only set in
      // character mode, so plain chats keep exactly the markup they had.
      if (msg.name) div.appendChild(characterHeader(msg.name));
      const body = document.createElement("div");
      body.className = msg.name ? "message-body" : "";
      body.innerHTML = renderMarkdown(msg.content || "");
      // Apply syntax highlighting to code blocks
      body.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block);
      });
      if (msg.name) div.appendChild(body);
      else div.innerHTML = body.innerHTML;
      addMessageToolbar(div, i);
      if (currentMode === "story") applyStoryFormatting(div);
    } else {
      div.textContent = msg.content;
      addUserMessageToolbar(div, i);
    }
    fragment.appendChild(div);
  }

  messagesEl.appendChild(fragment);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  Promise.all(imageRenders).then(() => settleScrollAfterImages(messagesEl));
}

/** Is the scroller within `tolerance` px of the bottom? */
function isScrolledToBottom(el, tolerance) {
  const tol = tolerance === undefined ? 40 : tolerance;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= tol;
}

/**
 * Cap generated images to the transcript's height, not the window's.
 *
 * The transcript sits between a header and a composer, so on an 800px-tall
 * window it is only ~614px — a portrait image capped at `70vh` (560px) still
 * overflows it once the message padding and toolbar are added, and the bottom
 * of the picture ends up below the fold. Measuring the scroller is exact where
 * a `vh` figure can only ever be a guess.
 */
function updateGeneratedImageHeight() {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  // Leave room for the message padding plus the toolbar underneath the image.
  const cap = Math.max(160, messagesEl.clientHeight - 96);
  document.documentElement.style.setProperty(
    "--generated-image-max-height",
    cap + "px",
  );
}

/**
 * Keep the transcript pinned to the bottom while images finish decoding.
 *
 * An `<img>` has no height until it decodes, so a scroll-to-bottom issued right
 * after rendering lands short: the scroller has not yet grown to its final
 * height, and a tall image ends up below the fold with no cue that there is
 * more to see. Re-pinning once the real height is known fixes it.
 *
 * Deliberately conditional. It only acts when the reader was already at the
 * bottom when called, and any scroll gesture cancels it — otherwise an image
 * further up the transcript would yank the view back down while someone was
 * reading.
 * @param {HTMLElement} messagesEl
 */
function settleScrollAfterImages(messagesEl) {
  if (!messagesEl) return;
  if (!isScrolledToBottom(messagesEl)) return;

  const repin = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  // An image that already decoded has its height counted by this read of
  // scrollHeight, so one immediate re-pin covers it.
  repin();

  // The rest grow the layout when they finish, so each needs its own re-pin.
  const pending = Array.from(messagesEl.querySelectorAll("img")).filter(
    (img) => !img.complete,
  );
  if (!pending.length) return;

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  messagesEl.addEventListener("wheel", cancel, { once: true, passive: true });
  messagesEl.addEventListener("touchmove", cancel, { once: true, passive: true });
  messagesEl.addEventListener("keydown", cancel, { once: true });

  const guardedRepin = () => {
    if (cancelled) return;
    repin();
  };
  for (const img of pending) {
    img.addEventListener("load", guardedRepin, { once: true });
    // A broken image also changes the height, so re-pin either way.
    img.addEventListener("error", guardedRepin, { once: true });
  }
}

/**
 * Speaker header for a character reply: avatar plus name.
 *
 * The avatar is only rendered when the chat's cast actually has one, so a
 * nameless card (or a hand-written character with no image) degrades to
 * just the name rather than a blank placeholder circle.
 * @param {string} name
 * @returns {HTMLElement}
 */
function characterHeader(name) {
  const header = document.createElement("div");
  header.className = "message-speaker";

  const avatar = typeof cardAvatarByName === "function" ? cardAvatarByName(name) : "";
  if (avatar) {
    const img = document.createElement("img");
    img.className = "message-avatar";
    img.src = avatar;
    img.alt = "";
    img.loading = "lazy";
    header.appendChild(img);
  }

  const label = document.createElement("span");
  label.className = "message-speaker-name";
  label.textContent = name;
  header.appendChild(label);

  return header;
}

/**
 * Render a generated image into an existing message element.
 *
 * The blob lives in IndexedDB (too large for localStorage), so the lookup is
 * async and the element may already be on screen — this fills it in place
 * rather than returning markup. A missing record is expected rather than
 * exceptional: `pruneOrphanImages()` can remove a blob whose message survived,
 * so it degrades to the message's own text instead of showing a broken image.
 *
 * @param {HTMLElement} div Message element to populate
 * @param {{content:string, image:{id:string, prompt:string, model?:string}}} msg
 * @returns {Promise<void>}
 */
async function renderImageMessage(div, msg) {
  const prompt = msg.image?.prompt || "";
  div.classList.add("message-image");
  div.textContent = "";

  let record = null;
  try {
    record = await getImage(msg.image.id);
  } catch (e) {
    console.warn("Image lookup failed for " + msg.image?.id + ":", e);
  }

  if (!record || !record.dataUrl) {
    const missing = document.createElement("div");
    missing.className = "generated-image-missing";
    missing.textContent = prompt
      ? `Image unavailable — ${prompt}`
      : "Image unavailable";
    div.appendChild(missing);
    return;
  }

  const img = document.createElement("img");
  img.src = record.dataUrl;
  // The prompt is the only description available, and it is what a screen
  // reader user needs to know what was generated.
  img.alt = prompt || "Generated image";
  // Lazy is right for a transcript full of images, but the newest message sits
  // just below the fold, and a lazily-deferred image there may not decode until
  // the reader scrolls — which is exactly the case settleScrollAfterImages()
  // cannot fix. So the last message loads eagerly.
  const messagesEl = document.getElementById("messages");
  img.loading = messagesEl && div.parentElement === messagesEl ? "eager" : "lazy";
  img.className = "generated-image";
  div.appendChild(img);
}

/**
 * Save generation alternatives to localStorage.
 */
function saveGenerations() {
  if (currentChatId) {
    safeSetItem(
      GENERATIONS_PREFIX + currentChatId,
      JSON.stringify(generationStore),
    );
  }
}

function editMessage(index) {
  const msg = chatHistory[index];
  if (!msg || msg.role !== "user") return;
  const messagesEl = document.getElementById("messages");
  const div = messagesEl.children[index];
  const original = msg.content;

  // Build textarea
  const ta = document.createElement("textarea");
  ta.value = original;
  ta.className = "edit-textarea";
  // Remove toolbar while editing
  const toolbar = div.querySelector(".msg-toolbar");
  if (toolbar) toolbar.remove();
  div.textContent = "";
  div.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const val = ta.value.trim();
    if (val) {
      chatHistory[index].content = val;
      // Truncate everything after this user message (old assistant response is now stale)
      if (index + 1 < chatHistory.length) {
        for (let j = index + 1; j < chatHistory.length; j++) {
          delete generationStore[j];
          delete generationIdx[j];
        }
        chatHistory = chatHistory.slice(0, index + 1);
        saveGenerations();
      }
      safeSetItem(
        STORAGE_KEY_PREFIX + currentChatId,
        JSON.stringify(chatHistory),
      );
    }
    renderMessages();
    // Auto-generate new response for the edited prompt
    if (
      val &&
      chatHistory.length > 0 &&
      chatHistory[chatHistory.length - 1].role === "user"
    ) {
      await generateResponseForHistory();
      renderMessages();
    }
  };

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      saved = true;
      div.textContent = original;
    }
  });
  ta.addEventListener("blur", () => save());
}

function deleteMessage(index) {
  const msg = chatHistory[index];
  if (!msg || msg.role !== "assistant") return;
  // Delete the assistant + the user message that triggered it
  const delStart =
    index > 0 && chatHistory[index - 1].role === "user" ? index - 1 : index;
  const delCount = delStart === index - 1 ? 2 : 1;
  chatHistory.splice(delStart, delCount);

  // Shift generation store/index to fill the hole
  const newStore = {};
  const newIdx = {};
  for (const key in generationStore) {
    const k = parseInt(key);
    if (k < delStart) {
      newStore[k] = generationStore[k];
      newIdx[k] = generationIdx[k] || 0;
    } else if (k >= delStart + delCount) {
      newStore[k - delCount] = generationStore[k];
      newIdx[k - delCount] = generationIdx[k] || 0;
    }
  }
  for (const key in generationStore) delete generationStore[key];
  Object.assign(generationStore, newStore);
  for (const key in generationIdx) delete generationIdx[key];
  Object.assign(generationIdx, newIdx);

  safeSetItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
  saveGenerations();
  renderMessages();
}

/* ══════════════════════════════════════════════════════════════
   Export / Import — backup and restore all chats
   ══════════════════════════════════════════════════════════════ */

/** Download all chats as a JSON file */
function exportChats() {
  const chats = safeGetJSON("chat_index", []);
  const meta = safeGetJSON(CHAT_META_KEY, {});
  const data = {
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    chats: {},
    meta: meta,
    index: chats,
  };
  chats.forEach((id) => {
    data.chats[id] = {
      history: safeGetJSON(STORAGE_KEY_PREFIX + id, []),
      generations: safeGetJSON(GENERATIONS_PREFIX + id, {}),
    };
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Chats exported successfully", "success");
}

/** Import chats from a JSON file */
function importChats(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.chats || !data.index) throw new Error("Invalid backup format");

      // Merge into existing storage (don't overwrite existing chats with same ID)
      const existing = safeGetJSON("chat_index", []);
      data.index.forEach((id) => {
        if (!existing.includes(id)) {
          existing.push(id);
          if (data.chats[id]) {
            if (data.chats[id].history) {
              safeSetItem(
                STORAGE_KEY_PREFIX + id,
                JSON.stringify(data.chats[id].history),
              );
            }
            if (data.chats[id].generations) {
              safeSetItem(
                GENERATIONS_PREFIX + id,
                JSON.stringify(data.chats[id].generations),
              );
            }
          }
        }
      });
      safeSetItem("chat_index", JSON.stringify(existing));
      if (data.meta) {
        const existingMeta = safeGetJSON(CHAT_META_KEY, {});
        const merged = { ...data.meta, ...existingMeta };
        safeSetItem(CHAT_META_KEY, JSON.stringify(merged));
      }
      showToast("Chats imported successfully", "success");
      // Reload to pick up imported chats
      if (existing.length > 0) {
        currentChatId = existing[existing.length - 1];
        chatHistory = safeGetJSON(STORAGE_KEY_PREFIX + currentChatId, []);
        generationStore = safeGetJSON(GENERATIONS_PREFIX + currentChatId, {});
        generationIdx = {};
      }
      renderChatList();
      if (chatHistory.length > 0) {
        showChatView();
        renderMessages();
      } else {
        showHeroView();
      }
    } catch (err) {
      showToast(`Import failed: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
}

/** Open the hidden file picker for importing chats (sidebar Import button). */
function triggerChatImport() {
  document.getElementById("chat-import-input").click();
}

/** Handle a file chosen via the sidebar Import button. */
function handleChatImport(input) {
  const file = input.files[0];
  if (file) importChats(file);
  input.value = "";
}

/**
 * Announce a completed assistant response to the screen-reader live region.
 * Called once per finished message (not per streamed token) to avoid SR spam.
 * @param {string} text
 */
function announceToSR(text) {
  const el = document.getElementById("sr-announcer");
  if (!el || !text) return;
  // Cap length so very long replies don't overwhelm the announcement.
  el.textContent = text.length > 600 ? text.slice(0, 600) + "…" : text;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} [type] - 'success' | 'error' | ''
 * @param {{actionLabel?:string, onAction?:Function, duration?:number}} [options]
 *        When actionLabel/onAction are provided, an action button (e.g. Undo) is shown
 *        and the toast persists for `duration` ms (default 6000) under JS control.
 */
function showToast(message, type, options) {
  const toast = document.createElement("div");
  const opts = options || {};
  const hasAction = opts.actionLabel && typeof opts.onAction === "function";
  // Action toasts (undo, etc.) surface at top-center; plain toasts sit bottom-right.
  const container = document.getElementById(
    hasAction ? "toast-top-container" : "toast-container",
  );

  if (hasAction) {
    toast.className = `toast toast-action toast-${type || ""}`;
    const msg = document.createElement("span");
    msg.className = "toast-message";
    msg.textContent = message;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action-btn";
    btn.textContent = opts.actionLabel;
    const dismiss = () => {
      if (toast.parentElement) toast.remove();
    };
    const timer = setTimeout(dismiss, opts.duration || 6000);
    btn.onclick = () => {
      clearTimeout(timer);
      dismiss();
      opts.onAction();
    };
    toast.appendChild(msg);
    toast.appendChild(btn);
    container.appendChild(toast);
    return;
  }

  toast.className = `toast toast-${type || ""}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
