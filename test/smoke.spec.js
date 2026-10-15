const { test, expect } = require('@playwright/test');
const {
  mockBaseEndpoints,
  mockChatCompletion,
  mockImageGeneration
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════
// Existing hero-view tests (unchanged)
// ═══════════════════════════════════════════════════════════════════════

test('app loads and shows hero view', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await expect(page.locator('#hero-region')).toBeVisible();
  await expect(page.locator('#hero-placeholder')).toBeHidden();
  await expect(page.locator('#hero-input-text')).toBeVisible();
});

test('clicking hero input reveals textarea and accepts input', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await page.locator('#hero-input-box').click();
  await expect(page.locator('#hero-input-text')).toBeVisible();
  await page.locator('#hero-input-text').fill('Hello, world');
  await expect(page.locator('#hero-input-text')).toHaveValue('Hello, world');
});

test('prompt chips are visible in hero view', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await expect(page.locator('#prompt-chips')).toBeVisible();
  await expect(page.locator('#prompt-chips .prompt-chip')).toHaveCount(4);
});

test('hero send button is visible', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await expect(page.locator('#hero-send-btn')).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════
// New: chat transcript rendering
// ═══════════════════════════════════════════════════════════════════════

test('sending a message renders user and assistant bubbles', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockChatCompletion(page, 'This is a **mocked** response with `code`.');

  await page.goto('/');

  // Type and send a message from the hero
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Hello, computer');
  await page.locator('#hero-send-btn').click();

  // Chat view should now be visible
  await expect(page.locator('#messages')).toBeVisible();
  await expect(page.locator('#chat-input-bar')).toBeVisible();

  // User message bubble
  const userMsg = page.locator('#messages .message.user');
  await expect(userMsg).toBeVisible();
  await expect(userMsg).toContainText('Hello, computer');

  // Assistant message bubble with rendered markdown
  const asstMsg = page.locator('#messages .message.assistant');
  await expect(asstMsg).toBeVisible();
  await expect(asstMsg).toContainText('mocked');

  // Bold markdown rendered as <strong>
  await expect(asstMsg.locator('strong')).toContainText('mocked');

  // Inline code rendered as <code>
  await expect(asstMsg.locator('code')).toContainText('code');

  // Message toolbar is present on the assistant bubble
  await expect(asstMsg.locator('.msg-toolbar')).toBeVisible();
});

test('sending a message persists chat in localStorage', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockChatCompletion(page, 'Response text');

  await page.goto('/');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Store me');
  await page.locator('#hero-send-btn').click();

  // Wait for assistant bubble to render
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // Give the finally block a tick to flush localStorage writes
  await page.waitForTimeout(200);

  // Verify localStorage was written (chat_index + chat_<id>)
  const state = await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('chat_index') || '[]');
    if (!index.length) return { error: 'no chat index' };
    const chatId = index[index.length - 1];
    const history = JSON.parse(localStorage.getItem('chat_' + chatId) || '[]');
    return { chatCount: index.length, messageCount: history.length };
  });

  expect(state.chatCount).toBe(1);
  expect(state.messageCount).toBe(2); // user + assistant
});

// ═══════════════════════════════════════════════════════════════════════
// New: sidebar chat CRUD
// ═══════════════════════════════════════════════════════════════════════

test('sidebar creates, lists, switches, and deletes chats', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockChatCompletion(page, 'First chat reply');

  await page.goto('/');

  // ── Create chat 1 ──
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Message in chat 1');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // Sidebar should show one entry
  const chatRows = page.locator('#sidebar-chat-list .sidebar-row.chat-entry');
  await expect(chatRows).toHaveCount(1);

  // ── New chat ──
  await page.locator('.btn-new-chat').click();
  await expect(page.locator('#hero-region')).toBeVisible();

  await mockChatCompletion(page, 'Second chat reply');
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Message in chat 2');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // Two chats in sidebar
  await expect(chatRows).toHaveCount(2);

  // ── Switch back to first chat ──
  // Sidebar renders newest first, so nth(1) is the older "chat 1"
  await chatRows.nth(1).click();
  await page.waitForTimeout(100);
  // The first chat's messages should contain "chat 1"
  await expect(page.locator('#messages .message.user').first()).toContainText('chat 1');

  // ── Delete the active chat ──
  const deleteBtn = page.locator('#sidebar-chat-list .sidebar-row.chat-entry.active .sidebar-row-delete').first();
  await deleteBtn.click();

  // Should see undo toast
  await expect(page.locator('#toast-top-container .toast-action')).toBeVisible();

  // One chat remains
  await expect(chatRows).toHaveCount(1);
});

