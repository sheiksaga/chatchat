<script lang="ts">
	// Settings: providers, keys and the active model.
	//
	// All writes go through the `/api/*` routes, so the phone, a script and this page share one code
	// path. API keys are never sent to the browser: the form leaves the field blank to keep the
	// stored key, and typing into it replaces the key.
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { Check, Lock, Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog/ConfirmDialog.svelte';
	import SidebarTrigger from '$lib/components/chat/SidebarTrigger.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { ProviderInfo, ProviderKind } from '$lib/shared/provider.js';

	let { data } = $props();

	type Draft = {
		id: string;
		label: string;
		kind: ProviderKind;
		baseUrl: string;
		apiKey: string;
		routerIni: string;
		chat: boolean;
		images: boolean;
		isLocal: boolean;
	};

	const emptyDraft = (): Draft => ({
		id: '',
		label: '',
		kind: 'openai',
		baseUrl: 'https://',
		apiKey: '',
		routerIni: '',
		chat: true,
		images: false,
		isLocal: false
	});

	let draft = $state<Draft | null>(null);
	let editingExisting = $state(false);
	let busy = $state(false);
	let message = $state('');
	let models = $state<string[]>([]);
	let modelError = $state('');
	let pendingProviderId = $state<string | null>(null);
	let confirmOpen = $state(false);

	const providers = $derived(data.settings.providers as ProviderInfo[]);
	const activeProvider = $derived(data.settings.activeProvider);
	const activeModel = $derived(data.settings.activeModel[activeProvider] ?? '');

	// Reading controls are optimistic local copies: dragging the slider must move the preview now,
	// not after a round trip to the server.
	let previewWidth = $state(untrack(() => data.settings.appearance.contentWidth));
	let previewSize = $state(untrack(() => data.settings.appearance.fontSize));

	const field =
		'rounded-lg border border-input bg-background px-3 py-2 text-ui placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none';
	const fieldLabel = 'flex flex-col gap-1.5 text-label font-medium text-muted-foreground';

	function startNew(template?: (typeof data.templates)[number]) {
		editingExisting = false;
		message = '';
		draft = template ? { ...emptyDraft(), ...template, apiKey: '', routerIni: '' } : emptyDraft();
	}

	function startEdit(provider: ProviderInfo) {
		editingExisting = true;
		message = '';
		draft = {
			id: provider.id,
			label: provider.label,
			kind: provider.kind,
			baseUrl: provider.baseUrl,
			apiKey: '',
			routerIni: provider.routerIni ?? '',
			chat: provider.chat,
			images: provider.images,
			isLocal: provider.isLocal
		};
	}

	async function post(path: string, body: unknown, method = 'POST') {
		busy = true;
		message = '';
		try {
			const response = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: method === 'DELETE' ? undefined : JSON.stringify(body)
			});
			if (!response.ok) {
				message = `${response.status}: ${await response.text()}`;
				toasts.error(message);
				return false;
			}
			await invalidateAll();
			return true;
		} finally {
			busy = false;
		}
	}

	/** Settings are one PATCH-shaped endpoint; this keeps the appearance form two lines long. */
	async function saveSettings(patch: Record<string, unknown>) {
		const ok = await post(resolve('/api/settings'), patch);
		if (ok) {
			message = 'Saved.';
			toasts.success('Saved');
		}
	}

	async function save() {
		if (!draft) return;
		const payload: Record<string, unknown> = {
			id: draft.id.trim(),
			label: draft.label.trim(),
			kind: draft.kind,
			baseUrl: draft.baseUrl.trim(),
			chat: draft.chat,
			images: draft.images,
			isLocal: draft.isLocal
		};
		// Blank key means "keep what is stored"; only an explicit edit replaces it.
		if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();
		if (draft.routerIni.trim()) payload.routerIni = draft.routerIni.trim();

		if (await post(resolve('/api/providers'), payload)) {
			draft = null;
			message = 'Saved.';
			toasts.success('Provider saved');
		}
	}

	function askRemove(id: string) {
		pendingProviderId = id;
		confirmOpen = true;
	}

	async function removeConfirmed() {
		const id = pendingProviderId;
		pendingProviderId = null;
		if (!id) return;
		if (await post(resolve('/api/providers/[id]', { id }), null, 'DELETE')) {
			message = 'Deleted.';
			toasts.success('Provider deleted');
		}
	}

	async function activate(id: string) {
		await post(resolve('/api/settings'), { activeProvider: id });
		models = [];
		modelError = '';
	}

	async function chooseModel(model: string) {
		await post(resolve('/api/settings'), {
			activeModel: { ...data.settings.activeModel, [activeProvider]: model }
		});
	}

	async function loadModels() {
		models = [];
		modelError = '';
		const response = await fetch(
			resolve('/api/models') + `?provider=${encodeURIComponent(activeProvider)}`
		);
		const body = await response.json();
		if (body.ok) models = body.models;
		else modelError = body.error ?? 'unreachable';
	}
