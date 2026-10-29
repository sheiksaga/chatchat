<!--
	One picture, in the transcript where it belongs.

	Shape, deliberately: the **prompt sits above** the image, so a picture is always read with the words
	that made it (a caption underneath reads as the picture's title, which it is not), and the image
	below it at full readable size. A filmstrip at the bottom of the screen could not do either: it
	followed the reader instead of the conversation, so pictures from turn 3 appeared to belong to turn
	40, and the prompt was a tooltip.

	Clicking the image opens the full-screen viewer (arrows, regenerate, edit, delete). The toolbar in
	the caption is the same actions without the round trip, revealed on hover — and always visible on a
	touch screen, which has no hover.
-->
<script lang="ts">
	import { Expand, Paintbrush, RotateCcw, Sparkles, Trash2 } from '@lucide/svelte';
	import { imageModelLabel, type ImageRecord } from '$lib/shared/image.js';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';

	let {
		image,
		onopen,
		onregenerate,
		onedit,
		ondelete
	}: {
		image: ImageRecord;
		onopen: () => void;
		onregenerate?: () => void;
		onedit?: () => void;
		ondelete?: () => void;
	} = $props();

	const model = $derived(imageModelLabel(image.workflow));

	/**
	 * How wide the card may be: never wider than the column, never so tall that a portrait fills the
	 * screen. Doing it in CSS (`min()` over `vh`) rather than in JS means it also reacts to a rotated
	 * phone. The ratio falls back to 2:3 for a row whose size was never recorded.
	 */
	const ratio = $derived(image.width && image.height ? image.width / image.height : 832 / 1216);
</script>

<figure
	class="group/pic w-full overflow-hidden rounded-xl border border-border/60 bg-card/40"
	style="max-width: min(100%, 28rem, calc(68vh * {ratio.toFixed(4)}))"
	data-image-id={image.id}
>
	<figcaption class="flex items-start gap-2 border-b border-border/40 px-3 py-2">
		<Sparkles class="mt-1 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
		<p
			class="line-clamp-2 min-w-0 flex-1 text-label leading-snug text-muted-foreground"
			title={image.prompt ?? model}
		>
			{image.prompt ?? 'no prompt recorded'}
		</p>

		<span
			class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/pic:opacity-100 group-hover/pic:opacity-100 hover-none:opacity-100"
		>
			{#if onregenerate}
				<IconButton label="Regenerate" title="Draw it again" size="sm" onclick={onregenerate}>
					<RotateCcw aria-hidden="true" />
				</IconButton>
			{/if}
			{#if onedit}
				<IconButton label="Edit" title="Paint over part of it" size="sm" onclick={onedit}>
					<Paintbrush aria-hidden="true" />
				</IconButton>
			{/if}
			{#if ondelete}
				<IconButton label="Delete" title="Delete this picture" size="sm" onclick={ondelete}>
					<Trash2 aria-hidden="true" />
				</IconButton>
			{/if}
		</span>
	</figcaption>

	<button
		class="relative block w-full cursor-zoom-in bg-black/25"
		aria-label="Open this picture"
		onclick={onopen}
	>
		<img
			class="h-auto w-full"
			src="/api/images/{image.id}"
			alt={image.prompt ?? 'generated image'}
			width={image.width ?? undefined}
			height={image.height ?? undefined}
			loading="lazy"
		/>
		<span
			class="pointer-events-none absolute end-2 bottom-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-label text-white/85 opacity-0 backdrop-blur transition-opacity duration-150 group-hover/pic:opacity-100"
		>
			<Expand class="size-3" aria-hidden="true" />
			<span class="hidden sm:inline">{model}</span>
		</span>
	</button>
</figure>
