const { test, expect } = require('@playwright/test');
const { mockBaseEndpoints, solidPng } = require('./helpers');

/**
 * ComfyUI integration.
 *
 * ComfyUI does not speak the OpenAI image API, so this covers a transport the
 * rest of the app never exercises: a node graph posted to /prompt, a polled
 * /history, and the image collected from /view. All of it is mocked, so the
 * suite passes with no ComfyUI running.
 */

const BASE = 'http://localhost:8188';
const CHECKPOINTS = [
  'realvis_sdxl_fp8.safetensors',
  'waiIllustriousSDXL_v170_hswq_r32_turbo.safetensors'
];

/** A tiny but structurally valid API-format graph with placeholders. */
const TINY_WORKFLOW = JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['1', 1] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%', clip: ['1', 1] } },
  4: {
    class_type: 'EmptyLatentImage',
    inputs: { width: '%width%', height: '%height%', batch_size: 1 }
  },
  5: {
    class_type: 'KSampler',
    inputs: {
      seed: '%seed%',
      steps: '%steps%',
      cfg: '%scale%',
      sampler_name: '%sampler%',
      scheduler: '%scheduler%',
      denoise: '%denoise%',
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['4', 0]
    }
  },
  6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'chatchat' } }
});

/** A 1x1 PNG, so /view returns something the app can turn into a data URL. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Stand up a fake ComfyUI: checkpoint discovery, /prompt, /history and /view.
 * Records the submitted graph so tests can assert on what was posted.
 */
async function mockComfy(page, opts = {}) {
  const seen = { paths: [], graph: null, postBody: null };

  await page.route('**/object_info/CheckpointLoaderSimple', async (route) => {
    seen.paths.push('/object_info/CheckpointLoaderSimple');
    if (opts.checkpointsError) {
      await route.fulfill({ status: 500, body: 'boom' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        CheckpointLoaderSimple: {
          input: { required: { ckpt_name: [opts.checkpoints || CHECKPOINTS] } },
          output: [],
          output_name: []
        }
      })
    });
  });

  await page.route('**/prompt', async (route) => {
    seen.paths.push('/prompt');
    seen.postBody = JSON.parse(route.request().postData());
    seen.graph = seen.postBody.prompt;

    if (opts.promptError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(opts.promptError)
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prompt_id: 'pid-1', number: 1, node_errors: {} })
    });
  });

  await page.route('**/history/*', async (route) => {
    seen.paths.push('/history');
    // First poll returns nothing (still queued), the second returns the result —
    // exercising the polling loop rather than a single-shot read.
    const hits = seen.paths.filter((p) => p === '/history').length;
    if (hits < 2) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        'pid-1': opts.history || {
          outputs: {
            7: { images: [{ filename: 'chatchat_00001_.png', subfolder: '', type: 'output' }] }
          },
          status: { status_str: 'success', completed: true, messages: [] }
        }
      })
    });
  });

  await page.route('**/view?**', async (route) => {
    seen.paths.push('/view');
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: opts.image || PNG_1X1
    });
  });

  return seen;
}

/** Select ComfyUI as the image provider through the real UI. */
async function useComfyUI(page) {
  await page.locator('#config-btn').click();
  await page.locator('#provider-row-image [data-provider-id="comfyui"]').click();
  await expect(
    page.locator('#provider-row-image [data-provider-id="comfyui"]')
  ).toHaveClass(/active/);
}

/** Point the image model at a checkpoint. */
async function pickCheckpoint(page, name) {
  await page.locator('#config-panel .config-panel-close').click();
  await page.locator('#image-model-selector').click();
  await page.locator(`#image-model-dropdown [data-model-id="${name}"]`).click();
}

async function generate(page, text = '/image') {
  await page.locator('#hero-input-text').fill(text);
  await page.locator('#hero-send-btn').click();
}

// ═══════════════════════════════════════════════════════════════════════
// Provider surfacing
// ═══════════════════════════════════════════════════════════════════════

