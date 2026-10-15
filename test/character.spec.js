const { test, expect } = require('@playwright/test');
const {
  mockBaseEndpoints,
  captureChatRequest,
  mockEmptyCardLibrary
} = require('./helpers');

// ── Fixtures ───────────────────────────────────────────────────────────

/**
 * A synthetic card in chatchat's canonical shape. Injected through
 * localStorage rather than relying on cards/cards.js, so the suite stays
 * hermetic: it must pass on a machine that has never run sync-cards and has
 * no SillyTavern install at all.
 */
const SERAPHINA = {
  id: 'card_test_seraphina',
  name: 'Seraphina',
  description: 'A librarian with pink hair and amber eyes, waist-length and unruly.',
  personality: 'Warm, teasing, endlessly patient.',
  scenario: 'The town library, long after closing.',
  firstMes: 'The library was quiet. *She looks up from the desk.* "You came back."',
  alternateGreetings: [
    '*A candle gutters in the empty reading room.* "Late again."',
    '"The stacks are closed," *she says without looking up.*'
  ],
  mesExample: '<START>\n{{user}}: Hello\n{{char}}: *She smiles.* "Hello yourself."',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetingsLoaded: true,
  characterBook: null,
  appearance: 'pink hair, amber eyes, waist-length hair',
  tags: ['fantasy'],
  spec: 'chara_card_v2'
};

/** Seed the card library before any app script runs. */
async function seedCards(page, cards = [SERAPHINA]) {
  await page.addInitScript((list) => {
    localStorage.setItem('chatchat_cards', JSON.stringify(list));
  }, cards);
}

/** Enter character mode and cast the first card. */
async function castFirstCard(page) {
  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();
  await page.locator('#cast-grid .cast-card-main').first().click();
}

/**
 * Open Story Settings.
 *
 * Casting the lead opens the transcript, which hides the hero — and the cast
 * picker lives inside `#story-config`, which is in the hero. Mid-chat the
 * config panel's "Edit Story" button is the real entry point: it moves
 * `#story-config` into a modal, exactly as SillyTavern keeps its character
 * settings in a drawer rather than on the transcript.
 */
async function openStorySettings(page) {
  await page.locator('#config-btn').click();
  await page.locator('#edit-story-btn').click();
  await expect(page.locator('#story-settings-overlay')).toBeVisible();
}

/** Dismiss the Story Settings modal. */
async function closeStorySettings(page) {
  await page.locator('#story-settings-overlay .config-panel-close').click();
  await expect(page.locator('#story-settings-overlay')).toBeHidden();
}

// ═══════════════════════════════════════════════════════════════════════
// Cast picker
// ═══════════════════════════════════════════════════════════════════════

test('the cast picker only appears in character style', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  await page.goto('/');

  await expect(page.locator('#story-cast')).toBeHidden();

  await page.locator('#pill-story-mode').click();
  await expect(page.locator('#story-cast')).toBeHidden(); // defaults to Adventure

  await page.locator('#style-pill-character').click();
  await expect(page.locator('#story-cast')).toBeVisible();
  await expect(page.locator('#cast-grid .cast-card')).toHaveCount(1);
  await expect(page.locator('#cast-grid .cast-card')).toContainText('Seraphina');

  // Leaving character style hides it again.
  await page.locator('#style-pill-cyoa').click();
  await expect(page.locator('#story-cast')).toBeHidden();
});

test('an empty library explains how to get cards', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await page.goto('/');

  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();

  await expect(page.locator('#cast-empty')).toBeVisible();
  await expect(page.locator('#cast-empty')).toContainText('Import a SillyTavern card');
  await expect(page.locator('#cast-grid .cast-card')).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════
// Greeting and swipes
// ═══════════════════════════════════════════════════════════════════════

test('casting a card opens the scene with its greeting', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  await page.goto('/');

  await castFirstCard(page);

  await expect(page.locator('#messages')).toBeVisible();
  const greeting = page.locator('#messages .message.assistant').first();
  await expect(greeting).toContainText('You came back');
  await expect(greeting.locator('.message-speaker-name')).toHaveText('Seraphina');

  // The chat is registered in the sidebar, so the player can come back to it.
  await expect(page.locator('#sidebar-chat-list .sidebar-row.chat-entry')).toHaveCount(1);
});

