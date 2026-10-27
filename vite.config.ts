import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['src/**/*.svelte.{test,spec}.ts'],
		// Every spec gets a scratch `data/` so `npm run verify` can never touch the real one.
		setupFiles: ['vitest.setup.ts']
	}
});
