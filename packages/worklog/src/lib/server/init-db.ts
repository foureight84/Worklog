import type { WorklogDB } from '$lib/db/types';
import { createClient, wrapLibsqlClient } from '$lib/db/libsql-wrapper';
import { getServerEnv } from './env';

let _db: WorklogDB | null = null;

/**
 * Initialize the server-side database connection.
 * Uses a singleton pattern — the same connection is reused across requests.
 */
export async function initServerDB(): Promise<WorklogDB> {
    if (_db) return _db;

    const env = getServerEnv();
    
    const client = createClient({ url: env.libsqlUrl });
    const db = wrapLibsqlClient(client);
    
    // Run schema creation and migrations on server startup
    const { CREATE_TABLES } = await import('$lib/db/schema');
    await db.execute(CREATE_TABLES);
    
    const { runMigrations } = await import('$lib/db/migrate');
    await runMigrations(db);

    // Seed default ticket types if empty
    const typesCount = await db.select<{ count: number }>(
        "SELECT COUNT(*) as count FROM ticket_types"
    );
    if (typesCount && typesCount[0] && typesCount[0].count === 0) {
        const now = new Date().toISOString();
        const defaultTypes = [
            { id: 'bug', name: 'Bug', color: '#fa4d56', icon: 'bug', is_default: 0 },
            { id: 'feature', name: 'Feature', color: '#198038', icon: 'star', is_default: 1 },
            { id: 'chore', name: 'Chore', color: '#525252', icon: 'tools', is_default: 0 },
            { id: 'task', name: 'Task', color: '#00539a', icon: 'checkmark', is_default: 0 },
            { id: 'improvement', name: 'Improvement', color: '#8a3ffc', icon: 'upgrade', is_default: 0 },
        ];
        for (const t of defaultTypes) {
            await db.execute(
                "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [t.id, t.name, t.color, t.icon, t.is_default, now, now]
            );
        }
    }

    _db = db;
    return _db;
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
