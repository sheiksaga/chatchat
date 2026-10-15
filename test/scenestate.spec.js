const { test, expect } = require('@playwright/test');
const { mockBaseEndpoints } = require('./helpers');

/**
 * Per-chat scene state (js/scenestate.js).
 *
 * The record is produced by a language model, so the tests that matter most are
 * the ones about bad output: prose instead of JSON, code fences, trailing
 * commas, an update that forgets a character, an update that forgets a field.
 * None of it may stop an image being generated.
 */

/** Stub the one-shot scene-update call, and record what was asked. */
async function mockSceneModel(page, { reply, replyFn } = {}) {
  const seen = { prompts: [], bodies: [] };
  await page.route('**/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    // The streaming path is the assistant reply, handled elsewhere.
    if (body.stream === true) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`
      });
      return;
    }
    seen.bodies.push(body);
    seen.prompts.push((body.messages || []).map((m) => m.content).join('\n'));
    const content = typeof replyFn === 'function' ? replyFn(seen) : reply;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] })
    });
  });
  return seen;
}

/**
 * Put a cast chat in localStorage and switch into it.
 *
 * The app boots on the hero view with no current chat, so the switch is part of
 * the setup — without it nothing has a chat id and no tracking happens at all.
 * `card_14d11rg` is the Jess card in the bundled manifest.
 */
async function seedCastChat(page, opts = {}) {
  await page.addInitScript(
    ([cast, history, scene]) => {
      const chatId = 'scene-chat';
      localStorage.setItem('chat_index', JSON.stringify([chatId]));
      localStorage.setItem(
        'chat_meta',
        JSON.stringify({
          [chatId]: {
            createdAt: Date.now(),
            lastMode: 'story',
            storyConfig: { style: 'character', castIds: cast }
          }
        })
      );
      if (scene) localStorage.setItem('chat_scene_' + chatId, scene);
      localStorage.setItem(
        'chat_' + chatId,
        JSON.stringify(history || [
          { role: 'user', content: 'Jess steps in from the rain.' },
          { role: 'assistant', content: '*She shivers.* "It is pouring."', name: 'Jess' }
        ])
      );
      localStorage.setItem('active_provider', 'local');
      localStorage.setItem('selectedModel', 'test-model');
    },
    [opts.cast || ['card_14d11rg'], opts.history, opts.scene]
  );
  await page.goto('/');
  await page.evaluate(() => switchChat('scene-chat'));
}

const RICH_STATE = JSON.stringify({
  scene: 'a rain-soaked neon street, late evening',
  present: ['Jess'],
  characters: {
    jess: {
      name: 'Jess',
      clothing: 'white sundress, soaked through',
      state: 'shivering, hair plastered to her face'
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Parsing whatever the model actually returns
// ═══════════════════════════════════════════════════════════════════════

test('scene JSON is extracted from fenced, padded and sloppy replies', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const out = await page.evaluate(() => {
    const good = '{"scene":"a","present":["Jess"],"characters":{"jess":{"name":"Jess"}}}';
    const cases = {
      plain: good,
      fenced: '```json\n' + good + '\n```',
      preamble: 'Sure! Here is the updated record:\n' + good,
      trailingProse: good + '\n\nLet me know if you need anything else.',
      trailingComma: '{"scene":"a","present":["Jess",],"characters":{}}',
      nestedBraces: '{"scene":"a {b} c","present":[],"characters":{}}',
      prose: 'I updated the scene for you.',
      empty: '',
      array: '[1,2,3]'
    };
    const result = {};
    for (const [name, raw] of Object.entries(cases)) {
      const parsed = parseSceneStateJSON(raw);
      result[name] = parsed ? { scene: parsed.scene, present: parsed.present } : null;
    }
    return result;
  });

  expect(out.plain.scene).toBe('a');
  expect(out.fenced.scene).toBe('a');
  expect(out.preamble.scene).toBe('a');
  expect(out.trailingProse.scene).toBe('a');
  expect(out.trailingComma.scene).toBe('a');
  expect(out.nestedBraces.scene).toBe('a {b} c');
  // Nothing usable — the caller keeps what it had.
  expect(out.prose).toBeNull();
  expect(out.empty).toBeNull();
  expect(out.array).toBeNull();
});

test('an update cannot inject junk, overlong text or unbounded characters', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const state = await page.evaluate(() => {
    const characters = {};
    for (let i = 0; i < 50; i++) characters['c' + i] = { name: 'C' + i, clothing: 'x' };
    const incoming = {
      scene: 'y'.repeat(5000),
      present: Array.from({ length: 50 }, (_, i) => 'P' + i),
      characters,
      throughIndex: 'not a number',
      updatedAt: {}
    };
    const normalized = normalizeSceneState(
      Object.assign({}, incoming, { throughIndex: incoming.throughIndex })
    );
    return {
      sceneLen: normalized.scene.length,
      presentLen: normalized.present.length,
      charCount: Object.keys(normalized.characters).length,
      throughIndex: normalized.throughIndex
    };
  });

  expect(state.sceneLen).toBeLessThanOrEqual(400);
  expect(state.presentLen).toBeLessThanOrEqual(12);
  expect(state.charCount).toBeLessThanOrEqual(12);
  // A garbage index must not be mistaken for "up to date".
  expect(state.throughIndex).toBe(-1);
});

test('normalize drops non-object characters and invents shells for the present', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const state = await page.evaluate(() => {
    const s = normalizeSceneState({
      scene: 'a room',
      present: ['Jess', 'Maya'],
      characters: { jess: { name: 'Jess', clothing: 'a coat' }, bad: 'not an object', 7: null }
    });
    return {
      keys: Object.keys(s.characters).sort(),
      maya: s.characters.maya,
      jess: s.characters.jess
    };
  });

  expect(state.keys).toEqual(['jess', 'maya']);
  expect(state.jess.clothing).toBe('a coat');
  // Maya is present but the update said nothing about her — she must still
  // carry a name, or she would vanish from the prompt.
  expect(state.maya.name).toBe('Maya');
});

// ═══════════════════════════════════════════════════════════════════════
// Merging
// ═══════════════════════════════════════════════════════════════════════

test('omitted fields carry forward, omitted characters do not', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const out = await page.evaluate(() => {
    const prev = normalizeSceneState({
      scene: 'a bar',
      present: ['Jess', 'Maya'],
      characters: {
        jess: { name: 'Jess', clothing: 'a red dress', state: 'laughing' },
        maya: { name: 'Maya', clothing: 'a leather jacket', state: 'leaning on the bar' }
      }
    });

    // The model reports a clothing change for Jess and says nothing about her
    // state; Maya has left the scene entirely and is simply gone.
    const merged = mergeSceneState(prev, {
      present: ['Jess'],
      characters: { jess: { name: 'Jess', clothing: 'nothing but a towel' } }
    });

    return {
      scene: merged.scene,
      present: merged.present,
      jess: merged.characters.jess,
      maya: merged.characters.maya || null
    };
  });

  // Field the update left alone is preserved...
  expect(out.jess.state).toBe('laughing');
  // ...the field it changed is the new value.
  expect(out.jess.clothing).toBe('nothing but a towel');
  // The scene description it did not repeat is not erased.
  expect(out.scene).toBe('a bar');
  // An omission from `present` means "left the scene".
  expect(out.present).toEqual(['Jess']);
  expect(out.maya).toBeNull();
});

test('a character still present keeps earlier detail if the update forgets them', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const merged = await page.evaluate(() => {
    const prev = normalizeSceneState({
      scene: 'a bar',
      present: ['Jess'],
      characters: { jess: { name: 'Jess', clothing: 'a red dress', state: 'laughing' } }
    });
    // Listed as present, but the characters map forgot her.
    return mergeSceneState(prev, { present: ['Jess'], characters: {} });
  });

  expect(merged.characters.jess.clothing).toBe('a red dress');
  expect(merged.characters.jess.state).toBe('laughing');
});

// ═══════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════

test('the scene record is written, read back and removed with the chat', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  const seen = await mockSceneModel(page, { reply: RICH_STATE });
  await seedCastChat(page);

  await page.evaluate(() => refreshSceneState());
  await expect.poll(async () => page.evaluate(() => getSceneState().present.length)).toBe(1);

  const stored = await page.evaluate(() => getSceneState());
  expect(stored.present).toEqual(['Jess']);
  expect(stored.characters.jess.clothing).toContain('sundress');
  expect(stored.scene).toContain('neon street');
  // It should have been given the previous record plus the transcript.
  expect(seen.prompts.join('\n')).toContain('PREVIOUS RECORD');
  expect(seen.prompts.join('\n')).toContain('Jess steps in from the rain');

  // The raw localStorage key is what deleteChat() has to clean up.
  const raw = await page.evaluate(() => localStorage.getItem('chat_scene_scene-chat'));
  expect(raw).toBeTruthy();

  await page.evaluate(() => deleteSceneState('scene-chat'));
  expect(
    await page.evaluate(() => localStorage.getItem('chat_scene_scene-chat'))
  ).toBeNull();
});

test('a record that is already current is not refreshed again', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockSceneModel(page, { reply: RICH_STATE });
  await seedCastChat(page);

  await page.evaluate(() => refreshSceneState());
  await expect.poll(async () => page.evaluate(() => getSceneState().present.length)).toBe(1);
  const first = seen.bodies.length;

  // Nothing new has been said, so a second pass must not cost another call.
  await page.evaluate(() => refreshSceneState());
  expect(seen.bodies.length).toBe(first);
});

test('a broken scene model leaves generation working and keeps the last record', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  // Answers with prose: unusable, but must not throw.
  await mockSceneModel(page, { reply: 'The scene is a rainy street, I think.' });
  await seedCastChat(page, { scene: RICH_STATE });

  const after = await page.evaluate(async () => {
    const before = getSceneState();
    const result = await refreshSceneState();
    return { before: before.present, after: result.present, scene: result.scene };
  });

  // The previous record survives untouched.
  expect(after.after).toEqual(['Jess']);
  expect(after.scene).toContain('neon street');
});

test('a scene model that errors does not surface as a failure', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.route('**/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.stream === true) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`
      });
      return;
    }
    await route.fulfill({ status: 500, body: 'model exploded' });
  });
  await seedCastChat(page, { scene: RICH_STATE });

  const result = await page.evaluate(async () => {
    const state = await refreshSceneState();
    return { present: state.present, scene: state.scene };
  });
  expect(result.present).toEqual(['Jess']);
});

