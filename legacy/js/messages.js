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

  // Generate an image for this message, on demand. Nothing in this app spends
  // a diffusion pass without being asked to, so this is the only per-message
  // path to one. Skipped once the message already has a picture: the image's
  // own hover controls (js/imageview.js) own regenerate, and two identical
  // buttons on one message is just noise.
  const alreadyHasImage = !!(
    chatHistory[msgIndex] && chatHistory[msgIndex].image
  );
  if (!alreadyHasImage) {
    const imageBtn = document.createElement("button");
    imageBtn.className = "msg-image-btn";
    imageBtn.setAttribute("aria-label", "Generate an image for this message");
    imageBtn.title = "Generate image";
    imageBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    imageBtn.onclick = (e) => {
      e.stopPropagation();
      generateImageForMessage(msgIndex);
    };
    toolbar.appendChild(imageBtn);
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

  // Resend: same prompt, new answer. Cheaper than editing when the wording was
  // right and only the response missed — no retyping, no second user turn.
  const resendBtn = document.createElement("button");
  resendBtn.className = "msg-resend-btn";
  resendBtn.setAttribute("aria-label", "Resend this message");
  resendBtn.title = "Resend";
  resendBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  resendBtn.onclick = (e) => {
    e.stopPropagation();
    resendMessage(msgIndex);
  };
  toolbar.appendChild(resendBtn);

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
    // Every message is addressable, so an action can find the element it
    // belongs to — the per-message image button in particular.
    div.dataset.msgIndex = i;

    if (msg.image && !msg.image.attached) {
      // A standalone image message carries its blob in IndexedDB, not in the
      // message text — render from the store rather than markdown.
      imageRenders.push(renderImageMessage(div, msg));
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
      // The picture for this message goes between it and its toolbar, so the
      // controls stay where the reader expects them.
      imageRenders.push(appendMessageImage(div, msg));
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
  trackTranscriptStick(messagesEl);
  updateGeneratedImageHeight();
  Promise.all(imageRenders).then(() => settleScrollAfterImages(messagesEl));
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
 * after rendering lands short. Deliberately conditional: it only acts when the
 * reader was already at the bottom, so an image further up the transcript can't
 * yank the view back down while someone is reading.
 * @param {HTMLElement} messagesEl
 */
function settleScrollAfterImages(messagesEl) {
  if (!messagesEl) return;
  if (!isScrolledToBottom(messagesEl, 80)) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Fill a standalone image message element from IndexedDB.
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
  div.classList.add("message-image");
  div.textContent = "";
  await appendImageElement(div, msg);
}

/**
 * Reserve a slot for a message's own image and fill it asynchronously.
 *
 * The wrapper is created synchronously so the picture lands above the toolbar
 * rather than after it: the blob comes out of IndexedDB, and appending the
 * <img> whenever that resolves would put it in the wrong place.
 * @param {HTMLElement} div
 * @param {object} msg
 * @returns {Promise<void>}
 */
function appendMessageImage(div, msg) {
  if (!msg.image) return Promise.resolve();
  const wrap = document.createElement("div");
  wrap.className = "message-image";
  div.appendChild(wrap);
  return appendImageElement(wrap, msg);
}

/**
 * Append the picture for a message's image into a container.
 *
 * Separated from renderImageMessage() because the two cases differ only in
 * what they append to: a standalone image message fills its own element, while
 * an image attached to a reply fills a slot inside it.
 * @param {HTMLElement} container
 * @param {{image:{id:string, prompt:string}}} msg
 * @returns {Promise<void>}
 */
async function appendImageElement(container, msg) {
  const prompt = (msg.image && msg.image.prompt) || "";

  let record = null;
  try {
    record = await getImage(msg.image.id);
  } catch (e) {
    console.warn("Image lookup failed for " + msg.image.id + ":", e);
  }

  if (!record || !record.dataUrl) {
    const missing = document.createElement("div");
    missing.className = "generated-image-missing";
    missing.textContent = prompt
      ? `Image unavailable — ${prompt}`
      : "Image unavailable";
    container.appendChild(missing);
    return;
  }

  const img = document.createElement("img");
  img.src = record.dataUrl;
  // The prompt is the only description available, and it is what a screen
  // reader user needs to know what was generated.
  img.alt = prompt || "Generated image";
  // The seed a picture was drawn with is stored on the message; show it on
  // hover so "fixed"/"last" are checkable against the picture itself.
  const meta = msg.image || {};
  // Hover detail: the model says which route drew it, the seed is what
  // "fixed"/"last" are checkable against, and the workflow distinguishes a
  // mask inpaint from an instruction edit — they look alike in the transcript
  // but are different graphs.
  const detail = [];
  if (meta.model) {
    detail.push(
      typeof imageModelDisplayName === "function"
        ? imageModelDisplayName(meta.model)
        : meta.model,
    );
  }
  if (Number.isFinite(meta.seed)) detail.push(`seed ${meta.seed}`);
  if (meta.workflow) detail.push(meta.workflow);
  if (Array.isArray(msg.imageVariants) && msg.imageVariants.length > 1) {
    const at =
      typeof activeImageVariantIndex === "function"
        ? activeImageVariantIndex(msg)
        : 0;
    detail.push(`version ${at + 1}/${msg.imageVariants.length}`);
  }
  img.title = detail.length
    ? `${detail.join(" · ")}${prompt ? " — " + prompt : ""}`
    : prompt;
  // Lazy is right for a transcript full of images, but the newest message sits
  // just below the fold, and a lazily-deferred image there may not decode until
  // the reader scrolls — which is exactly the case settleScrollAfterImages()
  // cannot fix. So the newest message loads eagerly.
  const messagesEl = document.getElementById("messages");
  img.loading =
    messagesEl && container.parentElement === messagesEl ? "eager" : "lazy";
  trackTranscriptStick(messagesEl);
  img.className = "generated-image";
  container.appendChild(img);

  // An <img> has no height until it decodes, so the scroll pin taken right
  // after render lands short and the picture's bottom ends up below the fold.
  // Two wrinkles: the height is only reflected in `scrollHeight` a frame after
  // the load event, and with several images each one grows the transcript in
  // turn. So pin on the next frame, against the live stick state.
  const pinAfterDecode = () => {
    if (!transcriptStickToBottom) return;
    requestAnimationFrame(() => {
      const el = document.getElementById("messages");
      if (el) el.scrollTop = el.scrollHeight;
    });
  };
  if (img.complete) pinAfterDecode();
  else img.addEventListener("load", pinAfterDecode, { once: true });

  // Viewport controls (regenerate + zoom) live on the picture itself, so every
  // path that renders an image gets them — a standalone /image message used to
  // have no affordances at all. See js/imageview.js.
  if (typeof attachImageControls === "function") {
    attachImageControls(container, img, msg);
  }
}

window.addEventListener("resize", updateGeneratedImageHeight);

/**
 * Whether the transcript should follow new content.
 *
 * Kept up to date by real scrolling only, so a pin performed by code never
 * turns it off. Images have no height when they are appended, so "was the
 * reader at the bottom?" cannot be decided at append time — it has to be the
 * state as of the moment the height lands.
 * @type {boolean}
 */
let transcriptStickToBottom = true;

/**
 * Start tracking whether the reader is following the transcript.
 * Idempotent — safe to call on every render and every append.
 * @param {HTMLElement|null} messagesEl
 */
function trackTranscriptStick(messagesEl) {
  if (!messagesEl || messagesEl.dataset.stickTracked) return;
  messagesEl.dataset.stickTracked = "1";
  messagesEl.addEventListener("scroll", () => {
    transcriptStickToBottom = isScrolledToBottom(messagesEl, 120);
  });
}

/** Is the scroller within `tolerance` px of the bottom? */
function isScrolledToBottom(el, tolerance) {
  const tol = tolerance === undefined ? 40 : tolerance;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= tol;
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

  const avatar =
    typeof cardAvatarByName === "function" ? cardAvatarByName(name) : "";
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
  ta.setAttribute("aria-label", "Edit your message");
  // Remove toolbar while editing
  const toolbar = div.querySelector(".msg-toolbar");
  if (toolbar) toolbar.remove();
  div.textContent = "";
  div.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  let saved = false;
  const revert = () => {
    saved = true;
    // A full re-render, not just the text: the toolbar was removed above and
    // the message still needs it back.
    renderMessages();
  };

  const save = async () => {
    if (saved) return;
    saved = true;
    const val = ta.value.trim();
    if (!val || val === original) {
      // Nothing changed (or the prompt was emptied) — keep the transcript as it
      // was. Re-generating on a stray blur would spend a model call for nothing.
      renderMessages();
      return;
    }

    chatHistory[index].content = val;
    await regenerateFromUserMessage(index);
  };

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
    }
  });
  ta.addEventListener("blur", () => save());
}

