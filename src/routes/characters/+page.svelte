<script lang="ts">
	// Character library: cards with avatars, import a card file, start a chat, or edit.
	//
	// Import accepts the formats people actually have: a SillyTavern PNG, a `.json` card, or a
	// couple of them at once. Parsing happens on the server (`cards/parse.ts`), so a bad file gets a
	// readable 400 instead of corrupting the library.
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { BookOpen, MessageSquare, Pencil, Plus, Trash2, Upload, Users } from '@lucide/svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog/ConfirmDialog.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { Character } from '$lib/shared/character.js';

	let { data } = $props();

	let importing = $state(false);
	let message = $state('');
	let pendingDelete = $state<Character | null>(null);
	let confirmOpen = $state(false);

	const characters = $derived(data.characters as Character[]);

	function initials(name: string) {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
	}

	async function importFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		if (files.length === 0) return;

		importing = true;
		message = '';
		let imported = 0;
		for (const file of files) {
			const body = new FormData();
			body.set('file', file);
			const response = await fetch(resolve('/api/characters'), { method: 'POST', body });
			if (response.ok) imported += 1;
			else message = `${file.name}: ${await response.text()}`;
		}
		importing = false;
		input.value = '';
		if (imported > 0) {
			message = `Imported ${imported} card${imported === 1 ? '' : 's'}.`;
			toasts.success(message);
			await invalidateAll();
		} else if (message) {
			toasts.error(message);
		}
	}

	async function createBlank() {
		const response = await fetch(resolve('/api/characters'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'New character' })
		});
		if (!response.ok) {
			message = await response.text();
			toasts.error(message);
			return;
		}
		const { character } = (await response.json()) as { character: Character };
		location.href = resolve('/characters/[id]', { id: character.id });
	}

	async function removeConfirmed() {
		const character = pendingDelete;
		pendingDelete = null;
		if (!character) return;
		const response = await fetch(resolve('/api/characters/[id]', { id: character.id }), {
			method: 'DELETE'
		});
		if (!response.ok) {
			message = await response.text();
			toasts.error(message);
			return;
		}
		toasts.success(`Deleted “${character.name}”`);
		await invalidateAll();
	}
</script>

<svelte:head><title>Characters · chatchat</title></svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
	<header class="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
		<div class="flex flex-col gap-1">
			<h1 class="text-display font-semibold tracking-[-0.01em]">Characters</h1>
			<p class="text-ui text-muted-foreground">SillyTavern v1/v2/v3 cards, with their lorebooks.</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<label
				class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-ui transition-colors duration-150 hover:bg-accent"
			>
				<Upload class="size-4" aria-hidden="true" />
				{importing ? 'Importing…' : 'Import card…'}
				<input
					class="hidden"
					type="file"
					accept=".png,.json,.jpeg,.jpg,image/png,application/json"
					multiple
					onchange={importFiles}
				/>
			</label>
			<button
				class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-ui font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-soft hover:bg-primary/85 active:translate-y-px"
				onclick={createBlank}
			>
				<Plus class="size-4" aria-hidden="true" />
				New blank
			</button>
		</div>
	</header>

	{#if message}
		<p class="text-ui" class:text-destructive={!message.startsWith('Imported')}>{message}</p>
	{/if}

	{#if characters.length === 0}
		<div
			class="flex animate-fade-in flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center"
		>
			<span class="grid size-12 place-items-center rounded-full bg-muted">
				<Users class="size-5 text-muted-foreground" aria-hidden="true" />
			</span>
			<h2 class="text-title font-semibold">No cards yet</h2>
			<p class="max-w-[46ch] text-ui text-muted-foreground">
				Import a SillyTavern PNG or a <code class="font-mono text-[0.9em]">.json</code> card, or run
				<code class="font-mono text-[0.9em]">npm run import:cards</code> to pull in the old library.
			</p>
		</div>
	{:else}
		<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each characters as character (character.id)}
				<li
					class="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 p-4 transition-[border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-foreground/20"
				>
					<div class="flex gap-3">
						{#if character.avatar}
							<img
								class="size-16 shrink-0 rounded-xl object-cover ring-1 ring-border"
								src={resolve('/api/characters/[id]/avatar', { id: character.id })}
								alt=""
							/>
						{:else}
							<div
								class="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-title font-semibold"
							>
								{initials(character.name)}
							</div>
						{/if}

						<div class="min-w-0 flex-1">
							<p class="truncate text-ui font-semibold">{character.name}</p>
							<p class="truncate text-label text-muted-foreground">
								{[character.spec.replace('chara_card_', ''), character.tags.slice(0, 3).join(', ')]
									.filter(Boolean)
									.join(' · ')}
							</p>
							{#if character.book?.entries.length}
								<p class="mt-0.5 inline-flex items-center gap-1 text-label text-muted-foreground">
									<BookOpen class="size-3" aria-hidden="true" />
									{character.book.entries.length} lore entries
								</p>
							{/if}
						</div>
					</div>

					<div class="mt-auto flex flex-wrap items-center gap-1.5">
						<!-- The action lives on the root page; SvelteKit runs it from any form that posts here. -->
						<form method="POST" action="/?/newChat">
							<input type="hidden" name="characterId" value={character.id} />
							<button
								class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-label font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-soft hover:bg-primary/85 active:translate-y-px"
								type="submit"
							>
								<MessageSquare class="size-3.5" aria-hidden="true" />
								chat
							</button>
						</form>
						<a
							class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-label text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
							href={resolve('/characters/[id]', { id: character.id })}
						>
							<Pencil class="size-3.5" aria-hidden="true" />
							edit
						</a>
						<button
							class="ms-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-label text-muted-foreground transition-colors duration-150 hover:bg-destructive/15 hover:text-destructive"
							onclick={() => {
								pendingDelete = character;
								confirmOpen = true;
							}}
						>
							<Trash2 class="size-3.5" aria-hidden="true" />
							delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete this card?"
	description={pendingDelete
		? `“${pendingDelete.name}” is removed from the library. Chats that used it keep their messages.`
		: ''}
	confirmLabel="Delete card"
	onconfirm={removeConfirmed}
/>
