/**
 * Shared mock helpers for the smoke suite.
 *
 * Every network call the app makes is stubbed here. The suite must pass with
 * no LM Studio running, no llama.cpp server, and no API key — a test that
 * needs a live backend does not belong in this repo.
 */

/**
 * Install network mocks that let the app boot and operate with no backend.
 * Every test calls this in a beforeEach, then adds route overrides as needed.
 * @param {import('@playwright/test').Page} page
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
 * @param {import('@playwright/test').Page} page
 * @param {string} content
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
 * @param {import('@playwright/test').Page} page
 */
async function mockImageGeneration(page) {
  await page.route('**/api/v1/images/generations', async (route) => {
    // 1-pixel PNG base64
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ b64_json: png }] })
    });
  });
}

/**
 * Capture the next chat-completion request body and answer it with `content`.
 *
 * The returned object's `body` is filled once the request arrives — use
 * `await expect.poll(() => captured.body).not.toBeNull()` before asserting,
 * since the app streams in the background.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} content
 * @returns {{body: object|null}}
 */
const zlib = require('zlib');

/**
 * Neutralise the synced card manifest (cards/cards.js) for the duration of a test.
 *
 * js/cards.js reads `window.CHATCHAT_CARDS` lazily, so replacing the module
 * itself with an empty library gives the test complete control over what cards
 * exist. Tests that import or hand-write their own cards need this: without it
 * the app is one card library plus whatever the test seeded, and assertions
 * like "the picker lists one card" silently depend on whether sync-cards has
 * ever been run on this machine.
 * @param {import('@playwright/test').Page} page
 */
async function mockEmptyCardLibrary(page) {
  await page.route('**/cards/cards.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.CHATCHAT_CARDS = [];' + String.fromCharCode(10)
    });
  });
}

function captureChatRequest(page, content) {
  const captured = { body: null, bodies: [] };
  page.route('**/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    // Only streaming requests are the assistant reply. The app also makes
    // one-shot non-streaming calls to summarise a scene, lock character
    // appearances, fold a turn into the per-chat scene record, and compress
    // history. Recording one of those would silently swap the request under
    // assertion for a helper call, which reads like the app sending the wrong
    // prompt. The last streaming request wins, so regenerate still asserts on
    // what was actually sent.
    if (body.stream === true) {
      captured.body = body;
      captured.bodies.push(body);
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        choices: [{ delta: { content: content } }]
      })}\n\ndata: [DONE]\n\n`
    });
  });
  return captured;
}

/** CRC32, as PNG chunks require. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

/**
 * Build a real PNG of the given size, filled with one colour.
 *
 * Tests need an image whose *intrinsic dimensions* are known, because the
 * layout rule under test is about aspect ratio — a 1x1 placeholder cannot
 * expose a portrait image overflowing the transcript.
 * @param {number} width
 * @param {number} height
 * @param {[number,number,number]} [rgb]
 * @returns {Buffer}
 */
function solidPng(width, height, rgb) {
  const [r, g, b] = rgb || [40, 80, 160];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = {
  mockBaseEndpoints,
  mockChatCompletion,
  mockImageGeneration,
  captureChatRequest,
  mockEmptyCardLibrary,
  solidPng
};
