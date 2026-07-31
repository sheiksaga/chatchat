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
 * Build a human-readable error from a failed response.
 *
 * Providers disagree on error shape — OpenAI-style nests it under
 * `error.message`, others return a bare string — and a raw "HTTP 400" tells
 * the user nothing actionable, so dig out a message when one exists.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function apiErrorDetail(response) {
    const status = `HTTP ${response.status}`;
    let body = '';
    try {
        body = await response.text();
    } catch (e) {
        return status;
    }
    if (!body) return status;
    try {
        const data = JSON.parse(body);
        const msg = data?.error?.message || data?.error || data?.message || data?.detail;
        if (msg) return `${status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
    } catch (e) {
        // Not JSON — fall through and use the raw text.
    }
    return `${status}: ${body.slice(0, 200)}`;
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

/**
 * One-shot, non-streaming completion — for text the user never sees as prose
 * (scene summaries, prompt building) rather than a chat turn.
 * @param {Array<{role:string, content:string}>} messages
 * @param {{maxTokens?:number, temperature?:number, signal?:AbortSignal, onRetry?:Function}} [opts]
 * @returns {Promise<string>} Trimmed assistant text
 */
async function requestCompletion(messages, opts) {
    opts = opts || {};
    const body = JSON.stringify({
        model: selectedModel || undefined,
        messages: messages,
        temperature: opts.temperature != null ? opts.temperature : 0.4,
        max_tokens: opts.maxTokens || 200,
        stream: false
    });

    for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: apiHeaders(),
            body: body,
            signal: opts.signal
        });

        if (response.ok) {
            const data = await response.json();
            return (data.choices?.[0]?.message?.content || '').trim();
        }

        if (response.status === 429 && attempt === 0) {
            const after = parseInt(response.headers.get('Retry-After') || '', 10);
            const waitMs = Math.min(Number.isFinite(after) ? after * 1000 : 2000, 10000);
            if (typeof opts.onRetry === 'function') opts.onRetry(waitMs);
            await new Promise(r => setTimeout(r, waitMs));
            if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            continue;
        }

        throw new Error(await apiErrorDetail(response));
    }
}