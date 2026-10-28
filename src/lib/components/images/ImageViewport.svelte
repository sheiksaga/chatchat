<!--
	Full-screen viewer: one image at a time, arrows, and the actions that make sense on a picture
	you are looking at (regenerate with the same prompt, edit a region, delete).
-->
<script lang="ts">
	import {
		ChevronLeft,
		ChevronRight,
		ExternalLink,
		Paintbrush,
		RotateCcw,
		Send,
		Sparkles,
		Trash2,
		X
	} from '@lucide/svelte';
	import type { ImageRow } from '$lib/server/db/images.js';

	let {
		images,
		index,
		onindex,
		onclose,
		onregenerate,
		onedit,
		oninstruct,
		ondelete
	}: {
		images: ImageRow[];
		index: number;
		onindex: (next: number) => void;
		onclose: () => void;
		onregenerate: (image: ImageRow, seed?: number) => void;
		onedit: (image: ImageRow) => void;
		oninstruct: (image: ImageRow, instruction: string) => void;
		ondelete: (image: ImageRow) => void;
	} = $props();

	let image = $derived(images[index]);
	/** Instruction panel: hidden until asked for, because most of the time you just look at pictures. */
	let instructing = $state(false);
	let instruction = $state('');

	function applyInstruction() {
		const text = instruction.trim();
		if (!text || !image) return;
		oninstruct(image, text);
		instruction = '';
		instructing = false;
	}

	function step(delta: number) {
		const next = index + delta;
		if (next < 0 || next >= images.length) return;
		onindex(next);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		if (event.key === 'ArrowLeft') step(-1);
		if (event.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window {onkeydown} />

<div
	class="fixed inset-0 z-50 flex animate-fade-in flex-col gap-3 bg-black/85 p-4 text-white backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-label="Image viewer"
>
	<div class="flex items-center gap-3 text-label text-white/80">
		<span class="rounded-full bg-white/10 px-2 py-0.5 font-mono tabular-nums">
			{index + 1}/{images.length}
		</span>
		{#if image?.width && image.height}
			<span>{image.width}×{image.height}</span>
		{/if}
		{#if image?.seed !== null && image?.seed !== undefined}
			<span class="font-mono">seed {image.seed}</span>
		{/if}
		<span class="truncate text-white/50">{image?.prompt}</span>
		<button
			class="ms-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label text-white transition-colors duration-150 hover:bg-white/10"
			onclick={onclose}
		>
			<X class="size-3.5" aria-hidden="true" />
			Close
		</button>
	</div>

	<div class="flex min-h-0 flex-1 items-center justify-center gap-3">
		<button
			class="grid size-10 shrink-0 place-items-center rounded-full border border-white/20 text-white transition-[background-color,opacity,transform] duration-150 ease-soft hover:-translate-x-0.5 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-20"
			aria-label="Previous image"
			title="Previous image (←)"
			disabled={index === 0}
			onclick={() => step(-1)}
		>
			<ChevronLeft class="size-5" aria-hidden="true" />
		</button>
		{#if image}
			<img
				class="max-h-full min-h-0 max-w-full animate-fade-in rounded-lg object-contain shadow-2xl shadow-black/60"
				src="/api/images/{image.id}"
				alt={image.prompt ?? 'generated image'}
			/>
		{/if}
		<button
			class="grid size-10 shrink-0 place-items-center rounded-full border border-white/20 text-white transition-[background-color,opacity,transform] duration-150 ease-soft hover:translate-x-0.5 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-20"
			aria-label="Next image"
			title="Next image (→)"
			disabled={index >= images.length - 1}
			onclick={() => step(1)}
		>
			<ChevronRight class="size-5" aria-hidden="true" />
		</button>
	</div>

	{#if image}
		<div class="flex flex-wrap items-center gap-2">
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
				onclick={() => onregenerate(image)}
			>
				<RotateCcw class="size-3.5" aria-hidden="true" />
				Regenerate
			</button>
			{#if image.seed !== null && image.seed !== undefined}
				<button
					class="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
					onclick={() => onregenerate(image, image.seed ?? undefined)}
				>
					Same seed
				</button>
			{/if}
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
				onclick={() => onedit(image)}
			>
				<Paintbrush class="size-3.5" aria-hidden="true" />
				Edit a region
			</button>
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
				aria-expanded={instructing}
				onclick={() => (instructing = !instructing)}
			>
				<Sparkles class="size-3.5" aria-hidden="true" />
				Change with a sentence
			</button>
			<!-- Raw bytes in a new tab: an action, not a route, so `resolve()` does not apply. -->
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
				onclick={() => window.open(`/api/images/${image.id}`, '_blank')}
			>
				<ExternalLink class="size-3.5" aria-hidden="true" />
				Open original
			</button>
			<button
				class="ms-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/40 px-2.5 text-label text-red-300 transition-colors duration-150 hover:bg-red-400/15"
				onclick={() => ondelete(image)}
			>
				<Trash2 class="size-3.5" aria-hidden="true" />
				Delete
			</button>
		</div>
		{#if instructing}
			<form
				class="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 p-2"
				onsubmit={(event) => {
					event.preventDefault();
					applyInstruction();
				}}
			>
				<label class="sr-only" for="instruction">What should change?</label>
				<input
					id="instruction"
					class="h-8 min-w-0 flex-1 rounded-md border border-white/20 bg-black/30 px-2.5 text-label text-white placeholder:text-white/40"
					placeholder="black evening gown instead of the sweater"
					bind:value={instruction}
					autocomplete="off"
				/>
				<button
					class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
					type="submit"
					disabled={!instruction.trim()}
				>
					<Send class="size-3.5" aria-hidden="true" />
					Apply
				</button>
			</form>
		{/if}
	{/if}
</div>
