/**
 * Provider settings: the shape stored in `data/config.json` and the shape the settings UI sees.
 *
 * Two schemas matter:
 * - `providerSchema` — the stored form, including the API key.
 * - `providerInfoSchema` — what leaves the server. **Keys never cross this boundary**; the UI only
 *   learns `hasKey`, so a stolen browser session cannot exfiltrate them.
 */
import { z } from 'zod';
import { samplersSchema } from './chat-request.js';

/**
 * - `llamacpp`   — llama.cpp server or router (extra sampler fields, optional models-router.ini)
 * - `lmstudio`   — LM Studio (`/v1/models`, load/unload lifecycle)
 * - `openai`     — anything OpenAI-compatible over HTTP with a Bearer key
 * - `fake`       — deterministic in-process model for tests; never needs a GPU
 */
export const providerKindSchema = z.enum(['llamacpp', 'lmstudio', 'openai', 'fake']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

const baseUrlSchema = z
	.string()
	.min(1)
	// Accept what people actually paste: with or without a trailing slash, and with or without
	// `/v1`. Trailing slashes are normalised by the adapters, not here.
	.refine((value) => /^https?:\/\/[^\s]+$/i.test(value), 'must start with http:// or https://');

export const providerSchema = z.object({
	id: z
		.string()
		.min(1)
		.max(48)
		.regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, dot, dash, underscore'),
	label: z.string().min(1).max(80),
	kind: providerKindSchema,
	/** Root of the API, e.g. `http://127.0.0.1:8081/v1` or `http://127.0.0.1:8188`. */
	baseUrl: baseUrlSchema,
	/** Empty string means "no key" (local servers). Never sent back to the browser. */
	apiKey: z.string().max(400).default(''),
	/** Extra request headers, e.g. OpenRouter's `HTTP-Referer` / `X-Title`. */
	headers: z.record(z.string(), z.string()).default({}),
	chat: z.boolean().default(true),
	images: z.boolean().default(false),
	/** Local servers own their model lifecycle and need no key. */
	isLocal: z.boolean().default(false),
	/**
	 * llama.cpp router only: absolute path to `models-router.ini`. Per-model sampler defaults live
	 * there, because router mode's `/props` describes the router, not a model.
	 */
	routerIni: z.string().optional()
});

/** What the browser is allowed to know about a provider. */
export const providerInfoSchema = providerSchema.omit({ apiKey: true }).extend({
	hasKey: z.boolean()
});

/**
 * Body of `POST /api/providers`. Everything the stored schema defaults is optional here, and
 * `apiKey` is optional so a settings form can update a provider without ever holding its key.
 */
export const providerInputSchema = providerSchema.partial({
	apiKey: true,
	headers: true,
	chat: true,
	images: true,
	isLocal: true
});

/** Body of `POST /api/settings`. */
export const settingsPatchSchema = z.object({
	activeProvider: z.string().min(1).optional(),
	activeModel: z.record(z.string(), z.string()).optional(),
	samplers: samplersSchema.optional(),
	userName: z.string().trim().min(1).max(60).optional(),
	appearance: z
		.object({
			contentWidth: z.number().min(30).max(120).optional(),
			fontSize: z.number().min(12).max(24).optional()
		})
		.optional()
});

export const appConfigSchema = z.object({
	version: z.literal(1),
	providers: z.array(providerSchema),
	/** Id of the provider new messages use. */
	activeProvider: z.string().min(1),
	/** Model id last chosen per provider, so switching back remembers it. */
	activeModel: z.record(z.string(), z.string()).default({}),
	/** Global sampler overrides applied on top of the backend's own defaults. */
	samplers: samplersSchema.default({}),
	/** Substituted for `{{user}}` in character cards and prompts. */
	userName: z.string().trim().min(1).max(60).default('You'),
	/** Reading comfort; applied as CSS custom properties by the layout. */
	appearance: z
		.object({
			/** Content width in `ch` units — scales with the font size, so it stays readable. */
			contentWidth: z.number().min(30).max(120).default(72),
			/** Base font size in px. 18 is the desktop default: 16 was small at arm's length. */
			fontSize: z.number().min(12).max(24).default(18)
		})
		.default({ contentWidth: 72, fontSize: 18 })
});

export type Provider = z.infer<typeof providerSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type ProviderInfo = z.infer<typeof providerInfoSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Templates the settings UI offers behind "Add provider". No keys, no ids that could collide with
 * a user's own entry — the UI suffixes the id when it is taken.
 */
export const PROVIDER_TEMPLATES = [
	{
		id: 'llamacpp',
		label: 'llama.cpp (local)',
		kind: 'llamacpp',
		baseUrl: 'http://127.0.0.1:8081/v1',
		isLocal: true,
		chat: true,
		images: false
	},
	{
		id: 'lmstudio',
		label: 'LM Studio (local)',
		kind: 'lmstudio',
		baseUrl: 'http://127.0.0.1:1234/v1',
		isLocal: true,
		chat: true,
		images: false
	},
	{
		id: 'openai',
		label: 'OpenAI',
		kind: 'openai',
		baseUrl: 'https://api.openai.com/v1',
		isLocal: false,
		chat: true,
		images: true
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		kind: 'openai',
		baseUrl: 'https://openrouter.ai/api/v1',
		isLocal: false,
		chat: true,
		images: false
	},
	{
		id: 'nanogpt',
		label: 'NanoGPT',
		kind: 'openai',
		baseUrl: 'https://nano-gpt.com/api/v1',
		isLocal: false,
		chat: true,
		images: true
	}
] as const satisfies ReadonlyArray<Omit<Provider, 'apiKey' | 'headers'> & { readonly id: string }>;
