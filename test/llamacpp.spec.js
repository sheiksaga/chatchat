const { test, expect } = require('@playwright/test');
const { mockBaseEndpoints } = require('./helpers');

/**
 * llama.cpp integration.
 *
 * llama.cpp is a different shape of server from LM Studio and the app has to
 * respect that:
 *
 *  - **No load/unload lifecycle.** Verified against the shipped
 *    `llama-server-impl.dll`: there are zero `models/load` or `models/unload`
 *    route strings. A request naming a model *is* the load — the router spawns
 *    a child server on the first request for that model and proxies to it.
 *  - **Sampler defaults live on the server**, from `--models-preset`, readable
 *    at `GET /props` as `default_generation_settings`. Request-body values win
 *    over them, so the app must read them or it silently clobbers the per-model
 *    tuning the user set up.
 *  - **The props endpoint is at the root**, not under the /v1 prefix.
 *
 * These tests mock all of it, so they pass with no llama.cpp running.
 */

const BASE = 'http://localhost:8081';

/** The two models from the real models-router.ini, plus a vision one. */
const ROUTER_MODELS = [
  { id: 'L3-8B-Stheno-v3.2-Q4_K_M-imat', object: 'model' },
  { id: 'Ministral-Instruct-2410-8B-DPO-RP.Q4_K_M', object: 'model' },
  { id: 'Qwen3.6-35B-A3B-UD-Q4_K_M', object: 'model' }
];

/**
 * Stand up a fake llama.cpp router: model list, /props, and a chat endpoint.
 * Records every request path so tests can assert on what was *not* called.
 */
async function mockLlamaServer(page, { props, propsStatus = 200 } = {}) {
  const seen = { paths: [], chatBody: null };

  await page.route('**/props', async (route) => {
    seen.paths.push('/props');
    if (propsStatus !== 200) {
      await route.fulfill({ status: propsStatus, body: 'nope' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        props === undefined
          ? {
              default_generation_settings: {
                temp: 1.17,
                min_p: 0.075,
                top_k: 50,
                repeat_penalty: 1.05
              }
            }
          : props
      )
    });
  });

  await page.route('**/v1/models', async (route) => {
    seen.paths.push('/v1/models');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: ROUTER_MODELS })
    });
  });

  // Exactly what llama.cpp does NOT have. Any hit here is a bug.
  for (const dead of ['/v1/models/load', '/v1/models/unload']) {
    await page.route(`**${dead}`, async (route) => {
      seen.paths.push(dead);
      await route.fulfill({ status: 404, body: 'not found' });
    });
  }

  await page.route('**/v1/chat/completions', async (route) => {
    seen.paths.push('/v1/chat/completions');
    seen.chatBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`
    });
  });

  return seen;
}

/** Select llama.cpp as the text provider through the real UI. */
async function useLlamaCpp(page) {
  await page.locator('#config-btn').click();
  await page.locator('#provider-row-text [data-provider-id="llama_cpp"]').click();
  await expect(
    page.locator('#provider-row-text [data-provider-id="llama_cpp"]')
  ).toHaveClass(/active/);
  await page.locator('#config-panel .config-panel-close').click();
}

/** Open the model dropdown and pick a model by its id. */
async function pickModel(page, id) {
  await page.locator('#model-selector').click();
  await page.locator(`#model-dropdown [data-model-id="${id}"]`).click();
}

// ═══════════════════════════════════════════════════════════════════════
// Provider presence
// ═══════════════════════════════════════════════════════════════════════

test('llama.cpp is offered as a text provider and excludes image capability', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  await page.locator('#config-btn').click();
  const pill = page.locator('#provider-row-text [data-provider-id="llama_cpp"]');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('llama.cpp');

  await pill.click();
  await expect(pill).toHaveClass(/active/);
  await expect(page.locator('#provider-detail-text input[type="text"]').first()).toHaveValue(
    `${BASE}/v1`
  );

  // llama.cpp has no image endpoint, so it must not appear in the image row.
  await expect(page.locator('#provider-row-image [data-provider-id="llama_cpp"]')).toHaveCount(0);
});

test('the router model list is used verbatim, including dotted ids', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await page.locator('#model-selector').click();
  for (const m of ROUTER_MODELS) {
    await expect(page.locator(`#model-dropdown [data-model-id="${m.id}"]`)).toBeVisible();
  }
  expect(seen.paths).toContain('/v1/models');
});