test('ComfyUI is offered as an image-only provider at the root URL', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await page.locator('#config-btn').click();

  const pill = page.locator('#provider-row-image [data-provider-id="comfyui"]');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('ComfyUI');

  await pill.click();
  // No /v1 suffix — ComfyUI serves its API at the root, unlike every other
  // provider in the registry.
  await expect(
    page.locator('#provider-detail-image input[type="text"]').first()
  ).toHaveValue(BASE);

  // It cannot chat, so it must not show up as a text provider.
  await expect(page.locator('#provider-row-text [data-provider-id="comfyui"]')).toHaveCount(0);
});

test('the ComfyUI settings block appears only when ComfyUI is selected', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');
  await page.locator('#config-btn').click();

  await expect(page.locator('#comfy-settings')).toBeHidden();

  await page.locator('#provider-row-image [data-provider-id="comfyui"]').click();
  await expect(page.locator('#comfy-settings')).toBeVisible();
  await expect(page.locator('#comfy-workflow')).toBeVisible();
  await expect(page.locator('#comfy-aspect')).toBeVisible();

  await page.locator('#provider-row-image [data-provider-id="local_image"]').click();
  await expect(page.locator('#comfy-settings')).toBeHidden();
});

// ═══════════════════════════════════════════════════════════════════════
// Checkpoint discovery
// ═══════════════════════════════════════════════════════════════════════

test('the image model list is the checkpoint list from object_info', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await page.locator('#config-panel .config-panel-close').click();

  await page.locator('#image-model-selector').click();
  for (const name of CHECKPOINTS) {
    await expect(page.locator(`#image-model-dropdown [data-model-id="${name}"]`)).toBeVisible();
  }
  // The targeted single-node endpoint, not the ~2MB full /object_info.
  expect(seen.paths).toContain('/object_info/CheckpointLoaderSimple');
});

test('a broken checkpoint list reports it without breaking the dropdown', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page, { checkpointsError: true });
  await page.goto('/');
  await useComfyUI(page);
  await page.locator('#config-panel .config-panel-close').click();

  await page.locator('#image-model-selector').click();
  await expect(page.locator('#image-model-dropdown')).toContainText("Can't reach");
});

// ═══════════════════════════════════════════════════════════════════════
// The generation round-trip
// ═══════════════════════════════════════════════════════════════════════

test('an image is posted as a node graph and collected from history and view', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await generate(page, '/img a girl in the rain');

  await expect(page.locator('#messages .message-image img')).toBeVisible();
  await expect.poll(() => seen.graph).not.toBeNull();

  // The transport is the whole point: /prompt, then /history, then /view.
  expect(seen.paths).toContain('/prompt');
  expect(seen.paths.filter((p) => p === '/history').length).toBeGreaterThanOrEqual(2);
  expect(seen.paths).toContain('/view');

  // And it never touched the OpenAI-shaped image endpoint.
  expect(seen.paths).not.toContain('/images/generations');

  // client_id is required for ComfyUI to correlate the job.
  expect(typeof seen.postBody.client_id).toBe('string');
  expect(seen.postBody.client_id.length).toBeGreaterThan(0);
});

test('workflow placeholders are substituted with real JSON types', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img a lone knight');

  await expect.poll(() => seen.graph).not.toBeNull();
  const g = seen.graph;

  // The checkpoint reached the loader — not left as the literal "%model%".
  expect(g['1'].inputs.ckpt_name).toBe(CHECKPOINTS[1]);

  // Numbers must be numbers. A quoted "832" is a validation error in ComfyUI,
  // and this is what makes the quoted "%width%" form in the source workflow
  // work out.
  expect(g['4'].inputs.width).toBe(832);
  expect(g['4'].inputs.height).toBe(1216);
  expect(typeof g['5'].inputs.seed).toBe('number');
  expect(typeof g['5'].inputs.steps).toBe('number');
  expect(g['5'].inputs.cfg).toBe(1);

  // Text kept its quotes and carried the prompt.
  expect(g['2'].inputs.text).toContain('knight');
  expect(g['2'].inputs.text).not.toContain('%prompt%');
  expect(g['3'].inputs.text).toContain('worst quality');

  // No placeholder survived anywhere.
  expect(JSON.stringify(g)).not.toMatch(/%[a-z_]+%|%[a-z_]+%/);
});

