/*
 * Dev-only visual verification helper for chatchat's UI/UX work.
 * Not loaded by the app; run manually with `node shot.js` from this folder
 * (after `npm install` here once). Requires Node + the Playwright browser
 * binaries (`npx playwright install chromium`).
 *
 * Captures the same 10 reference states used during the UI/UX review in
 * docs/superpowers/plans/2026-07-22-ui-ux-improvements.md so before/after
 * screenshots are directly comparable.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../index.html');
const OUT = path.resolve(__dirname, 'shots');

const seedChat = () => {
  const id = 'demo1';
  localStorage.setItem('data_version', '1');
  localStorage.setItem('chat_index', JSON.stringify([id]));
  localStorage.setItem('chat_meta', JSON.stringify({ [id]: { createdAt: Date.now(), name: 'Weeknight dinner ideas', lastMode: 'chat' } }));
  localStorage.setItem('chat_' + id, JSON.stringify([
    { role: 'user', content: 'Can you suggest a quick weeknight dinner using chicken thighs and whatever vegetables are usually in a fridge?' },
    { role: 'assistant', content: "Here's a solid one-pan option:\n\n## Sheet-Pan Chicken Thighs\n\n1. Toss chicken thighs with olive oil, salt, pepper, and paprika.\n2. Add chopped carrots, broccoli, and red onion to the same pan.\n3. Roast at 425°F for ~25-30 minutes until chicken hits 165°F internally.\n\n```js\nconst readyIn = 35; // minutes, including prep\n```\n\nWant a sauce to go with it?" },
    { role: 'user', content: 'Yes, something garlicky.' }
  ]));
  localStorage.setItem('selectedModel', 'local-model-7b-instruct');
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR', m.text()); });

  await page.goto(APP);
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/01-hero-chat.png' });

  await page.click('#pill-story-mode');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/02-hero-story.png' });

  await page.click('#pill-chat-mode');
  await page.waitForTimeout(300);
  await page.click('#config-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/03-config-panel.png' });
  await page.click('#config-btn');

  await page.click('#hero-input-box');
  await page.fill('#hero-input-text', 'What should I cook tonight?');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/04-hero-input-active.png' });

  await page.evaluate(seedChat);
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('.sidebar-row');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/05-chat-view.png' });

  const assistantMsg = await page.$('.message.assistant');
  if (assistantMsg) {
    await assistantMsg.hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/06-message-toolbar-hover.png' });
  }

  await page.click('.sidebar-toggle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/07-sidebar-collapsed.png' });
  await page.click('.sidebar-toggle');
  await page.waitForTimeout(400);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/08-mobile-chat.png' });
  // Real (non-forced) click — this must succeed on its own for the
  // offline-banner-intercepts-clicks bug to count as fixed.
  await page.click('.mobile-menu-btn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/09-mobile-sidebar-open.png' });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(APP);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/10-tablet-hero.png' });

  await browser.close();
  console.log('DONE — screenshots in ' + OUT);
})();
