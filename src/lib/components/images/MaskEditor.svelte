<!--
	Paint a mask, describe the change, get an edited picture.

	The mask is a second canvas: black everywhere, white where the brush went, exported as PNG. That is
	exactly what the LLLite inpaint graph expects (white = repaint), so no server-side mask maths.
-->
<script lang="ts">
	import type { ImageRow } from '$lib/server/db/images.js';

	let {
		image,
		chatId,
		onclose,
		onsaved
	}: {
		image: ImageRow;
		chatId: string;
		onclose: () => void;
		onsaved: (image: ImageRow) => void;
	} = $props();

	let brush = $state(48);
	let prompt = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let painting = $state(false);
	let edited = $state(false);

	let view: HTMLCanvasElement;
	let mask: HTMLCanvasElement;
	let loaded = $state(false);

	/** Load the picture onto the visible canvas, sized to fit the screen. */
	function loadImage() {
		const source = new Image();
		source.onload = () => {
			const scale = Math.min(1, 900 / source.naturalWidth);
			for (const canvas of [view, mask]) {
				canvas.width = Math.round(source.naturalWidth * scale);
				canvas.height = Math.round(source.naturalHeight * scale);
			}
			const context = view.getContext('2d');
			context?.drawImage(source, 0, 0, view.width, view.height);
			fillMask();
			loaded = true;
		};
		source.src = `/api/images/${image.id}`;
	}

	// The canvases only exist after the first render, so load the picture once they are bound.
	$effect(() => {
		if (!loaded && view && mask) loadImage();
	});

	function fillMask() {
		const context = mask.getContext('2d');
		if (!context) return;
		context.fillStyle = 'black';
		context.fillRect(0, 0, mask.width, mask.height);
		edited = false;
	}

	function paint(event: PointerEvent) {
		if (!painting) return;
		const rect = mask.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * mask.width;
		const y = ((event.clientY - rect.top) / rect.height) * mask.height;
		const context = mask.getContext('2d');
		if (!context) return;
		context.fillStyle = 'white';
		context.beginPath();
		context.arc(x, y, (brush / rect.width) * mask.width, 0, Math.PI * 2);
		context.fill();
		edited = true;
	}

	async function submit() {
		if (!edited) {
			error = 'Paint over the part you want to change first.';
			return;
		}
		error = null;
		busy = true;
		try {
			const [source, maskBlob] = await Promise.all([toPng(view), toPng(mask)]);
			const form = new FormData();
			form.set('source', source, 'source.png');
			form.set('mask', maskBlob, 'mask.png');
			form.set('prompt', prompt);
			form.set('chatId', chatId);
			form.set('messageId', '');
			const response = await fetch('/api/images/inpaint', { method: 'POST', body: form });
			const body = (await response.json()) as { image?: ImageRow; error?: string };
			if (!response.ok || !body.image) {
				error = body.error ?? `inpaint failed: ${response.status}`;
				return;
			}
			onsaved(body.image);
		} finally {
			busy = false;
		}
	}

	function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
		return new Promise((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('could not encode the canvas'))),
				'image/png'
			)
		);
	}
</script>

<div
	class="fixed inset-0 z-50 flex animate-fade-in flex-col gap-3 overflow-auto bg-black/85 p-4 text-white backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-label="Mask editor"
>
	<div class="flex flex-wrap items-center gap-3">
		<span class="text-ui font-semibold">Edit a region</span>
		<span class="text-label text-white/55"
			>paint where the change goes · white area is repainted</span
		>
		<button
			class="ms-auto inline-flex h-8 items-center rounded-md border border-white/20 px-2.5 text-label transition-colors duration-150 hover:bg-white/10"
			onclick={onclose}
		>
			Close
		</button>
	</div>

	<div class="relative mx-auto" style="max-width: min(900px, 100%);">
		<canvas bind:this={view} class="rounded-lg border border-white/15"></canvas>
		<!-- `mix-blend-mode: screen` makes black invisible and white bright, so the painted region reads
		     as a glow over the picture instead of a grey film across the whole canvas. -->
		<canvas
			bind:this={mask}
			class="absolute inset-0 h-full w-full cursor-crosshair rounded-lg opacity-60 mix-blend-screen"
			onpointerdown={(event) => {
				painting = true;
				paint(event);
			}}
			onpointermove={paint}
			onpointerup={() => (painting = false)}
			onpointerleave={() => (painting = false)}
		></canvas>
	</div>

	<div class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 text-label">
		<label class="flex items-center gap-2">
			Brush
			<input type="range" min="8" max="160" bind:value={brush} />
			<span class="w-8 rounded bg-white/10 px-1 text-center font-mono tabular-nums">{brush}</span>
		</label>
		<button
			class="inline-flex h-8 items-center rounded-md border border-white/20 px-2.5 transition-colors duration-150 hover:bg-white/10"
			onclick={fillMask}>Clear mask</button
		>
		<button
			class="inline-flex h-8 items-center rounded-md border border-white/20 px-2.5 transition-colors duration-150 hover:bg-white/10"
			onclick={onclose}>Cancel</button
		>
	</div>

	<form
		class="mx-auto flex w-full max-w-3xl gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<input
			class="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-ui placeholder:text-white/40 focus:border-white/50 focus:outline-none"
			aria-label="What should appear there"
			placeholder="what should appear there?"
			bind:value={prompt}
		/>
		<button
			class="inline-flex h-10 shrink-0 items-center rounded-lg bg-white px-4 text-ui font-medium text-black transition-[background-color,opacity] duration-150 hover:bg-white/85 disabled:opacity-40"
			disabled={busy || !prompt.trim()}
		>
			{busy ? 'Working…' : 'Generate'}
		</button>
	</form>

	{#if error}
		<p
			class="mx-auto w-full max-w-3xl rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-label text-red-200"
		>
			{error}
		</p>
	{/if}
</div>
