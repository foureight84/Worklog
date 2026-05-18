import type { WorklogDB } from '../db/types';
import { useSyncConfig } from './sync-config.svelte';
import { SyncEngine } from './sync-engine';

let interval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 30_000;

export function startSyncScheduler(getDb: () => Promise<WorklogDB>) {
    const syncConfig = useSyncConfig();

    if (interval) {
        clearInterval(interval);
    }

    interval = setInterval(async () => {
        if (!syncConfig.config.auto_sync) return;
        if (!syncConfig.config.primary_url) return;

        syncConfig.setStatus('syncing');

        const db = await getDb();
        const engine = new SyncEngine(() => Promise.resolve(db));
        const result = await engine.sync();

        if (result.status === 'success') {
            syncConfig.setStatus('connected');
            await syncConfig.updateLastSynced(db);
        } else {
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
