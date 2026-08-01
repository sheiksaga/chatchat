const { test, expect } = require('@playwright/test');

// ── Shared mock helpers ────────────────────────────────────────────────

/**
 * Install network mocks that let the app boot and operate with no LM Studio
 * running and no API key. Every test calls this in a beforeEach, then adds
 * route-specific overrides as needed.
 */
async function mockBaseEndpoints(page) {
  // /v1/models — health check and model list
  await page.route('**/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    });
  });

  // /v1/models/load, /v1/models/unload — no-ops
  await page.route('**/v1/models/load', async (route) => {
    await route.fulfill({ status: 200, body: 'ok' });
  });
  await page.route('**/v1/models/unload', async (route) => {
    await route.fulfill({ status: 200, body: 'ok' });
  });
}

/**
 * Stub a streaming chat completion that returns `content` in one chunk,
 * then [DONE].
 */
async function mockChatCompletion(page, content) {
  await page.route('**/v1/chat/completions', async (route) => {
    const body = `data: ${JSON.stringify({
      choices: [{ delta: { content: content } }]
    })}\n\ndata: [DONE]\n\n`;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: body
    });
  });
}

/**
 * Stub the NanoGPT image generation endpoint to return a small inline PNG.
 */
async function mockImageGeneration(page) {
  await page.route('**/api/v1/images/generations', async (route) => {
    // 1-pixel PNG base64
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ b64_json: png }]
      })
    });
  });
}

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
