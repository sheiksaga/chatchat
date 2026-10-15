const { test, expect } = require('@playwright/test');

/**
 * What the app says when the local server is not there.
 *
 * This is the single most likely failure in a client-only app pointed at a
 * local server, and the browsers report it uselessly: Chrome says "Failed to
 * fetch", Firefox says "NetworkError when attempting to fetch resource." (and
 * in its console dresses the same failure up as "Cross-Origin Request Blocked
 * ... CORS request did not succeed", which MDN confirms is "not directly
 * related to CORS").
 *
 * The app cannot detect CORS either — a rejected fetch is opaque by design, so
 * the distinction between "nothing is listening" and "origin refused" is not
 * observable from JavaScript. The tests below therefore pin the honest
 * behaviour: name the host, name both causes, and never claim to know which.
 *
 * `route.abort('connectionrefused')` reproduces the browser's network-level
 * rejection, which is what a page sees whether the server is down or the
 * response was CORS-blocked.
 */

/** Make every request to the local provider fail at the network level. */
async function makeLocalServerUnreachable(page) {
  await page.route('**/v1/**', (route) => route.abort('connectionrefused'));
}

test('the model list names the host and both causes when nothing is listening', async ({
  page
}) => {
  await makeLocalServerUnreachable(page);
  await page.goto('/');

  await page.locator('#model-selector').click();

  const error = page.locator('#model-dropdown .model-dropdown-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText("Can't reach http://localhost:1234");
  // Both possible causes, and no false claim about which one it is.
  await expect(error).toContainText('nothing is listening');
  await expect(error).toContainText('refusing requests');
  // The browser-specific string must not leak through.
  await expect(error).not.toContainText('Failed to fetch');
  await expect(error).not.toContainText('NetworkError');
});

test('a failed generation explains itself instead of saying "Failed to fetch"', async ({
  page
}) => {
  await makeLocalServerUnreachable(page);
  await page.goto('/');

  await page.locator('#hero-input-box').click();
  await page.locator('#hero-input-text').fill('Hello?');
  await page.locator('#hero-send-btn').click();

  const failed = page.locator('#messages .message.assistant').last();
  await expect(failed).toContainText("Can't reach http://localhost:1234");
  await expect(failed).not.toContainText('Failed to fetch');

  // The turn is recoverable — the user turn survived, so Retry can resend.
  await expect(failed.getByText('Retry')).toBeVisible();
});

test('the message advises enabling cross-origin access, not just "start it"', async ({
  page
}) => {
  await makeLocalServerUnreachable(page);
  await page.goto('/');

  await page.locator('#model-selector').click();
  const error = page.locator('#model-dropdown .model-dropdown-error');
  await expect(error).toContainText('allow cross-origin requests from this page');
});

test('a server that answers with an error is not reported as unreachable', async ({
  page
}) => {
  // The counter-case: an HTTP error status must keep its real detail, because
  // "unreachable" would send the user chasing a running, healthy server.
  await page.route('**/v1/models', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'model failed to load' } })
    })
  );
  await page.goto('/');

  await page.locator('#model-selector').click();
  const error = page.locator('#model-dropdown .model-dropdown-error');
  await expect(error).toContainText('HTTP 503');
  await expect(error).not.toContainText("Can't reach");
});
