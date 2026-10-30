/**
 * The flows that must never break: type → stream → persist, retry a reply, and a phone-sized screen
 * doing the same thing. Everything runs against the stub model (`tools/fake-llm.ts`), so there is no
 * GPU, no network and no API key in the loop.
 *
 * Two habits make these tests trustworthy rather than flaky:
 *  1. assert on the transcript container, which exists before the first token;
 *  2. wait for the `/api/chat` response to *finish* before reloading — the client sees the last
 *     token slightly before the server has committed the row, and that gap is not a bug.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { composer, newChat, openSidebar } from './nav.js';

const transcript = (page: Page) => page.getByTestId('transcript');

/** Every chat stream ends with a 200 on /api/chat; waiting for it to finish is the sync point. */
async function waitForChatStream(page: Page, action: () => Promise<void>) {
	const finished = page.waitForResponse(
		(response) => response.url().includes('/api/chat') && response.status() === 200
	);
	await action();
	await (await finished).finished();
}

async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await waitForChatStream(page, () => page.getByRole('button', { name: 'Send' }).click());
}

/** Create (or re-create) a card through the public API, independent of the legacy card library. */
async function seedCharacter(request: APIRequestContext) {
	const response = await request.post('/api/characters', {
		data: {
			spec: 'chara_card_v3',
			data: {
				name: 'E2E Tester',
				description: '{{char}} is a test character for {{user}}.',
				first_mes: 'Hello {{user}}, I am here.',
				system_prompt: 'Reply briefly.',
				post_history_instructions: 'End with an action.'
			}
		}
	});
	expect(response.ok()).toBeTruthy();
}

test('send a message, see it stream, reload and find it again', async ({ page }) => {
	await newChat(page);
	await send(page, 'Does the stub answer?');

	await expect(transcript(page)).toContainText('Stub reply to:');

	// Persistence: the reload must read the transcript back from SQLite, not from memory.
	await page.reload();
	await expect(page.locator('article[data-role="assistant"]').last()).toContainText(
		'Stub reply to:'
	);
	await expect(page.locator('article[data-role="user"]').last()).toContainText(
		'Does the stub answer?'
	);
});

test('retry a reply and cycle between versions', async ({ page }) => {
	await newChat(page);
	await send(page, 'Version me');
	await expect(transcript(page)).toContainText('Stub reply to:');

	const last = page.locator('article[data-role="assistant"]').last();
	const original = (await last.innerText()).replace(/\s+/g, ' ');

	await waitForChatStream(page, () => last.getByRole('button', { name: 'retry' }).click());
	await expect(last).toContainText('v2/2', { timeout: 15_000 });

	const regenerated = (await last.innerText()).replace(/\s+/g, ' ');
	expect(regenerated).not.toBe(original);

	// The previous version is still there: that is what makes "retry" safe to press.
	await last.getByRole('button', { name: '‹' }).click();
	await expect(last).toContainText('v1/2');
	expect((await last.innerText()).replace(/\s+/g, ' ').includes('v1/2')).toBe(true);
	await expect(last).toContainText('Stub reply to:');
});

test('a character chat opens with its greeting and replies in context', async ({
	page,
	request
}) => {
	await seedCharacter(request);

	await page.goto('/characters');
	await page.locator('li', { hasText: 'E2E Tester' }).getByRole('button', { name: 'chat' }).click();

	// The greeting is stored, so it survives the redirect *and* a reload.
	await expect(page.locator('article[data-role="assistant"]').first()).toContainText('Hello Sam', {
		timeout: 15_000
	});

	await send(page, 'Are you in character?');
	await expect(transcript(page)).toContainText('Stub reply to:');

	await page.reload();
	await expect(page.locator('article[data-role="assistant"]').first()).toContainText('Hello Sam');
});

test('the transcript and composer fit a phone screen', async ({ page }) => {
	// This project is a Pixel 7; skip in the desktop project so the two do not duplicate work.
	test.skip(test.info().project.name !== 'mobile', 'phone-only check');

	await newChat(page);
	await send(page, 'Phone check');
	await expect(transcript(page)).toContainText('Stub reply to:');

	// Nothing may overflow horizontally: a phone cannot scroll sideways out of a layout bug.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test('the chat list is a drawer on a phone, not a column', async ({ page }) => {
	test.skip(test.info().project.name !== 'mobile', 'the drawer only exists below md');

	const sidebar = page.getByTestId('sidebar');
	await page.goto('/');
	// Closed by default, because a 240px column on a 412px screen leaves 172px for the conversation.
	await expect(sidebar).toBeHidden();

	await openSidebar(page);
	await expect(sidebar).toBeVisible();

	// Escape puts it away again (a phone has no visible close button, and the backdrop needs a tap).
	await page.keyboard.press('Escape');
	await expect(sidebar).toBeHidden();

	// With the drawer shut, the transcript gets the width of the phone.
	await newChat(page);
	await expect(sidebar).toBeHidden();
	expect(await transcript(page).evaluate((element) => element.clientWidth)).toBeGreaterThan(320);
});

