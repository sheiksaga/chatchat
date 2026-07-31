/* ══════════════════════════════════════════════════════════════
   images.js — Image generation via NanoGPT API
   ══════════════════════════════════════════════════════════════ */



/**
 * Call the NanoGPT image endpoint.
 * @param {string} prompt
 * @param {AbortSignal} [signal]
 * @param {number} [seed] Reused across a chat to stabilise its look
 * @returns {Promise<string>} A data: URL for the generated image
 */
async function requestImage(prompt, signal, seed) {
    if (!getProviderConfig(IMAGE_PROVIDER_ID).key) {
        throw new Error('No NanoGPT API key set — add one under Provider in settings');
    }

    // This route's canonical sizing field is `resolution` (not `size`) and its
    // count field is `nImages` (not `n`) — it is not the plain OpenAI shape.
    const body = {
        prompt: prompt,
        model: imageParams.model,
        resolution: imageParams.size,
        nImages: 1,
        // The baked-in terms come first so they survive any truncation; the
        // user's own negative prompt extends them rather than replacing them.
        negative_prompt: [BASE_NEGATIVE_PROMPT, (imageParams.negativePrompt || '').trim()]
            .filter(Boolean).join(', '),
        showExplicitContent: !!imageParams.showExplicitContent
    };
    // Only sent when the user set them — valid ranges are model-specific.
    if (imageParams.guidanceScale !== '') body.guidance_scale = parseFloat(imageParams.guidanceScale);
    if (imageParams.steps !== '') body.num_inference_steps = parseInt(imageParams.steps, 10);
    if (seed != null) body.seed = seed;

    try {
        return await postImage(body, signal);
    } catch (err) {
        // A subscription only covers generations at the standard settings, so a
        // custom seed can push an otherwise-included request onto paid balance
        // and fail there. Dropping it is a real loss of continuity, but a
        // slightly different face beats no image at all.
        if (seed != null && /insufficient balance/i.test(err.message)) {
            console.warn('Seeded request was billed to balance and rejected; retrying without a seed.');
            delete body.seed;
            return await postImage(body, signal);
        }
        throw err;
    }
}

/**
 * POST one image body and unwrap the result.
 * @param {object} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} data: URL or hosted image URL
 */
async function postImage(body, signal) {
    const response = await fetch(`${imageApiBase()}/api/v1/images/generations`, {
        method: 'POST',
        headers: imageApiHeaders(),
        body: JSON.stringify(body),
        signal: signal
    });

    if (!response.ok) throw new Error(await apiErrorDetail(response));

    const data = await response.json();
    // paymentSource says whether the subscription or the paid balance covered
    // this one — the only way to tell which requests count as included.
    if (data.paymentSource !== undefined || data.cost !== undefined) {
        console.info('Image billed via', data.paymentSource, '— cost', data.cost,
            '— remaining balance', data.remainingBalance);
    }
    return extractImageUrl(data);
}

/**
 * Pull a usable image out of a generation response.
 *
 * The documented shape is { data: [ { b64_json } | { url } ] }, but the image
 * routes are a compatibility layer over several upstream providers, so a few
 * variants show up in practice. Anything unrecognised is logged in full — that
 * console dump is the fastest way to identify a new shape.
 * @param {object} data Parsed response body
 * @returns {string} data: URL or hosted image URL
 */
function extractImageUrl(data) {
    const candidates = [].concat(data.data || [], data.images || [], data.output || []);
    for (const entry of candidates) {
        if (typeof entry === 'string') {
            // Either a bare URL or bare base64 bytes.
            if (/^(https?:|data:)/.test(entry)) return entry;
            if (entry.length > 256) return 'data:image/png;base64,' + entry;
            continue;
        }
        if (!entry) continue;
        const b64 = entry.b64_json || entry.b64 || entry.base64;
        if (b64) return b64.startsWith('data:') ? b64 : 'data:image/png;base64,' + b64;
        if (entry.url) return entry.url;
        if (entry.image_url) return typeof entry.image_url === 'string' ? entry.image_url : entry.image_url.url;
    }
    if (typeof data.image === 'string' && data.image) {
        return /^(https?:|data:)/.test(data.image) ? data.image : 'data:image/png;base64,' + data.image;
    }

    console.error('Unrecognised image response shape:', data);
    throw new Error('API returned no image data (see console for the response)');
}

