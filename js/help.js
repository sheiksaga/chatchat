/* ══════════════════════════════════════════════════════════════
   help.js — Setup guide modal (local models, LAN, cloud providers)
   ══════════════════════════════════════════════════════════════ */

/** Static, trusted HTML — never interpolates user data, so plain innerHTML is safe here. */
const HELP_CONTENT_HTML = `
  <div class="help-section">
    <h3>Local text chat — LM Studio</h3>
    <p>
      <a href="https://lmstudio.ai" target="_blank" rel="noopener">LM Studio</a>
      runs a chat model on your own machine and serves it at an
      OpenAI-compatible <code>/v1/chat/completions</code> endpoint. Works the
      same way on Mac and Windows:
    </p>
    <ol>
      <li>Install and open LM Studio.</li>
      <li>Download any chat model from its model browser.</li>
      <li>Open the <strong>Developer</strong> (or "Local Server") tab and start the server — default port <code>1234</code>.</li>
      <li>In chatchat, pick <strong>LM Studio</strong> under Text Provider — it already points at <code>http://localhost:1234/v1</code>.</li>
    </ol>
    <p class="help-warn">
      <strong>Turn on "Enable CORS" in that same server panel.</strong> LM Studio
      disables cross-origin requests unless asked, and chatchat is a web page
      making requests to a different port, so the browser will block the reply.
      From the CLI the equivalent is <code>lms server start --cors</code>.
    </p>
  </div>

  <div class="help-section">
    <h3>Local text chat — llama.cpp</h3>
    <p>
      <a href="https://github.com/ggml-org/llama.cpp" target="_blank" rel="noopener">llama.cpp</a>'s
      <code>llama-server</code> is lighter than LM Studio and needs no CORS
      setup at all — it allows every origin by default. In chatchat, pick
      <strong>llama.cpp</strong> under Text Provider; the default is
      <code>http://localhost:8081/v1</code>.
    </p>
    <p>Single model, started by hand:</p>
    <pre>llama-server.exe -m model.gguf --alias my-model --port 8081 -c 16384 -ngl all</pre>
    <p>
      <strong>Router mode</strong> serves every model in a folder and loads
      them on demand, which is the nicer setup if you keep several around:
    </p>
    <pre>llama-server.exe --models-dir models --models-preset models-router.ini --models-max 1 --port 8081</pre>
    <p>
      Put one <code>[section]</code> per model in the preset file, with
      <code>model =</code> plus optional <code>ctx-size</code>,
      <code>temp</code>, <code>min-p</code> and <code>top-k</code>. chatchat lists
      whatever the server reports and sends the model name straight back, so the
      dropdown is always the server's own list.
    </p>
    <p>
      Two things worth knowing about router mode: switching models
      <strong>loads on the first reply</strong>, which can take 10-30 seconds,
      and with <code>--models-max 1</code> only one model is in VRAM at a time.
      There is no "unload" to press — that is why chatchat hides the eject
      button on llama.cpp rather than offering a button that does nothing.
    </p>
    <p>
      chatchat reads each model's sampler defaults from the server's
      <code>/props</code> and leaves the temperature and repetition-penalty
      sliders on <strong>auto</strong> until you move them, so the model's
      launch preset wins instead of being overridden by the app. In router mode
      it asks for the selected model's properties; a model that is not loaded
      yet may not report values until the first reply. To set samplers for a
      model chatchat has never seen, add them to the preset and pick the model
      again. Double-click a sampler value to return it to the model default
      after moving it.
    </p>
    <p>
      Qwen3.6 and Ornith open with a hidden <code>&lt;think&gt;</code> block by
      default. chatchat asks llama.cpp to skip it so replies stream immediately;
      use little-coder or SillyTavern if you want to read the reasoning trace.
    </p>
  </div>

  <div class="help-section">
    <h3>Trouble reaching a local server?</h3>
    <p>
      If chatchat says it <em>can't reach</em> the server, that covers two cases
      and the browser will not say which one it is: nothing is listening on the
      port, or the server is refusing requests from this page. Start the server
      first, then check the cross-origin setting.
    </p>
    <p>
      In Firefox's console a blocked <em>or simply unreachable</em> endpoint is
      reported as
      <code>Cross-Origin Request Blocked ... CORS request did not succeed</code>.
      That wording appears even when the server is not running at all, so do not
      read it as proof of a CORS problem. Check the server is up first.
    </p>
  </div>

  <div class="help-section">
    <h3>Using a local model over your home WiFi</h3>
    <p>
      Any local provider (LM Studio or an image server) can be shared with
      other devices on the same network:
    </p>
    <ol>
      <li>On the machine running the server, find its LAN address (e.g. <code>192.168.1.23</code>) and allow the port through the firewall.</li>
      <li>On the other device, edit that provider's <strong>Base URL</strong> in chatchat to <code>http://192.168.1.23:&lt;port&gt;/v1</code> instead of <code>localhost</code>.</li>
      <li>For a custom provider entry, check <strong>"No API key required (local or LAN server)"</strong> so chatchat doesn't ask for one.</li>
    </ol>
  </div>

  <div class="help-section">
    <h3>Cloud providers — quick tips</h3>
    <ul>
      <li><strong>NanoGPT</strong> (nano-gpt.com) — one key for both text and image models; the widest model selection.</li>
      <li><strong>OpenAI</strong> (platform.openai.com) — text via GPT models, images via <code>gpt-image-1</code>/DALL·E.</li>
      <li><strong>OpenRouter</strong> (openrouter.ai) — text only, aggregates many model providers behind one key.</li>
    </ul>
    <p class="settings-hint">
      Text and image providers are picked independently — e.g. local text via
      LM Studio with cloud images from NanoGPT, or the reverse. Use the
      <strong>+</strong> button on either row to add any other OpenAI-compatible
      endpoint.
    </p>
  </div>
`;

/** Open the setup-guide modal. */
function openHelp() {
  if (document.getElementById("help-overlay")) return;

  // Close panels that would otherwise sit behind/overlap the modal.
  document.getElementById("config-panel")?.classList.remove("open");
  document.getElementById("model-dropdown")?.classList.remove("open");

  const overlay = document.createElement("div");
  overlay.className = "story-settings-overlay";
  overlay.id = "help-overlay";

  const modal = document.createElement("div");
  modal.className = "story-settings-modal help-modal";

  const head = document.createElement("div");
  head.className = "story-settings-head";
  head.innerHTML = "<span>Setup Guide</span>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "config-panel-close";
  closeBtn.setAttribute("aria-label", "Close setup guide");
  closeBtn.title = "Close";
  closeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.onclick = closeHelp;
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "help-modal-body";
  body.innerHTML = HELP_CONTENT_HTML;

  modal.appendChild(head);
  modal.appendChild(body);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeHelp();
  });
  document.body.appendChild(overlay);
  closeBtn.focus();
}

/** Close the setup-guide modal. */
function closeHelp() {
  document.getElementById("help-overlay")?.remove();
}
