/* ══════════════════════════════════════════════════════════════
   help.js — Setup guide modal (local models, LAN, cloud providers)
   ══════════════════════════════════════════════════════════════ */

/** The command that starts the local MLX Omni image server, CORS-enabled for the browser. */
const MLX_OMNI_START_COMMAND = 'mlx-omni-server --port 10240 --cors-allow-origins="*"';

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
      <code>/props</code>, so the temperature slider reflects how the model was
      actually launched instead of overriding your preset. To set samplers for
      a model chatchat has never seen, add them to the preset and pick the model
      again.
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
    <h3>Local image generation — ComfyUI</h3>
    <p>
      <a href="https://www.comfy.org" target="_blank" rel="noopener">ComfyUI</a>
      is the most flexible local option and the one chatchat gives the most
      control over. Its default port is <code>8188</code>, which is what the
      <strong>ComfyUI</strong> image provider already points at.
    </p>
    <p>
      Start it with the cross-origin header enabled from the command line:
    </p>
    <pre>python main.py --enable-cors-header</pre>
    <p>
      Then in chatchat: <strong>Configuration → Image Provider → ComfyUI</strong>,
      and pick a checkpoint from the Image Model dropdown — that list is read
      straight from ComfyUI, so it always matches what you actually have.
    </p>
    <p><strong>Workflows.</strong> chatchat ships one bundled workflow and a
      box to paste your own. Anything you have already built in ComfyUI will
      work if you export it with <code>Workflow → Export (API)</code> — that is
      the node-graph format, and it is easy to grab the other export by mistake
      (chatchat will say so if you do).</p>
    <p>
      Placeholders are substituted per image using the same convention
      SillyTavern uses, so a workflow already tuned there works unmodified:
      <code>%prompt%</code>, <code>%negative_prompt%</code>,
      <code>%model%</code>, <code>%width%</code>, <code>%height%</code>,
      <code>%seed%</code>, <code>%steps%</code>, <code>%scale%</code>,
      <code>%sampler%</code> and <code>%scheduler%</code>. Workflows from the
      ComfyInject extension (which spells them <code>{{POSITIVE_PROMPT}}</code>,
      <code>{{CHECKPOINT}}</code> and so on) are understood too.
    </p>
    <p>
      <strong>The seed is locked per chat.</strong> A chat reuses one seed for
      every image it generates, so a character keeps the same face and build
      across scenes instead of being rerolled each time. A new chat starts a
      new seed; there is a reroll next to the image settings if you want a
      different look for the same chat.
    </p>
    <p>
      <strong>Scene memory.</strong> In a chat with a cast, the chat model keeps
      a small record of the current scene beside the chat: where it is, who is
      present, and what each character is wearing and doing right now. That is
      what stops a character being redressed from scratch every image — if
      someone took a jacket off three messages ago, the record knows, and the
      next picture does not put it back on. It updates itself after each reply,
      and again before every image. Delete the chat and the record goes with it.
    </p>
    <p>
      <strong>Aspect</strong> sets the canvas, and for a character portrait
      <code>Portrait 832 x 1216</code> is the shape to use — the checkpoints
      chatchat targets are trained around that size, and it is why the default
      is not square.
    </p>
    <p>
      For the WAI-illustrious family, <strong>CFG 1.0</strong> with
      <strong>6-10 steps</strong> and the <code>euler_ancestral</code> sampler
      is the intended fast configuration; raising CFG much above 2 on those
      checkpoints tends to burn the image rather than improve it.
    </p>
    <p class="help-warn">
      A workflow that loads a LoRA only present on your machine will fail
      everywhere else, and chatchat deliberately does not bundle those. Paste
      yours in and it will work.
    </p>
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
