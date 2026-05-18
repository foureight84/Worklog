export interface WorklogDB {
    select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
    execute(sql: string, args?: unknown[]): Promise<number>;
    /** Split multi-statement SQL (e.g. CREATE_TABLES DDL batch) into individual
     * statements and execute each sequentially. Use for independent DDL batches
     * only — NOT for BEGIN/COMMIT/ROLLBACK transaction sequences. */
    executeBatch(sql: string): Promise<number>;
    /** Sync with primary server (no-op for direct connections, delegates to libsql Client.sync() for embedded replicas) */
    sync(): Promise<void>;
    close(): Promise<void>;
}

/** Default ticket types seeded on first DB init. Single source of truth. */
export interface DefaultTicketType {
    id: string;
    name: string;
    color: string;
    icon: string;
    is_default: number;
}

export const DEFAULT_TICKET_TYPES: DefaultTicketType[] = [
    { id: 'bug',        name: 'Bug',        color: '#fa4d56', icon: 'bug',       is_default: 0 },
    { id: 'feature',    name: 'Feature',    color: '#198038', icon: 'star',      is_default: 1 },
    { id: 'chore',      name: 'Chore',      color: '#525252', icon: 'tools',     is_default: 0 },
    { id: 'task',       name: 'Task',       color: '#00539a', icon: 'checkmark', is_default: 0 },
    { id: 'improvement',name: 'Improvement',color: '#8a3ffc', icon: 'upgrade',   is_default: 0 },
];

/**
 * Seed default ticket types into the database if the ticket_types table is empty.
 * Used by both connection.ts (client-side/desktop) and init-db.ts (server-side/webapp).
 */
export async function seedDefaultTicketTypes(db: WorklogDB): Promise<void> {
    const typesCount = await db.select<{ count: number }>(
        "SELECT COUNT(*) as count FROM ticket_types"
    );
    if (typesCount && typesCount[0] && typesCount[0].count === 0) {
        const now = new Date().toISOString();
        for (const t of DEFAULT_TICKET_TYPES) {
            await db.execute(
                "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [t.id, t.name, t.color, t.icon, t.is_default, now, now]
            );
        }
    }
}
