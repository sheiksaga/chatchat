/* ══════════════════════════════════════════════════════════════
   help.js — Setup guide modal (local models, LAN, cloud providers)
   ══════════════════════════════════════════════════════════════ */

/** The command that starts the local MLX Omni image server, CORS-enabled for the browser. */
const MLX_OMNI_START_COMMAND = 'mlx-omni-server --port 10240 --cors-allow-origins="*"';

/** Static, trusted HTML — never interpolates user data, so plain innerHTML is safe here. */
const HELP_CONTENT_HTML = `
  <div class="help-section">
    <h3>Local text chat</h3>
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
      <li>In chatchat, pick <strong>Local</strong> under Text Provider — it already points at <code>http://localhost:1234/v1</code>.</li>
    </ol>
  </div>

  <div class="help-section">
    <h3>Local image generation — Mac (Apple Silicon)</h3>
    <p>
      The fastest local option is <strong>FLUX.1 schnell</strong> via an
      OpenAI-compatible MLX server, since chatchat's image pipeline expects
      that exact API shape.
    </p>
    <ol>
      <li>Install: <code>pip install mlx-omni-server</code></li>
      <li>Run it with CORS enabled so the browser can reach it:<br>
        <code>${MLX_OMNI_START_COMMAND}</code>
      </li>
      <li>In chatchat, pick <strong>Local image (MLX Omni)</strong> under Image Provider — it points at <code>http://localhost:10240/v1</code> by default.</li>
      <li>Set the image model to <code>dhairyashil/FLUX.1-schnell-mflux-4bit</code> (or another MLX FLUX checkpoint) via the image-model pill in the top bar.</li>
    </ol>
    <p class="settings-hint">
      Prefer a GUI? <a href="https://drawthings.ai" target="_blank" rel="noopener">Draw Things</a>
      is also fast on Apple Silicon, but its API
      (<code>/sdapi/v1/txt2img</code>) isn't OpenAI-compatible, so it can't be
      wired in as a provider here without a translation layer.
    </p>
  </div>

  <div class="help-section">
    <h3>Local image generation — Windows</h3>
    <p>
      MLX is Apple-Silicon-only, so there's no direct equivalent on Windows.
      Two practical options:
    </p>
    <ul>
      <li>Run a cloud image provider instead (see below) — no local GPU setup needed.</li>
      <li>
        Run <a href="https://github.com/AUTOMATIC1111/stable-diffusion-webui" target="_blank" rel="noopener">Automatic1111</a>
        or <a href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noopener">ComfyUI</a>
        behind an OpenAI-compatible shim (several small open-source proxies exist) — more setup, but keeps generation fully local.
      </li>
    </ul>
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
  document.getElementById("image-model-dropdown")?.classList.remove("open");

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
