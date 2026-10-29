/**
 * "Is the chat list open?" — the state behind the phone drawer.
 *
 * Below `md` the sidebar is not a column but a slide-over panel (a 240px column on a 412px phone left
 * 172px for the conversation). The trigger lives in each page's header, the panel lives in the layout, so
 * the two need one shared flag. Context, not a module singleton: one instance per layout, which keeps
 * invariant 7 (`no new module-level mutable state`) and lets two windows be independent.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('sidebar drawer');

export class SidebarDrawer {
	/** Only meaningful below `md`; the layout ignores it at `md` and up. */
	open = $state(false);

	show() {
		this.open = true;
	}

	hide() {
		this.open = false;
	}

	toggle() {
		this.open = !this.open;
	}
}

/** Called once, by `+layout.svelte`. */
export function provideSidebarDrawer(): SidebarDrawer {
	return setContext(KEY, new SidebarDrawer());
}

/** Called by `SidebarTrigger` in a page header. */
export function useSidebarDrawer(): SidebarDrawer {
	const drawer = getContext<SidebarDrawer | undefined>(KEY);
	if (!drawer) throw new Error('useSidebarDrawer() is only valid inside the app layout');
	return drawer;
}
