<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/**
	 * A square, icon-only button.
	 *
	 * `label` is not decoration: it is the button's accessible name *and* its tooltip, which is the
	 * only thing telling a mouse user what the icon does. Every icon button in this app must have one.
	 */
	export const iconButtonVariants = tv({
		base: 'inline-grid shrink-0 place-items-center rounded-md text-muted-foreground transition-[color,background-color,opacity,transform] duration-150 ease-soft hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
		variants: {
			size: {
				sm: 'size-7 [&_svg]:size-3.5',
				md: 'size-9 [&_svg]:size-4',
				lg: 'size-10 [&_svg]:size-[1.15rem]'
			},
			tone: {
				default: '',
				danger: 'hover:bg-destructive/15 hover:text-destructive focus-visible:text-destructive'
			}
		},
		defaultVariants: { size: 'md', tone: 'default' }
	});

	export type IconButtonProps = WithElementRef<HTMLButtonAttributes> &
		VariantProps<typeof iconButtonVariants> & { label: string };
</script>

<script lang="ts">
	let {
		label,
		size = 'md',
		tone = 'default',
		class: className,
		children,
		...rest
	}: IconButtonProps = $props();
</script>

<button
	type="button"
	aria-label={label}
	title={label}
	class={cn(iconButtonVariants({ size, tone }), className)}
	{...rest}
>
	{@render children?.()}
</button>
