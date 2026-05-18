import type { WorklogDB } from './types';
import { seedDefaultTicketTypes } from './types';
import { createWebDB } from './connection-web';
import { createDesktopDB } from './connection-desktop';
import { isDesktop } from '$lib/environment';

let _db: WorklogDB | null = null;
let _dbWorkspacePath: string | undefined = undefined;

export async function getDb(workspacePath?: string): Promise<WorklogDB> {
    // ── Architecture: this is the CLIENT-SIDE DB connection path.
    // The webapp also has a SERVER-SIDE path (initServerDB in $lib/server/init-db).
    // Both connect to the same sqld; see init-db.ts for rationale.

    // Reuse existing connection if same workspace
    if (_db && _dbWorkspacePath === workspacePath) return _db;

    // Close old connection if switching workspace
    if (_db && _dbWorkspacePath !== workspacePath) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = undefined;
    }

    if (isDesktop() && workspacePath) {
        // Desktop: ensure .worklog/ directory exists
        const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
        const dirPath = `${workspacePath}/.worklog`;
        const dirExists = await exists(dirPath);
        if (!dirExists) {
            await mkdir(dirPath, { recursive: true });
        }

        // Desktop: use embedded replica
        const { useSyncConfig } = await import('../sync/sync-config.svelte');
        const syncConfig = useSyncConfig();
        _db = createDesktopDB({
            workspacePath,
            syncUrl: syncConfig.config.primary_url,
            authToken: syncConfig.config.auth_token || undefined,
        });
    } else {
        // Webapp: direct connection to primary
        _db = createWebDB();
    }

    _dbWorkspacePath = workspacePath;

    // ── Run schema creation and migrations ──────────────
    const { CREATE_TABLES } = await import('./schema');
    await _db.executeBatch(CREATE_TABLES);

    const { runMigrations } = await import('./migrate');
    await runMigrations(_db);

    // ── Seed Default Ticket Types if empty ──────────────
    await seedDefaultTicketTypes(_db);

    return _db;
}

export async function closeDb(): Promise<void> {
    if (_db) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = undefined;
    }
}
