<!--
	The scene drawer: what the next picture is built from, and what the prompt will actually say.

	It exists because a picture that came out wrong has exactly two possible causes — the transcript said
	something else, or the record outside the transcript is stale — and without seeing the assembled prompt
	you cannot tell which. So the panel is a *viewer first*: the prompt at the bottom is the same string
	`POST /api/images/scene` returns to the generation path, for the model currently selected in the
	composer. Nothing here is a preview of my own re-implementation.

	The three fields are the whole record today (see `shared/story.ts`). Look and style change what every
	future picture says; the seed is what makes two pictures the *same* person.

	A real `<dialog>` with `showModal()`, like `ConfirmDialog`: Escape, the focus trap and the backdrop are
	the browser's job. It is anchored to the inline end, full height, because the conversation stays
	readable behind it — this is a panel, not a page.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { Copy, Dices, Image as ImageIcon, TriangleAlert, X } from '@lucide/svelte';
	import { imageModelLabel, randomSeed, type ImageModelId } from '$lib/shared/image.js';
	import {
		STORY_LOOK_MAX,
		STORY_SEED_MAX,
		STORY_STYLES,
		type Story,
		type StoryPatch,
		type StoryStyleId,
		effectiveStyle
	} from '$lib/shared/story.js';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';
	import SelectMenu from '$lib/components/ui/select-menu/SelectMenu.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';

	let {
		open = $bindable(false),
		chatId,
		story,
		workflow,
		/** Resolved: the record's flag, else the card's `image-generation` tag. */
		autoDraw,
		/** Persist one or more fields; the page owns the request and the local record. */
		onchange,
		/** Draw the prompt currently shown. Absent until the preview has been built. */
		onimage
	}: {
		open?: boolean;
		chatId: string;
		story: Story;
		workflow: ImageModelId;
		autoDraw: boolean;
		onchange: (patch: StoryPatch) => Promise<void>;
		onimage?: (prompt: string) => void | Promise<void>;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	/** The look as typed. Saved on blur, so a keystroke is not a request. */
	let lookDraft = $state(untrack(() => story.look));
	/** Which framing the preview describes. The three buttons under the composer use the same three. */
	let shot = $state<'wide' | 'medium' | 'close'>('medium');
	let preview = $state<{ prompt: string; width: number; height: number } | null>(null);
	let previewError = $state('');
	let loading = $state(false);

	const styleOptions = STORY_STYLES.map((style) => ({ value: style.id, label: style.label }));
	// The selector shows the style the chat *draws* with, not the raw field: an anime fine-tune on `none`
	// is pinned to anime server-side (`effectiveStyle`), and a control that disagreed with the picture was
	// how the Jess chat ended up drawing a photograph with the picker reading "No style hint".
	const shownStyle = $derived(effectiveStyle(story.style, workflow));
	const shots = [
		['wide', 'Wide'],
		['medium', 'Medium'],
		['close', 'Close-up']
	] as const;

	const words = $derived(preview ? preview.prompt.split(/\s+/).filter(Boolean).length : 0);
	const modelName = $derived(imageModelLabel(workflow));

	// Keep the native dialog in sync with the prop. `close()` fires `onclose`, which sets it back, so
	// Escape and the X follow one path.
	$effect(() => {
		const element = dialog;
		if (!element) return;
		if (open && !element.open) {
			element.showModal();
			lookDraft = story.look;
		} else if (!open && element.open) element.close();
	});

	// Ask the server for the prompt it would send, for the fields as currently saved. Re-runs when a save
	// lands (the `story` prop changes) or the framing/model changes; never on a keystroke.
	$effect(() => {
		if (!open) return;
		const body = { chatId, shot, workflow, style: story.style, look: story.look };

		let cancelled = false;
		loading = true;
		fetch('/api/images/scene', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
			.then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
			.then((scene: { prompt: string; width: number; height: number }) => {
				if (cancelled) return;
				preview = scene;
				previewError = '';
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				preview = null;
				previewError = `could not build the prompt (${String(cause)})`;
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	async function save(patch: StoryPatch) {
		await onchange(patch);
	}

	async function saveLook() {
		const look = lookDraft.trim().slice(0, STORY_LOOK_MAX);
		lookDraft = look;
		if (look === story.look) return;
		await save({ look });
		toasts.success('Look saved');
	}

	function saveSeed(event: Event) {
		const raw = (event.currentTarget as HTMLInputElement).value.trim();
		const seed = raw === '' ? null : Number(raw);
		if (seed === null) return void save({ seed: null });
		if (!Number.isFinite(seed) || seed < 0) {
			toasts.error('A seed is a whole number of 0 or more');
			return;
		}
		void save({ seed: Math.min(STORY_SEED_MAX, Math.floor(seed)) });
	}

	async function copyPrompt() {
		if (!preview) return;
		await navigator.clipboard.writeText(preview.prompt);
		toasts.success('Prompt copied');
	}

	/** Draw exactly the string under the preview — the same one Copy hands out, by construction. */
	async function drawPreview() {
		if (!preview || !onimage) return;
		await onimage(preview.prompt);
	}
</script>

<dialog
	bind:this={dialog}
	aria-label="Scene"
	class="m-0 ms-auto h-dvh max-h-dvh w-[min(24rem,calc(100vw-1rem))] border-s border-border bg-popover p-0 text-popover-foreground shadow-2xl shadow-black/60 backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-pop-in"
	onclose={() => (open = false)}
	oncancel={(event) => {
		event.preventDefault();
		open = false;
	}}
>
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
			<div class="min-w-0 flex-1">
				<h2 class="text-title font-semibold">Scene</h2>
				<p class="text-label text-muted-foreground">
					What every picture of this chat is built from.
				</p>
			</div>
			<IconButton label="Close" size="sm" onclick={() => (open = false)}>
				<X aria-hidden="true" />
			</IconButton>
		</header>

		<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
			<!-- Where. One line of place-and-light: the part the transcript never repeats. -->
			<div class="flex flex-col gap-1.5">
				<label class="text-label font-medium" for="scene-look">Where this story happens</label>
				<textarea
					id="scene-look"
					class="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-ui placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
					rows="2"
					maxlength={STORY_LOOK_MAX}
					placeholder="moonlit forest shrine, floating dust"
					bind:value={lookDraft}
					onchange={saveLook}></textarea>
				<p class="text-label text-muted-foreground/80">
					{#if lookDraft.trim()}
						Location, time and light. Every scene prompt reuses it — keep wardrobe out of here, it
						belongs to the character.
					{:else}
						<span class="text-amber-600 dark:text-amber-400">
							No location — the picture will invent a room for you.
						</span>
						Location, time and light. Every scene prompt reuses it.
					{/if}
				</p>
			</div>

			<!-- How. One chat is one kind of picture, so this is asked once, not per picture. -->
			<div class="flex flex-col gap-1.5">
				<span class="text-label font-medium">Style</span>
				<SelectMenu
					label="Render style"
					options={styleOptions}
					value={shownStyle}
					onchange={(value) => void save({ style: value as StoryStyleId })}
					class="self-start"
				/>
				<p class="text-label text-muted-foreground/80">
					Added to the prompt as tags for tag models and as a sentence for Z-Image.
					{#if story.style === 'none' && shownStyle !== 'none'}
						Anime models are pinned to anime even on "No style hint" — the picker here is what they
						follow.
					{/if}
				</p>
			</div>

			<!-- Consistency. Not variety: the same seed is what keeps a face recognisable between scenes. -->
			<div class="flex flex-col gap-1.5">
				<label class="text-label font-medium" for="scene-seed">Seed</label>
				<div class="flex items-center gap-1.5">
					<input
						id="scene-seed"
						type="number"
						min="0"
						max={STORY_SEED_MAX}
						step="1"
						class="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-ui tabular-nums placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
						placeholder="random"
						value={story.seed ?? ''}
						onchange={saveSeed}
					/>
					<button
						class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-card/40 px-2.5 text-label text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground"
						onclick={() => void save({ seed: randomSeed() })}
						title="Draw a new seed"
					>
						<Dices class="size-3.5" aria-hidden="true" />
						Randomise
					</button>
				</div>
				<p class="text-label text-muted-foreground/80">
					“Of this moment” starts from this seed, so the same beat redraws the same picture.
					Randomise for a different take; Regenerate always varies.
				</p>
			</div>

			<!-- Whether an [[IMG]] marker draws itself. On for a storyboard card, off for a roleplay one. -->
			<div class="flex flex-col gap-1.5">
				<span class="text-label font-medium">Draw markers automatically</span>
				<button
					class="inline-flex h-8 items-center gap-2 self-start rounded-md border px-2.5 text-label transition-colors duration-150 {autoDraw
						? 'border-foreground/30 bg-accent text-foreground'
						: 'border-border/70 bg-card/40 text-muted-foreground hover:border-foreground/25 hover:text-foreground'}"
					aria-pressed={autoDraw}
					onclick={() => void save({ autoImages: !autoDraw })}
				>
					<span
						class="size-2 rounded-full {autoDraw ? 'bg-emerald-400/90' : 'bg-muted-foreground/50'}"
						aria-hidden="true"
					></span>
					{autoDraw ? 'On' : 'Off'}
				</button>
				<p class="text-label text-muted-foreground/80">
					A reply's <code class="font-mono text-foreground/80">[[IMG: …]]</code> marker draws as soon
					as it arrives. Follows the card until you change it here; off means one click per picture.
				</p>
			</div>

			<!-- What the prompt will say. The product of everything above, as the server assembles it. -->
			<div class="flex flex-col gap-1.5 border-t border-border/60 pt-4">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-label font-medium">Prompt</span>
					<span class="flex items-center gap-1">
						{#if onimage}
							<!-- Beside the prompt, not beside the composer: this button draws *this* string, and the
							     string is what the reader is looking at. -->
							<IconButton
								label="Draw"
								title="Draw a picture from this prompt"
								size="sm"
								disabled={!preview}
								onclick={drawPreview}
							>
								<ImageIcon aria-hidden="true" />
							</IconButton>
						{/if}
						<button
							class="text-label text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40"
							disabled={!preview}
							onclick={() => void copyPrompt()}
						>
							<Copy class="me-1 inline size-3 align-[-1px]" aria-hidden="true" />Copy
						</button>
					</span>
				</div>

				<div class="flex flex-wrap items-center gap-1.5">
					{#each shots as [value, label] (value)}
						<button
							class="inline-flex h-7 items-center rounded-md border px-2.5 text-label transition-colors duration-150 {shot ===
							value
								? 'border-foreground/30 bg-accent text-foreground'
								: 'border-border/70 bg-card/40 text-muted-foreground hover:border-foreground/25 hover:text-foreground'}"
							aria-pressed={shot === value}
							onclick={() => (shot = value)}>{label}</button
						>
					{/each}
					<span class="ms-auto text-label text-muted-foreground/70">{modelName}</span>
				</div>

				{#if previewError}
					<p
						class="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-label text-destructive"
						role="alert"
					>
						<TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
						<span class="min-w-0 flex-1">{previewError}</span>
					</p>
				{:else if preview}
					<pre
						class="rounded-md border border-border/60 bg-card/40 px-2.5 py-2 font-mono text-label leading-relaxed break-words whitespace-pre-wrap text-foreground/90"
						data-testid="scene-prompt">{preview.prompt}</pre>
					<p class="text-label text-muted-foreground/70 tabular-nums">
						{words} words · {preview.width}×{preview.height}
					</p>
				{:else if loading}
					<p class="text-label text-muted-foreground/70">building the prompt…</p>
				{/if}
			</div>
		</div>
	</div>
</dialog>
