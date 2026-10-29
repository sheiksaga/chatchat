<script lang="ts">
	// A phone cannot run `npm run doctor`; this page is that command, in the browser.
	import { resolve } from '$app/paths';
	import { Check, X } from '@lucide/svelte';
	import SidebarTrigger from '$lib/components/chat/SidebarTrigger.svelte';

	let { data } = $props();

	const failing = $derived(data.checks.filter((check: { ok: boolean }) => !check.ok).length);
</script>

<svelte:head><title>Diagnostics · chatchat</title></svelte:head>

<main class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
	<header class="flex flex-col gap-1 border-b border-border/60 pb-5">
		<div class="flex items-center gap-2.5">
			<SidebarTrigger />
			<h1 class="text-display font-semibold tracking-[-0.01em]">Diagnostics</h1>
		</div>
		<p class="text-ui text-muted-foreground">
			Using <span class="font-mono text-foreground">{data.activeProvider}</span>
			{data.model ? `· ${data.model}` : '· no model selected'}
		</p>
	</header>

	<p
		class="rounded-lg border px-3 py-2 text-ui {failing === 0
			? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
			: 'border-destructive/30 bg-destructive/10 text-destructive'}"
		role="status"
	>
		{failing === 0 ? 'Every check passed.' : `${failing} of ${data.checks.length} checks failed.`}
	</p>

	<ul class="flex flex-col gap-1.5">
		{#each data.checks as check (check.name)}
			<li class="flex items-start gap-3 rounded-xl border border-border/70 px-3 py-2.5">
				<span
					class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full {check.ok
						? 'bg-emerald-400/15 text-emerald-400'
						: 'bg-destructive/15 text-destructive'}"
				>
					{#if check.ok}
						<Check class="size-3.5" aria-hidden="true" />
					{:else}
						<X class="size-3.5" aria-hidden="true" />
					{/if}
				</span>
				<span class="flex min-w-0 flex-col gap-0.5">
					<span class="text-ui font-medium">{check.name}</span>
					<span class="font-mono text-label break-words text-muted-foreground">{check.detail}</span>
				</span>
			</li>
		{/each}
	</ul>

	<p class="text-label text-muted-foreground">
		Fix a failing provider in <a
			class="underline underline-offset-2 hover:text-foreground"
			href={resolve('/settings')}>settings</a
		>. ComfyUI must be started before llama.cpp on an 8 GB card, so it can claim its CUDA context
		first.
	</p>
</main>
