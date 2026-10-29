<!--
	The way into the sidebar on a phone.

	Below `md` the chat list is a drawer, so every page that can afford a header puts this button first in
	it; the button disappears at `md` and up, where the sidebar is a column again. It has to be *in* the
	header rather than floating: a floating button would either cover a control or force every page to
	reserve space for it, and this app has no second row of chrome to spare on a 660px-tall screen.
-->
<script lang="ts">
	import { Menu } from '@lucide/svelte';
	import { useSidebarDrawer } from './sidebar-drawer.svelte.js';

	const drawer = useSidebarDrawer();
</script>

<button
	type="button"
	class="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:hidden"
	aria-label="Menu"
	title="Chats, characters and settings"
	aria-expanded={drawer.open}
	onclick={() => drawer.toggle()}
>
	<Menu class="size-4" aria-hidden="true" />
</button>
