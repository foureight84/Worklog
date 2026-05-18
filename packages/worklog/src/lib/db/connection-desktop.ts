import type { WorklogDB } from './types';
import { createClient, wrapLibsqlClient } from './libsql-wrapper';

export interface DesktopDBOptions {
    workspacePath: string;
    syncUrl: string;
    authToken?: string;
}

export function createDesktopDB(options: DesktopDBOptions): WorklogDB {
    const dbPath = `${options.workspacePath}/.worklog/worklog.db`;
    const client = createClient({
        url: `file:${dbPath}`,
        syncUrl: options.syncUrl,
        authToken: options.authToken,
    });
    return wrapLibsqlClient(client);
}
