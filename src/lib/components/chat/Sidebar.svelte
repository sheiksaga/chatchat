<script lang="ts">
	// Sidebar: the chat list plus per-chat rename/delete.
	//
	// Writes go through `/api/chats/[id]`; the list itself comes from `+layout.server.ts`, so every
	// page (home, chat, settings) renders the same sidebar without a second fetch.
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Plus, Search, X, Pencil, Trash2, Users, Settings2 } from '@lucide/svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog/ConfirmDialog.svelte';
	import IconButton from '$lib/components/ui/icon-button/icon-button.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { ChatSummary } from '$lib/shared/chat.js';

	let { chats }: { chats: ChatSummary[] } = $props();

	let renamingId = $state<string | null>(null);
	// Search is debounced: every keystroke would otherwise run an FTS query and re-render the list.
	let search = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	type Hit = { messageId: string; chatId: string; chatTitle: string; snippet: string };
	let hits = $state<Hit[]>([]);
	let searching = $state(false);
	let renameValue = $state('');
	let error = $state('');
	let pendingDelete = $state<ChatSummary | null>(null);
	let confirmOpen = $state(false);

	const activeId = $derived(page.params.id ?? '');
	const filtering = $derived(search.trim().length >= 2);

	function relative(ms: number) {
		const minutes = Math.round((Date.now() - ms) / 60000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours}h`;
		return `${Math.round(hours / 24)}d`;
	}

	async function fetchHits() {
		const response = await fetch(`/api/search?q=${encodeURIComponent(search.trim())}`);
		const body = (await response.json()) as { hits: Hit[] };
		hits = body.hits;
		searching = false;
	}

	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		const query = search.trim();
		if (query.length < 2) {
			hits = [];
			searching = false;
			return;
		}
		searching = true;
		searchTimer = setTimeout(fetchHits, 250);
	}

	async function call(path: string, init: RequestInit) {
		error = '';
		const response = await fetch(path, init);
		if (!response.ok) {
			error = `${response.status}: ${await response.text()}`;
			toasts.error(error);
			return false;
		}
		await invalidateAll();
		return true;
	}

	function startRename(chat: ChatSummary) {
		renamingId = chat.id;
		renameValue = chat.title;
	}

	async function commitRename() {
		const id = renamingId;
		const title = renameValue.trim();
		renamingId = null;
		if (!id || !title) return;
		if (
			await call(resolve('/api/chats/[id]', { id }), {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			})
		)
			toasts.success('Chat renamed');
	}

	function askDelete(chat: ChatSummary) {
		pendingDelete = chat;
		confirmOpen = true;
	}

	async function removeConfirmed() {
		const chat = pendingDelete;
		pendingDelete = null;
		if (!chat) return;
		const deleted = await call(resolve('/api/chats/[id]', { id: chat.id }), { method: 'DELETE' });
		if (!deleted) return;
		toasts.success(`Deleted “${chat.title}”`);
		// Deleting the open chat leaves the reader on a 404 page; send them home instead.
		if (chat.id === activeId) location.href = resolve('/');
	}

	/** The row's own background, so the hover-action scrim fades into it instead of a grey patch. */
	function scrim(active: boolean) {
		return active ? 'from-sidebar-accent via-sidebar-accent' : 'from-sidebar via-sidebar';
	}
</script>

<aside
	class="flex w-60 shrink-0 flex-col gap-3 border-e border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground lg:w-[17.5rem]"
>
	<header class="flex items-center justify-between gap-2 px-1">
		<a
			class="rounded text-ui font-semibold tracking-[-0.01em] transition-opacity duration-150 hover:opacity-80"
			href={resolve('/')}>chatchat</a
		>
		<!-- An explicit root action: the sidebar renders on /chat/[id] too, and `?/newChat` only
		     exists on the root page. -->
		<form method="POST" action="/?/newChat">
			<button
				type="submit"
				class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-label font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-soft hover:bg-primary/85 active:translate-y-px"
			>
				<Plus class="size-4" aria-hidden="true" />
				New chat
			</button>
		</form>
	</header>

	<div class="relative">
		<Search
			class="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
			aria-hidden="true"
		/>
		<input
			class="h-9 w-full rounded-lg border border-input bg-background/50 ps-9 pe-8 text-ui placeholder:text-muted-foreground/80 focus:border-ring focus:bg-background focus:outline-none"
			placeholder="Search messages…"
			aria-label="Search messages"
			bind:value={search}
			oninput={onSearchInput}
		/>
		{#if search}
			<IconButton
				label="Clear search"
				size="sm"
				class="absolute end-1 top-1/2 -translate-y-1/2"
				onclick={() => {
					search = '';
					onSearchInput();
				}}
			>
				<X aria-hidden="true" />
			</IconButton>
		{/if}
	</div>

	{#if error}
		<p class="rounded-lg bg-destructive/10 px-2 py-1.5 text-label text-destructive">{error}</p>
	{/if}

	<div class="flex items-baseline justify-between px-1 pt-1">
		<p class="text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
			{#if filtering}
				{searching ? 'Searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
			{:else}
				Recent
			{/if}
		</p>
		{#if !filtering}
			<span class="text-label text-muted-foreground/70 tabular-nums">{chats.length}</span>
		{/if}
	</div>

	{#if filtering}
		<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pe-0.5">
			{#each hits as hit (hit.messageId)}
				<a
					class="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-sidebar-accent"
					href={resolve('/chat/[id]', { id: hit.chatId })}
					title={hit.chatTitle}
				>
					<span class="block truncate text-ui font-medium">{hit.chatTitle}</span>
					<span class="block truncate text-label text-muted-foreground">{hit.snippet}</span>
				</a>
			{:else}
				<p class="px-2 py-3 text-ui text-muted-foreground">
					{searching ? 'Reading the index…' : 'No message matches that.'}
				</p>
			{/each}
		</div>
	{:else}
		<ul class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pe-0.5">
			{#each chats as chat (chat.id)}
				{@const active = chat.id === activeId}
				<li
					class="nav-rail group relative flex items-center rounded-lg transition-colors duration-150"
					class:bg-sidebar-accent={active}
					data-active={active}
				>
					{#if renamingId === chat.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="m-1 min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-ui focus:border-ring focus:outline-none"
							aria-label="Chat title"
							bind:value={renameValue}
							autofocus
							onblur={commitRename}
							onkeydown={(event) => {
								if (event.key === 'Enter') commitRename();
								if (event.key === 'Escape') renamingId = null;
							}}
						/>
					{:else}
						<a
							class="min-w-0 flex-1 truncate py-2 ps-2.5 text-ui"
							href={resolve('/chat/[id]', { id: chat.id })}
							title={chat.title}
						>
							{chat.title}
						</a>
						<span
							class="shrink-0 pe-2 text-label text-muted-foreground tabular-nums transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0"
						>
							{relative(chat.updatedAt)}
						</span>
						<div
							class="absolute end-0.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-linear-to-l to-transparent ps-5 pe-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover-none:opacity-100 {scrim(
								active
							)}"
						>
							<IconButton
								label="Rename"
								title="Rename this chat"
								size="sm"
								onclick={() => startRename(chat)}
							>
								<Pencil aria-hidden="true" />
							</IconButton>
							<IconButton
								label="Delete"
								title="Delete this chat"
								size="sm"
								tone="danger"
								onclick={() => askDelete(chat)}
							>
								<Trash2 aria-hidden="true" />
							</IconButton>
						</div>
					{/if}
				</li>
			{:else}
				<p class="px-2 py-3 text-ui text-muted-foreground">No chats yet.</p>
			{/each}
		</ul>
	{/if}

	<nav class="flex flex-col gap-0.5 border-t border-sidebar-border pt-2">
		<a
			class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-ui text-sidebar-foreground/85 transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground"
			href={resolve('/characters')}
		>
			<Users class="size-4 text-muted-foreground" aria-hidden="true" />
			Characters
		</a>
		<a
			class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-ui text-sidebar-foreground/85 transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground"
			href={resolve('/settings')}
		>
			<Settings2 class="size-4 text-muted-foreground" aria-hidden="true" />
			Settings
		</a>
	</nav>
</aside>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete this chat?"
	description={pendingDelete
		? `“${pendingDelete.title}” and all of its messages will be removed. This cannot be undone.`
		: ''}
	confirmLabel="Delete chat"
	onconfirm={removeConfirmed}
/>
