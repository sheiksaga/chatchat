<script lang="ts">
	// Card editor. Saves with PATCH, so a half-filled form cannot wipe fields it did not touch.
	// Lorebook editing is deliberately read-only for now: entries are long, and getting them wrong
	// is worse than not having the feature (see TODO Phase 4f).
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { ArrowLeft, MessageSquare, Plus, Save, Trash2 } from '@lucide/svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { Character } from '$lib/shared/character.js';

	let { data } = $props();

	let draft = $state(untrack(() => structuredClone(data.character) as Character));
	let status = $state('');
	let saving = $state(false);

	const fields = [
		{ key: 'description', label: 'Description', rows: 6 },
		{ key: 'personality', label: 'Personality', rows: 3 },
		{ key: 'scenario', label: 'Scenario', rows: 3 },
		{ key: 'firstMessage', label: 'First message', rows: 4 },
		{ key: 'exampleMessages', label: 'Example dialogue', rows: 5 },
		{ key: 'systemPrompt', label: 'System prompt', rows: 3 },
		{ key: 'postHistoryInstructions', label: 'Post-history instructions', rows: 2 },
		{ key: 'appearance', label: 'Appearance (image prompts)', rows: 2 },
		{ key: 'creatorNotes', label: 'Creator notes', rows: 2 }
	] as const;

	const field =
		'rounded-lg border border-input bg-background px-3 py-2 text-ui leading-relaxed placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none';
	const fieldLabel = 'flex flex-col gap-1.5 text-label font-medium text-muted-foreground';

	/** One-line, quote-stripped preview of a greeting, for the picker's option labels. */
	function greetingPreview(text: string) {
		const flat = text
			.replace(/[*_>`#]/g, '')
			.replace(/\s+/g, ' ')
			.replace(/^["“”']|["“”']$/g, '')
			.trim();
		return flat.length > 44 ? `${flat.slice(0, 44)}…` : flat;
	}

	async function save() {
		saving = true;
		status = '';
		const payload: Record<string, unknown> = { name: draft.name };
		for (const field of fields) payload[field.key] = draft[field.key];
		payload.alternateGreetings = draft.alternateGreetings;
		payload.tags = draft.tags;
		// Lore entries are editable since Phase 4f; send the whole book so deletions stick.
		payload.book = draft.book;

		const response = await fetch(resolve('/api/characters/[id]', { id: draft.id }), {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		saving = false;
		status = response.ok ? 'Saved.' : `${response.status}: ${await response.text()}`;
		if (response.ok) toasts.success('Card saved');
		else toasts.error(status);
	}

	/** Replace one field of one lore entry without mutating the array in place. */
	function updateLoreEntry(
		index: number,
		patch: Partial<
			Character['book'] extends null ? never : NonNullable<Character['book']>['entries'][number]
		>
	) {
		if (!draft.book) return;
		draft.book = {
			...draft.book,
			entries: draft.book.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
		};
	}

	function addLoreEntry() {
		if (!draft.book) {
			draft.book = { name: draft.name, entries: [], tokenBudget: 0, scanDepth: null };
		}
		draft.book = {
			...draft.book,
			entries: [
				...draft.book.entries,
				{
					keys: [],
					secondaryKeys: [],
					content: '',
					enabled: true,
					insertionOrder: 100,
					constant: false,
					selective: false,
					name: '',
					caseSensitive: false,
					priority: null
				}
			]
		};
	}

	function removeLoreEntry(index: number) {
		if (!draft.book) return;
		draft.book = { ...draft.book, entries: draft.book.entries.filter((_, i) => i !== index) };
	}

	function addGreeting() {
		draft.alternateGreetings = [...draft.alternateGreetings, ''];
	}

	function removeGreeting(index: number) {
		draft.alternateGreetings = draft.alternateGreetings.filter((_, i) => i !== index);
	}
</script>

<svelte:head><title>{draft.name} · chatchat</title></svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
	<header class="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
		<div class="flex min-w-0 items-center gap-3">
			{#if draft.avatar}
				<img
					class="size-14 shrink-0 rounded-xl object-cover ring-1 ring-border"
					src={resolve('/api/characters/[id]/avatar', { id: draft.id })}
					alt=""
				/>
			{/if}
			<div class="flex min-w-0 flex-col gap-0.5">
				<h1 class="truncate text-title font-semibold tracking-[-0.01em]">{draft.name}</h1>
				<p class="text-label text-muted-foreground">
					<span class="rounded-full bg-muted px-2 py-0.5">{draft.spec}</span>
				</p>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<a
				class="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-ui text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
				href={resolve('/characters')}
			>
				<ArrowLeft class="size-4" aria-hidden="true" />
				Library
			</a>
			<form method="POST" action="/?/newChat" class="flex items-center gap-1.5">
				<input type="hidden" name="characterId" value={draft.id} />
				{#if draft.alternateGreetings.length > 0}
					<!-- Which opening line this chat starts from; saved with the chat, not the card. -->
					<select
						name="greetingIndex"
						aria-label="Opening message"
						class="h-9 max-w-[16rem] rounded-lg border border-border bg-background px-2 text-label text-muted-foreground"
					>
						<option value="-1">Opening message</option>
						{#each draft.alternateGreetings as text, index (index)}
							<option value={index}>Alt {index + 1}: {greetingPreview(text)}</option>
						{/each}
					</select>
				{/if}
				<button
					class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-ui transition-colors duration-150 hover:bg-accent"
					type="submit"
				>
					<MessageSquare class="size-4" aria-hidden="true" />
					chat
				</button>
			</form>
			<button
				class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-ui font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-soft hover:bg-primary/85 active:translate-y-px disabled:opacity-50"
				onclick={save}
				disabled={saving}
			>
				<Save class="size-4" aria-hidden="true" />
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</header>

	{#if status}
		<p
			class="animate-fade-up rounded-lg border px-3 py-2 text-ui"
			class:border-border={status.startsWith('Saved')}
			class:bg-card={status.startsWith('Saved')}
			class:border-destructive={!status.startsWith('Saved')}
			class:bg-destructive={!status.startsWith('Saved')}
			class:text-destructive={!status.startsWith('Saved')}
		>
			{status}
		</p>
	{/if}

	<label class={fieldLabel}>
		Name
		<input class="{field} text-title font-semibold" bind:value={draft.name} />
	</label>

	{#each fields as entry (entry.key)}
		<label class={fieldLabel}>
			{entry.label}
			<textarea class={field} rows={entry.rows} bind:value={draft[entry.key]}></textarea>
		</label>
	{/each}

	<label class={fieldLabel}>
		Tags (comma separated)
		<input
			class={field}
			value={draft.tags.join(', ')}
			oninput={(event) => {
				draft.tags = event.currentTarget.value
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean);
			}}
		/>
	</label>

	<section class="flex flex-col gap-3 border-t border-border/60 pt-5">
		<div class="flex items-center justify-between gap-3">
			<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
				Alternate greetings
			</h2>
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-label text-muted-foreground transition-[color,border-color] duration-150 hover:border-foreground/30 hover:text-foreground"
				onclick={addGreeting}
			>
				<Plus class="size-3.5" aria-hidden="true" />
				Add
			</button>
		</div>
		{#each draft.alternateGreetings as greeting, index (index)}
			<div class="flex items-start gap-2">
				<textarea
					class="{field} flex-1"
					rows="2"
					aria-label="Alternate greeting {index + 1}"
					bind:value={draft.alternateGreetings[index]}></textarea>
				<button
					class="mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-destructive/15 hover:text-destructive"
					aria-label="Remove greeting {index + 1}"
					title={`Remove greeting ${index + 1}${greeting ? `: ${greeting.slice(0, 24)}` : ''}`}
					onclick={() => removeGreeting(index)}
				>
					<Trash2 class="size-4" aria-hidden="true" />
				</button>
			</div>
		{/each}
	</section>

	<section class="flex flex-col gap-3 border-t border-border/60 pt-5">
		<div class="flex items-center justify-between gap-3">
			<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
				Lorebook ({draft.book?.entries.length ?? 0} entries)
			</h2>
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-label text-muted-foreground transition-[color,border-color] duration-150 hover:border-foreground/30 hover:text-foreground"
				onclick={addLoreEntry}
			>
				<Plus class="size-3.5" aria-hidden="true" />
				Add entry
			</button>
		</div>
		<p class="text-label text-muted-foreground">
			An entry fires when one of its keywords appears in the last few messages, or always when
			marked constant. Lower insertion order goes into the prompt earlier.
		</p>

		{#each draft.book?.entries ?? [] as entry, index (index)}
			<div class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/30 p-3">
				<div class="flex flex-wrap items-center gap-2 text-label">
					<input
						class="min-w-40 flex-1 rounded-md border border-input bg-background px-2 py-1 text-ui focus:border-ring focus:outline-none"
						aria-label="Keywords for entry {index + 1}"
						placeholder="keywords, comma separated"
						value={entry.keys.join(', ')}
						oninput={(event) =>
							updateLoreEntry(index, {
								keys: event.currentTarget.value
									.split(',')
									.map((key) => key.trim())
									.filter(Boolean)
							})}
					/>
					<label class="flex items-center gap-1.5 text-muted-foreground">
						order
						<input
							class="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-ui focus:border-ring focus:outline-none"
							type="number"
							value={entry.insertionOrder}
							oninput={(event) =>
								updateLoreEntry(index, { insertionOrder: Number(event.currentTarget.value) || 0 })}
						/>
					</label>
					<label class="flex items-center gap-1.5 text-muted-foreground">
						<input
							type="checkbox"
							checked={entry.enabled}
							onchange={(event) => updateLoreEntry(index, { enabled: event.currentTarget.checked })}
						/> enabled
					</label>
					<label class="flex items-center gap-1.5 text-muted-foreground">
						<input
							type="checkbox"
							checked={entry.constant}
							onchange={(event) =>
								updateLoreEntry(index, { constant: event.currentTarget.checked })}
						/> constant
					</label>
					<button
						class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-destructive/15 hover:text-destructive"
						aria-label="Remove entry {index + 1}"
						title={`Remove entry ${index + 1}`}
						onclick={() => removeLoreEntry(index)}
					>
						<Trash2 class="size-3.5" aria-hidden="true" />
					</button>
				</div>
				<textarea
					class="{field} text-ui"
					rows="3"
					aria-label="Entry {index + 1} content"
					placeholder="what the model should know when this fires"
					value={entry.content}
					oninput={(event) => updateLoreEntry(index, { content: event.currentTarget.value })}
				></textarea>
			</div>
		{/each}
	</section>
</main>
