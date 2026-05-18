import type { WorklogDB } from './types';
import { createWebDB } from './connection-web';
import { createDesktopDB } from './connection-desktop';

let _db: WorklogDB | null = null;
let _dbWorkspacePath: string | null = null;

function isDesktop(): boolean {
    return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

export async function getDb(workspacePath?: string): Promise<WorklogDB> {
    // Reuse existing connection if same workspace
    if (_db && _dbWorkspacePath === workspacePath) return _db;

    // Close old connection if switching workspace
    if (_db && _dbWorkspacePath !== workspacePath) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = null;
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

    _dbWorkspacePath = workspacePath ?? null;

    // ── Run schema creation and migrations ──────────────
    const { CREATE_TABLES } = await import('./schema');
    await _db.execute(CREATE_TABLES);

    const { runMigrations } = await import('./migrate');
    await runMigrations(_db);

    // ── Seed Default Ticket Types if empty ──────────────
    const typesCount = await _db.select<{ count: number }>(
        "SELECT COUNT(*) as count FROM ticket_types"
    );
    if (typesCount && typesCount[0] && typesCount[0].count === 0) {
        const now = new Date().toISOString();
        const defaultTypes = [
            { id: 'bug', name: 'Bug', color: '#fa4d56', icon: 'bug', is_default: 0 },
            { id: 'feature', name: 'Feature', color: '#198038', icon: 'star', is_default: 1 },
            { id: 'chore', name: 'Chore', color: '#525252', icon: 'tools', is_default: 0 },
            { id: 'task', name: 'Task', color: '#00539a', icon: 'checkmark', is_default: 0 },
            { id: 'improvement', name: 'Improvement', color: '#8a3ffc', icon: 'upgrade', is_default: 0 },
        ];

        for (const t of defaultTypes) {
            await _db.execute(
                "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [t.id, t.name, t.color, t.icon, t.is_default, now, now]
            );
        }
    }

    return _db;
}

export async function closeDb(): Promise<void> {
    if (_db) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = null;
    }
}