</script>

<svelte:head><title>Settings · chatchat</title></svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 py-8">
	<header class="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-4">
		<div class="flex min-w-0 items-start gap-2.5">
			<SidebarTrigger />
			<div class="flex flex-col gap-1">
				<h1 class="text-display font-semibold tracking-[-0.01em]">Settings</h1>
				<p class="text-ui text-muted-foreground">
					Everything here is stored on this machine, in <code class="font-mono text-[0.9em]"
						>data/config.json</code
					>.
				</p>
			</div>
		</div>
		<a
			class="inline-flex h-9 items-center rounded-lg border border-border px-3 text-ui transition-colors duration-150 hover:bg-accent"
			href={resolve('/')}>← All chats</a
		>
	</header>

	<section class="flex flex-col gap-3">
		<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
			Providers
		</h2>

		<ul class="flex flex-col gap-2">
			{#each providers as provider (provider.id)}
				{@const active = provider.id === activeProvider}
				<li
					class="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border px-4 py-3 transition-colors duration-150 {active
						? 'border-foreground/25 bg-card'
						: 'border-border'}"
				>
					<span
						class="size-2 shrink-0 rounded-full {active
							? 'bg-emerald-400'
							: 'bg-muted-foreground/40'}"
						title={active ? 'Active provider' : 'Not in use'}
					></span>
					<span class="text-ui font-medium">{provider.label}</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-label text-muted-foreground">
						{provider.kind}
					</span>
					<span class="min-w-0 truncate font-mono text-label text-muted-foreground">
						{provider.baseUrl}
					</span>
					{#if provider.hasKey}
						<span class="inline-flex items-center gap-1 text-label text-muted-foreground">
							<Lock class="size-3" aria-hidden="true" /> key stored
						</span>
					{/if}
					{#if active}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-label font-medium text-emerald-300"
						>
							<Check class="size-3" aria-hidden="true" /> active
						</span>
					{/if}
					<span class="ms-auto flex shrink-0 items-center gap-1.5">
						{#if !active}
							<Button variant="outline" size="sm" onclick={() => activate(provider.id)}>Use</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={() => startEdit(provider)}>Edit</Button>
						<Button variant="destructive" size="sm" onclick={() => askRemove(provider.id)}>
							Delete
						</Button>
					</span>
				</li>
			{/each}
		</ul>

		<div class="flex flex-wrap gap-2 pt-1">
			{#each data.templates as template (template.id)}
				<button
					class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-label text-muted-foreground transition-[color,border-color,transform] duration-150 ease-soft hover:-translate-y-px hover:border-foreground/30 hover:text-foreground"
					onclick={() => startNew(template)}
				>
					<Plus class="size-3.5" aria-hidden="true" />
					{template.label}
				</button>
			{/each}
		</div>
	</section>

	{#if draft}
		<section
			class="flex animate-fade-up flex-col gap-4 rounded-xl border border-border bg-card/50 p-4"
		>
			<h2 class="text-ui font-semibold">
				{editingExisting ? `Edit ${draft.id}` : 'New provider'}
			</h2>

			<div class="grid gap-3 sm:grid-cols-2">
				<label class={fieldLabel}>
					Id
					<input
						class={field}
						bind:value={draft.id}
						readonly={editingExisting}
						placeholder="my-provider"
					/>
				</label>

				<label class={fieldLabel}>
					Label
					<input class={field} bind:value={draft.label} />
				</label>

				<label class={fieldLabel}>
					Kind
					<select class={field} bind:value={draft.kind}>
						<option value="llamacpp">llama.cpp</option>
						<option value="lmstudio">LM Studio</option>
						<option value="openai">OpenAI-compatible</option>
					</select>
				</label>

				<label class={fieldLabel}>
					Base URL
					<input class={field} bind:value={draft.baseUrl} />
				</label>
			</div>

			<label class={fieldLabel}>
				API key
				<input
					class={field}
					type="password"
					bind:value={draft.apiKey}
					placeholder={editingExisting ? 'stored — leave blank to keep' : 'optional'}
				/>
			</label>

			{#if draft.kind === 'llamacpp'}
				<label class={fieldLabel}>
					models-router.ini (absolute path, optional)
					<input class={field} bind:value={draft.routerIni} />
				</label>
			{/if}

			<div class="flex flex-wrap gap-4 text-ui">
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={draft.chat} /> chat
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={draft.images} /> images
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={draft.isLocal} /> local
				</label>
			</div>

			<div class="flex gap-2">
				<Button size="lg" onclick={save} disabled={busy}>Save provider</Button>
				<Button size="lg" variant="ghost" onclick={() => (draft = null)}>Cancel</Button>
			</div>
		</section>
	{/if}

	<section class="flex flex-col gap-3 border-t border-border/60 pt-5">
		<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
			Model
		</h2>
		<p class="text-ui text-muted-foreground">
			Active: <span class="font-mono text-foreground">{activeProvider}</span>
			{#if activeModel}· <span class="font-mono text-foreground">{activeModel}</span>{/if}
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="outline" size="lg" onclick={loadModels}>Load model list</Button>
			{#if models.length}
				<select
					class="max-w-full rounded-lg border border-input bg-background px-3 py-1.5 text-ui focus:border-ring focus:outline-none"
					aria-label="Active model"
					value={activeModel}
					onchange={(event) => chooseModel(event.currentTarget.value)}
				>
					{#each models as model (model)}
						<option value={model}>{model}</option>
					{/each}
				</select>
			{/if}
			{#if modelError}
				<span class="text-ui text-destructive">{modelError}</span>
			{/if}
		</div>
	</section>

	<section class="flex flex-col gap-4 border-t border-border/60 pt-5">
		<h2 class="text-label font-semibold tracking-[0.08em] text-muted-foreground uppercase">
			Reading
		</h2>

		<label class="flex flex-col gap-1.5 text-ui sm:flex-row sm:items-center sm:gap-3">
			<span class="sm:w-64"
				>Your name (the <code class="font-mono text-[0.9em]">user</code> placeholder)</span
			>
			<input
				class="{field} sm:w-56"
				value={data.settings.userName}
				onchange={(event) => saveSettings({ userName: event.currentTarget.value })}
			/>
		</label>

		<div class="flex flex-col gap-1.5">
			<div class="flex items-center justify-between gap-3">
				<label class="text-ui" for="content-width">Content width</label>
				<span
					class="rounded-full bg-muted px-2 py-0.5 text-label text-muted-foreground tabular-nums"
				>
					{previewWidth}ch
				</span>
			</div>
			<input
				id="content-width"
				class="w-full"
				type="range"
				min="30"
				max="120"
				bind:value={previewWidth}
				onchange={() => saveSettings({ appearance: { contentWidth: previewWidth } })}
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<div class="flex items-center justify-between gap-3">
				<label class="text-ui" for="font-size">Font size</label>
				<span
					class="rounded-full bg-muted px-2 py-0.5 text-label text-muted-foreground tabular-nums"
				>
					{previewSize}px
				</span>
			</div>
			<input
				id="font-size"
				class="w-full"
				type="range"
				min="12"
				max="24"
				bind:value={previewSize}
				onchange={() => saveSettings({ appearance: { fontSize: previewSize } })}
			/>
		</div>

		<!-- The point of a preview: you can see the reading width and size before leaving the page. -->
		<div class="rounded-xl border border-border/60 bg-card/40 p-4">
			<p class="text-label tracking-[0.08em] text-muted-foreground uppercase">Preview</p>
			<p
				class="msg-prose mt-2 text-foreground/90"
				style="--content-size: {previewSize}px; max-width: {previewWidth}ch;"
			>
				The gate stands open under a moon so low it seems to rest on the torii. Somewhere past the
				steps, water moves. <em>She does not turn around.</em>
			</p>
		</div>
	</section>

	{#if message}
		<p class="text-ui" class:text-destructive={message.includes(':')}>{message}</p>
	{/if}

	<p class="text-label text-muted-foreground">
		Keys are stored in <code class="font-mono text-[0.9em]">data/config.json</code> on the server and
		never sent to this page.
	</p>
</main>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete this provider?"
	description={pendingProviderId
		? `“${pendingProviderId}” is removed from the config. Chats that used it stay in the database.`
		: ''}
	confirmLabel="Delete provider"
	onconfirm={removeConfirmed}
/>
