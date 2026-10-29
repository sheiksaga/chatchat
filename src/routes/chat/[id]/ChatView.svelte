<script lang="ts">
	// The chat screen: transcript, message actions, composer, and the pictures the chat has drawn.
	//
	// Two sources of truth on purpose:
	// - `chat.messages` (AI SDK) is live: it holds the partial reply while tokens arrive.
	// - `data.chat.messages` (the server load) is canonical: ids, generation history, older edits.
	// Writes always go to the server first (`/api/*`), then `invalidateAll()` + `syncFromServer()`
	// refresh the client copy, so a reload and the screen never disagree.
	//
	// This file is mounted once per chat by `+page.svelte` (a `{#key data.chat.id}`), so local state is
	// safe to initialise from `data` directly — no chat switch can reuse it.
	import { Chat, type UIMessage } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import { tick, onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowDown,
		Image as ImageIcon,
		Pencil,
		RotateCcw,
		Sparkles,
		Square,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import MessageBody from '$lib/components/chat/MessageBody.svelte';
	import SidebarTrigger from '$lib/components/chat/SidebarTrigger.svelte';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';
	import SelectMenu from '$lib/components/ui/select-menu/SelectMenu.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog/ConfirmDialog.svelte';
	import ImageTools from '$lib/components/images/ImageTools.svelte';
	import ImageBlock from '$lib/components/images/ImageBlock.svelte';
	import MessageActions from '$lib/components/chat/MessageActions.svelte';
	import {
		findImageMarkers,
		parseImageCommand,
		placeImages,
		type ImageRecord
	} from '$lib/shared/image.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { ChatMessage } from '$lib/shared/chat.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	function toUiMessage(message: ChatMessage): UIMessage {
		return {
			id: message.id,
			role: message.role,
			parts: [{ type: 'text', text: message.content }]
		};
	}

	const seed = () => data.chat.messages.map(toUiMessage);

	// Snapshots of the server load, on purpose: this component is rebuilt per chat, and everything live
	// after this point is owned here (`chat.messages`, the pictures list). `untrack` says so, and keeps
	// svelte-check from suggesting a derived that would fight `invalidateAll()`.
	let model = $state(untrack(() => data.model));

	// The chat's pictures. The server load seeds them; new ones are appended as their jobs finish, so a
	// fresh picture needs no reload. Which message a picture belongs to is `message_id` — see `placed`.
	let images = $state<ImageRecord[]>(untrack(() => data.images));
	let look = $state(untrack(() => (data.chat.story as { look?: string } | null)?.look ?? ''));
	let lookOpen = $state(false);

	/** The look is story metadata, so it survives a reload and every scene prompt reuses it. */
	async function saveLook(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		look = value;
		await fetch(`/api/chats/${data.chat.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ story: { look: value } })
		});
		await invalidateAll();
		toasts.success('Look saved');
	}
	let imageTools = $state<ReturnType<typeof ImageTools> | null>(null);

	/**
	 * One entry point for the composer: `/image …` is a *local* command, so it must not reach the model
	 * (which would answer with prose about a picture it cannot see).
	 */
	function send(text: string) {
		const command = parseImageCommand(text);
		if (command) {
			void imageTools?.generate(command);
			return;
		}
		void chat.sendMessage({ text });
	}

	// Model picker: fetched on demand, because asking a stopped llama.cpp server for its model list
	// would stall every page render. An unreachable backend leaves the list with the configured model
	// only, and the picker says so instead of vanishing.
	let models = $state<string[]>([]);
	let pickerError = $state('');

	$effect(() => {
		let cancelled = false;
		fetch(`/api/models?provider=${encodeURIComponent(data.provider)}`)
			.then((response) => response.json())
			.then((body: { ok: boolean; models: string[]; error?: string }) => {
				if (cancelled) return;
				// Not an error the user can act on here: settings own the provider, so stay calm.
				if (body.ok) models = body.models;
				else pickerError = 'model list unavailable';
			})
			.catch(() => {
				if (!cancelled) pickerError = 'model list unavailable';
			});
		return () => {
			cancelled = true;
		};
	});

	/** The configured model is always offered, even when the backend did not answer. */
	const modelOptions = $derived(
		[...new Set([...(model ? [model] : []), ...models])].map((id) => ({ value: id, label: id }))
	);

	async function chooseModel(next: string) {
		model = next;
		await fetch('/api/settings', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activeModel: { ...data.activeModel, [data.provider]: next } })
		});
		toasts.success(`Model: ${next}`);
	}

	/**
	 * The client chat instance. Built once per mount, which is once per chat — see `+page.svelte`.
	 */
	function buildChat(): Chat {
		return new Chat({
			id: data.chat.id,
			messages: seed(),
			transport: new DefaultChatTransport({
				api: '/api/chat',
				// Everything dynamic is read here, at send time, so switching model mid-chat works.
				prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({
					body: {
						messages,
						model,
						provider: data.provider,
						chatId: data.chat.id,
						regenerateMessageId: trigger === 'regenerate-message' ? messageId : undefined
					}
				})
			}),
			onFinish: () => {
				void invalidateAll();
			}
		});
	}

	const chat = buildChat();

	/** Pull the canonical transcript back into the client instance (after an edit/delete/retry). */
	async function syncFromServer() {
		await invalidateAll();
		// `messages` is a getter/setter pair on the SDK chat, not a method.
		chat.messages = seed();
	}

	let editingId = $state<string | null>(null);
	let editValue = $state('');
	let actionError = $state('');

	/** Which saved reply is on screen, per message id. Absent means "the latest one". */
	let generationIndex = $state<Record<string, number>>({});

	const serverMessages = $derived(data.chat.messages);
	const byId = $derived(new Map(serverMessages.map((message) => [message.id, message])));

	/**
	 * Pictures, grouped under the message they were drawn with (rule + tests: `placeImages`).
	 */
	const placed = $derived(placeImages(images, serverMessages));
	/** The message a picture drawn right now belongs under: the newest saved reply. */
	const targetMessageId = $derived(
		serverMessages.findLast((message) => message.role === 'assistant')?.id ?? null
	);

	/** A finished job lands in the transcript, so follow it down unless the reader scrolled away. */
	async function onImageAdded() {
		await tick();
		if (stick) scrollToLatest();
	}

	function generationsOf(id: string): string[] {
		return byId.get(id)?.generations ?? [];
	}

	function shownContent(message: UIMessage): string {
		if (message.role !== 'assistant') return textOf(message);
		const generations = generationsOf(message.id);
		const index = generationIndex[message.id];
		if (generations.length > 1 && index !== undefined && generations[index] !== undefined) {
			return generations[index];
		}
		return textOf(message);
	}

	function textOf(message: UIMessage) {
		return message.parts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('');
	}

	const streamingId = $derived(
		chat.status === 'streaming' || chat.status === 'submitted'
			? chat.messages.at(-1)?.id
			: undefined
	);
	/** A reply is on its way. `error` is deliberately not in this set: the composer must recover. */
	const responding = $derived(chat.status === 'streaming' || chat.status === 'submitted');
	/** Between submit and the first token. A blank screen reads as "nothing happened". */
	const waiting = $derived(chat.status === 'submitted');

	async function call(path: string, init: RequestInit, after: () => Promise<void>) {
		actionError = '';
		const response = await fetch(path, init);
		if (!response.ok) {
			actionError = `${response.status}: ${await response.text()}`;
			return;
		}
		await after();
	}

	function startEdit(message: UIMessage) {
		editingId = message.id;
		editValue = textOf(message);
	}

	async function saveEdit() {
		const id = editingId;
		const content = editValue.trim();
		editingId = null;
		if (!id || !content) return;
		await call(
			resolve('/api/messages/[id]', { id }),
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ content })
			},
			syncFromServer
		);
		if (!actionError) toasts.success('Message updated');
	}

	let pendingDeleteId = $state<string | null>(null);
	let confirmOpen = $state(false);

	function askDelete(id: string) {
		pendingDeleteId = id;
		confirmOpen = true;
	}

	async function removeConfirmed() {
		const id = pendingDeleteId;
		pendingDeleteId = null;
		if (!id) return;
		await call(resolve('/api/messages/[id]', { id }), { method: 'DELETE' }, syncFromServer);
		if (!actionError) toasts.success('Message deleted');
	}

	async function regenerate(id: string) {
		await chat.regenerate({ messageId: id });
		await syncFromServer();
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.success('Copied to clipboard');
		} catch {
			actionError = 'clipboard unavailable';
		}
	}

	function cycle(id: string, delta: number) {
		const generations = generationsOf(id);
		if (generations.length < 2) return;
		const latest = generations.length - 1;
		const current = generationIndex[id] ?? latest;
		const next = (current + delta + generations.length) % generations.length;
		generationIndex = { ...generationIndex, [id]: next };
	}

	// Renaming in place: the title is the only thing at the top of the screen, so it should be
	// editable where it is rather than only from the sidebar.
	let renamingTitle = $state(false);
	let titleValue = $state('');

	function startRenameTitle() {
		titleValue = data.chat.title;
		renamingTitle = true;
	}

	async function commitTitle() {
		const title = titleValue.trim();
		renamingTitle = false;
		if (!title || title === data.chat.title) return;
		const response = await fetch(`/api/chats/${data.chat.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title })
		});
		if (!response.ok) {
			actionError = `${response.status}: ${await response.text()}`;
			return;
		}
		await invalidateAll();
		toasts.success('Chat renamed');
	}

	// Stick to the bottom while a reply streams, but stop if the reader scrolls up to read.
	let scroller = $state<HTMLDivElement | null>(null);
	let stick = $state(true);

	function onScroll() {
		const element = scroller;
		if (!element) return;
		stick = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
	}

	$effect(() => {
		// Reading `chat.messages` subscribes to each token; that is exactly when we want to follow.
		void chat.messages;
		untrack(() => {
			if (stick && scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	// Entry animation only for messages that arrive while the page is open. Animating the seeded
	// transcript on every load would make a fifty-message chat flash on refresh.
	let hydrated = $state(false);

	/**
	 * Keep the newest turn in view.
	 *
	 * The token effect alone is not enough: on a cold load the transcript is still growing after the
	 * effect ran (fonts, markdown blocks, an image that decodes late), which leaves the reader at the
	 * top of a conversation they just opened. A `ResizeObserver` on the inner column re-pins the
	 * scroll position whenever the content grows — and only while `stick` is true, so scrolling up to
	 * read is never yanked back.
	 */
	onMount(() => {
		const frame = requestAnimationFrame(() => (hydrated = true));
		const element = scroller;
		if (!element) return () => cancelAnimationFrame(frame);

		const pin = () => {
			if (stick) element.scrollTop = element.scrollHeight;
		};

		// Both nodes matter: the column grows as markdown and fonts settle, and the scroller itself
		// grows when the composer or the image strip takes its space. Missing either one leaves the
		// reader parked at the top of a conversation they just opened.
		const observer = new ResizeObserver(pin);
		const inner = element.firstElementChild;
		if (inner) observer.observe(inner);
		observer.observe(element);
		pin();

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});

	// Idle VRAM release. LM Studio can unload a model; llama.cpp cannot (a request *is* the load).
	// Restarted by every send, so an active conversation never pays a reload.
	const IDLE_MS = 10 * 60_000;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		// Re-arm whenever the transcript or the model changes.
		void chat.messages.length;
		const modelToFree = model;
		if (!data.caps?.unload || !modelToFree) return;

		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			void fetch('/api/unload', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ model: modelToFree, provider: data.provider })
			});
		}, IDLE_MS);
		return () => clearTimeout(idleTimer);
	});

	function scrollToLatest() {
		stick = true;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	const speaker = $derived(data.character?.name ?? 'Assistant');
	const listener = $derived(data.userName ?? 'You');

	function initial(name: string) {
		return name.trim().charAt(0).toUpperCase() || '•';
	}
</script>

<svelte:head><title>{data.chat.title} · chatchat</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
		<!-- Below `md` this is the only way back to the chat list: the sidebar is a drawer there. -->
		<SidebarTrigger />
		{#if data.character}
			{#if data.character.avatar}
				<img
					class="size-9 shrink-0 rounded-full object-cover ring-1 ring-border"
					src={resolve('/api/characters/[id]/avatar', { id: data.character.id })}
					alt=""
				/>
			{:else}
				<span
					class="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-label font-semibold ring-1 ring-border"
				>
					{initial(data.character.name)}
				</span>
			{/if}
		{/if}

		<div class="min-w-0 flex-1">
			{#if renamingTitle}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="w-full rounded-md border border-input bg-background px-2 py-0.5 text-title font-semibold focus:border-ring focus:outline-none"
					aria-label="Chat title"
					bind:value={titleValue}
					autofocus
					onblur={commitTitle}
					onkeydown={(event) => {
						if (event.key === 'Enter') commitTitle();
						if (event.key === 'Escape') renamingTitle = false;
					}}
				/>
			{:else}
				<button
					class="group/title flex max-w-full items-center gap-1.5 text-start"
					title="Rename this chat"
					onclick={startRenameTitle}
				>
					<h1 class="truncate text-title font-semibold tracking-[-0.01em]">{data.chat.title}</h1>
					<Pencil
						class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
						aria-hidden="true"
					/>
				</button>
			{/if}
			<p class="flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
				<span class="inline-flex min-w-0 items-center gap-1.5">
					<span
						class="size-1.5 shrink-0 rounded-full {pickerError ? 'bg-amber-400' : 'bg-emerald-400'}"
						title={pickerError ? 'Backend not answering' : 'Backend responding'}
					></span>
					<span class="truncate">{data.providerLabel}</span>
				</span>
				<span aria-hidden="true">·</span>
				<!-- The model is a real control, not a caption: it is the one setting people change per
				     conversation. It is always here, even when the backend did not answer. -->
				<SelectMenu
					label="Model"
					placeholder="no model selected"
					options={modelOptions}
					bind:value={model}
					onchange={chooseModel}
					tone="plain"
					class="max-w-[min(22rem,50vw)] font-mono text-foreground/90"
				>
					{#snippet footer()}
						<a
							class="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
							href={resolve('/settings')}
							>{pickerError ? 'Model list unavailable — open settings' : 'Provider settings'}</a
						>
					{/snippet}
				</SelectMenu>
			</p>
		</div>

		<div class="flex shrink-0 items-center gap-1">
			{#if pickerError}
				<span class="hidden rounded-md px-2 py-1 text-label text-amber-300/90 sm:inline">
					{pickerError}
				</span>
			{/if}

			<div class="relative">
				<button
					class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-label text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
					aria-expanded={lookOpen}
					title="Where this story happens"
					onclick={() => (lookOpen = !lookOpen)}
				>
					<Sparkles class="size-4" aria-hidden="true" />
					Look
				</button>
				{#if lookOpen}
					<button
						class="fixed inset-0 z-20 cursor-default"
						tabindex="-1"
						aria-hidden="true"
						onclick={() => (lookOpen = false)}
					></button>
					<div
						class="absolute end-0 top-full z-30 mt-1.5 flex w-80 animate-pop-in flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-xl shadow-black/50"
					>
						<p class="text-label text-muted-foreground">
							Where this story happens. Every scene prompt reuses it.
						</p>
						<input
							class="rounded-md border border-input bg-background px-2 py-1.5 text-ui placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
							aria-label="Story look"
							placeholder="moonlit forest shrine, floating dust"
							value={look}
							onchange={saveLook}
						/>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<div
		bind:this={scroller}
		onscroll={onScroll}
		class="min-h-0 flex-1 overflow-y-auto"
		data-testid="transcript"
		aria-live="polite"
		aria-relevant="additions text"
	>
		<div
			class="mx-auto flex w-full flex-col px-4 py-5"
			style="max-width: calc(var(--content-width, 62ch) + 3rem);"
		>
			{#if chat.messages.length === 0}
				<div class="flex animate-fade-in flex-col items-center gap-3 py-16 text-center">
					{#if data.character?.avatar}
						<img
							class="size-16 rounded-full object-cover ring-1 ring-border"
							src={resolve('/api/characters/[id]/avatar', { id: data.character.id })}
							alt=""
						/>
					{:else}
						<span class="grid size-16 place-items-center rounded-full bg-muted text-display">
							{initial(speaker)}
						</span>
					{/if}
					<h2 class="text-title font-semibold">{speaker} is ready</h2>
					<p class="max-w-[42ch] text-ui text-muted-foreground">
						Type below to open the scene. Markdown works, and
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-label"
							>/image a moonlit shrine</code
						>
						draws a picture without asking the model.
					</p>
				</div>
			{/if}

			{#each chat.messages as message, index (message.id)}
				{@const generations = generationsOf(message.id)}
				{@const shownIndex = generationIndex[message.id] ?? generations.length - 1}
				{@const isStreaming = message.id === streamingId}
				{@const markers =
					message.role === 'assistant' ? findImageMarkers(shownContent(message)) : []}
				{@const stats = byId.get(message.id)?.stats}
				{@const messageImages = placed.byMessage.get(message.id) ?? []}
				<article
					class="group/message relative flex flex-col gap-1 py-3"
					class:animate-fade-up={hydrated && index === chat.messages.length - 1}
					data-role={message.role}
				>
					<div class="flex items-center gap-2 text-label">
						{#if message.role === 'assistant'}
							<span class="size-2 shrink-0 rounded-full bg-emerald-400/80" aria-hidden="true"
							></span>
							<span class="font-semibold text-foreground/90">{speaker}</span>
						{:else}
							<span class="size-2 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true"
							></span>
							<span class="font-semibold text-muted-foreground">{listener}</span>
						{/if}

						{#if isStreaming}
							<span class="inline-flex items-center gap-1 text-muted-foreground">
								{#if waiting}
									<span
										class="inline-flex items-end gap-0.5"
										aria-label="Waiting for the first token"
									>
										<span class="size-1 animate-thinking rounded-full bg-current"></span>
										<span
											class="size-1 animate-thinking rounded-full bg-current [animation-delay:160ms]"
										></span>
										<span
											class="size-1 animate-thinking rounded-full bg-current [animation-delay:320ms]"
										></span>
									</span>
								{:else}
									writing
								{/if}
							</span>
						{/if}

						{#if generations.length > 1}
							<span
								class="inline-flex items-center gap-0.5 rounded-full border border-border/70 py-0.5 ps-2 pe-0.5 text-muted-foreground tabular-nums"
							>
								v{shownIndex + 1}/{generations.length}
								<IconButton
									label="‹ Previous version"
									title="Previous version"
									size="sm"
									onclick={() => cycle(message.id, -1)}
								>
									<span aria-hidden="true">‹</span>
								</IconButton>
								<IconButton
									label="› Next version"
									title="Next version"
									size="sm"
									onclick={() => cycle(message.id, 1)}
								>
									<span aria-hidden="true">›</span>
								</IconButton>
							</span>
						{/if}

						{#if stats}
							<span class="ms-auto hidden shrink-0 text-muted-foreground/80 tabular-nums sm:inline">
								{[
									stats.model,
									stats.ms !== undefined ? `${(stats.ms / 1000).toFixed(1)}s` : null,
									stats.completionTokens !== undefined ? `${stats.completionTokens} tok` : null,
									stats.aborted ? 'stopped' : null
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						{/if}

						<span
							class="ms-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/message:opacity-100 group-hover/message:opacity-100 hover-none:opacity-100 {stats
								? 'sm:ms-1'
								: 'ms-auto'}"
						>
							<MessageActions
								oncopy={() => copy(shownContent(message))}
								onedit={() => startEdit(message)}
								ondelete={() => askDelete(message.id)}
								onretry={message.role === 'assistant' &&
								index === chat.messages.length - 1 &&
								!responding
									? () => regenerate(message.id)
									: undefined}
							/>
						</span>
					</div>

					{#if editingId === message.id}
						<div class="flex flex-col gap-2">
							<textarea
								class="w-full resize-y rounded-lg border border-input bg-background p-3 text-ui leading-relaxed focus:border-ring focus:outline-none"
								aria-label="Edit message"
								rows="6"
								bind:value={editValue}
								onkeydown={(event) => {
									if (event.key === 'Escape') editingId = null;
									if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void saveEdit();
								}}></textarea>
							<div class="flex items-center gap-2">
								<button
									class="h-8 rounded-md bg-primary px-3 text-label font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/85"
									onclick={saveEdit}>Save</button
								>
								<button
									class="h-8 rounded-md px-3 text-label text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
									onclick={() => (editingId = null)}>Cancel</button
								>
								<span class="text-label text-muted-foreground/70">⌘/Ctrl + Enter to save</span>
							</div>
						</div>
					{:else if message.role === 'user'}
						<div
							class="rounded-xl rounded-ss-sm bg-muted/55 px-4 py-2.5 ring-1 ring-border/40 ring-inset"
						>
							<MessageBody content={shownContent(message)} role={message.role} />
						</div>
					{:else}
						<MessageBody content={shownContent(message)} role={message.role} {isStreaming} />
					{/if}

					{#if markers.length}
						<div class="flex flex-wrap gap-1.5 pt-1">
							{#each markers as marker, markerIndex (markerIndex)}
								<button
									class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-label text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-foreground/25 hover:text-foreground"
									title="Generate this picture"
									onclick={() => imageTools?.generate(marker, message.id)}
								>
									<ImageIcon class="size-3.5 shrink-0" aria-hidden="true" />
									<span class="truncate">{marker.prompt}</span>
								</button>
							{/each}
						</div>
					{/if}

					<!-- The pictures this turn drew: prompt above, image below, in the conversation where they
					     were made. Under the message, not in a strip at the bottom of the screen. -->
					{#if messageImages.length}
						<div class="flex flex-col gap-3 py-1">
							{#each messageImages as image (image.id)}
								<ImageBlock
									{image}
									onopen={() => imageTools?.open(image.id)}
									onregenerate={() => imageTools?.regenerate(image)}
									onedit={() => imageTools?.edit(image)}
									ondelete={() => imageTools?.remove(image)}
								/>
							{/each}
						</div>
					{/if}
				</article>
			{/each}

			{#if placed.loose.length}
				<div class="flex flex-col gap-3 pt-2 pb-1">
					{#each placed.loose as image (image.id)}
						<ImageBlock
							{image}
							onopen={() => imageTools?.open(image.id)}
							onregenerate={() => imageTools?.regenerate(image)}
							onedit={() => imageTools?.edit(image)}
							ondelete={() => imageTools?.remove(image)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="relative">
		{#if !stick}
			<button
				class="absolute -top-14 left-1/2 z-10 flex -translate-x-1/2 animate-fade-up items-center gap-1.5 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-label text-popover-foreground shadow-lg shadow-black/40 backdrop-blur transition-colors duration-150 hover:bg-accent"
				onclick={scrollToLatest}
			>
				<ArrowDown class="size-3.5" aria-hidden="true" />
				Jump to latest
			</button>
		{/if}

		<div class="mx-auto w-full px-4" style="max-width: calc(var(--content-width, 62ch) + 3rem);">
			{#if chat.error}
				<div
					class="mb-2 flex animate-fade-up items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-label text-destructive"
					role="alert"
				>
					<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p class="min-w-0 flex-1 break-words">{chat.error.message}</p>
					<IconButton label="Dismiss error" size="sm" onclick={() => chat.clearError()}>
						<X aria-hidden="true" />
					</IconButton>
				</div>
			{/if}
			{#if actionError}
				<div
					class="mb-2 flex animate-fade-up items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-label text-destructive"
					role="alert"
				>
					<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p class="min-w-0 flex-1 break-words">{actionError}</p>
					<IconButton label="Dismiss error" size="sm" onclick={() => (actionError = '')}>
						<X aria-hidden="true" />
					</IconButton>
				</div>
			{/if}
		</div>

		<div
			class="mx-auto w-full px-4 pb-2"
			style="max-width: calc(var(--content-width, 62ch) + 3rem);"
		>
			<ImageTools
				bind:this={imageTools}
				chatId={data.chat.id}
				bind:images
				{targetMessageId}
				onadded={onImageAdded}
			/>
		</div>

		<div
			class="mx-auto w-full px-4 pb-4"
			style="max-width: calc(var(--content-width, 62ch) + 3rem);"
		>
			<Composer status={chat.status} onsend={send} onstop={() => chat.stop()} />
			{#if responding}
				<p class="mt-1.5 flex items-center gap-1.5 ps-1 text-label text-muted-foreground">
					<Square class="size-3 fill-current" aria-hidden="true" />
					Stop to keep the partial reply — it is saved either way.
				</p>
			{:else}
				<p class="mt-1.5 ps-1 text-label text-muted-foreground/70">
					<RotateCcw class="me-1 inline size-3 align-[-1px]" aria-hidden="true" />
					Hover a reply for copy, edit, retry and delete.
				</p>
			{/if}
		</div>
	</div>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete this message?"
	description="The turn and everything after it stay readable, but this message is gone for good."
	confirmLabel="Delete message"
	onconfirm={removeConfirmed}
/>
