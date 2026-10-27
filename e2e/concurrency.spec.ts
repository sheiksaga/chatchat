/**
 * Two tabs, one chat.
 *
 * SQLite runs in WAL mode so readers never block a writer, but that promise is worth testing rather
 * than asserting: two streams finishing at the same time must both land, and neither may produce a
 * lock error or a lost message. This is the "two-tab safety check" from `_notes/TODO.md`, as a test.
 *
 * The failure this is looking for: `SQLITE_BUSY` surfacing as a 500, or the second write silently
 * overwriting the first because both were read-modify-write on the same row.
 */
import { expect, test, type Page } from '@playwright/test';

const transcript = (page: Page) => page.getByTestId('transcript');

async function streamFinished(page: Page, action: () => Promise<void>) {
	const finished = page.waitForResponse(
		(response) => response.url().includes('/api/chat') && response.status() === 200
	);
	await action();
	await (await finished).finished();
}

test('two tabs can write to the same chat at the same time', async ({ page, context }) => {
	// A fresh chat, created through the UI so this test does not depend on an internal API.
	await page.goto('/');
	await page.getByRole('button', { name: 'New chat' }).first().click();
	await expect(page.getByRole('textbox', { name: 'Write a message…' })).toBeVisible();
	const url = page.url();

	// The second tab is a real second page on the same URL — same chat id, separate client state.
	const other = await context.newPage();
	await other.goto(url);
	await expect(other.getByRole('textbox', { name: 'Write a message…' })).toBeVisible();

	// Both send immediately, so the two requests overlap on the server.
	await Promise.all([
		streamFinished(page, async () => {
			await page.getByRole('textbox', { name: 'Write a message…' }).fill('tab one speaking');
			await page.getByRole('button', { name: 'Send' }).click();
		}),
		streamFinished(other, async () => {
			await other.getByRole('textbox', { name: 'Write a message…' }).fill('tab two speaking');
			await other.getByRole('button', { name: 'Send' }).click();
		})
	]);

	// Both tabs reload: each must read the same, complete transcript back out of SQLite.
	for (const tab of [page, other]) {
		await tab.reload();
		await expect(transcript(tab)).toContainText('tab one speaking', { timeout: 15_000 });
		await expect(transcript(tab)).toContainText('tab two speaking');
		// Two questions, two answers — nothing swallowed by a concurrent write.
		await expect(tab.locator('article[data-role="assistant"]')).toHaveCount(2);
		await expect(tab.getByText(/database is locked|SQLITE_BUSY/i)).toHaveCount(0);
	}

	await other.close();
});
