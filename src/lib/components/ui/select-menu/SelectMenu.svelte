<!--
	A one-of-N picker: a small trigger plus a popover list.

	**Why not `<select>`?** `@tailwindcss/forms` gives every `select` `padding: 0.5rem 0.75rem` from the
	base layer. Inside the 20-28px pill a header row wants, that leaves ~4px of content box, so the
	13px label is clipped to a slice of glyphs — which is exactly how the model pickers "disappeared".
	Overriding the padding works until the next component copy; owning the list is the durable fix, and
	it also lets a 40-character model id be readable instead of truncated by the native control.

	Keyboard: opening focuses the selected option (or the first one), ↑/↓/Home/End move between options,
	Enter/Space chooses (they are buttons), Escape closes and returns focus to the trigger.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Check, ChevronDown } from '@lucide/svelte';

	interface SelectOption {
		value: string;
		/** What the list shows. Defaults to `value`. */
		label?: string;
		/** Second line in the list — a filename, a size, "not downloaded". */
		hint?: string;
		disabled?: boolean;
	}

	let {
		options,
		value = $bindable(),
		label,
		placeholder = 'None',
		disabled = false,
		/** `end` anchors the panel to the trigger's right edge (for a control near the screen edge). */
		align = 'start',
		/**
		 * Where the panel opens. `auto` flips upward when there is no room below — the image-model row sits
		 * directly above the composer, so a nine-item list would otherwise fall off the bottom of a phone.
		 */
		placement = 'auto',
		/** `chip` is a bordered pill; `plain` is bare text, for a trigger inside a metadata row. */
		tone = 'chip',
		/** Extra classes for the trigger; use it for width and font, not for colour (which `tone` owns). */
		class: triggerClass = '',
		onchange,
		/** Rendered under the list: "no models answered", a link to settings, … */
		footer
	}: {
		options: SelectOption[];
		value?: string;
		label: string;
		placeholder?: string;
		disabled?: boolean;
		align?: 'start' | 'end';
		placement?: 'auto' | 'up' | 'down';
		tone?: 'chip' | 'plain';
		class?: string;
		onchange?: (value: string) => void;
		footer?: Snippet;
	} = $props();

	let open = $state(false);
	/** Decided once per open, from the trigger's distance to the bottom of the window. */
	let dropUp = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLDivElement | null>(null);

	const current = $derived(options.find((option) => option.value === value));

	function toggle() {
		if (open) {
			open = false;
			return;
		}
		const room = window.innerHeight - (trigger?.getBoundingClientRect().bottom ?? 0);
		dropUp = placement === 'up' || (placement === 'auto' && room < 280);
		open = true;
	}

	function close(returnFocus = true) {
		open = false;
		if (returnFocus) trigger?.focus();
	}

	function choose(next: string) {
		value = next;
		close();
		onchange?.(next);
	}

	/** Focus the current option as soon as the list exists, so the keyboard path needs no Tab. */
	$effect(() => {
		if (!open) return;
		const list = panel;
		if (!list) return;
		const selected =
			list.querySelector<HTMLElement>('[aria-selected="true"]') ??
			list.querySelector<HTMLElement>('[role="option"]');
		selected?.focus();
	});

	function move(event: KeyboardEvent, delta: number | 'first' | 'last') {
		const list = panel;
		if (!list) return;
		event.preventDefault();
		const items = [...list.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])')];
		if (!items.length) return;
		if (delta === 'first') return items[0].focus();
		if (delta === 'last') return items.at(-1)?.focus();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next = at === -1 ? 0 : (at + delta + items.length) % items.length;
		items[next].focus();
	}
</script>

<div class="relative inline-flex min-w-0">
	<button
		bind:this={trigger}
		type="button"
		{disabled}
		class="inline-flex min-w-0 items-center gap-1 rounded-md text-label text-muted-foreground transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 {tone ===
		'chip'
			? 'h-7 border border-border/70 bg-card/40 ps-2 pe-1.5 hover:border-foreground/25 hover:text-foreground'
			: 'h-6 ps-1 pe-1.5 hover:bg-accent hover:text-foreground'} {triggerClass}"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={label}
		title={current?.label ?? current?.value ?? placeholder}
		onclick={toggle}
		onkeydown={(event) => {
			if (event.key === 'ArrowDown' && !open) {
				event.preventDefault();
				toggle();
			}
		}}
	>
		<span class="truncate">{current?.label ?? current?.value ?? placeholder}</span>
		<ChevronDown
			class="size-3 shrink-0 opacity-70 transition-transform duration-150 {open
				? 'rotate-180'
				: ''}"
			aria-hidden="true"
		/>
	</button>

	{#if open}
		<!-- Click-away layer: a real element keeps the popover from needing a window listener. -->
		<button
			class="fixed inset-0 z-20 cursor-default"
			tabindex="-1"
			aria-hidden="true"
			onclick={() => close(false)}
		></button>
		<div
			bind:this={panel}
			class="absolute z-30 max-h-72 w-max max-w-[min(22rem,calc(100vw-2rem))] min-w-full animate-pop-in overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl shadow-black/50 {align ===
			'end'
				? 'end-0'
				: 'start-0'} {dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}"
			role="listbox"
			aria-label={label}
			tabindex="-1"
			onkeydown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					close();
				} else if (event.key === 'ArrowDown') move(event, 1);
				else if (event.key === 'ArrowUp') move(event, -1);
				else if (event.key === 'Home') move(event, 'first');
				else if (event.key === 'End') move(event, 'last');
				else if (event.key === 'Tab') close(false);
			}}
		>
			{#each options as option (option.value)}
				<button
					type="button"
					role="option"
					aria-selected={option.value === value}
					disabled={option.disabled}
					class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-label text-popover-foreground transition-colors duration-100 hover:bg-accent focus:bg-accent focus:outline-none disabled:pointer-events-none disabled:opacity-40"
					onclick={() => choose(option.value)}
				>
					<span class="min-w-0 flex-1">
						<span class="block truncate">{option.label ?? option.value}</span>
						{#if option.hint}
							<span class="block truncate text-muted-foreground">{option.hint}</span>
						{/if}
					</span>
					{#if option.value === value}
						<Check class="size-3.5 shrink-0" aria-hidden="true" />
					{/if}
				</button>
			{:else}
				<p class="px-2 py-1.5 text-label text-muted-foreground">Nothing to choose from yet.</p>
			{/each}

			{#if footer}
				<div class="mt-1 border-t border-border/60 px-2 py-1.5 text-label text-muted-foreground">
					{@render footer()}
				</div>
			{/if}
		</div>
	{/if}
</div>
