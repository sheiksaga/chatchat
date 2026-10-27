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
    <h3>Images — FLUX.2 Klein on ComfyUI</h3>
    <p>
      Image generation runs through a local
      <a href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noopener">ComfyUI</a>
      install. Pick <strong>ComfyUI (local)</strong> under Image Provider, and
      <strong>flux2-klein-4b</strong> in the image model menu. It is the default
      and it does both jobs:
    </p>
    <ul>
      <li><code>/img a woman reading on a rainy balcony</code> — draw a new picture from your words, as written.</li>
      <li><code>/edit make her hair red</code> — change the most recent picture. Everything the instruction does not mention is kept.</li>
      <li><code>/image show the whole scene</code> — the chat model reads the story so far and composes a prompt for you.</li>
    </ul>
    <p>
      Prompts are <strong>natural language</strong>: describe the picture as you
      would to a person. There are no quality tags, no negative prompt and no
      prompt expansion — nothing is appended to what you type. Write the
      content you want positively and specifically, and adult content is
      allowed where the story calls for it.
    </p>
    <p>
      <strong>Seed is locked to the chat.</strong> A seed is drawn when the
      chat starts and every picture in that chat uses it, so asking for the same
      scene again redraws the same picture instead of a new variation. Each
      picture also stores the prompt and sampler settings it was drawn with, and
      regenerating it replays those — not the chat's later state. The image
      model menu shows the locked seed as <em>Chat</em>; the story record's
      <strong>Seed ↻</strong> button draws a new one for future pictures.
    </p>
    <p>
      <strong>Image prompts come from the scene record</strong>, not from the
      previous message. Each chat keeps a JSON record of the current location,
      time of day, weather, lighting, mood and who is present (with their
      clothing and condition), and <code>/image</code> builds its prompt from
      that. The document icon next to the send button opens the raw record for
      troubleshooting; editing a value there and regenerating the latest picture
      rebuilds the prompt from your correction. In a plain chat the record turns
      on the first time you ask for an image. The player is stored in their own
      <code>player</code> block, separate from the cast, so the lead character's
      name and clothing can never be attributed to the person you are playing.
    </p>
    <p>
      <strong>Regenerate keeps versions.</strong> Change the image model first
      and press regenerate on a picture: the new draw uses the selected model
      (same locked seed and prompt), and the picture's hover controls gain
      <strong>‹ 1/2 ›</strong> arrows to switch back and forth between the
      versions. Regenerating with the same model and settings replaces the
      current version instead of stacking an identical copy. The same controls
      have a <strong>Delete</strong> button: a picture attached to a reply is
      removed while the reply text stays; a standalone <code>/image</code>
      message is removed with it. Deleting drops every version's bytes.
    </p>
    <p class="settings-hint">
      Model files, in <code>ComfyUI/models/</code>:
      <code>diffusion_models/flux-2-klein-4b-fp8.safetensors</code>,
      <code>text_encoders/qwen_3_4b.safetensors</code> (CLIP type
      <code>flux2</code>) and <code>vae/flux2-vae.safetensors</code>.
      Defaults are 832×1216, 4 steps, CFG 1.0, euler/simple.
    </p>
    <p class="settings-hint">
      FLUX.2 has no mask path: the <strong>Inpaint</strong> button only appears
      with an Anima model selected (<strong>anima-turbo-2b</strong> or
      <strong>anima-turbo-int8</strong>). See the Inpaint section below.
    </p>
  </div>

  <div class="help-section">
    <h3>Images — Anima Turbo 2B (anime: text-to-image + mask inpaint)</h3>
    <p>
      A second model sits in the same menu: <strong>anima-turbo-2b</strong>.
      It is the anime route for explicit adult scenes, where FLUX.2 tends to
      draw clothing the prompt did not ask for. It takes the same
      <strong>natural-language prompts</strong> and the same seed control:
      <code>/img</code> and <code>/image</code> work exactly as they do for
      FLUX.2.
    </p>
    <p>
      <strong>Anima still cannot /edit.</strong> It has no instruction-edit
      graph, so <code>/edit</code> refuses with “Anima is T2I-only; switch to
      FLUX.2 to edit.” Switch the image model back to
      <strong>flux2-klein-4b</strong> first, then run <code>/edit</code>. Nothing
      is ever silently redrawn as a new picture in place of an edit.
    </p>
    <p class="settings-hint">
      Model files, in <code>ComfyUI/models/</code>:
      <code>diffusion_models/anima-turbo-v1.1.safetensors</code>,
      <code>text_encoders/qwen_3_06b_base.safetensors</code> (CLIP type
      <code>stable_diffusion</code>) and
      <code>vae/qwen_image_vae.safetensors</code>.
      Defaults are 1024×1024, 8 steps, CFG 1.0, euler/simple, saved under an
      <code>Anima</code> filename prefix. The checkpoint is
      <strong>non-commercial</strong> — fine for personal use, not for
      redistribution. Like FLUX.2 it takes no negative prompt.
    </p>
    <p class="settings-hint">
      A faster int8 build is also available as
      <strong>anima-turbo-int8</strong> (saved under the
      <code>AnimaFast</code> prefix). It uses the same graph, prompts, seed
      controls and inpaint path, and measures about 1.5–1.8× faster **once the
      model is loaded**. The first load after ComfyUI evicts a model can be
      very slow; keep Anima resident for the session before judging speed.
    </p>
  </div>

  <div class="help-section">
    <h3>Inpaint — repaint part of a picture (Anima only)</h3>
    <p>
      With an Anima model selected (<strong>anima-turbo-2b</strong> or
      <strong>anima-turbo-int8</strong>), every picture's hover pill gains a
      brush button: <strong>Inpaint</strong>. It opens a mask editor over that
      picture.
    </p>
    <ul>
      <li><strong>Paint</strong> over the part you want changed — brush, eraser and a size slider. <strong>White is repainted; black is kept.</strong> Nothing outside your strokes is redrawn.</li>
      <li>Type the <strong>instruction</strong> for that area (default “Change the masked area.”), then <strong>Apply</strong>. Apply stays disabled until something is painted.</li>
      <li>Paint slightly <em>past</em> the edge of the thing you are changing — the graph grows the mask a little and blends the seam, so a tight box leaves a visible halo.</li>
      <li>Cost: <strong>8 steps, CFG 1.0, euler/simple</strong> — about <strong>9 s</strong> warm. There is no strength slider: it barely moves the result, so mask quality is the only real lever.</li>
    </ul>
    <p>
      The result is appended as a new picture with the instruction as its
      caption and the seed it used, so the original is never overwritten.
      Inpainting needs the <code>anima-lllite-inpainting-v2</code> patch in
      <code>ComfyUI/models/model_patches/</code>; it only appears on Anima, and
      a FLUX.2 picture is never silently substituted.
    </p>
    <p class="settings-hint">
      Instruction editing is still FLUX.2's job: <code>/edit</code> has no mask
      and changes what its sentence describes. Use Inpaint when you want to
      choose the region yourself, and <code>/edit</code> when you want the model
      to work out where the change goes.
    </p>
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
  <div class="help-section">
    <h3>Where chats are stored</h3>
    <p>
      Chats are <strong>files on disk</strong>, not browser storage. The local
      server in <code>tools/serve.js</code> keeps them in a gitignored
      <code>chats/</code> folder next to the app:
    </p>
    <ul>
      <li><code>chats/index.json</code> — sidebar order and per-chat settings.</li>
      <li><code>chats/&lt;id&gt;/chat.json</code> — messages and text generations.</li>
      <li><code>chats/&lt;id&gt;/story.json</code> — the scene record (seed, player, cast).</li>
      <li><code>chats/images/&lt;id&gt;.bin</code> — generated pictures.</li>
    </ul>
    <p>
      Start the app with <code>start-chatchat.bat</code> (or
      <code>npm run start</code>). It opens the browser on the first free port,
      so it will not collide with another local service. The folder is the
      source of truth: copy it to back up or move every chat and picture.
    </p>
    <p class="settings-hint">
      The first run after an older build imports existing browser-local chats
      and pictures into <code>chats/</code>, then leaves the browser copy
      behind. Keep the folder out of version control — it is already in
      <code>.gitignore</code>.
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
