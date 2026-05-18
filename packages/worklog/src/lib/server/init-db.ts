import type { WorklogDB } from '$lib/db/types';
import { seedDefaultTicketTypes } from '$lib/db/types';
import { createClient, wrapLibsqlClient } from '$lib/db/libsql-wrapper';
import { getServerEnv } from './env';

let _db: WorklogDB | null = null;
let _initPromise: Promise<WorklogDB> | null = null;

/**
 * Initialize the server-side database connection.
 * Uses a singleton pattern — the same connection is reused across requests.
 * Thread-safe via in-flight promise deduplication.
 *
 * ── Architecture note ──
 * The webapp has TWO DB initialization paths:
 *   1. THIS function (initServerDB) — server-only, called from hooks.server.ts.
 *      Used by server load functions, API routes, form actions.
 *   2. connection.ts → getDb() — shared client/server, called from
 *      workspace.svelte.ts (browser-side hydration). Creates a separate libsql
 *      Client for direct browser→sqld communication.
 *
 * These are intentional: the browser-side connection handles Svelte 5 runes
 * ($state reactivity) without server round-trips, while the server connection
 * handles SSR, auth, and API endpoints. Both talk to the same sqld instance.
 *
 * TODO: If sqld is not exposed to the browser (e.g. Docker internal network),
 * the browser-side connection in getDb() will fail. In that setup, the browser
 * should use SvelteKit server API routes instead. See Phase 6 (Testing).
 */
export async function initServerDB(): Promise<WorklogDB> {
    if (_db) return _db;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const env = getServerEnv();

        const client = createClient({ url: env.libsqlUrl });
        const db = wrapLibsqlClient(client);

        // Run schema creation and migrations on server startup
        const { CREATE_TABLES } = await import('$lib/db/schema');
        await db.executeBatch(CREATE_TABLES);

        const { runMigrations } = await import('$lib/db/migrate');
        await runMigrations(db);

        // Seed default ticket types if empty
        await seedDefaultTicketTypes(db);

        _db = db;
        return _db;
    })();

    return _initPromise;
}

/**
 * Get the server DB instance (throws if not initialized).
 */
export function getServerDB(): WorklogDB {
    if (!_db) {
        throw new Error('Server DB not initialized. Call initServerDB() first.');
    }
    return _db;
}
