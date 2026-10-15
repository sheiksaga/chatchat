const { test, expect } = require('@playwright/test');
const { mockBaseEndpoints } = require('./helpers');
const syncCards = require('../tools/sync-cards');

/**
 * `tools/sync-cards.js` duplicates the card parsing and appearance extraction
 * from `js/cards.js`, because that half has to run in Node at build time. The
 * duplication is deliberate, but drift is not: a manifest synced by one and
 * re-imported by the other would silently disagree about the same card.
 *
 * These tests run the same inputs through both implementations and require
 * identical output, so the two can only be changed together.
 */

/** Descriptions that exercise each branch of the extractor. */
const DESCRIPTIONS = [
  // Plain prose, no explicit heading.
  'A librarian with pink hair and amber eyes, waist-length and unruly.',
  // Explicit heading wins and stops at the next "Word:" heading.
  'Appearance: copper hair, one green eye, soot-stained cheeks.\nPersonality: cheerfully rude.\nLikes: parcel routes.',
  // Structured block, the shape SillyTavern exports often produce.
  "[Seraphina's body= \"pink hair\", \"long hair\", \"amber eyes\"]",
  // Example dialogue must be cut before it can be mistaken for description.
  'Tall and grey-eyed.\n{{char}}: *She waves.* "Hello there, traveller."\n{{user}}: Hi.',
  // Prompt-engineering noise must not survive.
  'You are a helpful assistant. Always stay in character. Write in third person. Her hair is red.',
  // Emphasis markers and code fences.
  '**blonde braid**, `pale skin`, *sharp jawline*',
  // Height markers must keep their digits and quotes.
  `5'2" tall, slender, grey-green eyes`,
  // Single-clause over-cap: the hard slice is the only backstop.
  'hair ' + 'a'.repeat(400),
  // Many clauses pushing past the cap: whole clauses must be dropped. Each
  // clause has to carry an appearance cue to survive the extractor's filter.
  Array.from({ length: 40 }, (_, i) => `feature ${i} of her pale skin`).join(', '),
  // Empty and junk input.
  '',
  '   ',
  null
];

/** Full card objects for normalizeCard agreement. */
const RAW_CARDS = [
  {
    spec: 'chara_card_v2',
    data: {
      name: 'Vess',
      description: 'A courier with copper hair.',
      personality: 'Brisk.',
      scenario: 'The depot.',
      first_mes: 'She drops the parcel.',
      alternate_greetings: ['She is already gone.'],
      mes_example: '<START>\n{{user}}: Hi\n{{char}}: "Busy."',
      system_prompt: 'Stay terse.',
      post_history_instructions: 'Never break character.',
      tags: ['sci-fi'],
      character_book: {
        entries: [
          { keys: ['Ravenhold'], content: 'Black basalt.', enabled: true, constant: false },
          { keys: [], content: 'Always relevant.', enabled: true, constant: true },
          { keys: ['ignored'], content: 'Disabled.', enabled: false, constant: false }
        ]
      }
    }
  },
  // A v2 card without the wrapper, which is what a bare JSON export looks like.
  { name: 'Bare', description: 'A bare card.', first_mes: 'Hello.' },
  // A v3 card in flat shape.
  {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    name: 'Flat',
    description: 'A flat v3 card.',
    nickname: 'F',
    creator: 'someone',
    tags: 'not-an-array'
  }
];

test('the Node and browser appearance extractors agree', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const inBrowser = await page.evaluate(
    (cases) => cases.map((d) => extractAppearance({ description: d })),
    DESCRIPTIONS
  );
  const inNode = DESCRIPTIONS.map((d) => syncCards.extractAppearance({ description: d }));

  expect(inBrowser).toEqual(inNode);
  // Sanity: the extractor is not just returning empty for everything.
  expect(inNode.filter(Boolean).length).toBeGreaterThanOrEqual(6);
});

test('the Node and browser card normalisers agree', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const inBrowser = await page.evaluate(
    (raws) => raws.map((r) => normalizeCard(r)),
    RAW_CARDS
  );
  const inNode = RAW_CARDS.map((r) => syncCards.normalizeCard(r));

  expect(inBrowser).toEqual(inNode);
});

test('card identity is a hash of name and description only', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const card = { name: 'Vess', description: 'A courier with copper hair.' };
  // Rewriting creator_notes is what SillyTavern does on every re-export. If
  // identity keyed on it, each re-export would mint a duplicate card.
  const reexported = Object.assign({}, card, {
    creator_notes: 'rewritten by the exporter',
    creator_notes_multilingual: { en: 'nope' },
    create_date: '2024-01-01'
  });
  // A different description must be a different card.
  const changed = Object.assign({}, card, { description: 'A courier with black hair.' });

  expect(syncCards.cardId(card)).toBe(syncCards.cardId(reexported));
  expect(syncCards.cardId(card)).not.toBe(syncCards.cardId(changed));

  // And the browser copy agrees on all three.
  const inBrowser = await page.evaluate(
    ([c, r, x]) => [cardId(c), cardId(r), cardId(x)],
    [card, reexported, changed]
  );
  expect(inBrowser).toEqual([
    syncCards.cardId(card),
    syncCards.cardId(reexported),
    syncCards.cardId(changed)
  ]);
});

test('the extractor truncates on clause boundaries, not mid-word', async ({ page }) => {
  await mockBaseEndpoints(page);
  await page.goto('/');

  const long = DESCRIPTIONS[8]; // 40 "feature N of her pale skin" clauses
  const out = syncCards.extractAppearance({ description: long });

  expect(out.length).toBeLessThanOrEqual(300);
  expect(out.length).toBeGreaterThan(200);
  // Clauses must be whole: every one ends in the same word, so a mid-word cut
  // would leave a dangling fragment instead.
  expect(out.endsWith('pale skin')).toBe(true);

  const inBrowser = await page.evaluate(
    (d) => extractAppearance({ description: d }),
    long
  );
  expect(inBrowser).toBe(out);
});
