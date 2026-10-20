/* ══════════════════════════════════════════════════════════════
   chat.js — Send messages, compress history, quick actions
   ══════════════════════════════════════════════════════════════ */

/**
 * The formatting convention line shared by every story style.
 */
const STORY_FORMATTING_LINE =
  'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.';

/**
 * Emit the config-derived lines (scene, characters, tags, first prompt) shared
 * by every story style. Order and text match the original CYOA prompt exactly.
 * @param {object} cfg storyConfig
 * @returns {string[]}
 */
function storyConfigLines(cfg) {
  const out = [];
  if (cfg.scene) out.push("\nScene: " + cfg.scene);
  // The cast cards are the character source; the lead card comes first, so
  // the styles' "the FIRST character listed below" rule points at it.
  out.push.apply(out, castCharacterLines(cfg));
  // Hand-written rows survive on configs that predate the cast picker (Use
  // Default, Generate and story import still write them). They ride along as
  // extra context rather than being dropped.
  if (cfg.characters && cfg.characters.length > 0) {
    cfg.characters.forEach(function (c) {
      if (!c.name) return;
      var line = "Character \u2014 " + c.name + ": " + (c.traits || "unknown");
      if (c.role && c.role.trim()) line += ". Role: " + c.role.trim();
      out.push(line);
    });
  }
  const userName = ((cfg && cfg.userName) || "").trim();
  const persona = ((cfg && cfg.userPersona) || "").trim();
  if (persona) {
    out.push("The user (" + (userName || DEFAULT_USER_NAME) + "): " + persona);
  } else if (userName) {
    out.push("The user's name is " + userName + ".");
  }
  if (cfg.tags) out.push("Tags/Genre: " + cfg.tags);
  if (cfg.firstPrompt) out.push("\n" + cfg.firstPrompt);
  return out;
}

/**
 * Character lines for the cast cards: name, traits (personality and
 * description) and the card's scenario. Card fields routinely carry
 * {{user}}/{{char}} macros, so they are expanded before the line is built.
 * @param {object} cfg storyConfig
 * @returns {string[]}
 */
function castCharacterLines(cfg) {
  if (typeof getCast !== "function") return [];
  const userName = ((cfg && cfg.userName) || "").trim() || DEFAULT_USER_NAME;
  return getCast()
    .filter((card) => card && card.name)
    .map(function (card) {
      const macros = characterMacros(card, cfg, userName);
      const traits = [card.personality, card.description]
        .map((s) => (s || "").trim().replace(/[.\s]+$/, ""))
        .filter(Boolean)
        .map((s) => applyMacros(s, macros))
        .join(". ");
      let line = "Character \u2014 " + card.name + ": " + (traits || "unknown");
      const scenario = (card.scenario || "").trim();
      if (scenario) line += ". Scenario: " + applyMacros(scenario, macros);
      return line;
    });
}

/**
 * Registry of story styles. Each entry owns its system-prompt instructions but
 * shares the config-lines scaffold and formatting convention.
 */
