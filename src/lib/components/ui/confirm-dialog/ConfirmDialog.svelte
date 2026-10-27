<script lang="ts">
	// In-app replacement for `window.confirm()`, which blocks the thread, cannot be styled and is not
	// dismissible with Escape on every platform.
	//
	// A real `<dialog>` with `showModal()`: focus trapping, Escape and the backdrop are the browser's
	// job, and deleting is one keystroke away from being a mistake we cannot undo.
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		open = $bindable(false),
		title,
		description = '',
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		destructive = true,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
		onconfirm: () => void | Promise<void>;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let busy = $state(false);

	// Keep the native dialog in sync with the prop; `close()` fires `onclose`, which sets it back,
	// so Escape and the Cancel button follow the same path.
	$effect(() => {
		const element = dialog;
		if (!element) return;
		if (open && !element.open) element.showModal();
		else if (!open && element.open) element.close();
	});

	async function confirm() {
		if (busy) return;
		busy = true;
		try {
			await onconfirm();
		} finally {
			busy = false;
			open = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl shadow-black/60 backdrop:bg-black/55 backdrop:backdrop-blur-[2px] open:animate-pop-in"
	onclose={() => (open = false)}
	oncancel={(event) => {
		event.preventDefault();
		open = false;
	}}
>
	<form method="dialog" class="flex flex-col gap-4 p-5" onsubmit={(e) => e.preventDefault()}>
		<div class="flex flex-col gap-1.5">
			<h2 class="text-title font-semibold tracking-[-0.01em]">{title}</h2>
			{#if description}
				<p class="text-ui text-muted-foreground">{description}</p>
			{/if}
		</div>
		<div class="flex justify-end gap-2">
			<Button variant="ghost" size="lg" onclick={() => (open = false)}>{cancelLabel}</Button>
			<Button
				size="lg"
				variant={destructive ? 'destructive' : 'default'}
				disabled={busy}
				onclick={confirm}
			>
				{busy ? 'Working…' : confirmLabel}
			</Button>
		</div>
	</form>
</dialog>