/**
 * Re-answer one user message from its stored text.
 *
 * Everything after the turn answered a prompt that is no longer current (or, for
 * a resend, an answer the reader wants replaced), so it is dropped along with
 * the image blobs it owned. The turn itself stays put, so the transcript keeps
 * a single user bubble per prompt rather than growing a duplicate.
 *
 * Shared by editMessage() (after the wording changed) and resendMessage().
 * @param {number} index Index of the user message to answer
 * @returns {Promise<void>}
 */
async function regenerateFromUserMessage(index) {
  if (index + 1 < chatHistory.length) {
    for (let j = index + 1; j < chatHistory.length; j++) {
      const dropped = chatHistory[j];
      // A picture can hold several generated versions; all of their blobs go.
      const imageIds =
        typeof imageVariantIds === "function"
          ? imageVariantIds(dropped)
          : dropped && dropped.image && dropped.image.id
            ? [dropped.image.id]
            : [];
      for (const imageId of imageIds) {
        if (typeof deleteImage === "function") {
          deleteImage(imageId).catch(() => {});
        }
      }
      delete generationStore[j];
      delete generationIdx[j];
    }
    chatHistory = chatHistory.slice(0, index + 1);
    saveGenerations();
  }
  safeSetItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));

  renderMessages();

  // An /image, /img or /edit line asks for a picture, so it is re-run through
  // the image pipeline; anything else is a chat turn and is re-streamed. Same
  // split as sendMessage(), so a resent prompt behaves exactly like a typed one.
  const text = chatHistory[index].content;
  const editCommand =
    typeof parseImageEditCommand === "function"
      ? parseImageEditCommand(text)
      : null;
  const command =
    typeof parseImageCommand === "function" ? parseImageCommand(text) : null;
  if ((command || editCommand) && typeof runImagePrompt === "function") {
    await runImagePrompt(command || editCommand);
  } else {
    await generateResponseForHistory();
  }
  renderMessages();
}

