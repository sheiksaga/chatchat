<script lang="ts">
	// One chat, one component instance.
	//
	// SvelteKit reuses a page component when only the route parameter changes (`/chat/a` → `/chat/b`),
	// so every `$state` initializer in here runs **once** — for the first chat you opened. That is how one
	// chat's pictures used to follow the reader into the next, and why the AI SDK `Chat` had to be rebuilt
	// by hand in an effect. Keying on the chat id rebuilds the whole view instead: the transcript, the
	// pictures, the look, the edit-in-progress and the client chat all start fresh, and there is no list of
	// "remember to reset this too" to get wrong later.
	import ChatView from './ChatView.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

{#key data.chat.id}
	<ChatView {data} />
{/key}