test('sidebar undo restores a deleted chat', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockChatCompletion(page, 'Reply');

  await page.goto('/');

  // Create a chat
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Test message');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // Delete it
  await page.locator('#sidebar-chat-list .sidebar-row.chat-entry .sidebar-row-delete').first().click();

  // Undo via toast action button
  await page.locator('#toast-top-container .toast-action-btn').click();

  // Chat should be back in sidebar
  const chatRows = page.locator('#sidebar-chat-list .sidebar-row.chat-entry');
  await expect(chatRows).toHaveCount(1);
  // And messages should be restored
  await expect(page.locator('#messages .message.user')).toContainText('Test message');
});

// ═══════════════════════════════════════════════════════════════════════
// New: /image command path
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// /image command
// ═══════════════════════════════════════════════════════════════════════
test('/image command generates an image message', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockImageGeneration(page);

  // Mock chat completions: streaming for chat reply, non-streaming for scene summariser
  await page.route('**/v1/chat/completions', async (route) => {
    const req = route.request();
    let body;
    try { body = req.postDataJSON(); } catch (e) { body = null; }

    if (body && body.stream) {
      // Streaming = regular chat reply
      const sse = `data: ${JSON.stringify({
        choices: [{ delta: { content: 'The forest darkens around you.' } }]
      })}\n\ndata: [DONE]\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
    } else {
      // Non-streaming = scene summariser or character discoverer
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: 'a misty forest at twilight, tall ancient trees' } }]
        })
      });
    }
  });

  // Activate NanoGPT with a key before the page's own scripts run, so
  // image generation (which now follows the active provider) is available.
  await page.addInitScript(() => {
    localStorage.setItem('active_provider', 'nanogpt');
    localStorage.setItem('provider_cfg_nanogpt', JSON.stringify({
      baseUrl: 'https://nano-gpt.com/api/v1',
      key: 'test-key-123'
    }));
  });

  await page.goto('/');

  // First send a regular message to set up chat context
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('I walk into the forest');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // Now send /image from the chat input bar
  await page.locator('#chat-input').fill('/image');
  await page.locator('#chat-send-btn').click();

  // Should render an image message (class .message-image is added by renderImageMessage)
  await expect(page.locator('#messages .message-image')).toBeVisible({ timeout: 10000 });

  // The image should contain an <img> element
  const img = page.locator('#messages .message-image img.generated-image');
  await expect(img).toBeVisible();
  // Image should have a data: or blob: src
  await expect(img).toHaveAttribute('src', /data:image/);
});

test('unreachable local image server shows a copy-command toast', async ({ page }) => {
  await mockBaseEndpoints(page);
  // Simulate mlx-omni-server not running: the request never reaches a server.
  await page.route('**/localhost:10240/**', (route) => route.abort('connectionrefused'));

  await page.addInitScript(() => {
    localStorage.setItem('active_image_provider', 'local_image');
  });

  await page.goto('/');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('/img a cup of coffee');
  await page.locator('#hero-send-btn').click();

  const toast = page.locator('#toast-top-container .toast-action-btn', { hasText: 'Copy command' });
  await expect(toast).toBeVisible({ timeout: 10000 });
});

test('text provider presets are listed and switching providers works', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#config-btn').click();
  await expect(page.locator('#config-panel')).toHaveClass(/open/);

  await expect(page.locator('#provider-row-text [data-provider-id="local"]')).toHaveClass(/active/);
  await expect(page.locator('#provider-row-text [data-provider-id="nanogpt"]')).toBeVisible();
  await expect(page.locator('#provider-row-text [data-provider-id="openai"]')).toBeVisible();
  await expect(page.locator('#provider-row-text [data-provider-id="openrouter"]')).toBeVisible();

  await page.locator('#provider-row-text [data-provider-id="openai"]').click();
  await expect(page.locator('#provider-row-text [data-provider-id="openai"]')).toHaveClass(/active/);
  await expect(page.locator('#provider-detail-text input[type="password"]')).toBeVisible();
});

test('text and image providers are selected independently', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#config-btn').click();
  await expect(page.locator('#config-panel')).toHaveClass(/open/);

  // Image provider defaults to Auto and lists the built-in local preset.
  await expect(page.locator('#provider-row-image button', { hasText: 'Auto' })).toHaveClass(/active/);
  await expect(page.locator('#provider-row-image [data-provider-id="local_image"]')).toBeVisible();

  // Switch the text provider to a cloud preset...
  await page.locator('#provider-row-text [data-provider-id="openai"]').click();
  await expect(page.locator('#provider-row-text [data-provider-id="openai"]')).toHaveClass(/active/);

  // ...then pick an explicit image provider — the two must not couple.
  await page.locator('#provider-row-image [data-provider-id="local_image"]').click();
  await expect(page.locator('#provider-row-image [data-provider-id="local_image"]')).toHaveClass(/active/);
  await expect(page.locator('#provider-detail-image input[type="text"]')).toHaveValue('http://localhost:10240/v1');
  await expect(page.locator('#provider-row-text [data-provider-id="openai"]')).toHaveClass(/active/);
});

test('text model selector shows a Hugging Face hint when LM Studio has no models loaded', async ({ page }) => {
  await mockBaseEndpoints(page); // /v1/models already stubbed to return zero models
  await page.goto('/');

  await page.locator('#model-selector').click();
  await expect(page.locator('#model-dropdown')).toContainText('No models loaded in LM Studio');
  await expect(page.locator('#model-dropdown a', { hasText: 'Browse GGUF models on Hugging Face' })).toHaveAttribute('href', /huggingface\.co/);
});

test('image model selector lists models actually available on a local provider', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.route('**/localhost:10240/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'mlx-community/FLUX.1-schnell-4bit' }] })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('active_image_provider', 'local_image');
  });

  await page.goto('/');

  await page.locator('#image-model-selector').click();
  const item = page.locator('#image-model-dropdown .model-dropdown-item', { hasText: 'mlx-community/FLUX.1-schnell-4bit' });
  await expect(item).toBeVisible();

  await item.click();
  await expect(page.locator('#current-image-model-name')).toHaveText('mlx-community/FLUX.1-schnell-4bit');
});

test('image model selector shows a Hugging Face hint when no local models are loaded', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.route('**/localhost:10240/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('active_image_provider', 'local_image');
  });

  await page.goto('/');

  await page.locator('#image-model-selector').click();
  await expect(page.locator('#image-model-dropdown')).toContainText('No models loaded');
  await expect(page.locator('#image-model-dropdown a', { hasText: 'Browse MLX models on Hugging Face' })).toHaveAttribute('href', 'https://huggingface.co/mlx-community');
});

// ═══════════════════════════════════════════════════════════════════════
// Setup guide
// ═══════════════════════════════════════════════════════════════════════

test('the setup guide covers both local text servers and the CORS misreading', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#help-btn').click();
  const help = page.locator('#help-overlay');
  await expect(help).toBeVisible();

  // LM Studio and llama.cpp each get their own section — they need different
  // setup, including the fact that only one of them needs CORS enabled.
  await expect(help).toContainText('Local text chat — LM Studio');
  await expect(help).toContainText('Local text chat — llama.cpp');
  await expect(help).toContainText('Enable CORS');
  await expect(help).toContainText('allows every origin by default');

  // The router invocation is shown verbatim, in a <pre> that must not be the
  // only unstyled element in the modal.
  const cmd = help.locator('pre', { hasText: '--models-preset' });
  await expect(cmd).toBeVisible();

  // The actionable warning about Firefox's misleading console message.
  await expect(help).toContainText('do not read it as proof of a CORS problem');
});

// ═══════════════════════════════════════════════════════════════════════
// Bundled card manifest
// ═══════════════════════════════════════════════════════════════════════

/**
 * The synced card manifest must actually be loaded by the page.
 *
 * cards/cards.js is generated by tools/sync-cards.js and read by js/cards.js from
 * `window.CHATCHAT_CARDS`. It was once generated but never referenced by
 * index.html, which meant the whole bundled-cast feature was inert and the
 * picker silently empty — and nothing failed, because every other test seeds
 * its own cards. This asserts the wiring, not the generator.
 */
test('the bundled card manifest is loaded and its characters are castable', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  // Confirm the manifest reached the page at all.
  const manifestCount = await page.evaluate(() =>
    Array.isArray(window.CHATCHAT_CARDS) ? window.CHATCHAT_CARDS.length : 0
  );
  expect(manifestCount).toBeGreaterThan(0);

  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();

  const grid = page.locator('#cast-grid');
  await expect(grid.locator('.cast-card').first()).toBeVisible();
  await expect(grid).toContainText('Jess');
  await expect(grid).toContainText('Seraphina');
  // ...and the "no cards" hint is not shown over a populated library.
  await expect(page.locator('#cast-empty')).toBeHidden();

  // A card whose id came from the manifest resolves to a real card object.
  const resolved = await page.evaluate(() =>
    (getCardsByIds(['card_14d11rg'])[0] || {}).name || null
  );
  expect(resolved).toBe('Jess');
});

// ═══════════════════════════════════════════════════════════════════════
// /image discoverability
//
// Nothing in the UI used to mention /image at all, so the only way to find it
// was to be told. These pin the affordances that name it.
// ═══════════════════════════════════════════════════════════════════════

test('the hero offers an illustrate affordance that spells out /image', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const chip = page.locator('#hero-image-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('/image');
});

test('the illustrate chip inserts the command instead of sending it', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#hero-image-chip').click();

  // The command is in the box, visible and editable — the point of inserting
  // rather than sending. Still on the hero, nothing sent.
  await expect(page.locator('#hero-input-text')).toHaveValue('/image ');
  await expect(page.locator('#hero-region')).toBeVisible();
});

test('an existing command is never doubled, and a typed subject is kept', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const input = page.locator('#hero-input-text');
  await page.locator('#hero-image-chip').click();
  await page.locator('#hero-image-chip').click();
  await expect(input).toHaveValue('/image ');

  // A subject typed after the command survives a repeat click.
  await input.fill('/image a girl in the rain');
  await page.locator('#hero-image-chip').click();
  await expect(input).toHaveValue('/image a girl in the rain');

  // A subject typed *before* being commanded gets the command hoisted in
  // front, where the parser looks for it.
  await input.fill('a girl in the rain');
  await page.locator('#hero-image-chip').click();
  await expect(input).toHaveValue('/image a girl in the rain');

  // The hand-typed verbatim form is respected rather than replaced.
  await input.fill('/img just this');
  await page.locator('#hero-image-chip').click();
  await expect(input).toHaveValue('/img just this');
});

test('the chat bar offers the same affordance and names /image in the placeholder', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await mockChatCompletion(page);
  await page.goto('/');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('hello');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#chat-input-bar')).toBeVisible();

  await expect(page.locator('#chat-input')).toHaveAttribute(
    'placeholder',
    /\/image/
  );

  await page.locator('#chat-image-btn').click();
  await expect(page.locator('#chat-input')).toHaveValue('/image ');
});

test('the affordances hide in image mode, where every message is already an image', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await expect(page.locator('#hero-image-chip')).toBeVisible();

  await page.locator('#pill-image-mode').click();
  await expect(page.locator('#hero-image-chip')).toBeHidden();
  await expect(page.locator('#chat-image-btn')).toBeHidden();
  await expect(page.locator('#chat-input')).toHaveAttribute(
    'placeholder',
    /Describe the image/
  );

  await page.locator('#pill-chat-mode').click();
  await expect(page.locator('#hero-image-chip')).toBeVisible();
});

test('the illustrate chip is offered in story mode too, where the starter prompts are not', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#pill-story-mode').click();

  // Chat-mode sample prompts are meaningless in story mode and stay hidden...
  await expect(page.locator('#prompt-chips')).toBeHidden();
  // ...but /image works in every mode, so it does not.
  await expect(page.locator('#hero-image-chip')).toBeVisible();

  await page.locator('#hero-image-chip').click();
  await expect(page.locator('#hero-input-text')).toHaveValue('/image ');
});

test('illustrating from the chip reaches the image provider', async ({
  page
}) => {
  await mockImageGeneration(page);
  await mockBaseEndpoints(page);

  // Streaming = chat reply; non-streaming = the scene summariser.
  await page.route('**/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON();
    const content = body && body.stream
      ? 'Rain hammers the window.'
      : 'a girl at a rain-streaked window, warm interior light';
    await route.fulfill(
      body && body.stream
        ? {
            status: 200,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({
              choices: [{ delta: { content } }]
            })}\n\ndata: [DONE]\n\n`
          }
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content } }] })
          }
    );
  });

  await page.addInitScript(() => {
    localStorage.setItem('active_provider', 'nanogpt');
    localStorage.setItem('active_image_provider', 'nanogpt');
    localStorage.setItem(
      'provider_cfg_nanogpt',
      JSON.stringify({
        baseUrl: 'https://nano-gpt.com/api/v1',
        key: 'test-key-123'
      })
    );
  });

  await page.goto('/');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('I sit by the window');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();

  // The whole point: click the chip, press Enter, get a picture.
  await page.locator('#chat-image-btn').click();
  await page.locator('#chat-input').press('Enter');

  await expect(page.locator('#messages .message-image')).toBeVisible({
    timeout: 15000
  });
});
