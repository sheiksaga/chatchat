# Third-party notices

chatchat is licensed under the GPL-3.0 (see `LICENSE`). Every dependency below is permissively
licensed (MIT / ISC / Apache-2.0 / BSD), which is compatible with distributing this app under the GPL.
No code from SillyTavern (AGPL-3.0) is copied or linked; its file formats are implemented from
documentation.

## Runtime dependencies

| Package                                             | Licence          | What it does here                                                     |
| --------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/svelte` | Apache-2.0       | streaming chat: request/response plumbing and the client `Chat` store |
| `@sveltejs/kit`, `svelte`                           | MIT              | routing, SSR, reactivity                                              |
| `vite`, `typescript`                                | MIT / Apache-2.0 | build and type checking                                               |
| `tailwindcss`                                       | MIT              | styling                                                               |
| `bits-ui`, `shadcn-svelte`                          | MIT              | accessible primitives (dialogs, buttons)                              |
| `svelte-streamdown`                                 | MIT              | incremental markdown rendering while tokens arrive                    |
| `@lenml/char-card-reader`                           | MIT              | SillyTavern card v1/v2/v3 + lorebook parsing                          |
| `@stable-canvas/comfyui-client`                     | MIT              | ComfyUI HTTP + websocket transport                                    |
| `zod`                                               | MIT              | request/response validation                                           |
| `clsx`, `tailwind-merge`, `tailwind-variants`       | MIT              | class composition                                                     |
| `@lucide/svelte`                                    | ISC              | icons                                                                 |

## Development only

| Package                                                             | Licence    | What it does                              |
| ------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| `vitest`                                                            | MIT        | unit and integration tests                |
| `@playwright/test`                                                  | Apache-2.0 | browser end-to-end tests                  |
| `prettier`, `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` | MIT        | formatting                                |
| `eslint`, `typescript-eslint`, `eslint-plugin-svelte`               | MIT        | linting                                   |
| `tsx`                                                               | MIT        | running `tools/*.ts` without a build step |

## Data formats

- **Character cards** — the PNG `tEXt`/`iTXt` "chara" convention and the v2/v3 JSON layout, as
  documented by the SillyTavern project and the `character-card-spec-v3` repository. Implemented here
  via `@lenml/char-card-reader`; this repo ships no SillyTavern code.
- **`models-router.ini`** — llama.cpp's per-model preset file, parsed by `backends/llm/ini.ts`.

## Fonts and assets

No web fonts are downloaded at runtime. The UI uses the operating system's UI font stack, so the app
works with no network at all. Icons are inline SVG or `@lucide/svelte` (ISC).

## Image LoRAs (downloaded separately)

The app names five LoRA files that sit beside the checkpoints in `ComfyUI/models/loras/`. They are weights,
not code, so the GPL of this repository does not apply to them and their own terms do; each is listed with
its source so the terms can be checked. `npm run doctor` reports any that are missing.

| File                            | Source                                                                | Used by                   |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| `Zed_Turbo_Lightning`           | <https://civitai.com/models/2409672> (step distillation, 4 steps)     | Z-Image Turbo             |
| `Mystic-XXX-ZIT-V7`             | Civitai (NSFW unlock, rank 64) — search the file name                 | Z-Image + Mystic XXX      |
| `FLUX_NSFW_Fix`                 | <https://civitai.com/models/2482439> (4B anatomy/NSFW fix)            | FLUX.2 Klein NSFW         |
| `anima-highres-aesthetic-boost` | <https://civitai.com/models/2540444> (higher resolutions, aesthetics) | Anima Turbo + detail      |
| `rendering_detailer_base10`     | <https://civitai.com/models/2620171> (detail slider)                  | Anima Turbo + detail      |
| `snofs_krea_v1_nostrip`         | ships with Krea2 Anime (present in the graph at strength 0)           | Krea2 Anime               |
| `fedor_bypass`                  | ships with Krea2 (style bypass)                                       | Krea2 Turbo / Krea2 Anime |

## Not bundled

- ComfyUI, llama.cpp, LM Studio and any model weights: the user installs and runs these separately.
- Generated images and chat history live in `data/` on the user's machine and are the user's own.
