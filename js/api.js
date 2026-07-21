/* ══════════════════════════════════════════════════════════════
   api.js — LM Studio API streaming + input toggling
   ══════════════════════════════════════════════════════════════ */

/** @type {AbortController|null} */
let currentAbortController = null;

/**
 * Stream a chat completion from LM Studio API and render in target element.
 * @param {Array<{role:string, content:string}>} messages - Chat messages
 * @param {HTMLElement} targetEl - DOM element to render streaming content into
 * @returns {Promise<string>} Full response text, or empty string if aborted
 */
async function streamResponse(messages, targetEl) {
    currentAbortController = new AbortController();

    const body = {
        model: selectedModel || undefined,
        messages: messages,
        temperature: apiParams.temperature,
        repeat_penalty: apiParams.repetitionPenalty,
        stream: true
    };
    // Include optional sampling params sourced from RP model profiles, when set
    if (apiParams.topP != null) body.top_p = apiParams.topP;
    if (apiParams.topK != null) body.top_k = apiParams.topK;

    let response;
    try {
        response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify(body),
            signal: currentAbortController.signal
        });
    } catch (err) {
        // Aborted before a response arrived — no partial content to keep
        if (err.name === 'AbortError') return '';
        throw err;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullResponse = '';
    let buffer = '';
    let lastRender = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const jsonStr = trimmed.slice(6);
                if (jsonStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(jsonStr);
                    const content = data.choices?.[0]?.delta?.content;
                    if (content) {
                        targetEl.classList.remove('loading-indicator');
                        fullResponse += content;
                        // Throttle renders to ~30fps to reduce layout thrash during streaming
                        const now = performance.now();
                        if (now - lastRender >= 33) {
                            const parent = targetEl.parentElement;
                            const isAtBottom = (parent.scrollHeight - parent.scrollTop - parent.clientHeight) < 100;
                            targetEl.innerHTML = renderMarkdown(fullResponse);
                            if (isAtBottom) {
                                parent.scrollTop = parent.scrollHeight;
                            }
                            lastRender = now;
                        }
                    }
                } catch (e) { /* skip malformed chunks */ }
            }
        }
    } catch (err) {
        // Aborted mid-stream — keep whatever streamed so far rather than discarding it
        if (err.name !== 'AbortError') throw err;
    }

    // Final render to catch any remaining content
    if (fullResponse) {
        targetEl.innerHTML = renderMarkdown(fullResponse);
        const parent = targetEl.parentElement;
        parent.scrollTop = parent.scrollHeight;
    }

    return fullResponse;
}

/** Stop the current streaming generation */
function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
}

/**
 * Enable or disable all send buttons and chat input.
 * @param {boolean} disabled
 */
function disableInputs(disabled) {
    const sendBtns = document.querySelectorAll('.btn-send');
    sendBtns.forEach(b => b.disabled = disabled);
    document.getElementById('chat-input') && (document.getElementById('chat-input').disabled = disabled);
}