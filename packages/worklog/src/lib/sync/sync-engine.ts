import type { Client } from '@libsql/client';
import type { SyncResult } from './types';

export class SyncEngine {
    constructor(private client: Client | null) {}

    async sync(): Promise<SyncResult> {
        if (!this.client) {
            return { status: 'success', message: 'No sync configured', timestamp: new Date().toISOString() };
        }
        try {
            await (this.client as any).sync();
            return { status: 'success', message: 'Synced', timestamp: new Date().toISOString() };
        } catch (error) {
            return { status: 'error', message: String(error), timestamp: new Date().toISOString() };
        }
    }

    async isAvailable(): Promise<boolean> {
        return !!this.client;
    }
}
