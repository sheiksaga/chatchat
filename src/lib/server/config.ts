import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Server configuration: the single place where hosts, ports and default model ids live.
 * Nothing else in the codebase may hardcode a backend address (see CLAUDE.md invariants).
 */

/** llama.cpp server. Router mode (`--models-dir`) or a single-model server both work. */
export const LLAMACPP_URL = process.env.CHATCHAT_LLAMACPP_URL ?? 'http://127.0.0.1:8081';

/** ComfyUI. Used from Phase 5 on; declared here so the address lives in one place. */
export const COMFYUI_URL = process.env.CHATCHAT_COMFYUI_URL ?? 'http://127.0.0.1:8188';

/** Model id served by the llama.cpp router; must match a section in `models-router.ini`. */
export const DEFAULT_MODEL = process.env.CHATCHAT_MODEL ?? 'L3-8B-Stheno-v3.2-Q4_K_M-imat';

/**
 * Samplers sent with every request.
 *
 * Stheno v3.2 card values, the same ones `models-router.ini` sets as the server-side
 * fallback: temp 1.17 / min_p 0.075 / top_k 50 / repeat_penalty 1.1.
 * Phase 2 replaces this constant with per-model values read from `/props` + user overrides.
 */
export const DEFAULT_SAMPLERS = {
	temperature: 1.17,
	top_p: 1,
	top_k: 50,
	min_p: 0.075,
	repeat_penalty: 1.1
} as const;

/** Stop strings for chat mode. llama.cpp also stops on EOG tokens by itself. */
export const STOP_SEQUENCES = ['<|end_of_turn|>', '<end_of_turn>', '\nUser:', '\nUSER:'] as const;

/**
 * Filesystem roots. `adapter-node` runs with cwd = project root, and tests run from the same
 * place, so `process.cwd()` is the anchor. Every one of these is overridable by env for the
 * packaged build and for tests.
 */
const ROOT = process.env.CHATCHAT_ROOT ?? process.cwd();

/** API-format ComfyUI graphs (`workflows/*.json`). */
export const WORKFLOWS_DIR =
	process.env.CHATCHAT_WORKFLOWS_DIR ??
	(existsSync(path.join(ROOT, 'workflows'))
		? path.join(ROOT, 'workflows')
		: // fallback for running the app from a nested folder (tests, packaged build)
			path.join(ROOT, '..', 'workflows'));

/** Runtime data: SQLite db, image bytes, server-side provider config. Gitignored. */
export const DATA_DIR = process.env.CHATCHAT_DATA_DIR ?? path.join(ROOT, 'data');

/** Per-chat folders: `chats/<chatId>/{chat.json, story.json, images/}`. */
export const CHATS_DIR = path.join(DATA_DIR, 'chats');

/** Pictures that belong to no chat (one-off generations, tests). */
export const IMAGES_DIR = path.join(DATA_DIR, 'images');

/** Character card avatars (one file per card, named after the card id). */
export const CARDS_DIR = path.join(DATA_DIR, 'cards');

/**
 * Hard ceiling on one reply.
 *
 * Not a style preference: a small model can fall into a repetition loop ("1man, adult, short brown hair, ...
 * 1man, adult, short brown hair, ...") and a loop with no ceiling writes 118 KB / 29 500 tokens, fills the
 * whole context and leaves the chat unable to answer anything afterwards. 1200 tokens is ~4 800 characters —
 * far longer than any reply this app wants, short enough that a loop costs seconds instead of five minutes.
 */
export const MAX_REPLY_TOKENS = Number(process.env.CHATCHAT_MAX_REPLY_TOKENS ?? 1200);