test('alternate greetings become swipes on the opening message', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  await page.goto('/');

  await castFirstCard(page);

  const greeting = page.locator('#messages .message.assistant').first();
  // 1 first_mes + 2 alternates = 3 generations in the slot.
  await expect(greeting.locator('.gen-count')).toHaveText('1/3');

  await greeting.getByLabel('Next generation').click();
  await expect(greeting).toContainText('Late again');
  await expect(greeting.locator('.gen-count')).toHaveText('2/3');

  await greeting.getByLabel('Previous generation').click();
  await expect(greeting).toContainText('You came back');
});

test('a card with no greeting does not invent one', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page, [Object.assign({}, SERAPHINA, { firstMes: '', alternateGreetings: [] })]);
  await page.goto('/');

  await castFirstCard(page);

  await expect(page.locator('#hero-region')).toBeVisible();
  await expect(page.locator('#messages .message')).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════
// Request shape — the part that actually changes model behaviour
// ═══════════════════════════════════════════════════════════════════════

test('character mode sends card fields, prefixed turns, a primed final turn, and name stop strings', async ({
  page
}) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  const captured = captureChatRequest(page, '"Mm." *She smiles.*');
  await page.goto('/');

  await castFirstCard(page);
  await openStorySettings(page);
  await page.locator('#cast-user-name').fill('Bogdan');
  await closeStorySettings(page);
  await page.locator('#chat-input').fill('I push the door open.');
  await page.locator('#chat-send-btn').click();

  await expect.poll(() => captured.body).not.toBeNull();
  const body = captured.body;

  // ── The system block carries the card ──
  const system = body.messages[0];
  expect(system.role).toBe('system');
  expect(system.content).toContain(
    "Seraphina's description: A librarian with pink hair and amber eyes, waist-length and unruly."
  );
  expect(system.content).toContain("Seraphina's personality: Warm, teasing, endlessly patient.");
  expect(system.content).toContain('Scenario: The town library, long after closing.');
  // Example dialogue is included, with the <START> marker resolved.
  expect(system.content).toContain('"Hello yourself."');
  expect(system.content).not.toContain('<START>');

  // ── Turns are speaker-prefixed ──
  const greetingTurn = body.messages.find((m) => m.content.includes('You came back'));
  expect(greetingTurn.role).toBe('assistant');
  expect(greetingTurn.content.startsWith('Seraphina: ')).toBe(true);

  // ── The final turn is primed so the model continues the scene ──
  const last = body.messages[body.messages.length - 1];
  expect(last.role).toBe('user');
  expect(last.content).toBe('Bogdan: I push the door open.\nSeraphina:');

  // ── Stop strings keep the model out of the player's half ──
  expect(body.stop).toEqual(expect.arrayContaining(['\nSeraphina:', '\nBogdan:']));

  // ── The reply carries the character's name and avatar too, not just the
  //    greeting — a streamed reply must not render as a bare paragraph. ──
  const reply = page.locator('#messages .message.assistant').last();
  await expect(reply.locator('.message-speaker-name')).toHaveText('Seraphina');
  await expect(reply.locator('.message-body')).toContainText('Mm.');
});

test('the player persona is injected under the player name', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  const captured = captureChatRequest(page, 'ok');
  await page.goto('/');

  await castFirstCard(page);
  await openStorySettings(page);
  await page.locator('#cast-user-name').fill('Bogdan');
  await page.locator('#cast-user-persona').fill('A tired cartographer, 40s, ink-stained hands.');
  await closeStorySettings(page);
  await page.locator('#chat-input').fill('Hello.');
  await page.locator('#chat-send-btn').click();

  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body.messages[0].content).toContain(
    'Bogdan: A tired cartographer, 40s, ink-stained hands.'
  );
});

