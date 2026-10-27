/* ══════════════════════════════════════════════════════════════
   chatlist.js — Sidebar chat list CRUD
   ══════════════════════════════════════════════════════════════ */

/**
 * Render the sidebar chat list with tooltips, delete buttons, and timestamps.
 */
function renderChatList() {
  const list = document.getElementById("sidebar-chat-list");
  const chats = safeGetJSON("chat_index", []);
  const meta = safeGetJSON(CHAT_META_KEY, {});

  list.querySelectorAll(".sidebar-row.chat-entry").forEach((el) => el.remove());

  chats
    .slice()
    .reverse()
    .forEach((chatId) => {
      const msgs = safeGetJSON(STORAGE_KEY_PREFIX + chatId, []);
      const firstUser = msgs.find((m) => m.role === "user");
      const storedName = meta[chatId]?.name;
      const title =
        storedName ||
        (firstUser ? firstUser.content.slice(0, 40) : "Empty chat");
      const createdAt = meta[chatId]?.createdAt;

      const row = document.createElement("div");
      row.className =
        "sidebar-row chat-entry" + (chatId === currentChatId ? " active" : "");
      row.setAttribute(
        "aria-current",
        chatId === currentChatId ? "page" : null,
      );
      row.setAttribute("data-title", title);
      if (createdAt)
        row.title = `${title} — ${new Date(createdAt).toLocaleString()}`;
      else row.title = title;
      row.onclick = () => switchChat(chatId);
      row.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        renameChat(chatId);
      });

      // Chat bubble SVG icon
      const icon = document.createElement("span");
      icon.className = "sidebar-row-icon";
      icon.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';

      const label = document.createElement("span");
      label.className = "sidebar-row-label";
      label.textContent = title;

      row.appendChild(icon);
      row.appendChild(label);

      // Rename button (visible affordance; double-click still works too)
      const renameBtn = document.createElement("button");
      renameBtn.className = "sidebar-row-rename";
      renameBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      renameBtn.setAttribute("aria-label", `Rename chat: ${title}`);
      renameBtn.title = "Rename chat";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        renameChat(chatId);
      };
      row.appendChild(renameBtn);

      // Always show delete button (improved visibility via CSS)
      const delBtn = document.createElement("button");
      delBtn.className = "sidebar-row-delete";
      delBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      delBtn.setAttribute("aria-label", `Delete chat: ${title}`);
      delBtn.title = "Delete chat";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteChat(chatId);
      };
      row.appendChild(delBtn);

      list.appendChild(row);
    });
}

/**
 * Switch to a different chat by ID.
 * @param {string} chatId
 */
function switchChat(chatId) {
  if (chatId === currentChatId) {
    // Still close mobile sidebar if open (user tapped same chat)
    if (typeof closeSidebar === "function") closeSidebar();
    return;
  }
  if (currentChatId && chatHistory.length > 0) {
    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );
    safeSetItem(
      GENERATIONS_PREFIX + currentChatId,
      JSON.stringify(generationStore),
    );
    const chats = safeGetJSON("chat_index", []);
    if (!chats.includes(currentChatId)) {
      chats.push(currentChatId);
      safeSetItem("chat_index", JSON.stringify(chats));
    }
  }
  currentChatId = chatId;
  chatHistory = safeGetJSON(STORAGE_KEY_PREFIX + chatId, []);
  generationStore = safeGetJSON(GENERATIONS_PREFIX + chatId, {});
  generationIdx = {};
  // Load story config and mode for this chat. Merged over the defaults so a
  // chat saved before a field existed still gets a usable value.
  const meta = safeGetJSON(CHAT_META_KEY, {});
  storyConfig = Object.assign(
    defaultStoryConfig(),
    meta[chatId]?.storyConfig || {},
  );
  currentMode = meta[chatId]?.lastMode || "chat";
  // The story/cast panel describes the chat that is now open. Re-rendering it
  // here is what keeps the cast picker honest: a grid painted for the previous
  // chat still shows that chat's selections, and its ✕ / ↑ buttons would then
  // hand this chat ids it never cast (a silent no-op).
  if (typeof renderStoryConfig === "function") renderStoryConfig();
  renderChatList();
  // Sync mode UI if hero is visible
  const heroRegion = document.getElementById("hero-region");
  if (heroRegion && !heroRegion.classList.contains("hidden")) {
    setMode(currentMode);
  }
  if (chatHistory.length > 0) {
    showChatView();
    renderMessages();
  } else {
    showHeroView();
  }

  // Close mobile sidebar overlay after switching
  if (typeof closeSidebar === "function") closeSidebar();
}

/**
 * Start a new chat. Saves current chat, generates new ID, stores metadata.
 */
/**
 * Register the active chat in the sidebar index, creating its metadata if
 * needed, and refresh the sidebar.
 *
 * Nothing else lists a chat, so any code path that puts content into the
 * active chat must call this — otherwise the content is written to
 * localStorage but the chat is unreachable, and a reload orphans it.
 * Cheap and idempotent: it returns immediately once registered.
 */
