/* ══════════════════════════════════════════════════════════════
   api.js — LM Studio API streaming + input toggling
   ══════════════════════════════════════════════════════════════ */

/** @type {AbortController|null} */
let currentAbortController = null;

/**
 * Models whose GGUF chat template opens a hidden `<think>` block by default.
 * chatchat has no reasoning-trace UI, so leaving these on makes the bubble
 * look frozen until the model finishes thinking.
 * @param {string} modelId
 * @returns {boolean}
 */
function isThinkingModel(modelId) {
  // The separator is optional: ids read both as `gemma-4-e4b` and `gemma4-e4b`.
  return /(qwen3\.[56]|ornith|gemma[-_ ]?4)/i.test(modelId || "");
}

/**
 * Ask llama.cpp to skip a reasoning model's hidden thinking block for this
 * request. Only sent to the llama.cpp provider: the field is llama.cpp's
 * `chat_template_kwargs` extension, and other providers may reject it.
 * little-coder/SillyTavern are unaffected — they have their own thinking UI.
 * @param {object} payload Request body, mutated in place.
 */
function addThinkingControl(payload) {
  const provider = currentProvider();
  if (!provider || provider.samplerSource !== "props") return;
  const modelId = payload.model || selectedModel || "";
  if (!isThinkingModel(modelId)) return;
  payload.chat_template_kwargs = { enable_thinking: false };
}

/**
 * Remove a reasoning trace if a server ever puts it back into `content`
 * (llama.cpp's `reasoning_format: none` fallback). Normally the trace is in
 * `reasoning_content` and the model is asked not to think at all.
 * @param {string} text
 * @returns {string}
 */
function stripThinkTags(text) {
  let s = String(text || "");

  // Gemma 4 / gpt-oss style: the hidden reasoning sits between
  // `<|channel>thought` and `<|channel>final`. Keep only what follows the
  // last final marker; a thought with no final after it is a trace truncated
  // mid-think (small max_tokens), so none of it is an answer.
  const finalAt = s.lastIndexOf("<|channel>final");
  if (finalAt !== -1) {
    s = s.slice(finalAt + "<|channel>final".length);
  } else {
    const thoughtAt = s.indexOf("<|channel>thought");
    if (thoughtAt !== -1) s = s.slice(0, thoughtAt);
  }

  return (
    s
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<think>[\s\S]*$/i, "")
      .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, "")
      .replace(/<\|(?:think|begin_of_thought|end_of_thought)\|>/gi, "")
      // Gemma writes the role label right after the turn marker, so the two are
      // stripped together or "model" leaks into the output.
      .replace(/<start_of_turn>(?:model|user|system)?/gi, "")
      .replace(/<end_of_turn>/gi, "")
      .replace(/^\s+/, "")
  );
}

/**
 * Stream a chat completion from LM Studio API and render in target element.
 * @param {Array<{role:string, content:string}>} messages - Chat messages
 * @param {HTMLElement} targetEl - DOM element to render streaming content into
 * @param {{stop?: string[], renderEl?: HTMLElement}} [opts] - `stop` adds
 *   server-side stop strings; `renderEl` redirects where markdown lands while
 *   `targetEl` keeps owning scroll + toolbar placement.
 * @param {{stop?: string[]}} [opts] - `stop` halts generation on these
 *   strings; character mode uses it to stop the model writing the user's
 *   half of the scene (see rpStopStrings in js/rp.js).
 * @returns {Promise<string>} Full response text, or empty string if aborted
 */
