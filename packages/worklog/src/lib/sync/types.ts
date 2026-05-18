export interface SyncConfig {
    primary_url: string;
    auth_token: string;
    auto_sync: boolean;
    last_synced_at: string | null;
}

export type SyncStatus = 'connected' | 'disconnected' | 'syncing';

export interface SyncResult {
    status: 'success' | 'error';
    message: string;
    timestamp: string;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    primary_url: '',
    auth_token: '',
    auto_sync: false,
    last_synced_at: null,
};