function registerCurrentChat() {
  if (!currentChatId) return;

  // The chat locks its image seed the moment it starts, whether or not it is
  // already listed. ensureStoryFile is idempotent and creates the record on
  // first use, so a chat restored from an older build gets one here too.
  if (typeof ensureStoryFile === "function") ensureStoryFile(currentChatId);

  const chats = safeGetJSON("chat_index", []);
  if (chats.includes(currentChatId)) return;

  chats.push(currentChatId);
  safeSetItem("chat_index", JSON.stringify(chats));

  const meta = safeGetJSON(CHAT_META_KEY, {});
  if (!meta[currentChatId])
    meta[currentChatId] = { createdAt: Date.now(), lastMode: currentMode };
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));

  // The config the chat was started with is now this chat's config. It is
  // written here because the cast picked on the hero screen is a draft that
  // lives in memory only — without this, the characters chosen before starting
  // would be lost the next time the chat is opened.
  if (typeof saveStoryConfig === "function") saveStoryConfig();

  renderChatList();
}

function startNewChat() {
  if (currentChatId && chatHistory.length > 0) {
    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );
    const chats = safeGetJSON("chat_index", []);
    if (!chats.includes(currentChatId)) {
      chats.push(currentChatId);
      safeSetItem("chat_index", JSON.stringify(chats));
    }
  }
  currentChatId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  // Store chat metadata (creation timestamp)
  const meta = safeGetJSON(CHAT_META_KEY, {});
  meta[currentChatId] = { createdAt: Date.now(), lastMode: currentMode };
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
  chatHistory = [];
  generationStore = {};
  generationIdx = {};
  renderChatList();
  showHeroView();

  // Close mobile sidebar overlay
  if (typeof closeSidebar === "function") closeSidebar();
}

/**
 * Delete a single chat by ID.
 * @param {string} chatId
 */
function deleteChat(chatId) {
  let chats = safeGetJSON("chat_index", []);
  const idx = chats.indexOf(chatId);

  // Snapshot everything about this chat so the delete can be undone.
  const meta = safeGetJSON(CHAT_META_KEY, {});
  const useFolder = typeof chatStore !== "undefined" && chatStore.ready;
  const snapshot = useFolder
    ? Object.assign(chatStore.snapshotChat(chatId), {
        position: idx,
        wasCurrent: chatId === currentChatId,
      })
    : {
        chatId: chatId,
        position: idx,
        wasCurrent: chatId === currentChatId,
        history: safeGetItem(STORAGE_KEY_PREFIX + chatId),
        generations: safeGetItem(GENERATIONS_PREFIX + chatId),
        storyFile:
          typeof storyFileKey === "function"
            ? safeGetItem(storyFileKey(chatId))
            : null,
        meta: meta[chatId] ? JSON.parse(JSON.stringify(meta[chatId])) : null,
      };

  if (idx >= 0) chats.splice(idx, 1);
  safeSetItem("chat_index", JSON.stringify(chats));
  if (useFolder) {
    // One folder removal takes chat.json and story.json together. Calling the
    // per-key removers as well would chase the delete with a story write and
    // recreate the folder.
    chatStore.deleteChat(chatId).catch((err) => {
      console.error("Chat delete failed:", err);
      showToast("Could not delete that chat folder.", "error");
    });
  } else {
    localStorage.removeItem(STORAGE_KEY_PREFIX + chatId);
    localStorage.removeItem(GENERATIONS_PREFIX + chatId);
    if (typeof deleteStoryFile === "function") deleteStoryFile(chatId);
  }

  // Clean up chat meta
  delete meta[chatId];
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));

  if (chatId === currentChatId) {
    if (chats.length > 0) {
      currentChatId = chats[chats.length - 1];
      chatHistory = safeGetJSON(STORAGE_KEY_PREFIX + currentChatId, []);
      generationStore = safeGetJSON(GENERATIONS_PREFIX + currentChatId, {});
      generationIdx = {};
      // Load the fallback chat's story config / mode instead of keeping the deleted chat's
      const meta2 = safeGetJSON(CHAT_META_KEY, {});
      storyConfig = meta2[currentChatId]?.storyConfig || {
        style: "cyoa",
        narration: "first",
        scene: "",
        characters: [],
        tags: "",
        firstPrompt: "",
      };
      currentMode = meta2[currentChatId]?.lastMode || "chat";
    } else {
      chatHistory = [];
      currentChatId = null;
      storyConfig = {
        style: "cyoa",
        narration: "first",
        scene: "",
        characters: [],
        tags: "",
        firstPrompt: "",
      };
      currentMode = "chat";
    }
    if (chatHistory.length > 0) {
      showChatView();
      renderMessages();
    } else {
      showHeroView();
    }
    // Sync the mode UI if the hero view is visible
    const heroRegion = document.getElementById("hero-region");
    if (heroRegion && !heroRegion.classList.contains("hidden")) {
      setMode(currentMode);
    }
  }
  renderChatList();

  showToast("Chat deleted", "", {
    actionLabel: "Undo",
    onAction: () => restoreDeletedChat(snapshot),
  });
}

