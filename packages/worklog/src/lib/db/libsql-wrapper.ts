import { createClient, type Client } from '@libsql/client';
import type { WorklogDB } from './types';

export function wrapLibsqlClient(client: Client): WorklogDB {
    return {
        async select<T>(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rows.map(row => {
                const obj: Record<string, unknown> = {};
                for (let i = 0; i < result.columns.length; i++) {
                    obj[result.columns[i]] = row[i];
                }
                return obj as T;
            });
        },
        async execute(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rowsAffected;
        },
        async sync() {
            // libsql Client.sync() is not in the public types but exists
            // at runtime for embedded replicas. Cast to access it.
            if (typeof (client as any).sync === 'function') {
                await (client as any).sync();
            }
            // For direct HTTP connections, sync is a no-op
        },
        async close() {
            // @libsql/client doesn't expose .close() on Client — no-op
        },
    };
}

export { createClient };
