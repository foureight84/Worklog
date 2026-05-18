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
            // sqld Hrana-over-HTTP auto-commits each statement.
            // Explicit BEGIN/COMMIT/ROLLBACK are no-ops — the transaction
            // is already closed by the time the next HTTP request arrives.
            const trimmed = sql.trim().toUpperCase();
            if (trimmed === 'BEGIN TRANSACTION' ||
                trimmed === 'BEGIN' ||
                trimmed === 'COMMIT' ||
                trimmed === 'ROLLBACK') {
                return 0;
            }
            const result = await client.execute({ sql, args: args as any });
            return result.rowsAffected;
        },
        async executeBatch(sql: string): Promise<number> {
            // Split multi-statement SQL for sqld compatibility.
            // sqld rejects batched statements, so we split on ';'
            // and execute each individually.
            // NOTE: this breaks transaction boundaries — only use for
            // independent DDL batches like CREATE_TABLES, never for
            // BEGIN/COMMIT/ROLLBACK sequences.
            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            let totalAffected = 0;
            for (const stmt of statements) {
                const result = await client.execute(stmt);
                totalAffected += result.rowsAffected;
            }
            return totalAffected;
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
