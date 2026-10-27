/**
 * Transient feedback, one per action ("Copied", "Chat renamed", "Nothing to retry").
 *
 * Deliberately an explicit store module rather than a component-local variable: the things that need
 * to announce an outcome (message actions, sidebar renames, card imports) are in different branches.
 * Keep it to one line of text — anything longer belongs inline next to the thing that failed.
 */
export type ToastTone = 'info' | 'success' | 'error';

export type ToastItem = {
	id: number;
	message: string;
	tone: ToastTone;
};

class ToastStore {
	items = $state<ToastItem[]>([]);
	#next = 0;

	/** Show a toast. `ttl` is in ms; pass 0 to keep it until dismissed. */
	show(message: string, tone: ToastTone = 'info', ttl = 2600) {
		const id = ++this.#next;
		this.items = [...this.items, { id, message, tone }];
		if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
		return id;
	}

	success(message: string) {
		return this.show(message, 'success');
	}

	error(message: string) {
		return this.show(message, 'error', 4200);
	}

	dismiss(id: number) {
		this.items = this.items.filter((item) => item.id !== id);
	}
}

export const toasts = new ToastStore();
