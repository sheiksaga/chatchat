<script lang="ts">
	// The landing screen: the chat list, and a way to start a new conversation.
	import { resolve } from '$app/paths';
	import { ChevronRight, MessageSquarePlus, Plus, Stethoscope } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let { data } = $props();

	function when(ms: number) {
		const minutes = Math.round((Date.now() - ms) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours} h ago`;
		return `${Math.round(hours / 24)} d ago`;
	}
</script>

<svelte:head><title>chatchat</title></svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 py-8">
	<header class="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
		<h1 class="text-display font-semibold tracking-[-0.01em]">chatchat</h1>
		<form method="POST" action="?/newChat">
			<Button type="submit" size="lg" class="gap-1.5">
				<Plus class="size-4" aria-hidden="true" />
				New chat
			</Button>
		</form>
	</header>

	{#if data.chats.length === 0}
		<div
			class="flex animate-fade-in flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center"
		>
			<span class="grid size-12 place-items-center rounded-full bg-muted">
				<MessageSquarePlus class="size-5 text-muted-foreground" aria-hidden="true" />
			</span>
			<h2 class="text-title font-semibold">No chats yet</h2>
			<p class="max-w-[46ch] text-ui text-muted-foreground">
				Start one with <strong class="font-medium text-foreground">New chat</strong>, or pick a card
				from
				<a class="underline underline-offset-2 hover:text-foreground" href={resolve('/characters')}
					>characters</a
				>. The model server (<code class="font-mono text-[0.9em]">chat_image.bat</code>) has to be
				running for replies to arrive.
			</p>
		</div>
	{:else}
		<section class="flex flex-col gap-2.5">
			<div class="flex items-baseline justify-between px-1">
				<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
					Recent chats
				</h2>
				<span class="text-label text-muted-foreground/70 tabular-nums">{data.chats.length}</span>
			</div>

			<ul class="flex flex-col gap-1.5">
				{#each data.chats as chat (chat.id)}
					<li>
						<a
							href={resolve('/chat/[id]', { id: chat.id })}
							class="group flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 transition-[background-color,border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-border hover:bg-card"
						>
							<span class="min-w-0 flex-1 truncate text-ui">{chat.title}</span>
							<span class="shrink-0 text-label text-muted-foreground tabular-nums">
								{when(chat.updatedAt)}
							</span>
							<ChevronRight
								class="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-soft group-hover:translate-x-0 group-hover:opacity-100"
								aria-hidden="true"
							/>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<footer
		class="flex items-center gap-4 border-t border-border/60 pt-4 text-label text-muted-foreground"
	>
		<a
			class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-accent hover:text-foreground"
			href={resolve('/characters')}>Characters</a
		>
		<a
			class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-accent hover:text-foreground"
			href={resolve('/settings')}>Settings</a
		>
		<a
			class="ms-auto inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-accent hover:text-foreground"
			href={resolve('/diagnostics')}
		>
			<Stethoscope class="size-3.5" aria-hidden="true" />
			Diagnostics
		</a>
	</footer>
</main>
