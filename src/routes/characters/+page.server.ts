import { db } from '$lib/server/db/index.js';
import { listCharacters } from '$lib/server/db/characters.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => ({ characters: listCharacters(db()) });