/**
 * Generate an image and append it to the current chat. Mirrors
 * streamAssistantResponse()'s lifecycle: placeholder row, disabled inputs,
 * stop button, persistence on the way out.
 * @param {string} prompt A direction for the scene summariser, or — when
 *   `opts.raw` is set — the literal image prompt. Empty means "the scene as-is".
 * @param {{reroll?:boolean, raw?:boolean}} [opts] `reroll` picks a fresh seed —
 *   without it a regenerate would reproduce the identical image, since prompt
 *   and seed would both be unchanged. `raw` skips the summariser entirely.
 * @returns {Promise<number>} Index of the new message, or -1 on failure
 */
async function generateImageMessage(prompt, opts) {
    opts = opts || {};
    const messagesEl = document.getElementById('messages');

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading-indicator';
    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    disableInputs(true);
    document.querySelectorAll('.btn-stop').forEach(b => b.classList.remove('hidden'));
    document.querySelectorAll('.btn-send').forEach(b => b.classList.add('hidden'));

    currentAbortController = new AbortController();

    try {
        if (opts.raw && !prompt) throw new Error('/img needs a prompt — use /image on its own to illustrate the scene');

        // Anything but /img goes through the summariser, with the user's text
        // steering the shot rather than replacing the scene.
        if (!opts.raw) {
            loadingDiv.classList.remove('loading-indicator');
            loadingDiv.className = 'message assistant scene-prompt-pending';
            loadingDiv.textContent = 'Reading the scene…';
            prompt = await buildScenePrompt(
                currentAbortController.signal,
                status => { loadingDiv.textContent = status; },
                prompt
            );
            loadingDiv.className = 'message assistant loading-indicator';
            loadingDiv.textContent = '';
        }

        // Character locks and style are applied to raw prompts too, so
        // "/img Jess smiling" matches the Jess a bare /image produced.
        const composed = await applyImageProfile(
            prompt,
            currentAbortController.signal,
            status => { loadingDiv.textContent = status; }
        );
        loadingDiv.className = 'message assistant loading-indicator';
        loadingDiv.textContent = '';

        const seed = opts.reroll ? Math.floor(Math.random() * 2147483647) : composed.seed;
        const dataUrl = await requestImage(composed.prompt, currentAbortController.signal, seed);

        const id = newImageId();
        await putImage({
            id: id,
            chatId: String(currentChatId),
            dataUrl: dataUrl,
            prompt: prompt,
            model: imageParams.model
        });

        // content stays plain text so the LLM sees sensible context if the
        // conversation continues; the image itself hangs off `image`.
        chatHistory.push({
            role: 'assistant',
            content: `*Generated image — ${prompt}*`,
            image: { id: id, prompt: prompt, model: imageParams.model }
        });
        const newIdx = chatHistory.length - 1;

        loadingDiv.classList.remove('loading-indicator');
        loadingDiv.dataset.msgIndex = newIdx;
        renderImageMessage(loadingDiv, chatHistory[newIdx]);
        addMessageToolbar(loadingDiv, newIdx);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        announceToSR(`Image generated for ${prompt}`);
        return newIdx;
    } catch (err) {
        if (err.name === 'AbortError') {
            loadingDiv.remove();
            return -1;
        }
        console.error('Image generation error:', err);
        loadingDiv.textContent = `Error: ${err.message}`;
        loadingDiv.classList.remove('loading-indicator');
        showToast(`Image generation failed: ${err.message}`, 'error');
        return -1;
    } finally {
        disableInputs(false);
        currentAbortController = null;
        document.querySelectorAll('.btn-stop').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('.btn-send').forEach(b => b.classList.remove('hidden'));
        safeSetItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));
        renderChatList();
    }
}