test('an image command generates a picture without asking the model', async ({ page }) => {
	// ComfyUI is not part of the e2e stack (it needs a GPU), so the point of this test is the routing:
	// `/image …` must reach the image endpoint and *not* become a chat turn. A failing generation is a
	// valid outcome here; a chat reply is not.
	test.skip(test.info().project.name !== 'desktop', 'one viewport is enough for a routing check');

	await newChat(page);
	await composer(page).fill('/image a lighthouse at dusk');
	await page.getByRole('button', { name: 'Send' }).click();

	// The endpoint is unreachable in this stack, so an error must surface — and it must surface *here*,
	// not as a chat reply, which is what proves `/image` never reaches the model. The picture itself
	// would land in the transcript under the last reply (see `placeImages`), never in a docked strip.
	await expect(page.getByText(/drawing|request failed|fetch failed|ECONNREFUSED/i)).toBeVisible({
		timeout: 20_000
	});
	await expect(transcript(page)).not.toContainText('Stub reply to:');
});

test('the scene panel shows the prompt the next picture would use', async ({ page }) => {
	// The screen the whole image pipeline is debugged through: it must show the *server's* prompt, not a
	// second implementation of the rules, and it must not need ComfyUI to do it (this asserts the text).
	test.skip(test.info().project.name !== 'desktop', 'one viewport is enough for a panel check');

	await newChat(page);
	await send(page, 'She waits by the window.');

	await page.getByRole('button', { name: 'Scene' }).click();
	const panel = page.getByRole('dialog', { name: 'Scene' });
	await expect(panel).toBeVisible();

	const prompt = panel.getByTestId('scene-prompt');
	// Default model is Z-Image, whose dialect is prose, so the framing arrives as a sentence.
	await expect(prompt).toContainText(/medium shot of/i);

	// The look is stored with the chat and reused by every prompt: saving it must change what the panel
	// shows, which is the only way the reader can tell a stale record from a bad model.
	const look = panel.getByLabel('Where this story happens');
	await look.fill('moonlit forest shrine');
	await look.blur();
	await expect(prompt).toContainText(/moonlit forest shrine/i);

	// Escape is the native dialog's job — if the panel swallowed it, the transcript would be stuck behind
	// an overlay that only a mouse could dismiss.
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
});

test('the composer draws the prompt as written, without asking the model', async ({ page }) => {
	// The button next to Send is the typed word's counterpart to "of this moment": it must reach the image
	// endpoint with the box's text verbatim, and it must *not* clear the box — the prompt is usually one
	// tweak away from the next picture, so the text is the reader's only copy of it.
	test.skip(test.info().project.name !== 'desktop', 'one viewport is enough for a routing check');

	await newChat(page);
	const box = composer(page);
	const draw = page.getByRole('button', { name: 'Draw', exact: true });

	// Nothing to draw, nothing to press.
	await expect(draw).toBeDisabled();

	await box.fill('a lighthouse at dusk, oil on canvas');
	await expect(draw).toBeEnabled();

	// The image stack has no ComfyUI here (it needs a GPU), so a visible failure is the proof that the
	// request went to the picture path; a chat reply would be the bug this test exists to catch.
	await draw.click();
	await expect(page.getByText(/drawing|request failed|fetch failed|ECONNREFUSED/i)).toBeVisible({
		timeout: 20_000
	});
	await expect(box).toHaveValue('a lighthouse at dusk, oil on canvas');
	await expect(transcript(page)).not.toContainText('Stub reply to:');
});

test('the scene panel draws the prompt it is showing', async ({ page }) => {
	// The panel's icon button sits beside the prompt for a reason: it draws *that* string. Sending any
	// other text would make the one screen built for debugging prompts a liar.
	test.skip(test.info().project.name !== 'desktop', 'one viewport is enough for a panel check');

	await newChat(page);
	await send(page, 'She waits by the window.');

	await page.getByRole('button', { name: 'Scene' }).click();
	const panel = page.getByRole('dialog', { name: 'Scene' });
	await expect(panel).toBeVisible();

	// Wait for the server's preview, then draw it. ComfyUI is absent, so the panel (or the job's error
	// banner) must say the request failed rather than silently doing nothing.
	const draw = panel.getByRole('button', { name: 'Draw', exact: true });
	await expect(draw).toBeEnabled();
	await draw.click();

	// Drawing closes the drawer so the result is visible in the transcript it belongs to.
	await expect(panel).toBeHidden();
	await expect(page.getByText(/drawing|request failed|fetch failed|ECONNREFUSED/i)).toBeVisible({
		timeout: 20_000
	});
});
