import type { WorklogDB } from './types';
import { createClient, wrapLibsqlClient } from './libsql-wrapper';

export interface DesktopDBOptions {
    workspacePath: string;
    syncUrl: string;
    authToken?: string;
}

export function createDesktopDB(options: DesktopDBOptions): WorklogDB {
    const dbPath = `${options.workspacePath}/.worklog/worklog.db`;
    const clientConfig: Parameters<typeof createClient>[0] = {
        url: `file:${dbPath}`,
    };
    // Only pass syncUrl if configured — empty string or missing means local-only
    if (options.syncUrl) {
        clientConfig.syncUrl = options.syncUrl;
    }
    if (options.authToken) {
        clientConfig.authToken = options.authToken;
    }
    const client = createClient(clientConfig);
    return wrapLibsqlClient(client);
}
