<!--
	The picture controls for one chat: which image model, "of this moment", progress, and the two
	full-screen overlays (viewer, mask editor).

	What it deliberately does **not** do any more is display the pictures. They belong to a message, so
	`ImageBlock` renders them inside the transcript (prompt above, image below); a strip docked above the
	composer followed the reader instead of the conversation. This component owns the *job*, the page owns
	the list — `onadded` hands a finished picture back so it can be appended to the transcript.

	Images are grouped by message: `targetMessageId` is the message a new picture is drawn under, so a
	chat's pictures never turn up under an unrelated turn, and never in another chat.
-->
<script lang="ts">
	import { ImagePlus, TriangleAlert, X } from '@lucide/svelte';
	import type { ImageRecord, ImageRequest } from '$lib/shared/image.js';
	import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, type ImageModelId } from '$lib/shared/image.js';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';
	import SelectMenu from '$lib/components/ui/select-menu/SelectMenu.svelte';
	import ImageViewport from './ImageViewport.svelte';
	import MaskEditor from './MaskEditor.svelte';

	let {
		chatId,
		images = $bindable([]),
		/** The message a picture drawn now belongs under (the last reply). */
		targetMessageId = null,
		/** Called after a job adds a picture, so the page can keep it in view. */
		onadded
	}: {
		chatId: string;
		images?: ImageRecord[];
		targetMessageId?: string | null;
		onadded?: (image: ImageRecord) => void;
	} = $props();

	/** Which image model to draw with. Remembered for the session; the picker is one popover. */
	let workflow = $state<ImageModelId>(DEFAULT_IMAGE_MODEL);
	let viewing = $state<number | null>(null);
	let editing = $state<ImageRecord | null>(null);
	let busy = $state<{ value: number; max: number; what: string } | null>(null);
	let error = $state<string | null>(null);

	const percent = $derived(busy && busy.max > 0 ? Math.min(100, (busy.value / busy.max) * 100) : 0);

	const modelOptions = IMAGE_MODELS.map((model) => ({ value: model.id, label: model.label }));

	const shots = [
		['wide', 'Wide'],
		['medium', 'Medium'],
		['close', 'Close-up']
	] as const;

	/**
	 * Generate one picture from a typed `/image …` command or from a `[[IMG: …]]` chip under a reply.
	 * `messageId` is the message it will appear under once it finishes.
	 */
	export async function generate(request: ImageRequest, messageId?: string | null) {
		if (busy) return;
		await runJob('/api/images', {
			chatId,
			messageId: messageId ?? targetMessageId ?? undefined,
			workflow,
			...request
		});
	}

	/** Open the viewer on a picture the transcript is already showing. */
	export function open(imageId: string) {
		const index = images.findIndex((image) => image.id === imageId);
		if (index >= 0) viewing = index;
	}

	/**
	 * "Change this picture." The server reads the source bytes and talks to ComfyUI's edit graph; we only
	 * send the id and the sentence, so this is cheap even over a phone connection.
	 */
	async function editWithInstruction(image: ImageRecord, instruction: string) {
		if (busy) return;
		viewing = null;
		await runJob('/api/images/edit', {
			chatId,
			imageId: image.id,
			messageId: image.message_id,
			instruction
		});
	}

	/**
	 * One image job: POST, then read SSE frames until `done` or `error`. Shared by generate and edit
	 * because both endpoints answer in exactly the same shape.
	 */
	async function runJob(endpoint: string, body: Record<string, unknown>) {
		error = null;
		busy = { value: 0, max: 1, what: String(body.prompt ?? body.instruction ?? 'picture') };

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok || !response.body) {
				// A refusal (404/410/400) is JSON, not a stream; show its message instead of a status code.
				const detail = await response
					.clone()
					.json()
					.catch(() => null);
				error = detail?.error ?? `request failed: ${response.status}`;
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
						image?: ImageRecord;
						message?: string;
					};
					if (event.type === 'progress') {
						busy = {
							value: event.value ?? 0,
							max: event.max ?? 1,
							what: busy?.what ?? 'picture'
						};
					} else if (event.type === 'done' && event.image) {
						images = [...images, event.image];
						onadded?.(event.image);
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
			body: JSON.stringify({ chatId, shot, workflow })
		});
		if (!response.ok) {
			error = `could not build the scene prompt: ${response.status}`;
			return;
		}
		const scene = (await response.json()) as { prompt: string; width: number; height: number };
		await generate({ prompt: scene.prompt, width: scene.width, height: scene.height });
	}

	/** Regenerate: same prompt, new seed unless the caller pinned one, under the same message. */
	export function regenerate(image: ImageRecord, pinnedSeed?: number) {
		void generate(
			{
				prompt: image.prompt ?? '',
				width: image.width ?? undefined,
				height: image.height ?? undefined,
				seed: pinnedSeed
			},
			image.message_id
		);
	}

	/** Paint over part of a picture (opens the mask editor). */
	export function edit(image: ImageRecord) {
		viewing = null;
		editing = image;
	}

	export async function remove(image: ImageRecord) {
		await fetch(`/api/images/${image.id}`, { method: 'DELETE' });
		images = images.filter((candidate) => candidate.id !== image.id);
		viewing = null;
	}
</script>

<div class="flex flex-col gap-1.5 border-t border-border/50 pt-2">
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="inline-flex items-center gap-1.5 text-label text-muted-foreground">
			<ImagePlus class="size-3.5" aria-hidden="true" />
			<SelectMenu
				label="Image model"
				options={modelOptions}
				bind:value={workflow}
				placeholder="no image model"
				class="max-w-[17rem] border-border/70 bg-card/40"
			/>
		</span>

		<span class="flex items-center gap-1.5">
			<span class="text-label text-muted-foreground/80">of this moment</span>
			{#each shots as [shot, label] (shot)}
				<button
					class="inline-flex h-7 items-center rounded-md border border-border/70 bg-card/40 px-2.5 text-label text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
					disabled={!!busy}
					onclick={() => generateScene(shot)}>{label}</button
				>
			{/each}
		</span>

		<span class="ms-auto hidden text-label text-muted-foreground/70 sm:inline">
			or type <code class="font-mono text-foreground/80">/image …</code>
		</span>
	</div>

	{#if busy}
		<div
			class="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"
		>
			<span class="min-w-0 flex-1 truncate text-label text-muted-foreground">
				Drawing <span class="text-foreground/80">{busy.what}</span>
			</span>
			<span class="shrink-0 text-label text-muted-foreground/70 tabular-nums">
				{busy.value}/{busy.max}
			</span>
			<div class="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
				<div
					class="progress-strip h-full rounded-full bg-foreground/80 transition-[width] duration-300 ease-soft"
					style="width: {percent}%"
				></div>
			</div>
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
			oninstruct={(image, instruction) => void editWithInstruction(image, instruction)}
			ondelete={(image) => void remove(image)}
		/>
	{/if}

	{#if editing}
		<MaskEditor
			image={editing}
			{chatId}
			messageId={editing.message_id}
			onclose={() => (editing = null)}
			onsaved={(image) => {
				images = [...images, image];
				onadded?.(image);
				editing = null;
			}}
		/>
	{/if}
</div>