/**
 * Send a user message again as-is, replacing its answer.
 *
 * The point of a resend, rather than a regenerate on the reply, is that the
 * reply holds many generations to cycle through while a fresh draw is what the
 * reader actually wants — and for `/image` lines the image model has no
 * generation list at all.
 * @param {number} index
 * @returns {Promise<void>}
 */
async function resendMessage(index) {
  const msg = chatHistory[index];
  if (!msg || msg.role !== "user") return;
  if (!msg.content || !msg.content.trim()) return;
  await regenerateFromUserMessage(index);
}

function deleteMessage(index) {
  const msg = chatHistory[index];
  if (!msg || msg.role !== "assistant") return;
  // Delete the assistant + the user message that triggered it
  const delStart =
    index > 0 && chatHistory[index - 1].role === "user" ? index - 1 : index;
  const delCount = delStart === index - 1 ? 2 : 1;
  // Drop every blob the removed messages own, including image versions that
  // are not the one currently on screen.
  const removed = chatHistory.slice(delStart, delStart + delCount);
  for (const gone of removed) {
    const imageIds =
      typeof imageVariantIds === "function"
        ? imageVariantIds(gone)
        : gone && gone.image && gone.image.id
          ? [gone.image.id]
          : [];
    for (const imageId of imageIds) {
      if (typeof deleteImage === "function") {
        deleteImage(imageId).catch(() => {});
      }
    }
  }
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
