<script lang="ts">
	// The one place toasts are drawn. Mounted once in +layout.svelte.
	//
	// Bottom-centre, above the composer, is the least intrusive spot on a desktop: it never covers
	// the message you are reading and it is where the eye already rests after an action.
	import { Check, Info, TriangleAlert, X } from '@lucide/svelte';
	import { toasts, type ToastTone } from '$lib/stores/toast.svelte.js';

	const icons: Record<ToastTone, typeof Info> = {
		info: Info,
		success: Check,
		error: TriangleAlert
	};

	const tones: Record<ToastTone, string> = {
		info: 'text-muted-foreground',
		success: 'text-emerald-400',
		error: 'text-destructive'
	};
</script>

<div
	class="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-6 sm:bottom-6 sm:items-end"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toasts.items as toast (toast.id)}
		{@const Icon = icons[toast.tone]}
		<!-- Only the dismiss button takes clicks: a toast that lands over the Send button for two
		     seconds must not swallow the click that was aimed at it. -->
		<div
			class="flex max-w-md animate-toast-in items-center gap-2.5 rounded-full border border-border/80 bg-popover/95 py-2 ps-3 pe-2 text-ui text-popover-foreground shadow-lg shadow-black/40 backdrop-blur-sm"
			role="status"
		>
			<Icon class="size-4 shrink-0 {tones[toast.tone]}" aria-hidden="true" />
			<span class="min-w-0">{toast.message}</span>
			<button
				type="button"
				aria-label="Dismiss"
				title="Dismiss"
				class="pointer-events-auto grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
				onclick={() => toasts.dismiss(toast.id)}
			>
				<X class="size-3.5" aria-hidden="true" />
			</button>
		</div>
	{/each}
</div>