test('scene tracking stays off for a chat with no cast', async ({ page }) => {
  await mockBaseEndpoints(page);
  const seen = await mockSceneModel(page, { reply: RICH_STATE });
  await page.addInitScript(() => {
    localStorage.setItem('chat_index', JSON.stringify(['plain-chat']));
    localStorage.setItem(
      'chat_meta',
      JSON.stringify({ 'plain-chat': { createdAt: Date.now(), lastMode: 'chat' } })
    );
    localStorage.setItem(
      'chat_plain-chat',
      JSON.stringify([{ role: 'user', content: 'hello' }])
    );
    localStorage.setItem('active_provider', 'local');
    localStorage.setItem('selectedModel', 'test-model');
  });
  await page.goto('/');

  const enabled = await page.evaluate(() => sceneTrackingEnabled());
  expect(enabled).toBe(false);

  await page.evaluate(() => scheduleSceneStateUpdate());
  await page.waitForTimeout(300);
  // No cast, so no extra model call at all.
  expect(seen.bodies.length).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════
// Prompt integration
// ═══════════════════════════════════════════════════════════════════════

test('the scene fills in clothing and place without disturbing the body lock', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const out = await page.evaluate(() => {
    const state = normalizeSceneState({
      scene: 'a rain-soaked neon street, late evening',
      present: ['Jess'],
      characters: {
        jess: {
          name: 'Jess',
          clothing: 'white sundress, soaked through',
          state: 'shivering, hair plastered to her face'
        }
      }
    });
    const profile = {
      style: '',
      characters: {
        jess: { name: 'Jess', appearance: 'long red hair, green eyes' }
      }
    };
    // Call the composer against a controlled profile rather than the chat's.
    const saved = getImageProfile;
    window.getImageProfile = () => profile;
    const composed = composeImagePrompt('Jess stands in the doorway', state);
    window.getImageProfile = saved;
    return {
      composed,
      detail: sceneDetailFor(state, 'Jess'),
      unknown: sceneDetailFor(state, 'Nobody'),
      block: sceneContextBlock(state)
    };
  });

  // Body lock and scene detail sit in the same parenthetical, so the model
  // reads them as one person.
  expect(out.composed).toContain('Jess (long red hair, green eyes, white sundress, soaked through, shivering');
  // The location is attached to the frame, not to a character.
  expect(out.composed).toContain('rain-soaked neon street');
  // Second mention is a short handle, as before.
  expect(out.detail).toContain('sundress');
  expect(out.unknown).toBe('');
  expect(out.block).toContain('Present: Jess');
  expect(out.block).toContain('Where: a rain-soaked neon street');
});

test('with no scene record the prompt is exactly what it was before', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const composed = await page.evaluate(() => {
    const saved = getImageProfile;
    window.getImageProfile = () => ({
      style: '',
      characters: { jess: { name: 'Jess', appearance: 'long red hair' } }
    });
    const withNone = composeImagePrompt('Jess waves', null);
    const withEmpty = composeImagePrompt('Jess waves', newSceneState());
    window.getImageProfile = saved;
    return { withNone, withEmpty };
  });

  expect(composed.withNone).toBe('Jess (long red hair) waves');
  expect(composed.withEmpty).toBe('Jess (long red hair) waves');
});