/**
 * Restore a chat previously removed by deleteChat, from its snapshot.
 * @param {{chatId:string, position:number, wasCurrent:boolean, history:?string, generations:?string, storyFile:?string, meta:?object}} snap
 */
function restoreDeletedChat(snap) {
  // Folder snapshots carry the parsed transcript; the legacy localStorage
  // snapshot carries JSON strings. Handle both so an in-flight undo across a
  // reload still works.
  if (
    typeof chatStore !== "undefined" &&
    chatStore.ready &&
    snap.messages !== undefined
  ) {
    chatStore
      .restoreChat(snap)
      .then(() => {
        renderChatList();
        if (snap.wasCurrent && snap.chatId !== currentChatId) {
          switchChat(snap.chatId);
        }
        showToast("Chat restored", "success");
      })
      .catch((err) => {
        console.error("Chat restore failed:", err);
        showToast("Could not restore that chat folder.", "error");
      });
    return;
  }

  const chats = safeGetJSON("chat_index", []);
  if (!chats.includes(snap.chatId)) {
    const pos =
      snap.position >= 0 && snap.position <= chats.length
        ? snap.position
        : chats.length;
    chats.splice(pos, 0, snap.chatId);
    safeSetItem("chat_index", JSON.stringify(chats));
  }
  if (snap.history != null)
    safeSetItem(STORAGE_KEY_PREFIX + snap.chatId, snap.history);
  if (snap.generations != null)
    safeSetItem(GENERATIONS_PREFIX + snap.chatId, snap.generations);
  // The story file is part of the chat, so undo has to bring it back too or
  // the restored story would silently lose its scene and cast.
  if (snap.storyFile != null && typeof storyFileKey === "function")
    safeSetItem(storyFileKey(snap.chatId), snap.storyFile);
  if (snap.meta) {
    const meta = safeGetJSON(CHAT_META_KEY, {});
    meta[snap.chatId] = snap.meta;
    safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
  }
  renderChatList();
  // If the deleted chat had been the active one, switch back to it.
  if (snap.wasCurrent && snap.chatId !== currentChatId) {
    switchChat(snap.chatId);
  }
  showToast("Chat restored", "success");
}

/**
 * Delete all chats after user confirmation.
 */
function showConfirmDialog(message, { confirmLabel = "Confirm", onConfirm }) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  const msg = document.createElement("div");
  msg.className = "confirm-dialog-message";
  msg.textContent = message;
  const actions = document.createElement("div");
  actions.className = "confirm-dialog-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "confirm-dialog-cancel";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "confirm-dialog-confirm";
  confirmBtn.textContent = confirmLabel;
  const close = () => overlay.remove();
  cancelBtn.onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  confirmBtn.onclick = () => {
    close();
    onConfirm();
  };
  actions.append(cancelBtn, confirmBtn);
  dialog.append(msg, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  confirmBtn.focus();
}

function deleteAllChats() {
  showConfirmDialog("Delete all chats? This cannot be undone.", {
    confirmLabel: "Delete All",
    onConfirm: () => {
      const useFolder = typeof chatStore !== "undefined" && chatStore.ready;
      if (useFolder) {
        chatStore.clearAll().catch((err) => {
          console.error("Delete all failed:", err);
          showToast("Could not clear the chats folder.", "error");
        });
      } else {
        const chats = safeGetJSON("chat_index", []);
        chats.forEach((id) => {
          localStorage.removeItem(STORAGE_KEY_PREFIX + id);
          localStorage.removeItem(GENERATIONS_PREFIX + id);
          if (typeof deleteStoryFile === "function") deleteStoryFile(id);
        });
        safeSetItem("chat_index", "[]");
        localStorage.removeItem(CHAT_META_KEY);
      }
      currentChatId = null;
      chatHistory = [];
      generationStore = {};
      generationIdx = {};
      renderChatList();
      showHeroView();
      document.getElementById("messages").innerHTML = "";
    },
  });
}

/**
 * Rename a chat (triggered by double-click or context menu).
 */
function renameChat(chatId) {
  const meta = safeGetJSON(CHAT_META_KEY, {});
  const current = meta[chatId]?.name || "";
  const newName = prompt("Rename chat:", current);
  if (newName === null) return; // cancelled
  if (!meta[chatId]) meta[chatId] = {};
  meta[chatId].name = newName.trim() || undefined;
  if (!meta[chatId].name) delete meta[chatId].name;
  safeSetItem(CHAT_META_KEY, JSON.stringify(meta));
  renderChatList();
}
