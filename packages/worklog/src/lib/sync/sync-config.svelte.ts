import type { WorklogDB } from '../db/types';
import type { SyncConfig, SyncStatus } from './types';
import { DEFAULT_SYNC_CONFIG } from './types';

// ── Module-level reactive state ────────────────────────────────────────────

let _config = $state<SyncConfig>({ ...DEFAULT_SYNC_CONFIG });
let _status = $state<SyncStatus>('disconnected');

/**
 * Reactive hook for sync configuration.
 * Config is persisted in the sync_config database table.
 */
export function useSyncConfig() {
    async function load(db: WorklogDB): Promise<void> {
        try {
            const rows = await db.select<{
                primary_url: string;
                auth_token: string;
                auto_sync: number;
                last_synced_at: string | null;
            }>(
                `SELECT primary_url, auth_token, auto_sync, last_synced_at
                 FROM sync_config WHERE id = 1`
            );

            if (rows.length > 0) {
                const row = rows[0];
                _config = {
                    primary_url: row.primary_url || '',
                    auth_token: row.auth_token || '',
                    auto_sync: row.auto_sync === 1,
                    last_synced_at: row.last_synced_at || null,
                };
                _status = _config.primary_url ? 'connected' : 'disconnected';
            } else {
                _config = { ...DEFAULT_SYNC_CONFIG };
                _status = 'disconnected';
            }
        } catch {
            // Table might not exist yet (pre-migration)
            _config = { ...DEFAULT_SYNC_CONFIG };
            _status = 'disconnected';
        }
    }

    async function save(db: WorklogDB): Promise<void> {
        const now = new Date().toISOString();
        await db.execute(
            `INSERT INTO sync_config (id, primary_url, auth_token, auto_sync, last_synced_at, updated_at)
             VALUES (1, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                primary_url = excluded.primary_url,
                auth_token = excluded.auth_token,
                auto_sync = excluded.auto_sync,
                last_synced_at = excluded.last_synced_at,
                updated_at = excluded.updated_at`,
            [
                _config.primary_url,
                _config.auth_token,
                _config.auto_sync ? 1 : 0,
                _config.last_synced_at,
                now,
            ]
        );
    }

    /** Update last_synced_at in memory and persist to DB (fire-and-forget). */
    async function updateLastSynced(db: WorklogDB): Promise<void> {
        const now = new Date().toISOString();
        _config.last_synced_at = now;
        await db.execute(
            `UPDATE sync_config SET last_synced_at = ?, updated_at = ? WHERE id = 1`,
            [now, now]
        );
    }

    function setStatus(status: SyncStatus) {
        _status = status;
    }

    return {
        get config() { return _config; },
        set config(value: SyncConfig) { _config = value; },
        get status() { return _status; },
        load,
        save,
        updateLastSynced,
        setStatus,
    };
}