async function streamResponse(messages, targetEl, opts) {
  const renderEl = opts?.renderEl || targetEl;
  currentAbortController = new AbortController();

  const body = {
    model: selectedModel || undefined,
    messages: messages,
    stream: true,
  };
  // Only send a sampler override when one is actually in play. On llama.cpp
  // with no /props profile, the auto flags stay true so the server's
  // --models-preset values win instead of being clobbered by the app defaults.
  if (!temperatureAuto) body.temperature = apiParams.temperature;
  if (!repetitionAuto) body.repeat_penalty = apiParams.repetitionPenalty;
  addThinkingControl(body);
  // Include optional sampling params sourced from RP model profiles, when set
  if (apiParams.topP != null) body.top_p = apiParams.topP;
  if (apiParams.topK != null) body.top_k = apiParams.topK;
  if (apiParams.minP != null) body.min_p = apiParams.minP;
  if (opts && Array.isArray(opts.stop) && opts.stop.length) {
    body.stop = opts.stop;
  }

  let response;
  try {
    response = await fetchApi(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body),
      signal: currentAbortController.signal,
    });
  } catch (err) {
    // Aborted before a response arrived — no partial content to keep
    if (err.name === "AbortError") return "";
    throw err;
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullResponse = "";
  let buffer = "";
  let lastRender = 0;

  // Live generation speed, shown next to the stop button — each SSE delta is
  // ~one token, and elapsed time comes from wall clock, so no server-reported
  // total length is needed.
  const genStart = performance.now();
  let tokenCount = 0;
  let lastStatsUpdate = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const data = JSON.parse(jsonStr);
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            targetEl.classList.remove("loading-indicator");
            fullResponse += content;
            tokenCount++;
            // Throttle renders to ~30fps to reduce layout thrash during streaming
            const now = performance.now();
            if (now - lastRender >= 33) {
              const parent = targetEl.parentElement;
              const isAtBottom =
                parent.scrollHeight - parent.scrollTop - parent.clientHeight <
                100;
              renderEl.innerHTML = renderMarkdown(fullResponse);
              if (isAtBottom) {
                parent.scrollTop = parent.scrollHeight;
              }
              lastRender = now;
            }
            if (now - lastStatsUpdate >= 250) {
              updateGenStats(tokenCount, now - genStart);
              lastStatsUpdate = now;
            }
          }
        } catch (e) {
          /* skip malformed chunks */
        }
      }
    }
  } catch (err) {
    // Aborted mid-stream — keep whatever streamed so far rather than discarding it
    if (err.name !== "AbortError") throw err;
  } finally {
    updateGenStats(0);
  }

  // Final render to catch any remaining content. Strip a reasoning trace if
  // the server returned one in `content` rather than `reasoning_content`.
  fullResponse = stripThinkTags(fullResponse);
  if (fullResponse) {
    renderEl.innerHTML = renderMarkdown(fullResponse);
    const parent = targetEl.parentElement;
    parent.scrollTop = parent.scrollHeight;
  }

  return fullResponse;
}

/**
 * Update (or hide) the live "N tok/s · Ns" readout next to the stop button.
 * There's no server-reported total length to derive a true ETA from, so this
 * shows generation speed and elapsed time rather than a time-remaining guess.
 * @param {number} tokenCount - tokens streamed so far; 0 hides the readout
 * @param {number} [elapsedMs]
 */
