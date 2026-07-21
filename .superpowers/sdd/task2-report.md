# Task 2 Report: Style registry + prompt dispatch

## Commit

`769f560` — "Add story style registry (Adventure/Roleplay/Game Master) with prompt dispatch"

Only `js/chat.js` was staged and committed (`git add js/chat.js`). No temp test scripts were committed.

## What changed

File: `js/chat.js`, originally lines 9-32 (the single `buildStoryPrompt` function).

Replaced that block, verbatim per the brief, with:

- `STORY_FORMATTING_LINE` — shared formatting-convention constant string.
- `storyConfigLines(cfg)` — extracted helper that emits the scene/characters/tags/firstPrompt lines shared by every style, in the same order and text as the original inline code.
- `STORY_STYLES` — registry object with three keys:
  - `cyoa` (label `'Adventure'`, hero `'What do you do?'`) — prompt text identical to the original hardcoded prompt.
  - `roleplay` (label `'Roleplay'`, hero `'What do you do or say?'`) — new prompt instructing the AI to voice the first-listed character in first person, suppress numbered choices, and interpret user input as either out-of-scene direction or in-character speech/action.
  - `gm` (label `'Game Master'`, hero `'What do you do?'`) — new prompt instructing the AI to act as GM, treat the first-listed character as the user's PC, narrate outcomes with consequences (no dice/stats), and suppress numbered choices.
- `currentStyle()` — returns `storyConfig.style` if it's a valid key in `STORY_STYLES`, else `'cyoa'`.
- `storyHeroText()` — returns `STORY_STYLES[currentStyle()].hero`.
- `buildStoryPrompt()` — now dispatches to `STORY_STYLES[currentStyle()].buildPrompt(storyConfig)`; the function's public signature/behavior at the `js/chat.js:56` call site (`buildStoryPrompt()`, no args) is unchanged.

The new block replaces lines 9-32 of the original file. Per `git diff --stat`: 1 file changed, 100 insertions(+), 20 deletions(-).

## Test script (Node vm harness)

Written temporarily to `.superpowers/sdd/tmp-test-styles.js`, run via `node`, then deleted after use (never staged/committed). Full content used, exactly per the brief:

```js
const fs = require('fs'), vm = require('vm');
const ctx = { storyConfig: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/chat.js', 'utf8'), ctx);

const cfg = {
  scene: 'A ship bridge',
  characters: [{ name: 'Shara', traits: 'bossy', role: 'Captain' }, { name: 'Jax', traits: 'nervous', role: 'Pilot' }],
  tags: 'sci-fi', firstPrompt: 'Begin.'
};
function P(style) { ctx.storyConfig = Object.assign({ style }, cfg); return ctx.buildStoryPrompt(); }

// Byte-identical regression baseline for CYOA (replicates the pre-change prompt).
function oldBuild(sc) {
  const parts = [
    'You are a creative storytelling AI running in story mode.',
    'Narrate vividly in second-person ("You stand before...").',
    'Roleplay all non-player characters with distinct voices.',
    'NEVER roleplay what the user says, does, thinks, or feels.',
    'End EVERY response with 2-3 explicit numbered choices.',
    "Move the story forward based on the user's input.",
    'Maintain consistency with established characters, setting, and plot.',
    'Format prose with these conventions: spoken dialogue in "double quotes", physical actions and narration wrapped in *asterisks*, and a character\'s inner thoughts wrapped in `backticks`.'
  ];
  if (sc.scene) parts.push('\nScene: ' + sc.scene);
  (sc.characters || []).forEach(function (c) {
    if (!c.name) return;
    var line = 'Character — ' + c.name + ': ' + (c.traits || 'unknown');
    if (c.role && c.role.trim()) line += '. Role: ' + c.role.trim();
    parts.push(line);
  });
  if (sc.tags) parts.push('Tags/Genre: ' + sc.tags);
  if (sc.firstPrompt) parts.push('\n' + sc.firstPrompt);
  return parts.join('\n');
}

const cy = P('cyoa'), rp = P('roleplay'), gm = P('gm');
let ok = true;
function check(name, cond) { if (!cond) { ok = false; console.log('FAIL ' + name); } else console.log('PASS ' + name); }

check('cyoa byte-identical to old prompt', cy === oldBuild(Object.assign({ style: 'cyoa' }, cfg)));
check('roleplay suppresses numbered choices', /Do NOT present numbered choices/i.test(rp));
check('gm suppresses numbered choices', /Do NOT present numbered choices/i.test(gm));
check('roleplay references FIRST character', /FIRST character/i.test(rp));
check('gm references FIRST character', /FIRST character/i.test(gm));
check('all include the scene', cy.includes('A ship bridge') && rp.includes('A ship bridge') && gm.includes('A ship bridge'));
check('all include the character line', [cy, rp, gm].every(p => p.includes('Character — Shara: bossy. Role: Captain')));
check('all include formatting convention', [cy, rp, gm].every(p => /double quotes/.test(p)));
check('unknown style falls back to cyoa', (ctx.storyConfig = Object.assign({}, cfg), ctx.buildStoryPrompt() === oldBuild(cfg)));
check('currentStyle validates', ctx.currentStyle && (ctx.storyConfig = { style: 'bogus' }, ctx.currentStyle() === 'cyoa'));
check('storyHeroText differs for roleplay', (ctx.storyConfig = { style: 'roleplay' }, ctx.storyHeroText() === 'What do you do or say?'));
process.exit(ok ? 0 : 1);
```

