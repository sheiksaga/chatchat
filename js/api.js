/* ══════════════════════════════════════════════════════════════
   api.js — LM Studio API streaming + input toggling
   ══════════════════════════════════════════════════════════════ */

/** @type {AbortController|null} */
let currentAbortController = null;

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
    temperature: apiParams.temperature,
    repeat_penalty: apiParams.repetitionPenalty,
    stream: true,
  };
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

  // Final render to catch any remaining content
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
 * Every field is treated as optional and the whole call is best-effort. What
 * `/props` reports on a *router* server (as opposed to a single-model one) is
 * not guaranteed, so a missing or differently-shaped payload must degrade to
 * "no profile" rather than throw or wipe the user's slider settings.
 *
 * @param {{baseUrl?: string}} provider
 * @returns {Promise<?object>} A profile shaped like `applyModelProfile` expects,
 *   or null when nothing usable was returned.
 */
async function fetchPropsProfile(provider) {
  const root = providerRoot(provider);
  if (!root) return null;

  let data;
  try {
    const response = await fetchApi(`${root}/props`);
    if (!response.ok) return null;
    data = await response.json();
  } catch (e) {
    // Including the networkUnreachable case — an unreachable server already
    // gets a clear message from the model list, and must not also break
    // model selection.
    return null;
  }

  const gen = data && data.default_generation_settings;
  if (!gen || typeof gen !== "object") return null;

  /** Keep only a finite number, so `null`/strings cannot reach the sliders. */
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : undefined);

  const profile = {
    temperature: num(gen.temp != null ? gen.temp : gen.temperature),
    top_p: num(gen.top_p),
    top_k: num(gen.top_k),
    min_p: num(gen.min_p),
    repetitionPenalty: num(gen.repeat_penalty),
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
    stream: false,
  });

  for (let attempt = 0; ; attempt++) {
    const response = await fetchApi(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: apiHeaders(),
      body: body,
      signal: opts.signal,
    });

    if (response.ok) {
      const data = await response.json();
      return (data.choices?.[0]?.message?.content || "").trim();
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
