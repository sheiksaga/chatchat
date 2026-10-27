<script lang="ts">
	// Token entry for phones/tablets on the LAN. The token is only ever sent once, to set a cookie.
	import { KeyRound } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let token = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		// Full navigation (not fetch) so the 303 + Set-Cookie lands as a normal browser request.
		location.href = `/login?token=${encodeURIComponent(token)}`;
	}
</script>

<svelte:head><title>chatchat</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-6 py-10">
	<div class="flex w-full max-w-sm flex-col gap-5">
		<div class="flex flex-col gap-1.5">
			<span class="grid size-10 place-items-center rounded-xl bg-muted">
				<KeyRound class="size-4.5 text-muted-foreground" aria-hidden="true" />
			</span>
			<h1 class="text-display font-semibold tracking-[-0.01em]">chatchat</h1>
			<p class="text-ui text-muted-foreground">
				This app is reachable from your network, so it asks for the token set in
				<code class="font-mono text-[0.9em]">CHATCHAT_TOKEN</code>.
			</p>
		</div>
		<form onsubmit={submit} class="flex flex-col gap-2.5">
			<input
				bind:value={token}
				type="password"
				autocomplete="current-password"
				aria-label="Access token"
				class="rounded-lg border border-input bg-background px-3 py-2.5 text-ui placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
				placeholder="token"
			/>
			<Button type="submit" size="lg" disabled={!token}>Continue</Button>
		</form>
	</div>
</main>
