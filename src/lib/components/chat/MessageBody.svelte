<script lang="ts">
	// One message's text.
	//
	// Assistant output is markdown (model replies are full of lists, code fences and emphasis);
	// user and system text is shown verbatim, because "I typed *that*" must mean what it says.
	// `static` tells Streamdown no more tokens are coming, which lets it stop healing half-finished
	// blocks — pass `isStreaming` for the message currently being written.
	//
	// Sizing lives in `app.css` under `.msg-prose`, so the Reading slider and the markdown element
	// scale from the same value.
	import { Streamdown } from 'svelte-streamdown';

	let {
		content,
		role,
		isStreaming = false
	}: { content: string; role: string; isStreaming?: boolean } = $props();
</script>

{#if role === 'assistant'}
	<div class="msg-prose" class:streaming-caret={isStreaming && content.trim().length > 0}>
		<Streamdown {content} static={!isStreaming} baseTheme="shadcn" />
	</div>
{:else}
	<p class="text-ui leading-relaxed whitespace-pre-wrap">{content}</p>
{/if}
