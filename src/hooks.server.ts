/**
 * Access control for LAN use.
 *
 * The app is local-first: loopback requests are always allowed, because that is the single-user
 * case and requiring a token there would defeat the double-click start. The moment a request
 * arrives from another machine (phone over LAN/Tailscale), it must carry the shared token.
 *
 * Token flow: `CHATCHAT_TOKEN=…` in the environment. Open `/login?token=…` once on the phone; the
 * server sets an httpOnly cookie and redirects to a clean URL. The cookie stores an HMAC of the
 * token rather than the token itself, so it is not a copy of the secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Handle } from '@sveltejs/kit';

const COOKIE = 'chatchat_token';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

/** What lands in the cookie: derived, never the token itself. */
function cookieValue(token: string): string {
	return createHmac('sha256', token).update('chatchat-lan-cookie-v1').digest('hex');
}

/**
 * No `Secure` flag on purpose: adapter-node reports the request as https even when it is plain
 * http (it infers the protocol from headers the browser does not send), and a Secure cookie over
 * http is silently dropped — which looks exactly like "the login form does nothing".
 * The transport for a LAN app is LAN/Tailscale itself; see docs/ARCHITECTURE.md for the threat model.
 */
function setCookieHeader(value: string): string {
	return [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=31536000'].join(
		'; '
	);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence that works on loopback *and* on a LAN address.
 *
 * SvelteKit's built-in check is disabled in `svelte.config.js` because adapter-node reports the
 * request as `https` when it is plain http, making its comparison fail on `http://192.168.x.x`.
 * Here we compare the `Origin` header against the request's own `Host` header.
 */
function sameOrigin(event: Parameters<Handle>[0]['event']): boolean {
	if (!MUTATING.has(event.request.method)) return true;
	const site = event.request.headers.get('sec-fetch-site');
	if (site === 'same-origin') return true;
	if (!site && !event.request.headers.get('origin')) return true; // curl, native clients
	const origin = event.request.headers.get('origin');
	const host = event.request.headers.get('host');
	if (!origin || !host) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	if (!sameOrigin(event)) {
		return new Response('chatchat: cross-origin request rejected.', {
			status: 403,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const expected = process.env.CHATCHAT_TOKEN;
	if (!expected) return resolve(event);

	const desired = cookieValue(expected);

	// `?token=` exists only to bootstrap the cookie, then disappears from the URL.
	// Built by hand: a Response returned from `handle` bypasses the framework's cookie
	// serialisation, so `event.cookies.set` here would silently emit nothing.
	const fromQuery = event.url.searchParams.get('token');
	if (fromQuery && safeEqual(fromQuery, expected)) {
		const clean = new URL(event.url);
		clean.searchParams.delete('token');
		// The bootstrap lives on /login; land the user in the app, not back on the form.
		const target = clean.pathname === '/login' ? '/' : clean.pathname + clean.search;
		return new Response(null, {
			status: 303,
			headers: {
				location: target,
				'set-cookie': setCookieHeader(desired),
				'cache-control': 'no-store'
			}
		});
	}

	let address = '';
	try {
		address = event.getClientAddress();
	} catch {
		// No adapter-provided address (dev edge case): treat as remote, i.e. require the token.
	}
	if (LOOPBACK.has(address)) return resolve(event);

	const cookie = event.cookies.get(COOKIE);
	if (cookie && safeEqual(cookie, desired)) return resolve(event);

	if (event.url.pathname === '/login') return resolve(event);

	return new Response('chatchat: a token is required on this address. Open /login.', {
		status: 401,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
};
