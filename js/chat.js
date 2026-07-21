/* ══════════════════════════════════════════════════════════════
   chat.js — Send messages, compress history, quick actions
   ══════════════════════════════════════════════════════════════ */

/**
 * Build the story mode system prompt from storyConfig.
 * @returns {string}
 */
function buildStoryPrompt() {
    const parts = [
        'You are a creative storytelling AI running in story mode.',
        'Narrate vividly in second-person ("You stand before...").',
        'Roleplay all non-player characters with distinct voices.',
        'NEVER roleplay what the user says, does, thinks, or feels.',
        'End EVERY response with 2-3 explicit numbered choices.',
        'Move the story forward based on the user\'s input.',
        'Maintain consistency with established characters, setting, and plot.',
        'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.'
    ];
    if (storyConfig.scene) parts.push('\nScene: ' + storyConfig.scene);
    if (storyConfig.characters && storyConfig.characters.length > 0) {
        storyConfig.characters.forEach(function(c) {
            if (!c.name) return;
            var line = 'Character \u2014 ' + c.name + ': ' + (c.traits || 'unknown');
            if (c.role && c.role.trim()) line += '. Role: ' + c.role.trim();
            parts.push(line);
        });
    }
    if (storyConfig.tags) parts.push('Tags/Genre: ' + storyConfig.tags);
    if (storyConfig.firstPrompt) parts.push('\n' + storyConfig.firstPrompt);
    return parts.join('\n');
}

/**
 * Shared helper: stream an assistant response for the current chatHistory.
 * Returns the index of the new assistant message, or -1 on error.
 * @returns {Promise<number>}
 */
async function streamAssistantResponse() {
    const messagesEl = document.getElementById('messages');
    const systemPrompt = document.getElementById('system-prompt').value.trim();

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading-indicator';
    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    disableInputs(true);
    // Show stop button, hide send
    document.querySelectorAll('.btn-stop').forEach(b => b.classList.remove('hidden'));
    document.querySelectorAll('.btn-send').forEach(b => b.classList.add('hidden'));

    try {
        let messages;
        if (currentMode === 'story') {
            messages = [{ role: 'system', content: buildStoryPrompt() }, ...chatHistory];
        } else if (systemPrompt) {
            messages = [{ role: 'system', content: systemPrompt }, ...chatHistory];
        } else {
            messages = chatHistory;
        }

        const fullResponse = await streamResponse(messages, loadingDiv);
        if (fullResponse) {
            // Includes the case where the user stopped mid-stream — keep the partial text
            chatHistory.push({ role: 'assistant', content: fullResponse });
            const newIdx = chatHistory.length - 1;
            loadingDiv.classList.remove('loading-indicator');
            addMessageToolbar(loadingDiv, newIdx);
            if (currentMode === 'story') applyStoryFormatting(loadingDiv);
            announceToSR(fullResponse);
            return newIdx;
        }
        // Aborted before any content streamed — drop the empty placeholder
        loadingDiv.remove();
        return -1;
    } catch (err) {
        console.error('Generation error:', err);
        loadingDiv.textContent = `Error: ${err.message}`;
        loadingDiv.classList.remove('loading-indicator');
        showToast(`Generation failed: ${err.message}`, 'error');
        return -1;
    } finally {
        disableInputs(false);
        currentAbortController = null;
        // Hide stop button, show send
        document.querySelectorAll('.btn-stop').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('.btn-send').forEach(b => b.classList.remove('hidden'));
        localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
        renderChatList();
    }
}

async function generateResponseForHistory() {
    return await streamAssistantResponse();
}

async function sendMessage(text) {
    if (!text) return;
    if (!currentChatId) startNewChat();

    // Ensure current chat ID is registered in the chat index in localStorage
    const chats = JSON.parse(localStorage.getItem('chat_index') || '[]');
    if (!chats.includes(currentChatId)) {
        chats.push(currentChatId);
        localStorage.setItem('chat_index', JSON.stringify(chats));
        // Ensure metadata exists for newly registered chats
        const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
        if (!meta[currentChatId]) meta[currentChatId] = { createdAt: Date.now(), lastMode: currentMode };
        localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    }

    showChatView();
    document.getElementById('hero-placeholder').style.display = '';

    chatHistory.push({ role: 'user', content: text });
    resetIdleTimer();

    const messagesEl = document.getElementById('messages');

    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    userDiv.textContent = text;
    messagesEl.appendChild(userDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    await generateResponseForHistory();

    document.getElementById('chat-input')?.focus();
}

/**
 * Send a message from the chat input bar (Enter handler).
 */
async function sendChatMessage() {
    const inputEl = document.getElementById('chat-input');
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    await sendMessage(text);
}

/**
 * Handle Enter key in chat input (send on Enter, newline on Shift+Enter).
 * @param {KeyboardEvent} e
 */
function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

async function quickAction(prompt) {
    if (!currentChatId) startNewChat();
    await sendMessage(prompt);
}

/**
 * Compress conversation history via summarization API call.
 */
async function compressHistory() {
    if (chatHistory.length < 4 || !currentChatId) return;

    disableInputs(true);

    try {
        var charNames = (storyConfig.characters || []).map(function(c) { return c.name; }).filter(Boolean).join(', ');
        const storyContext = currentMode === 'story' && (storyConfig.scene || charNames)
            ? '[Story: scene="' + storyConfig.scene + '", characters="' + charNames + '"] '
            : '';
        const summaryPrompt = storyContext + 'Summarize the conversation above into a concise paragraph. Keep all key facts, decisions, and context. Output ONLY the summary.';
        const msgs = chatHistory.slice(0, -1);
        msgs.push({ role: 'user', content: summaryPrompt });

        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({
                model: selectedModel || undefined,
                messages: msgs,
                temperature: 0.3,
                stream: false
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content || '';

        if (summary) {
            const oldLength = chatHistory.length;
            const oldAsstIdx = oldLength - 1;
            const lastExchange = chatHistory.slice(-2);
            var charNames = (storyConfig.characters || []).map(function(c) { return c.name; }).filter(Boolean).join(', ');
            const storyPrefix = currentMode === 'story' && (storyConfig.scene || charNames)
                ? '[Story context: scene="' + storyConfig.scene + '", characters="' + charNames + '"]\n'
                : '';
            chatHistory = [
                { role: 'assistant', content: `${storyPrefix}[Previous conversation summary: ${summary}]` },
                ...lastExchange
            ];

            // Remap generation store/index keys to new indices (asstN at oldLength-1 → 2)
            const newStore = {};
            const newIdx = {};
            if (generationStore[oldAsstIdx]) newStore[2] = generationStore[oldAsstIdx];
            if (generationIdx[oldAsstIdx] !== undefined) newIdx[2] = generationIdx[oldAsstIdx];
            generationStore = newStore;
            generationIdx = newIdx;
            saveGenerations();

            localStorage.setItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
            renderMessages();
        }
    } catch (err) {
        console.error('Compression failed:', err);
    }

    disableInputs(false);
}