<script lang="ts">
	// Spike 0.2 — prove the AI SDK 7 + llama.cpp path end-to-end in the browser.
	// Throwaway page: the real chat UI starts in Phase 3.
	//
	// Gotcha (cost 20 minutes): a block comment placed ABOVE the script tag in a
	// .svelte file is rendered as page text, and a nested comment terminator
	// inside a header comment breaks parsing. Keep headers inside <script>, flat.
	import { Chat, type UIMessage } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import { Button } from '$lib/components/ui/button/index.js';

	let { data } = $props();

	// Spike page only: `data` is static here, so capturing it once is intentional.
	// svelte-ignore state_referenced_locally
	const chat = new Chat({
		transport: new DefaultChatTransport({
			api: '/api/chat',
			body: { model: data.model }
		}),
		onError(err) {
			console.error('[spike] chat error', err);
		}
	});

	let input = $state('Write two sentences about a lighthouse at dusk.');
	let errorText = $state('');

	$effect(() => {
		if (chat.error) errorText = chat.error.message;
	});

	async function send(event: SubmitEvent) {
		event.preventDefault();
		const text = input.trim();
		if (!text || chat.status !== 'ready') return;
		errorText = '';
		await chat.sendMessage({ text });
	}

	function textOf(message: UIMessage) {
		return message.parts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('');
	}
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
	<h1 class="text-xl font-semibold">spike 0.2 — llama.cpp via AI SDK</h1>
	<p class="text-sm text-muted-foreground">model: {data.model} · status: {chat.status}</p>

	{#each chat.messages as message (message.id)}
		<div class="rounded-lg border p-3">
			<div class="mb-1 text-xs text-muted-foreground uppercase">{message.role}</div>
			<pre class="font-sans text-sm whitespace-pre-wrap">{textOf(message)}</pre>
		</div>
	{/each}

	<form onsubmit={send} class="flex gap-2">
		<input
			bind:value={input}
			class="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
			placeholder="prompt"
		/>
		<Button type="submit" disabled={chat.status !== 'ready'}>
			{chat.status === 'streaming' ? 'streaming…' : 'Send'}
		</Button>
	</form>

	{#if errorText}
		<p class="text-sm text-destructive">error: {errorText}</p>
	{/if}
</main>