// ═══════════════════════════════════════════════════════════════════════
// End to end: the record reaches the image request
// ═══════════════════════════════════════════════════════════════════════

test('a generated image carries the scene clothing and location', async ({ page }) => {
  const { solidPng } = require('./helpers');
  await mockBaseEndpoints(page);
  await mockSceneModel(page, { reply: RICH_STATE });

  // ComfyUI is the provider whose request carries the whole prompt, so it is
  // the clearest place to assert the assembled text from.
  const seen = { graph: null };
  await page.route('**/prompt', async (route) => {
    seen.graph = JSON.parse(route.request().postData()).prompt;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prompt_id: 'p1', node_errors: {} })
    });
  });
  await page.route('**/history/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        p1: {
          outputs: { 7: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
          status: { status_str: 'success', completed: true, messages: [] }
        }
      })
    });
  });
  await page.route('**/view?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng(64, 64) });
  });

  await page.addInitScript(() => {
    localStorage.setItem('active_image_provider', 'comfyui');
    localStorage.setItem('image_model', 'waiIllustriousSDXL_v170_hswq_r32_turbo.safetensors');
    localStorage.setItem('image_steps', '6');
  });

  // A record that already covers the transcript, so no refresh call is needed
  // and the assertion is about the prompt, not about the updater.
  const fresh = JSON.stringify(Object.assign(JSON.parse(RICH_STATE), { throughIndex: 1 }));
  await seedCastChat(page, { scene: fresh });
  await page.locator('#config-btn').click();
  await page.locator('#provider-row-image [data-provider-id="comfyui"]').click();
  await page.locator('#config-panel .config-panel-close').click();

  // /img is the verbatim path, so the scene summariser is skipped and whatever
  // reaches the workflow comes from the record plus the character lock. Using
  // the chat composer because the seeded chat is already open.
  await page.locator('#chat-input').fill('/img Jess waves');
  await page.locator('#chat-send-btn').click();

  await expect(page.locator('#messages .message-image img')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => seen.graph).not.toBeNull();

  const promptText = JSON.stringify(seen.graph);
  // The clothing is what only the scene record knows.
  expect(promptText).toContain('white sundress');
  expect(promptText).toContain('shivering');
  // And the location it supplies.
  expect(promptText).toContain('rain-soaked neon street');
  // The body lock from the character card is still applied alongside it.
  expect(promptText).toContain('Jess (');
});

