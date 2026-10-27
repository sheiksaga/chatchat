<script lang="ts">
	// The per-message action bar.
	//
	// Extracted so the transcript stays readable, and so every action has the same hit area, the same
	// tooltip and the same keyboard order (after the message text, never before it).
	import { Copy, Pencil, RotateCcw, Trash2 } from '@lucide/svelte';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';

	let {
		oncopy,
		onedit,
		ondelete,
		onretry
	}: {
		oncopy: () => void;
		onedit: () => void;
		ondelete: () => void;
		/** Only offered on the last assistant reply, and only when nothing is streaming. */
		onretry?: (() => void) | undefined;
	} = $props();
</script>

<div class="flex items-center gap-0.5">
	<IconButton label="Copy" size="sm" onclick={oncopy}>
		<Copy aria-hidden="true" />
	</IconButton>
	<IconButton label="Edit" size="sm" onclick={onedit}>
		<Pencil aria-hidden="true" />
	</IconButton>
	{#if onretry}
		<IconButton label="Retry" size="sm" onclick={onretry}>
			<RotateCcw aria-hidden="true" />
		</IconButton>
	{/if}
	<IconButton label="Delete" size="sm" tone="danger" onclick={ondelete}>
		<Trash2 aria-hidden="true" />
	</IconButton>
</div>