test('plain chat mode sends no stop strings and no speaker prefixes', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  const captured = captureChatRequest(page, 'Hello there.');
  await page.goto('/');

  // A card is loaded, but chat mode must ignore it entirely.
  await page.locator('#hero-input-text').fill('Hi');
  await page.locator('#hero-send-btn').click();

  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body.stop).toBeUndefined();
  const userTurn = captured.body.messages.find((m) => m.role === 'user');
  expect(userTurn.content).toBe('Hi');
});

test('a supporting cast member is described but does not own the greeting', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  const MALIK = Object.assign({}, SERAPHINA, {
    id: 'card_test_malik',
    name: 'Malik',
    description: 'A broad-shouldered dockworker with a salt-and-pepper beard.',
    firstMes: 'Malik waves from the pier.'
  });
  await seedCards(page, [SERAPHINA, MALIK]);
  const captured = captureChatRequest(page, 'ok');
  await page.goto('/');

  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();
  await page.locator('#cast-grid .cast-card-main').first().click(); // Seraphina = lead
  await openStorySettings(page);
  await page.locator('.cast-card', { hasText: 'Malik' }).locator('.cast-card-main').click();
  await closeStorySettings(page);

  // Only the lead's greeting opens the scene.
  await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
  await expect(page.locator('#messages .message.assistant').first()).toContainText('You came back');

  await page.locator('#chat-input').fill('Who is with me?');
  await page.locator('#chat-send-btn').click();

  await expect.poll(() => captured.body).not.toBeNull();
  const system = captured.body.messages[0].content;
  expect(system).toContain('Malik (also present):');
  expect(system).toContain('salt-and-pepper beard');
  // Both names are protected by stop strings.
  expect(captured.body.stop).toEqual(expect.arrayContaining(['\nSeraphina:', '\nMalik:']));
});

test('the lead can be promoted by clicking the move button', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  const MALIK = Object.assign({}, SERAPHINA, {
    id: 'card_test_malik',
    name: 'Malik',
    description: 'A dockworker.'
  });
  await seedCards(page, [SERAPHINA, MALIK]);
  await page.goto('/');

  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();
  await page.locator('.cast-card', { hasText: 'Malik' }).locator('.cast-card-main').click();
  await openStorySettings(page);
  await page.locator('.cast-card', { hasText: 'Seraphina' }).locator('.cast-card-main').click();

  // Malik is lead (cast order: Malik, Seraphina).
  await expect(page.locator('.cast-card', { hasText: 'Malik' })).toContainText('lead');

  await page.locator('.cast-card', { hasText: 'Seraphina' }).getByTitle('Make lead character').click();
  await expect(page.locator('.cast-card', { hasText: 'Seraphina' })).toContainText('lead');
});

// ═══════════════════════════════════════════════════════════════════════
// Card parsing and the editor
// ═══════════════════════════════════════════════════════════════════════

test('a PNG card is parsed from its chara tEXt chunk', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await page.goto('/');

  const parsed = await page.evaluate(async () => {
    // Build a minimal valid PNG carrying a base64 `chara` chunk, the same
    // way SillyTavern writes one.
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Vess',
        description: 'A soot-stained courier with copper hair and one green eye.',
        first_mes: 'She drops the parcel on the counter.',
        alternate_greetings: [],
        personality: '',
        scenario: '',
        mes_example: '',
        tags: ['sci-fi'],
        character_book: {
          entries: [
            { keys: ['Ravenhold'], content: 'A fortress of black basalt.', enabled: true, constant: false },
            { keys: [], content: 'Always relevant.', enabled: true, constant: true }
          ]
        }
      }
    };
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(card))));

    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type, data) => {
      const out = [];
      out.push((data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255);
      for (const c of type) out.push(c.charCodeAt(0));
      for (const b of data) out.push(b);
      out.push(0, 0, 0, 0); // CRC — not validated by the reader
      return out;
    };
    const text = Array.from('chara\u0000' + b64).map((c) => c.charCodeAt(0));
    const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];

    const bytes = new Uint8Array([
      ...sig,
      ...chunk('IHDR', ihdr),
      ...chunk('tEXt', text),
      ...chunk('IEND', [])
    ]);

    const raw = await readCardJsonFromPng(bytes.buffer);
    const normalised = normalizeCard(raw);
    return {
      name: normalised.name,
      appearance: normalised.appearance,
      tags: normalised.tags,
      book: normalised.characterBook ? normalised.characterBook.length : 0,
      spec: normalised.spec
    };
  });

  expect(parsed.name).toBe('Vess');
  expect(parsed.spec).toBe('chara_card_v2');
  expect(parsed.tags).toEqual(['sci-fi']);
  expect(parsed.book).toBe(2);
  expect(parsed.appearance).toContain('copper hair');
});

