<!--
	Images for one chat: a thumbnail strip, a full-screen viewer, and the mask editor.

	The component owns the whole lifecycle so the chat page only has to ask it to `generate()`. Images
	arrive from the server load and are appended locally as they finish, so a fresh picture appears
	without a full page reload.
-->
<script lang="ts">
	import { ImagePlus, TriangleAlert, X } from '@lucide/svelte';
	import type { ImageRequest } from '$lib/shared/image.js';
	import type { ImageRow } from '$lib/server/db/images.js';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';
	import ImageViewport from './ImageViewport.svelte';
	import MaskEditor from './MaskEditor.svelte';

	let { chatId, images = $bindable([]) }: { chatId: string; images?: ImageRow[] } = $props();

	let viewing = $state<number | null>(null);
	let editing = $state<ImageRow | null>(null);
	let busy = $state<{ value: number; max: number } | null>(null);
	let error = $state<string | null>(null);

	const percent = $derived(busy && busy.max > 0 ? Math.min(100, (busy.value / busy.max) * 100) : 0);

	const shots = [
		['wide', 'Wide'],
		['medium', 'Medium'],
		['close', 'Close-up']
	] as const;

	/** Generate from a typed `/image …` command or from an `[[IMG: …]]` chip under a reply. */
	export async function generate(request: ImageRequest) {
		if (busy) return;
		error = null;
		busy = { value: 0, max: 1 };

		try {
			const response = await fetch('/api/images', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ chatId, ...request })
			});
			if (!response.ok || !response.body) {
				error = `request failed: ${response.status}`;
				return;
			}

			// The response is the job: read SSE frames until `done` or `error`.
			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				for (const line of value.split('\n')) {
					if (!line.startsWith('data: ')) continue;
					const event = JSON.parse(line.slice(6)) as {
						type: 'progress' | 'done' | 'error';
						value?: number;
						max?: number;
						image?: ImageRow;
						message?: string;
					};
					if (event.type === 'progress') {
						busy = { value: event.value ?? 0, max: event.max ?? 1 };
					} else if (event.type === 'done' && event.image) {
						images = [...images, event.image];
					} else if (event.type === 'error') {
						error = event.message ?? 'generation failed';
					}
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = null;
		}
	}

	/** "This moment": the server reads the transcript and returns a prompt, then we generate it. */
	export async function generateScene(shot: 'wide' | 'medium' | 'close') {
		if (busy) return;
		const response = await fetch('/api/images/scene', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chatId, shot })
		});
		if (!response.ok) {
			error = `could not build the scene prompt: ${response.status}`;
			return;
		}
		const scene = (await response.json()) as { prompt: string; width: number; height: number };
		await generate(scene);
	}

	/** Regenerate: same prompt, new seed unless the caller pinned one. */
	function regenerate(image: ImageRow, pinnedSeed?: number) {
		void generate({
			prompt: image.prompt ?? '',
			width: image.width ?? undefined,
			height: image.height ?? undefined,
			seed: pinnedSeed
		});
	}
</script>

<section class="flex flex-col gap-2 border-t border-border/50 pt-2.5">
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="me-1 inline-flex items-center gap-1.5 text-label text-muted-foreground">
			<ImagePlus class="size-3.5" aria-hidden="true" />
			Picture of this moment
		</span>
		{#each shots as [shot, label] (shot)}
			<button
				class="inline-flex h-7 items-center rounded-md border border-border/70 bg-card/40 px-2.5 text-label text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
				disabled={!!busy}
				onclick={() => generateScene(shot)}>{label}</button
			>
		{/each}
		<span class="ms-auto text-label text-muted-foreground/70">
			or type <code class="font-mono text-foreground/80">/image …</code>
		</span>
	</div>

	{#if images.length || busy}
		<div class="flex items-center gap-2 overflow-x-auto pb-1">
			{#each images as image, index (image.id)}
				<button
					class="group/img relative size-16 shrink-0 overflow-hidden rounded-lg border border-border/70 transition-[transform,border-color] duration-150 ease-soft hover:-translate-y-0.5 hover:border-foreground/30"
					title={image.prompt ?? 'Open picture'}
					onclick={() => (viewing = index)}
				>
					<img
						class="h-full w-full object-cover transition-transform duration-200 ease-soft group-hover/img:scale-[1.06]"
						src="/api/images/{image.id}"
						alt={image.prompt ?? 'generated image'}
					/>
				</button>
			{/each}

			{#if busy}
				<div
					class="flex h-16 min-w-52 flex-col justify-center gap-1.5 rounded-lg border border-border/70 px-3"
				>
					<span class="text-label text-muted-foreground">
						Generating {busy.value}/{busy.max}
					</span>
					<div class="h-1 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="progress-strip h-full rounded-full bg-foreground/80 transition-[width] duration-300 ease-soft"
							style="width: {percent}%"
						></div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<div
			class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-label text-destructive"
			role="alert"
		>
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
			<p class="min-w-0 flex-1 break-words">{error}</p>
			<IconButton label="Dismiss" size="sm" onclick={() => (error = null)}>
				<X aria-hidden="true" />
			</IconButton>
		</div>
	{/if}

	{#if viewing !== null && images[viewing]}
		<ImageViewport
			{images}
			index={viewing}
			onindex={(next) => (viewing = next)}
			onclose={() => (viewing = null)}
			onregenerate={(image, seed) => regenerate(image, seed)}
			onedit={(image) => {
				viewing = null;
				editing = image;
			}}
			ondelete={async (image) => {
				await fetch(`/api/images/${image.id}`, { method: 'DELETE' });
				images = images.filter((candidate) => candidate.id !== image.id);
				viewing = null;
			}}
		/>
	{/if}

	{#if editing}
		<MaskEditor
			image={editing}
			{chatId}
			onclose={() => (editing = null)}
			onsaved={(image) => {
				images = [...images, image];
				editing = null;
			}}
		/>
	{/if}
</section>