function updateGenStats(tokenCount, elapsedMs) {
  const elems = document.querySelectorAll(".gen-stats");
  if (!tokenCount) {
    elems.forEach((el) => {
      el.classList.add("hidden");
      el.textContent = "";
    });
    return;
  }
  const elapsedSec = elapsedMs / 1000;
  const rate = tokenCount / elapsedSec;
  const text = `${rate.toFixed(1)} tok/s · ${elapsedSec.toFixed(1)}s`;
  elems.forEach((el) => {
    el.textContent = text;
    el.classList.remove("hidden");
  });
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
  let body = "";
  try {
    body = await response.text();
  } catch (e) {
    return status;
  }
  if (!body) return status;
  try {
    const data = JSON.parse(body);
    const msg =
      data?.error?.message || data?.error || data?.message || data?.detail;
    if (msg)
      return `${status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
  } catch (e) {
    // Not JSON — fall through and use the raw text.
  }
  return `${status}: ${body.slice(0, 200)}`;
}

/**
 * Explain a network-level `fetch` rejection in terms the user can act on.
 *
 * A rejected fetch is deliberately opaque: the browser will not say whether
 * the host refused the connection or a CORS policy blocked the response,
 * because that distinction leaks information across origins. There is
 * therefore **no way to detect CORS from JavaScript** — so this names both
 * possible causes instead of guessing at one.
 *
 * Worth the words, because "the local server isn't running" is the most likely
 * failure in this app, and every browser reports it uselessly: Chrome says
 * "Failed to fetch", Firefox says "NetworkError when attempting to fetch
 * resource." In its *console* Firefox dresses the same failure up as
 * `Cross-Origin Request Blocked ... (Reason: CORS request did not succeed)`,
 * which reads like a server misconfiguration when nothing is listening at all.
 * MDN is explicit that this message is "not directly related to CORS, but is a
 * fundamental network error" — so do not trust it as a CORS diagnosis.
 *
 * @param {unknown} err The rejection reason.
 * @param {string} url The URL that was being fetched.
 * @returns {string}
 */
function networkErrorDetail(err, url) {
  if (err && err.name === "AbortError") return "Cancelled.";

  let target = url;
  try {
    target = new URL(url, location.href).origin;
  } catch (e) {
    /* not a parseable URL — show it as-is */
  }

  // A file:// page sends `Origin: null`, which many local servers reject
  // outright. Naming that is the difference between a solvable problem and a
  // shrug.
  const from =
    location.protocol === "file:"
      ? 'this page, opened as a file:// document (it sends Origin: "null")'
      : location.origin;

  return (
    `Can't reach ${target}. Either nothing is listening there, or it is ` +
    `refusing requests from ${from}. Start the server — and if it is already ` +
    `running, allow cross-origin requests from this page.`
  );
}

/**
 * `fetch`, but a network-level rejection becomes an actionable message rather
 * than a browser-specific string that names neither the host nor the reason.
 *
 * Use this for every request that talks to a user-configured server. Callers
 * can test `err.networkUnreachable` to tell "never got a response" apart from
 * "the server answered with an error status".
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function fetchApi(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Aborts are a normal user action, not a failure to explain.
    if (err && err.name === "AbortError") throw err;
    const friendly = new Error(networkErrorDetail(err, url));
    friendly.networkUnreachable = true;
    friendly.cause = err;
    throw friendly;
  }
}

/**
 * Read per-model sampler defaults from a llama.cpp server.
 *
 * llama.cpp serves `GET /props` at the server *root* (not under `/v1`) with a
 * `default_generation_settings` object holding the flags the model was loaded
 * with — including whatever `--models-preset` supplied. That is the only
 * authoritative source for a model's tuned samplers: they live in the server's
 * config, not in a Hugging Face README.
 *
 * Current builds nest those flags under `default_generation_settings.params`;
 * older builds put them at the top level, so both are accepted. On a router,
 * `/props` without a model name describes the router (or whichever child is
 * resident), so pass `?model=` to ask about the selected model. `autoload=false`
 * keeps model selection from triggering a 10-30 second load just to read it.
 *
 * Every field is optional and the whole call is best-effort: a missing or
 * differently-shaped payload degrades to "no profile" rather than throwing or
 * wiping the user's slider settings.
 *
 * @param {{baseUrl?: string}} provider
 * @param {string} [modelId] Selected model id (router section or direct alias).
 * @returns {Promise<?object>} A profile shaped like `applyModelProfile` expects,
 *   or null when nothing usable was returned.
 */