### Run 1 — before the code change (expected failures)

Command: `node ".superpowers\sdd\tmp-test-styles.js"` (run from repo root)

Actual console output:

```
PASS cyoa byte-identical to old prompt
FAIL roleplay suppresses numbered choices
FAIL gm suppresses numbered choices
FAIL roleplay references FIRST character
FAIL gm references FIRST character
PASS all include the scene
PASS all include the character line
PASS all include formatting convention
PASS unknown style falls back to cyoa
FAIL currentStyle validates
```

followed by an uncaught `TypeError: ctx.storyHeroText is not a function` on the final check (since `storyHeroText` did not exist yet), process exit code 1. This matches the brief's expectation that the roleplay/gm/currentStyle/storyHeroText checks fail pre-change (the last check crashed rather than printing a soft `FAIL` line, because `storyHeroText` was completely undefined at that point — a stronger failure than a plain `FAIL`, but consistent with "doesn't exist yet").

### Run 2 — after the code change (expected all-pass)

Command: `node ".superpowers\sdd\tmp-test-styles.js"`

Actual console output:

```
PASS cyoa byte-identical to old prompt
PASS roleplay suppresses numbered choices
PASS gm suppresses numbered choices
PASS roleplay references FIRST character
PASS gm references FIRST character
PASS all include the scene
PASS all include the character line
PASS all include formatting convention
PASS unknown style falls back to cyoa
PASS currentStyle validates
PASS storyHeroText differs for roleplay
```

Exit code: `0`. 11/11 PASS, including `PASS cyoa byte-identical to old prompt`.

## Syntax check

Command: `node --check js/chat.js`
Output: (none)
Exit code: `0` — pass.

## Deviations from the brief

None in the production code — `js/chat.js` was edited to contain exactly the code given in the brief's Step 3, verbatim (no rewriting).

Minor procedural deviations (tooling only, no effect on the deliverable):
- The brief's test path was `$CLAUDE_JOB_DIR/tmp/test-styles.js`; that environment variable/path wasn't available in this session's shell, so the identical test script content was placed at `.superpowers/sdd/tmp-test-styles.js` within the repo instead, run directly with `node`, and deleted after both runs. It was never staged or committed.
- Node version used: v25.1.0 (system default); no version-specific issues encountered.
- Note: this file (`task2-report.md`) previously contained an unrelated report about a story-config HTML form (apparently left over from a different task run against this same filename); it has been overwritten here with the correct Task 2 report.