test('the per-chat locked seed is used for the generation', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await generate(page, '/img first');
  await expect.poll(() => seen.graph).not.toBeNull();
  const firstSeed = seen.graph['5'].inputs.seed;

  // A second generation in the same chat must reuse the seed, so the
  // character keeps the same look instead of being rerolled each time.
  seen.graph = null;
  await page.locator('#chat-input').fill('/img second');
  await page.locator('#chat-send-btn').click();
  await expect.poll(() => seen.graph).not.toBeNull();

  expect(seen.graph['5'].inputs.seed).toBe(firstSeed);
  expect(Number.isInteger(firstSeed)).toBe(true);
});

test('a different chat gets a different locked seed', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await generate(page, '/img first');
  await expect.poll(() => seen.graph).not.toBeNull();
  const firstSeed = seen.graph['5'].inputs.seed;

  await page.locator('.btn-new-chat').click();
  // Reset first: otherwise the poll below passes instantly on the *previous*
  // generation's graph and this compares a seed with itself.
  seen.graph = null;
  await generate(page, '/img second');
  await expect.poll(() => seen.graph).not.toBeNull();

  // Seeds are per chat, not global — otherwise every chat would share a look.
  expect(seen.graph['5'].inputs.seed).not.toBe(firstSeed);
});

test('the aspect preset drives width and height', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await page.locator('#config-btn').click();
  await page.locator('#comfy-aspect').selectOption('CINEMA');
  await page.locator('#config-panel .config-panel-close').click();
  await generate(page, '/img wide');

  await expect.poll(() => seen.graph).not.toBeNull();
  expect(seen.graph['4'].inputs.width).toBe(1536);
  expect(seen.graph['4'].inputs.height).toBe(640);
});

test('the CFG and negative prompt settings reach the graph', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await page.locator('#config-btn').click();
  await page.locator('#comfy-negative-prompt').fill('ugly, deformed');
  await page.locator('#comfy-negative-prompt').blur();
  await page.locator('#comfy-cfg').fill('2.5');
  await page.locator('#config-panel .config-panel-close').click();
  await generate(page, '/img something');

  await expect.poll(() => seen.graph).not.toBeNull();
  expect(seen.graph['3'].inputs.text).toBe('ugly, deformed');
  expect(seen.graph['5'].inputs.cfg).toBe(2.5);
});

// ═══════════════════════════════════════════════════════════════════════
// Error reporting
// ═══════════════════════════════════════════════════════════════════════

test('a rejected graph names the offending node and field', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page, {
    promptError: {
      error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
      node_errors: {
        1: {
          errors: [
            {
              type: 'value_not_in_list',
              message: 'Value not in list',
              details: "ckpt_name: 'nope.safetensors' not in ['a.safetensors']",
              extra_info: { input_name: 'ckpt_name' }
            }
          ]
        }
      }
    }
  });
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);

  await generate(page, '/img anything');

  const msg = page.locator('#messages .loading-indicator, #messages .message').last();
  await expect(msg).toContainText('ckpt_name');
  await expect(msg).toContainText('Value not in list');
});

test('a workflow that fails while running explains the node', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page, {
    history: {
      outputs: {},
      status: {
        status_str: 'error',
        completed: true,
        messages: [
          [
            'execution_error',
            {
              node_id: 5,
              node_type: 'KSampler',
              exception_message: 'CUDA out of memory'
            }
          ]
        ]
      }
    }
  });
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img anything');

  const msg = page.locator('#messages .message').last();
  await expect(msg).toContainText('CUDA out of memory');
  await expect(msg).toContainText('KSampler');
});

test('a graph with no image output node is reported clearly', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page, {
    history: {
      outputs: { 6: { value: 'something not an image' } },
      status: { status_str: 'success', completed: true, messages: [] }
    }
  });
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img anything');

  await expect(page.locator('#messages .message').last()).toContainText('SaveImage');
});

