/**
 * Dev-only UX analysis script — run manually, not part of any workflow.
 *
 * Uses Playwright to open the app, screenshot key views (hero, chat, mobile,
 * story mode, config panel), and dump computed styles, interactive element
 * positions, color palettes, and layout issues to the console.
 *
 * Usage:  node tools/analyze-ux.js
 * Requires: a local dev server running on port 9090 (e.g. python -m http.server 9090)
 *
 * Output: screenshots/ directory (gitignored)
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:9090', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  // ====== HERO VIEW ANALYSIS ======
  console.log('===== HERO VIEW =====');
  await page.screenshot({ path: 'screenshots/hero-view.png', fullPage: true });
  
  const heroText = await page.evaluate(() => document.body.innerText);
  console.log('Visible text (first 2000 chars):');
  console.log(heroText.substring(0, 2000));
  console.log('');
  
  // Get detailed element analysis
  console.log('=== KEY ELEMENT STYLES ===');
  const styles = await page.evaluate(() => {
    const results = {};
    const selectors = ['textarea', 'button', 'header', 'nav', '#sidebar', '#chat-container', 
      '#hero-input', '#system-prompt', '#send-btn', '.hero', 'body', 'input', 'select'];
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        const cs = window.getComputedStyle(el);
        results[sel] = {
          width: cs.width, height: cs.height,
          padding: cs.padding, margin: cs.margin,
          fontSize: cs.fontSize, borderRadius: cs.borderRadius,
          color: cs.color, backgroundColor: cs.backgroundColor,
          fontFamily: cs.fontFamily.substring(0, 80),
          border: cs.border, boxShadow: cs.boxShadow,
          lineHeight: cs.lineHeight,
          position: cs.position,
          display: cs.display,
          transition: cs.transition?.substring(0, 120),
          cursor: cs.cursor,
        };
      }
    });
    return results;
  });
  console.log(JSON.stringify(styles, null, 2));
  console.log('');
  
  // ====== INTERACT: SEND A MESSAGE TO GET CHAT VIEW ======
  console.log('===== SENDING A MESSAGE =====');
  // Find the hero textarea and type
  const heroTextarea = await page.$('#hero-input');
  if (heroTextarea) {
    await heroTextarea.fill('Hello, this is a test message to see the chat UI');
    await page.waitForTimeout(300);
    // Click send button
    const sendBtn = await page.$('#send-btn');
    if (sendBtn) {
      await sendBtn.click();
      await page.waitForTimeout(2000);
      
      // Screenshot chat view
      await page.screenshot({ path: 'screenshots/chat-view.png', fullPage: true });
      
      const chatText = await page.evaluate(() => document.body.innerText);
      console.log('Chat view text (first 2500 chars):');
      console.log(chatText.substring(0, 2500));
    }
  }
  
  // ====== SIDEBAR ANALYSIS ======
  console.log('\n===== SIDEBAR =====');
  const sidebarVisible = await page.evaluate(() => {
    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) return { visible: false };
    const cs = window.getComputedStyle(sidebar);
    return {
      visible: cs.display !== 'none',
      width: cs.width,
      position: cs.position,
      transform: cs.transform,
      opacity: cs.opacity,
    };
  });
  console.log(JSON.stringify(sidebarVisible, null, 2));
  
  // ====== INTERACTIVE ELEMENTS MAP ======
  console.log('\n=== ALL INTERACTIVE ELEMENTS ===');
  const interactive = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, textarea, input, select, a[href]')).map(el => {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: (el.textContent || el.placeholder || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 80),
        class: el.className?.substring(0, 80),
        id: el.id,
        visible: el.offsetParent !== null && rect.width > 0 && rect.height > 0,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        fontSize: cs.fontSize,
        bgColor: cs.backgroundColor,
        borderRadius: cs.borderRadius,
      };
    });
  });
  interactive.forEach(el => console.log(JSON.stringify(el)));
  
  // ====== RESPONSIVE CHECK AT MOBILE ======
  console.log('\n===== MOBILE VIEWPORT (375x812) =====');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/mobile-view.png', fullPage: true });
  
  const mobileInfo = await page.evaluate(() => {
    const bodyFont = window.getComputedStyle(document.body).fontSize;
    const textarea = document.querySelector('textarea');
    const taSize = textarea ? window.getComputedStyle(textarea).fontSize : 'none';
    const overflowX = document.documentElement.scrollWidth > window.innerWidth;
    return { bodyFontSize: bodyFont, textareaFontSize: taSize, horizontalOverflow: overflowX };
  });
  console.log(JSON.stringify(mobileInfo, null, 2));
  
  // ====== CLICK INTERACTIONS ======
  console.log('\n===== CLICKING STORY MODE =====');
  const storyPill = await page.$('#pill-story-mode');
  if (storyPill) { await storyPill.click(); await page.waitForTimeout(500); }
  await page.screenshot({ path: 'screenshots/story-mode.png', fullPage: true });
  
  const storyPanelInfo = await page.evaluate(() => {
    const sc = document.querySelector('#story-config');
    if (!sc) return { notFound: true };
    const cs = window.getComputedStyle(sc);
    const inputs = sc.querySelectorAll('input, textarea, button, select');
    return {
      maxHeight: cs.maxHeight, opacity: cs.opacity,
      display: cs.display, hidden: sc.classList.contains('hidden'),
      inputCount: inputs.length,
      visibleInputs: Array.from(inputs).filter(el => el.offsetParent !== null).length
    };
  });
  console.log(JSON.stringify(storyPanelInfo, null, 2));
  
  // Check hero input interaction
  console.log('\n===== HERO INPUT INTERACTION =====');
  const heroInput = await page.$('#hero-input-box');
  if (heroInput) {
    await heroInput.click();
    await page.waitForTimeout(500);
  }
  const heroState = await page.evaluate(() => {
    const box = document.querySelector('#hero-input-box');
    const ta = document.querySelector('#hero-input-text');
    if (!box || !ta) return { notFound: true };
    return {
      boxActive: box.classList.contains('active'),
      textareaStyle: window.getComputedStyle(ta).opacity,
      textareaMaxHeight: window.getComputedStyle(ta).maxHeight,
      placeholderOpacity: window.getComputedStyle(document.querySelector('#hero-placeholder')).opacity,
    };
  });
  console.log(JSON.stringify(heroState, null, 2));
  
  // Check config panel open
  console.log('\n===== CONFIG PANEL =====');
  const configBtn = await page.$('#config-btn');
  if (configBtn) { await configBtn.click(); await page.waitForTimeout(400); }
  await page.screenshot({ path: 'screenshots/config-panel.png', fullPage: true });
  const configState = await page.evaluate(() => {
    const panel = document.querySelector('#config-panel');
    if (!panel) return { notFound: true };
    const visibleInputs = Array.from(panel.querySelectorAll('input, textarea, button, select'))
      .filter(el => el.offsetParent !== null);
    return {
      isOpen: panel.classList.contains('open'),
      visibleInputCount: visibleInputs.length,
      visibleIds: visibleInputs.map(el => el.id).filter(Boolean),
    };
  });
  console.log(JSON.stringify(configState, null, 2));
  
  // Check spacing and layout issues
  console.log('\n===== LAYOUT & SPACING =====');
  const layout = await page.evaluate(() => {
    const issues = [];
    
    // Check if sidebar toggle button label is visible
    const sbToggle = document.querySelector('.sidebar-toggle');
    const sbToggleLabel = sbToggle ? sbToggle.getAttribute('aria-label') : null;
    if (!sbToggleLabel) issues.push('Sidebar toggle missing aria-label');
    
    // Check if story config inputs have labels
    document.querySelectorAll('#story-config input, #story-config textarea').forEach(el => {
      if (!el.getAttribute('aria-label') && !el.closest('label')) {
        // Check if there's a visible label nearby
        const prevLabel = el.previousElementSibling;
        if (!prevLabel || !prevLabel.classList.contains('story-section-label')) {
          issues.push('Input ' + (el.id || el.placeholder) + ' may lack proper label');
        }
      }
    });
    
    // Check for text truncation issues
    const allText = document.body.innerText;
    if (allText.includes('…') || allText.includes('...')) {
      // Is there ellipsis? Check truncated elements
      document.querySelectorAll('.sidebar-row-label').forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.textOverflow === 'ellipsis') issues.push('Chat names use text-overflow: ellipsis');
      });
    }
    
    // Check duplication/redundancy  
    const exportBtns = document.querySelectorAll('button');
    const exportLabels = Array.from(exportBtns).map(b => b.textContent.trim()).filter(t => t.toLowerCase().includes('export'));
    if (exportLabels.length > 3) issues.push('Multiple export buttons: ' + exportLabels.join(', '));
    
    // Check contrast
    const mutedElements = document.querySelectorAll('.sidebar-row-label, .story-section-label');
    const mutedColors = new Set();
    mutedElements.forEach(el => {
      mutedColors.add(window.getComputedStyle(el).color);
    });
    issues.push('Muted text colors used: ' + Array.from(mutedColors).join(', '));
    
    return issues;
  });
  layout.forEach(l => console.log('  ' + l));
  
  // ====== COLOR PALETTE ======
  console.log('\n===== COLOR PALETTE FROM CSS VARIABLES =====');
  const palette = await page.evaluate(() => {
    const cs = window.getComputedStyle(document.documentElement);
    const vars = [];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (prop.startsWith('--')) {
        vars.push({ prop, value: cs.getPropertyValue(prop).trim() });
      }
    }
    return vars;
  });
  palette.forEach(v => console.log(v.prop + ': ' + v.value));
  
  await browser.close();
  console.log('\n===== DONE =====');
})();
