/* ══════════════════════════════════════════════════════════════
   generations.js — Regenerate and cycle through LLM responses
   ══════════════════════════════════════════════════════════════ */

/**
 * Regenerate an assistant message at the given index.
 * Saves current response as an alternative, truncates, and re-streams.
 */
async function regenerateMessage(msgIndex) {
    if (msgIndex >= chatHistory.length || chatHistory[msgIndex].role !== 'assistant') return;

    // The generation list holds EVERY generation for this slot (including the current
    // one). Seed it with the existing content the first time this message is regenerated.
    const currentContent = chatHistory[msgIndex].content;
    if (!generationStore[msgIndex]) generationStore[msgIndex] = [currentContent];
    else if (!generationStore[msgIndex].includes(currentContent)) generationStore[msgIndex].push(currentContent);
    saveGenerations();

    // Truncate chatHistory: remove this assistant message and everything after
    chatHistory = chatHistory.slice(0, msgIndex);
    localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));

    // Re-render to show truncated view
    renderMessages();

    // Re-use shared streaming helper
    const newIdx = await streamAssistantResponse();

    const list = generationStore[msgIndex] || [];
    if (newIdx === -1) {
        // Aborted with no content / failed — restore the previous message so the slot
        // isn't left empty with an orphaned generation list.
        const restored = list[list.length - 1];
        if (restored !== undefined) {
            chatHistory.push({ role: 'assistant', content: restored });
            generationIdx[msgIndex] = list.length - 1;
            localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
        }
        renderMessages();
        return;
    }

    // streamAssistantResponse pushed the new content at msgIndex — record it in the list
    const newContent = chatHistory[msgIndex].content;
    if (!list.includes(newContent)) list.push(newContent);
    generationIdx[msgIndex] = list.indexOf(newContent);
    saveGenerations();
    localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
    renderMessages();
}

function cycleGeneration(msgIndex, direction) {
    const alts = generationStore[msgIndex];
    if (!alts || alts.length <= 1) return;

    // The list is the single source of truth; chatHistory just mirrors the selected slot.
    let currentSlot = generationIdx[msgIndex];
    if (currentSlot === undefined) currentSlot = alts.indexOf(chatHistory[msgIndex].content);
    if (currentSlot === -1) currentSlot = alts.length - 1;

    const newSlot = (currentSlot + direction + alts.length) % alts.length;
    chatHistory[msgIndex].content = alts[newSlot];

    generationIdx[msgIndex] = newSlot;
    saveGenerations();
    localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
    renderMessages();

    // Trigger bounce after DOM paint
    requestAnimationFrame(() => {
        const msgEl = document.getElementById('messages').children[msgIndex];
        if (msgEl) {
            msgEl.classList.add('gen-swap');
            msgEl.addEventListener('animationend', () => msgEl.classList.remove('gen-swap'), { once: true });
        }
    });
}