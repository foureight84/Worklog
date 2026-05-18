import type { WorklogDB } from './types';
import { createClient, wrapLibsqlClient } from './libsql-wrapper';

export function createWebDB(url?: string): WorklogDB {
    const dbUrl = url || process.env.LIBSQL_URL || 'http://localhost:8080';
    const client = createClient({ url: dbUrl });
    return wrapLibsqlClient(client);
}