// ═══════════════════════════════════════════════════════════════════════
// Custom (pasted) workflows
// ═══════════════════════════════════════════════════════════════════════

test('a pasted workflow overrides the bundled one and is used verbatim', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);

  await page.locator('#comfy-workflow-json').fill(TINY_WORKFLOW);
  await page.locator('#comfy-workflow-json').blur();
  await expect(page.locator('#comfy-workflow-status, #comfy-workflow-hint').first()).toBeVisible();
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img from the pasted workflow');

  await expect.poll(() => seen.graph).not.toBeNull();
  expect(Object.keys(seen.graph)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(seen.graph['7'].class_type).toBe('SaveImage');
  expect(seen.graph['2'].inputs.text).toContain('pasted workflow');
});

test('clearing a pasted workflow falls back to the bundled picker', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);

  await page.locator('#comfy-workflow-json').fill(TINY_WORKFLOW);
  await page.locator('#comfy-workflow-json').blur();
  await expect(page.locator('#comfy-workflow')).toBeDisabled();

  await page.locator('#comfy-workflow-clear').click();
  await expect(page.locator('#comfy-workflow-json')).toHaveValue('');
  await expect(page.locator('#comfy-workflow')).toBeEnabled();
});

test('an editor-format workflow is rejected with the export instructions', async ({ page }) => {
  await mockBaseEndpoints(page);
  await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);

  // ComfyUI's UI export: a {nodes:[], links:[]} document. Pasting this instead
  // of the API export is the single most likely mistake.
  await page.locator('#comfy-workflow-json').fill(
    JSON.stringify({ last_node_id: 7, nodes: [{ id: 1, type: 'KSampler' }], links: [] })
  );
  await page.locator('#comfy-workflow-json').blur();
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img x');

  await expect(page.locator('#messages .message').last()).toContainText('Export (API)');
});

test('invalid JSON is rejected rather than sent', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockComfy(page);
  await page.goto('/');
  await useComfyUI(page);

  await page.locator('#comfy-workflow-json').fill('{ not json');
  await page.locator('#comfy-workflow-json').blur();
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img x');

  await expect(page.locator('#messages .message').last()).toContainText('not valid JSON');
  expect(seen.paths).not.toContain('/prompt');
});

// ═══════════════════════════════════════════════════════════════════════
// Image layout
// ═══════════════════════════════════════════════════════════════════════

/**
 * A portrait image must not overflow the transcript.
 *
 * ComfyUI is the first provider here that produces non-square images by
 * default, and a 832x1216 portrait at full content width rendered ~994px tall
 * inside a ~614px transcript — the bottom of the picture sat below the fold,
 * with the scroll never following it there because the scroll ran before the
 * <img> had decoded. Both halves of that are regression-tested here.
 */