async function fetchPropsProfile(provider, modelId) {
  const root = providerRoot(provider);
  if (!root) return null;

  const readProps = async (url) => {
    try {
      // Never let a slow/hung /props block model selection. A missed profile
      // just means the server's own defaults stay in charge ("auto").
      const response = await fetchApi(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      // Including the networkUnreachable case — an unreachable server already
      // gets a clear message from the model list, and must not also break
      // model selection.
      return null;
    }
  };

  let data = await readProps(`${root}/props`);
  if (!data) return null;

  if (data.role === "router" && modelId) {
    data = await readProps(
      `${root}/props?model=${encodeURIComponent(modelId)}&autoload=false`,
    );
    if (!data) return null;
  }

  const gen = data && data.default_generation_settings;
  if (!gen || typeof gen !== "object") return null;

  // Never cache another resident model's samplers under this model's id. A
  // router without a matching `?model=` (or a direct server mid-switch) can
  // answer with a different model's aliases/paths.
  if (modelId && data.model_alias && data.model_alias !== modelId) {
    const modelPath = data.model_path || "";
    if (!modelPath.includes(modelId)) return null;
  }

  // Current llama.cpp (b11146) nests sampler flags under `params`; older
  // builds expose them at the top level. Accept both.
  const params =
    gen.params && typeof gen.params === "object" ? gen.params : gen;

  /** Keep only a finite number, so `null`/strings cannot reach the sliders. */
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : undefined);

  const profile = {
    temperature: num(
      params.temperature != null ? params.temperature : params.temp,
    ),
    top_p: num(params.top_p),
    top_k: num(params.top_k),
    min_p: num(params.min_p),
    repetitionPenalty: num(params.repeat_penalty),
  };
  for (const k of Object.keys(profile)) {
    if (profile[k] === undefined) delete profile[k];
  }
  return Object.keys(profile).length ? profile : null;
}

/**
 * Enable or disable all send buttons and chat input.
 * @param {boolean} disabled
 */
function disableInputs(disabled) {
  const sendBtns = document.querySelectorAll(".btn-send");
  sendBtns.forEach((b) => (b.disabled = disabled));
  document.getElementById("chat-input") &&
    (document.getElementById("chat-input").disabled = disabled);
}

/**
 * One-shot, non-streaming completion — for text the user never sees as prose
 * (scene summaries, prompt building) rather than a chat turn.
 * @param {Array<{role:string, content:string}>} messages
 * @param {{maxTokens?:number, temperature?:number, signal?:AbortSignal, onRetry?:Function,
 *   responseFormat?:object}} [opts] `responseFormat` is an OpenAI
 *   `response_format` value (e.g. a `json_schema`). Servers that do not know
 *   the parameter reject the whole request rather than ignoring it, so this is
 *   dropped and retried once — the caller's own forgiving parse is the fallback.
 * @returns {Promise<string>} Trimmed assistant text
 */
async function requestCompletion(messages, opts) {
  opts = opts || {};
  const payload = {
    model: selectedModel || undefined,
    messages: messages,
    temperature: opts.temperature != null ? opts.temperature : 0.4,
    max_tokens: opts.maxTokens || 200,
    stream: false,
  };
  addThinkingControl(payload);
  let schema = opts.responseFormat || null;

  for (let attempt = 0; ; attempt++) {
    if (schema) payload.response_format = schema;
    else delete payload.response_format;

    const response = await fetchApi(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload),
      signal: opts.signal,
    });

    if (response.ok) {
      const data = await response.json();
      const message = (data.choices &&
        data.choices[0] &&
        data.choices[0].message) || { content: "" };
      let text = stripThinkTags(message.content || "").trim();
      // A thinking model can spend its entire max_tokens on hidden reasoning
      // and hand back an empty `content` — Gemma 4 E4B does exactly this
      // whenever the budget is tight. The reasoning usually describes the
      // same thing the answer would have, so salvage it rather than failing
      // the call; downstream sanitising strips whatever meta-text remains.
      if (!text) {
        text = stripThinkTags(
          message.reasoning_content || message.reasoning || "",
        ).trim();
      }
      return text;
    }

    // 400/422 is how a server says "I do not know that field". Anything the
    // schema was meant to guarantee is still achievable by parsing, so drop it
    // and try once more rather than failing a background update.
    if (schema && (response.status === 400 || response.status === 422)) {
      schema = null;
      continue;
    }

    if (response.status === 429 && attempt === 0) {
      const after = parseInt(response.headers.get("Retry-After") || "", 10);
      const waitMs = Math.min(
        Number.isFinite(after) ? after * 1000 : 2000,
        10000,
      );
      if (typeof opts.onRetry === "function") opts.onRetry(waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      continue;
    }

    throw new Error(await apiErrorDetail(response));
  }
}