// ═══════════════════════════════════════════════════════════════════════
// No load/unload lifecycle
// ═══════════════════════════════════════════════════════════════════════

test('selecting a model never calls the load or unload endpoints llama.cpp lacks', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  // Pick two models in a row, so the "unload the previous one" path runs too.
  await pickModel(page, ROUTER_MODELS[0].id);
  await pickModel(page, ROUTER_MODELS[1].id);

  expect(seen.paths).not.toContain('/v1/models/load');
  expect(seen.paths).not.toContain('/v1/models/unload');
  // And the selection stuck.
  await expect(page.locator('#current-model-name')).toHaveText(ROUTER_MODELS[1].id);
});

test('the eject button is hidden on llama.cpp because unload does not exist', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  // A control that fires a 404 and leaves the model resident is worse than no
  // control at all.
  await expect(page.locator('#btn-eject')).toBeHidden();
});

test('the first reply on an on-demand server warns that loading takes time', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  await expect(page.locator('#toast-container')).toContainText('first reply');
});

// ═══════════════════════════════════════════════════════════════════════
// Samplers from /props
// ═══════════════════════════════════════════════════════════════════════

test('picking a model adopts the samplers the server was launched with', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  expect(seen.paths).toContain('/props');

  // The temperature slider follows the server, so the UI shows the truth.
  await expect(page.locator('#temperature')).toHaveValue('1.17');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Hello');
  await page.locator('#hero-send-btn').click();

  await expect.poll(() => seen.chatBody).not.toBeNull();
  const body = seen.chatBody;
  // Without this the request body silently overrides --models-preset.
  expect(body.temperature).toBe(1.17);
  expect(body.min_p).toBe(0.075);
  expect(body.top_k).toBe(50);

  // The selected model is echoed exactly as the router named it.
  expect(body.model).toBe(ROUTER_MODELS[0].id);
});

test('props samplers are cached rather than re-probed on every selection', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  await pickModel(page, ROUTER_MODELS[1].id);
  await pickModel(page, ROUTER_MODELS[0].id);

  const propsCalls = seen.paths.filter((p) => p === '/props').length;
  // Two distinct models were probed; the third selection hit the cache.
  expect(propsCalls).toBe(2);
});

test('a missing or broken /props degrades to no profile instead of breaking selection', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await mockLlamaServer(page, { propsStatus: 500 });
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);

  // Selection still works...
  await expect(page.locator('#current-model-name')).toHaveText(ROUTER_MODELS[0].id);
  // ...and the request is still well-formed, just without the optional params.
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Hello');
  await page.locator('#hero-send-btn').click();
  await expect(page.locator('#messages .message.assistant')).toBeVisible();
});

test('a /props payload with no generation settings is treated as no profile', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page, { props: { build_info: 'x' } });
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Hello');
  await page.locator('#hero-send-btn').click();

  await expect.poll(() => seen.chatBody).not.toBeNull();
  // No NaN, no undefined leaking into the body.
  expect(seen.chatBody.min_p).toBeUndefined();
  expect(seen.chatBody.top_k).toBeUndefined();
});

test('switching away from llama.cpp does not leave stale props samplers behind', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockLlamaServer(page);
  await page.goto('/');
  await useLlamaCpp(page);

  await pickModel(page, ROUTER_MODELS[0].id);
  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('one');
  await page.locator('#hero-send-btn').click();
  await expect.poll(() => seen.chatBody).not.toBeNull();
  expect(seen.chatBody.min_p).toBe(0.075);

  // Back to LM Studio, which reports no profile for this model.
  await page.locator('#config-btn').click();
  await page.locator('#provider-row-text [data-provider-id="local"]').click();
  await page.locator('#config-panel .config-panel-close').click();
  await page.locator('#model-selector').click();
  await page.locator(`#model-dropdown [data-model-id="${ROUTER_MODELS[0].id}"]`).click();

  seen.chatBody = null;
  await page.locator('#chat-input').fill('two');
  await page.locator('#chat-send-btn').click();
  await expect.poll(() => seen.chatBody).not.toBeNull();
  // min_p was a llama.cpp preset value; it must not follow us to another server.
  expect(seen.chatBody.min_p).toBeUndefined();
});
