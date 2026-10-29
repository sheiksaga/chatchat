/**
 * Navigation helpers shared by the specs.
 *
 * Below `md` the chat list is a drawer, so a test that reaches for a chat there has to open it first —
 * exactly like a person would. The menu button exists only on a small viewport, which makes this the
 * same call in both Playwright projects.
 */
import { expect, type Page } from '@playwright/test';

export const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message…' });

/** Open the sidebar if it is a drawer at this viewport (no-op on desktop). */
export async function openSidebar(page: Page) {
	const menu = page.getByRole('button', { name: 'Menu', exact: true });
	if (await menu.isVisible().catch(() => false)) {
		await menu.click();
		await expect(page.getByTestId('sidebar')).toBeVisible();
	}
}

/** Start a chat from the root page, through whichever "New chat" button this viewport offers. */
export async function newChat(page: Page) {
	await page.goto('/');
	await openSidebar(page);
	await page.getByRole('button', { name: 'New chat' }).first().click();
	await expect(composer(page)).toBeVisible();
}