test('a tall portrait image fits the transcript instead of overflowing it', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await mockComfy(page, { image: solidPng(832, 1216) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await useComfyUI(page);
  await pickCheckpoint(page, CHECKPOINTS[1]);
  await generate(page, '/img a portrait');

  const img = page.locator('#messages .message-image img');
  await expect(img).toBeVisible();
  await page.waitForTimeout(500);

  const m = await page.evaluate(() => {
    const el = document.querySelector('#messages .message-image img');
    const sc = document.getElementById('messages');
    const i = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    return {
      natural: el.naturalWidth + 'x' + el.naturalHeight,
      renderedH: Math.round(i.height),
      clippedBelowBy: Math.round(i.bottom - s.bottom),
      distanceFromBottom: Math.round(
        sc.scrollHeight - sc.scrollTop - sc.clientHeight
      )
    };
  });

  expect(m.natural).toBe('832x1216');
  // Scaled down rather than rendered at natural height.
  expect(m.renderedH).toBeLessThan(1216);
  // Nothing of the image hidden below the transcript's bottom edge.
  expect(m.clippedBelowBy).toBeLessThanOrEqual(0);
  // And the transcript followed the image to the bottom as it decoded.
  expect(m.distanceFromBottom).toBeLessThanOrEqual(40);
});

// ═══════════════════════════════════════════════════════════════════════
// Placeholder substitution unit coverage
// ═══════════════════════════════════════════════════════════════════════

/**
 * Every bundled workflow must survive substitution.
 *
 * This is the test that matters most here, because the two placeholder
 * conventions are easy to get subtly wrong in a way that only shows up on the
 * workflows you did not happen to try. Substituting the braces of a quoted
 * `"{{WIDTH}}"` while leaving its quotes behind yields `""832""` — invalid
 * JSON, and every ComfyInject-style workflow fails at once while the
 * SillyTavern-style default keeps working.
 */
test('every bundled workflow substitutes into a valid graph', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const results = await page.evaluate(() => {
    const NUMERIC = ['width', 'height', 'seed', 'steps', 'cfg', 'denoise'];
    const list =
      typeof COMFY_BUILTIN_WORKFLOWS === 'undefined' ? [] : COMFY_BUILTIN_WORKFLOWS;

    return list.map((w) => {
      try {
        const vars = comfyVars('1girl, standing in the rain', 424242);
        const graph = JSON.parse(substituteComfyWorkflow(w.workflow, vars));

        const leftovers = (JSON.stringify(graph).match(/%[a-z_]+%|\{\{[A-Z_]+\}\}/g) || []).slice(0, 5);

        // A numeric field that came through as a string is a validation error
        // in ComfyUI, so check the type rather than just the value.
        const wrongType = [];
        for (const [id, node] of Object.entries(graph)) {
          for (const field of NUMERIC) {
            const v = node.inputs && node.inputs[field];
            if (v !== undefined && typeof v !== 'number') {
              wrongType.push(`${id}.${field}=${JSON.stringify(v)}`);
            }
          }
        }
        return {
          id: w.id,
          style: w.style,
          ok: true,
          nodes: Object.keys(graph).length,
          leftovers,
          wrongType: wrongType.slice(0, 5),
        };
      } catch (err) {
        return { id: w.id, ok: false, error: err.message.slice(0, 200) };
      }
    });
  });

  expect(results.length).toBeGreaterThan(0);
  // Both conventions must actually be represented, or this proves little.
  expect([...new Set(results.map((r) => r.style))].sort()).toEqual(['comfyinject', 'st']);

  expect(results.filter((r) => !r.ok)).toEqual([]);
  expect(results.filter((r) => r.leftovers.length)).toEqual([]);
  expect(results.filter((r) => r.wrongType.length)).toEqual([]);
  for (const r of results) expect(r.nodes).toBeGreaterThan(0);
});

test('substitution handles both placeholder conventions and reports gaps', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const result = await page.evaluate(() => {
    const vars = { prompt: 'a "quoted" prompt', width: 832, seed: 7 };

    const st = substituteComfyWorkflow(
      '{"text": "%prompt%", "width": "%width%", "seed": "%seed%"}',
      vars
    );
    const ci = substituteComfyWorkflow(
      '{"text": "{{POSITIVE_PROMPT}}", "width": "{{WIDTH}}", "seed": "{{SEED}}"}',
      vars
    );

    let gap = null;
    try {
      substituteComfyWorkflow('{"x": "%char_avatar%"}', vars);
    } catch (e) {
      gap = e.message;
    }
    return { st, ci, gap, stParsed: JSON.parse(st), ciParsed: JSON.parse(ci) };
  });
  // The quoted form must survive escaping and stay a number where it was one.
  expect(result.stParsed.text).toBe('a "quoted" prompt');
  expect(result.stParsed.width).toBe(832);
  expect(result.stParsed.seed).toBe(7);

  // ComfyInject's spelling maps onto the same values.
  expect(result.ciParsed.text).toBe('a "quoted" prompt');
  expect(result.ciParsed.width).toBe(832);
  expect(result.ciParsed.seed).toBe(7);

  // An unmapped placeholder names itself instead of reaching ComfyUI as text.
  expect(result.gap).toContain('%char_avatar%');
});