test('per-character detail is capped so a crowd cannot crowd out the action', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const out = await page.evaluate(() => {
    const long = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
    const state = normalizeSceneState({
      scene: 'a hall',
      present: ['Jess'],
      characters: { jess: { name: 'Jess', clothing: long, state: long } }
    });
    const saved = getImageProfile;
    window.getImageProfile = () => ({
      style: '',
      // A card's prose can easily run this long.
      characters: { jess: { name: 'Jess', appearance: long } }
    });
    const composed = composeImagePrompt('Jess stands', state);
    window.getImageProfile = saved;

    const inner = composed.slice(composed.indexOf('(') + 1, composed.indexOf(')'));
    return { composed, innerWords: inner.split(/\s+/).length, inner };
  });

  // 16 body words + 12 detail words, plus the two joining commas.
  expect(out.innerWords).toBeLessThanOrEqual(30);
  // The leading (identifying) descriptors are the ones kept.
  expect(out.inner).toContain('word0');
  expect(out.inner).not.toContain('word59');
});

test('short locks are passed through untouched', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const composed = await page.evaluate(() => {
    const saved = getImageProfile;
    window.getImageProfile = () => ({
      style: '',
      characters: { jess: { name: 'Jess', appearance: 'pink hair, amber eyes' } }
    });
    const state = normalizeSceneState({
      scene: 'a hall',
      present: ['Jess'],
      characters: { jess: { name: 'Jess', clothing: 'a red dress', state: 'laughing' } }
    });
    const out = composeImagePrompt('Jess stands', state);
    window.getImageProfile = saved;
    return out;
  });

  expect(composed).toContain('(pink hair, amber eyes, a red dress, laughing)');
});
