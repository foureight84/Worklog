import type { WorklogDB } from '../db/types';
import { useSyncConfig } from './sync-config.svelte';

let interval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 30_000;

/**
 * Start the sync scheduler. Called when a workspace is opened.
 * getDb returns the WorklogDB instance for the current workspace.
 */
export function startSyncScheduler(getDb: () => Promise<WorklogDB>) {
    const syncConfig = useSyncConfig();

    if (interval) {
        clearInterval(interval);
    }

    interval = setInterval(async () => {
        if (!syncConfig.config.auto_sync) return;
        if (!syncConfig.config.primary_url) return;

        syncConfig.setStatus('syncing');

        try {
            const db = await getDb();
            await db.sync();
            syncConfig.setStatus('connected');
            await syncConfig.updateLastSynced(db);
        } catch {
            syncConfig.setStatus('disconnected');
        }
    }, SYNC_INTERVAL_MS);
}

export function stopSyncScheduler() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}
