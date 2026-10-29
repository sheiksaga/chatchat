<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import Sidebar from '$lib/components/chat/Sidebar.svelte';
	import { provideSidebarDrawer } from '$lib/components/chat/sidebar-drawer.svelte.js';
	import Toaster from '$lib/components/ui/toast/Toaster.svelte';

	let { data, children } = $props();

	const drawer = provideSidebarDrawer();

	/**
	 * Navigating away is a reason for the drawer to get out of the way: a phone has ~380px of width, and
	 * leaving the panel over the page you just asked for looks like the tap did nothing.
	 */
	$effect(() => {
		void page.url.pathname;
		drawer.hide();
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && drawer.open) drawer.hide();
	}}
/>

<!-- Font size and content width as CSS variables, so components read them without prop drilling. -->
<div
	class="flex h-dvh overflow-hidden"
	style={`--content-width: ${data.appearance.contentWidth}ch; --content-size: ${data.appearance.fontSize}px;`}
>
	{#if drawer.open}
		<!-- Tap-outside to close, which is what a phone user reaches for. Dimmed, not blurred to mush. -->
		<button
			class="fixed inset-0 z-30 animate-fade-in bg-black/55 md:hidden"
			tabindex="-1"
			aria-label="Close menu"
			onclick={() => drawer.hide()}
		></button>
	{/if}

	<!--
		One <Sidebar>, two presentations:
		· below `md`: fixed, off-canvas, hidden from the accessibility tree and the tab order while closed
		  (`invisible`, not `hidden`, so the slide-in still animates);
		· at `md` and up: back in the flow as a column, always visible.
		The width lives here because it changes per presentation; the sidebar itself just fills it.
	-->
	<div
		class="fixed inset-y-0 start-0 z-40 w-[min(17.5rem,85vw)] shrink-0 transition-transform duration-200 ease-soft md:visible md:static md:z-auto md:w-60 md:translate-x-0 lg:w-[17.5rem] {drawer.open
			? 'visible translate-x-0'
			: 'invisible -translate-x-full'}"
		data-testid="sidebar"
	>
		<Sidebar chats={data.chats} />
	</div>

	<div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>

<Toaster />
