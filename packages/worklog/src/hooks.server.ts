import type { Handle } from '@sveltejs/kit';
import { initServerDB, getServerDB } from '$lib/server/init-db';

/**
 * SvelteKit server hooks.
 * - Initializes the server DB on first request
 * - Attaches the DB instance to event.locals for use in server routes/load functions
 */
export const handle: Handle = async ({ event, resolve }) => {
    // Initialize server DB on first request (lazy init)
    if (!event.locals.db) {
        await initServerDB();
        event.locals.db = getServerDB();
    }

    return resolve(event);
};