const STORY_STYLES = {
  cyoa: {
    label: "Adventure",
    hero: "What do you do?",
    buildPrompt: function (cfg) {
      var parts = [
        "You are a creative storytelling AI running in story mode.",
        'Narrate vividly in second-person ("You stand before...").',
        "Roleplay all non-player characters with distinct voices.",
        "NEVER roleplay what the user says, does, thinks, or feels.",
        "End EVERY response with 2-3 explicit numbered choices.",
        "Move the story forward based on the user's input.",
        "Maintain consistency with established characters, setting, and plot.",
        STORY_FORMATTING_LINE,
      ];
      return parts.concat(storyConfigLines(cfg)).join("\n");
    },
  },
  roleplay: {
    label: "Roleplay",
    hero: "What do you do or say?",
    buildPrompt: function (cfg) {
      var narrationLine =
        cfg.narration === "third"
          ? 'The FIRST character listed below is your lead character \u2014 narrate them in third person, using their name and pronouns rather than "I", as a novel would. Voice every other listed character as an NPC when the scene calls for it.'
          : "The FIRST character listed below is your lead character \u2014 speak and act as them in first person, in character. Voice every other listed character as an NPC when the scene calls for it.";
      var parts = [
        "You are a masterful roleplay partner running in story mode.",
        narrationLine,
        "Set the scene, then keep track of who is present, the location, and the mood as the story unfolds.",
        'The user may either DIRECT the scene from outside (e.g. "move toward the cockpit", "we are now in the schoolyard") OR speak and act in character. Interpret which they mean and respond accordingly.',
        "NEVER narrate the user's own words, actions, thoughts, or feelings for them.",
        "Do NOT present numbered choices \u2014 continue the scene naturally and leave room for the user to act.",
        "Maintain consistency with established characters, setting, and plot.",
        STORY_FORMATTING_LINE,
      ];
      return parts.concat(storyConfigLines(cfg)).join("\n");
    },
  },
  gm: {
    label: "Game Master",
    hero: "What do you do?",
    buildPrompt: function (cfg) {
      var parts = [
        "You are a skilled game master (GM) running an interactive scene in story mode.",
        "Describe the world vividly, voice every non-player character with a distinct personality, and keep the world consistent and reactive.",
        "The FIRST character listed below is the user's player character; every other listed character is an NPC you control.",
        "When the user attempts something with an uncertain outcome, narrate a plausible result WITH consequences \u2014 success, partial success, or complication \u2014 instead of always letting them succeed. Use narrative judgment only; do NOT roll dice or use numeric stats.",
        "NEVER decide the player character's choices, words, or feelings for them.",
        "Do NOT present numbered choices \u2014 react to what the user does.",
        "Maintain consistency with established characters, setting, and plot.",
        STORY_FORMATTING_LINE,
      ];
      return parts.concat(storyConfigLines(cfg)).join("\n");
    },
  },
};

/**
 * Resolve the active, valid story style id (defaults to 'cyoa').
 * @returns {'cyoa'|'roleplay'|'gm'}
 */
function currentStyle() {
  return storyConfig && STORY_STYLES[storyConfig.style]
    ? storyConfig.style
    : "cyoa";
}

/**
 * The hero-input placeholder text for the active story style.
 * @returns {string}
 */
function storyHeroText() {
  return STORY_STYLES[currentStyle()].hero;
}

/**
 * Build the story mode system prompt for the active style.
 * @returns {string}
 */
function buildStoryPrompt() {
  return STORY_STYLES[currentStyle()].buildPrompt(storyConfig);
}

/**
 * Shared helper: stream an assistant response for the current chatHistory.
 * Returns the index of the new assistant message, or -1 on error.
 * @returns {Promise<number>}
 */
