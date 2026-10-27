import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { getCharacter } from '$lib/server/db/characters.js';
import { getConfig } from '$lib/server/config-store.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ params }) => {
	const character = getCharacter(db(), params.id);
	if (!character) error(404, 'Character not found');
	return { character, userName: getConfig().userName };
};
