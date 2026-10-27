<script lang="ts">
	// Composer: autosizing textarea, Enter sends, Shift+Enter newline, Stop while streaming.
	//
	// Autosize is done by resetting the height and reading `scrollHeight`, which is the only method
	// that works without measuring off-screen clones; it is cheap enough to run per keystroke.
	//
	// The composer is *docked*, not floating: it is a sibling of the scroll area, so it can never
	// cover the last line of a reply. The hint row under the text is the app's main "what happens if
	// I press Enter" indicator, so it swaps to the live state while a reply is coming in.
	import { ArrowUp, Square } from '@lucide/svelte';

	let {
		status,
		onsend,
		onstop
	}: {
		status: string;
		onsend: (text: string) => void | Promise<void>;
		onstop: () => void;
	} = $props();

	let input = $state('');
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// `status` is one of ready | submitted | streaming | error. Only the two in-flight states mean a
	// reply is coming; after an error the composer must be usable again immediately.
	const busy = $derived(status === 'submitted' || status === 'streaming');
	const waiting = $derived(status === 'submitted');

	function resize(element: HTMLTextAreaElement) {
		element.style.height = 'auto';
		element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.4)}px`;
	}

	async function submit(event?: SubmitEvent) {
		event?.preventDefault();
		const text = input.trim();
		if (!text || busy) return;
		input = '';
		if (textarea) textarea.style.height = 'auto';
		await onsend(text);
	}

	$effect(() => {
		// Focus follows the reader: a reload or a new chat should be typeable immediately.
		textarea?.focus();
	});
</script>

<form
	onsubmit={submit}
	class="flex flex-col gap-1 rounded-2xl border border-input bg-card/60 px-3 py-2 transition-[border-color,box-shadow] duration-150 ease-soft focus-within:border-ring/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]"
>
	<textarea
		bind:this={textarea}
		bind:value={input}
		rows="1"
		class="max-h-[40vh] w-full resize-none bg-transparent py-1 text-ui leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none"
		placeholder={busy ? 'writing…' : 'Write a message…'}
		oninput={(event) => resize(event.currentTarget)}
		onkeydown={(event) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				void submit();
			}
		}}></textarea>

	<div class="flex items-center gap-3">
		<p class="min-w-0 flex-1 truncate text-label text-muted-foreground/80">
			{#if busy}
				<span class="inline-flex items-center gap-1.5 text-foreground/85">
					<span class="size-1.5 animate-thinking rounded-full bg-emerald-400"></span>
					{waiting ? 'Waiting for the first token…' : 'Writing…'}
				</span>
			{:else}
				Enter to send · Shift+Enter for a new line
			{/if}
		</p>

		{#if busy}
			<button
				type="button"
				class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-ui font-medium transition-colors duration-150 hover:bg-accent"
				onclick={onstop}
			>
				<Square class="size-3.5 fill-current" aria-hidden="true" />
				Stop
			</button>
		{:else}
			<button
				type="submit"
				class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-ui font-medium text-primary-foreground transition-[background-color,transform,opacity] duration-150 ease-soft hover:bg-primary/85 active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
				disabled={!input.trim()}
			>
				Send
				<ArrowUp class="size-4" aria-hidden="true" />
			</button>
		{/if}
	</div>
</form>
