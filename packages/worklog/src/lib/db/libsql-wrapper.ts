import { createClient, type Client } from '@libsql/client';
import type { WorklogDB } from './types';

export function wrapLibsqlClient(client: Client): WorklogDB {
    return {
        async select<T>(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rows.map(row => {
                const obj: Record<string, unknown> = {};
                for (const col of result.columns) {
                    obj[col] = row[result.columns.indexOf(col)];
                }
                return obj as T;
            });
        },
        async execute(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rowsAffected;
        },
        async close() {
            // @libsql/client doesn't expose .close() on Client — no-op
        },
    };
}

export { createClient };
