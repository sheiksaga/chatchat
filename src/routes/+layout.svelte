<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/chat/Sidebar.svelte';
	import Toaster from '$lib/components/ui/toast/Toaster.svelte';

	let { data, children } = $props();
</script>

<!-- Font size and content width as CSS variables, so components read them without prop drilling. -->
<div
	class="flex h-dvh overflow-hidden"
	style={`--content-width: ${data.appearance.contentWidth}ch; --content-size: ${data.appearance.fontSize}px;`}
>
	<Sidebar chats={data.chats} />
	<div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>

<Toaster />