test('a PNG with no character chunk is rejected with a clear reason', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await page.goto('/');

  const message = await page.evaluate(async () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const bytes = new Uint8Array([...sig, 0, 0, 0, 0]);
    try {
      await readCardJsonFromPng(bytes.buffer);
      return 'no error thrown';
    } catch (e) {
      return e.message;
    }
  });

  expect(message).toContain('no chara/ccv3 chunk');
});

test('the card editor saves a hand-written character and casts it', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await page.goto('/');

  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();
  await page.locator('#story-cast').getByText('New Character').click();

  await expect(page.locator('#card-editor-overlay')).toBeVisible();
  await page.locator('#ce-name').fill('Ordwin');
  await page.locator('#ce-description').fill('A stooped archivist with wire-rimmed spectacles.');
  await page.locator('#ce-personality').fill('Fastidious, dry-witted.');
  await page.locator('#ce-first-mes').fill('"Mind the dust," *he says.*');
  await page.locator('.card-editor-foot').getByText('Save').click();

  await expect(page.locator('#card-editor-overlay')).toBeHidden();
  await expect(page.locator('#cast-grid .cast-card')).toContainText('Ordwin');

  // It survives a reload, because it is persisted, not just in memory.
  await page.reload();
  await page.locator('#pill-story-mode').click();
  await page.locator('#style-pill-character').click();
  await expect(page.locator('#cast-grid .cast-card')).toContainText('Ordwin');
});

test('editing a card and changing its name keeps it cast', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  await page.goto('/');

  await castFirstCard(page);
  await expect(page.locator('#messages .message.assistant').first()).toContainText('You came back');

  await openStorySettings(page);
  await page.locator('#cast-grid .cast-card').getByTitle('Edit character').click();
  await page.locator('#ce-name').fill('Seraphina Voss');
  await page.locator('.card-editor-foot').getByText('Save').click();

  // Card identity is a hash of name + description, so renaming changes the
  // id. The cast must follow rather than silently emptying.
  await expect(page.locator('#cast-grid .cast-card')).toContainText('Seraphina Voss');
  await expect(page.locator('#cast-grid .cast-card')).toHaveClass(/selected/);

  // And it is written to storage, not just held in memory. (Checked directly
  // rather than by reloading: seedCards re-runs on every navigation.)
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('chatchat_cards') || '[]').map((c) => c.name)
  );
  expect(stored).toContain('Seraphina Voss');
  expect(stored).not.toContain('Seraphina');
});

test('the prompt preview shows the assembled system prompt', async ({ page }) => {
  await mockBaseEndpoints(page);
  // This file owns the card library it asserts on — see mockEmptyCardLibrary.
  await mockEmptyCardLibrary(page);
  await seedCards(page);
  await page.goto('/');

  await castFirstCard(page);
  await openStorySettings(page);
  await page.locator('#cast-grid .cast-card').getByTitle('Edit character').click();
  await page.locator('.card-editor-foot').getByText('Preview prompt').click();

  const preview = page.locator('#card-editor-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Seraphina's description:");
  await expect(preview).toContainText('The town library, long after closing.');
});
