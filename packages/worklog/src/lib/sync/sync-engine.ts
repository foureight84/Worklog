import type { WorklogDB } from '../db/types';
import type { SyncResult } from './types';

/**
 * SyncEngine orchestrates libsql sync between a local embedded replica
 * and the primary server.
 *
 * For desktop (embedded replica): calls WorklogDB.sync() which delegates
 * to libsql Client.sync() — pushes local changes and pulls remote changes.
 *
 * For webapp (direct connection): sync() is a no-op since the webapp
 * talks directly to the primary server.
 */
export class SyncEngine {
    constructor(private getDb: () => Promise<WorklogDB>) {}

    async sync(): Promise<SyncResult> {
        try {
            const db = await this.getDb();
            await db.sync();
            return {
                status: 'success',
                message: 'Synced',
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                status: 'error',
                message: String(error),
                timestamp: new Date().toISOString(),
            };
        }
    }
}