async function streamAssistantResponse() {
  const messagesEl = document.getElementById("messages");
  const systemPrompt = document.getElementById("system-prompt").value.trim();

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message assistant loading-indicator";
  messagesEl.appendChild(loadingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  disableInputs(true);
  // Show stop button, hide send
  document
    .querySelectorAll(".btn-stop")
    .forEach((b) => b.classList.remove("hidden"));
  document
    .querySelectorAll(".btn-send")
    .forEach((b) => b.classList.add("hidden"));

  try {
    let messages;

    if (currentMode === "story") {
      messages = [
        { role: "system", content: buildStoryPrompt() },
        ...chatHistory,
      ];
    } else if (systemPrompt) {
      messages = [{ role: "system", content: systemPrompt }, ...chatHistory];
    } else {
      messages = chatHistory;
    }

    const rawResponse = await streamResponse(messages, loadingDiv);
    if (rawResponse) {
      // Includes the case where the user stopped mid-stream — keep the partial text
      const assistantMsg = { role: "assistant", content: rawResponse };
      chatHistory.push(assistantMsg);
      const newIdx = chatHistory.length - 1;
      loadingDiv.classList.remove("loading-indicator");
      addMessageToolbar(loadingDiv, newIdx);
      if (currentMode === "story") applyStoryFormatting(loadingDiv);
      announceToSR(rawResponse);
      // Fold this exchange into the chat's story file in the background. Fire
      // and forget: it is an extra model call, and making the reader wait for
      // it before they can read the reply they just got would be the wrong
      // trade.
      if (typeof scheduleStoryFileUpdate === "function") {
        scheduleStoryFileUpdate();
      }
      return newIdx;
    }
    // Aborted before any content streamed — drop the empty placeholder
    loadingDiv.remove();
    return -1;
  } catch (err) {
    console.error("Generation error:", err);
    // A network failure already reads as a complete sentence naming the host
    // and both possible causes; prefixing it would only bury the useful part.
    const detail = err.networkUnreachable
      ? err.message
      : `Generation failed: ${err.message}`;
    loadingDiv.textContent = err.networkUnreachable
      ? detail
      : `Error: ${detail}`;
    loadingDiv.classList.remove("loading-indicator");
    showToast(detail, "error");
    addRetryButton(loadingDiv, () => streamAssistantResponse());
    return -1;
  } finally {
    disableInputs(false);
    currentAbortController = null;
    // Hide stop button, show send
    document
      .querySelectorAll(".btn-stop")
      .forEach((b) => b.classList.add("hidden"));
    document
      .querySelectorAll(".btn-send")
      .forEach((b) => b.classList.remove("hidden"));
    safeSetItem(
      STORAGE_KEY_PREFIX + currentChatId,
      JSON.stringify(chatHistory),
    );
    renderChatList();
  }
}

async function generateResponseForHistory() {
  return await streamAssistantResponse();
}

async function sendMessage(text) {
  if (!text) return;

  // /img is the verbatim escape hatch and /image is scene-aware. Both work in
  // any mode: a plain chat has no scene record to summarise, so /image falls
  // back to whatever the user typed after it.
  const imageCommand =
    typeof parseImageCommand === "function" ? parseImageCommand(text) : null;
  if (imageCommand) {
    await sendImagePrompt(text, imageCommand);
    return;
  }

  // The image subsystem is being rebuilt. Chat-mode /img (above) is the only
  // wired path so far; Image Mode's scene logic comes later.
  if (currentMode === "image") {
    showToast(
      "Image Mode isn't wired up yet — use /img in chat for now.",
      "error",
    );
    return;
  }

  if (!currentChatId) startNewChat();
  registerCurrentChat();

  // A story is assumed to have a scene from its very first message, so the
  // file is created alongside the chat rather than lazily on the first image.
  if (currentMode === "story" && typeof ensureStoryFile === "function") {
    ensureStoryFile(currentChatId);
  }

  showChatView();
  var ta = document.getElementById("hero-input-text");
  if (ta)
    ta.placeholder =
      currentMode === "story"
        ? storyHeroText()
        : currentMode === "image"
          ? "Describe the image to generate…"
          : "Ask anything…";

  chatHistory.push({ role: "user", content: text });
  resetIdleTimer();

  const messagesEl = document.getElementById("messages");

  const userDiv = document.createElement("div");
  userDiv.className = "message user";
  userDiv.textContent = text;
  messagesEl.appendChild(userDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  await generateResponseForHistory();

  document.getElementById("chat-input")?.focus();
}

/**
 * Send a message from the chat input bar (Enter handler).
 */
async function sendChatMessage() {
  const inputEl = document.getElementById("chat-input");
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  inputEl.style.height = "auto";
  await sendMessage(text);
}

/**
 * Render an /image or /img user line and generate the image it asks for.
 *
 * `/img` draws fresh from the literal text. `/image` is scene-aware and, when
 * its direction *changes the picture that already exists* ("have it be
 * surrounded by stormy water instead"), edits that picture rather than
 * redrawing from scratch — the picture is sent back as the img2img source, so
 * the subject survives the change. A direction naming a fresh subject ("a man
 * talking to a woman") draws fresh. Which one it is comes from the direction
 * itself, see imageDirectionEdits().
 *
 * `userText` is the raw command line. It is kept in the transcript (and in the
 * LLM's context) because that is what the user typed, but it is filtered back
 * out of any prompt building — a leading command is an instruction to this
 * app, not something the image model should be asked to draw.
 *
 * @param {string} userText The raw command line
 * @param {{prompt:string, raw:boolean}} command From parseImageCommand()
 */
async function sendImagePrompt(userText, command) {
  if (!currentChatId) startNewChat();
  registerCurrentChat();
  showChatView();

  chatHistory.push({ role: "user", content: userText });
  resetIdleTimer();

  const messagesEl = document.getElementById("messages");
  const userDiv = document.createElement("div");
  userDiv.className = "message user";
  userDiv.textContent = userText;
  messagesEl.appendChild(userDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  safeSetItem(STORAGE_KEY_PREFIX + currentChatId, JSON.stringify(chatHistory));

  await runImagePrompt(command);

  document.getElementById("chat-input")?.focus();
}

/**
 * Run the image pipeline for a command line that is already in chatHistory.
 *
 * Split out of sendImagePrompt() so an edited /image (or /img) line can be
 * re-run against the same transcript slot: editing a prompt means "do that
 * again with these words", which for an image command is a diffusion pass,
 * not a chat reply.
 *
 * @param {{prompt:string, raw:boolean}} command From parseImageCommand()
 * @returns {Promise<void>}
 */
async function runImagePrompt(command) {
  try {
    const file = getStoryFile(currentChatId);

    // Does this direction change the picture that already exists (an edit), or
    // name a new subject (a fresh draw)?
    const picture = typeof storyPicture === "function" ? storyPicture() : null;
    const wantsEdit =
      !command.raw &&
      !!picture &&
      typeof imageDirectionEdits === "function" &&
      imageDirectionEdits(command.prompt);
    const hasProse =
      typeof storyMomentLines === "function" && storyMomentLines().length > 0;

    // /img takes the text as the prompt. /image asks the chat model to read
    // the scene and compose one — worth it when there is a scene to read or a
    // picture to keep; with neither, the text is already the whole prompt.
    const prompt =
      command.raw || !(hasProse || wantsEdit)
        ? command.prompt
        : await buildStoryImagePrompt({
            direction: command.prompt,
            edit: wantsEdit,
          });

    const opts = { seed: file ? file.seed : undefined };

    // An edit sends the picture being edited back as the img2img source.
    if (wantsEdit && typeof getImage === "function") {
      const record = await getImage(picture.id).catch(() => null);
      if (record && record.dataUrl) {
        opts.initImage = record.dataUrl;
        opts.denoise = imageParams.editDenoise;
        opts.editOf = picture.id;
      }
    }

    await generateImageMessage(prompt, opts);
  } catch (err) {
    showToast(err.message || String(err), "error");
  }
}

/**
 * Handle Enter key in chat input (send on Enter, newline on Shift+Enter).
 * @param {KeyboardEvent} e
 */
function handleChatKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
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
    var charNames = (storyConfig.characters || [])
      .map(function (c) {
        return c.name;
      })
      .filter(Boolean)
      .join(", ");
    const storyContext =
      currentMode === "story" && (storyConfig.scene || charNames)
        ? '[Story: scene="' +
          storyConfig.scene +
          '", characters="' +
          charNames +
          '"] '
        : "";
    const summaryPrompt =
      storyContext +
      "Summarize the conversation above into a concise paragraph. Keep all key facts, decisions, and context. Output ONLY the summary.";
    const msgs = chatHistory.slice(0, -1);
    msgs.push({ role: "user", content: summaryPrompt });

    const payload = {
      model: selectedModel || undefined,
      messages: msgs,
      temperature: 0.3,
      stream: false,
    };
    addThinkingControl(payload);
    const response = await fetchApi(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const summary = stripThinkTags(
      data.choices?.[0]?.message?.content || "",
    );

    if (summary) {
      const oldLength = chatHistory.length;
      const oldAsstIdx = oldLength - 1;
      const lastExchange = chatHistory.slice(-2);
      var charNames = (storyConfig.characters || [])
        .map(function (c) {
          return c.name;
        })
        .filter(Boolean)
        .join(", ");
      const storyPrefix =
        currentMode === "story" && (storyConfig.scene || charNames)
          ? '[Story context: scene="' +
            storyConfig.scene +
            '", characters="' +
            charNames +
            '"]\n'
          : "";
      chatHistory = [
        {
          role: "assistant",
          content: `${storyPrefix}[Previous conversation summary: ${summary}]`,
        },
        ...lastExchange,
      ];

      // Remap generation store/index keys to new indices (asstN at oldLength-1 → 2)
      const newStore = {};
      const newIdx = {};
      if (generationStore[oldAsstIdx])
        newStore[2] = generationStore[oldAsstIdx];
      if (generationIdx[oldAsstIdx] !== undefined)
        newIdx[2] = generationIdx[oldAsstIdx];
      generationStore = newStore;
      generationIdx = newIdx;
      saveGenerations();

      safeSetItem(
        STORAGE_KEY_PREFIX + currentChatId,
        JSON.stringify(chatHistory),
      );
      renderMessages();
    }
  } catch (err) {
    console.error("Compression failed:", err);
  }

  disableInputs(false);
}
