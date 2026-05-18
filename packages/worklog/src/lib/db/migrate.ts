import type { WorklogDB } from './types';
import { SCHEMA_VERSION } from './schema';

async function migrate_v2(db: WorklogDB): Promise<void> {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id                INTEGER PRIMARY KEY CHECK (id = 1),
            author_name       TEXT NOT NULL DEFAULT '',
            default_branch    TEXT NOT NULL DEFAULT 'main',
            autosave_seconds  INTEGER NOT NULL DEFAULT 10,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        )
    `);
}

async function migrate_v3(db: WorklogDB): Promise<void> {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(tickets)`);
    const hasPriority = columns.some((column) => column.name === 'priority');

    if (!hasPriority) {
        await db.execute(`
            ALTER TABLE tickets
            ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
            CHECK (priority IN ('low', 'medium', 'high'))
        `);
    }

    await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`
    );
}

async function migrate_v4(db: WorklogDB): Promise<void> {
    const columns = await db.select<{ name: string }>(
        `PRAGMA table_info(tickets)`
    );

    if (columns.length === 0) {
        return;
    }

    const hasStatus = columns.some((column) => column.name === 'status');
    const hasPriority = columns.some((column) => column.name === 'priority');
    const hasTicketType = columns.some((column) => column.name === 'ticket_type');
    const hasDueDate = columns.some((column) => column.name === 'due_date');

    const statusExpr = hasStatus
        ? `CASE
            WHEN status IN ('backlog', 'todo', 'in_progress', 'done') THEN status
            ELSE 'todo'
          END`
        : `'todo'`;

    const priorityExpr = hasPriority
        ? `CASE
            WHEN priority = 'p1' THEN 'p1'
            WHEN priority = 'p2' THEN 'p2'
            WHEN priority = 'p3' THEN 'p3'
            WHEN priority = 'high' THEN 'p1'
            WHEN priority = 'medium' THEN 'p2'
            WHEN priority = 'low' THEN 'p3'
            ELSE 'p2'
          END`
        : `'p2'`;

    const ticketTypeExpr = hasTicketType
        ? `CASE
            WHEN ticket_type IN ('feature', 'bug', 'chore') THEN ticket_type
            ELSE 'feature'
          END`
        : `'feature'`;

    const dueDateExpr = hasDueDate ? `due_date` : `NULL`;

    await db.execute(`PRAGMA foreign_keys = OFF`);
    await db.execute(`BEGIN TRANSACTION`);

    try {
        await db.execute(`ALTER TABLE tickets RENAME TO tickets_legacy`);

        await db.execute(`
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority    TEXT NOT NULL DEFAULT 'p2'
                            CHECK (priority IN ('p1', 'p2', 'p3')),
                ticket_type TEXT NOT NULL DEFAULT 'feature'
                            CHECK (ticket_type IN ('feature', 'bug', 'chore')),
                due_date    TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        `);

        await db.execute(`
            INSERT INTO tickets (
                id,
                board_id,
                title,
                description,
                status,
                priority,
                ticket_type,
                due_date,
                labels,
                comments,
                created_at,
                updated_at
            )
            SELECT
                id,
                board_id,
                title,
                description,
                ${statusExpr},
                ${priorityExpr},
                ${ticketTypeExpr},
                ${dueDateExpr},
                labels,
                comments,
                created_at,
                updated_at
            FROM tickets_legacy
        `);

        await db.execute(`DROP TABLE tickets_legacy`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`);
        await db.execute(
            `CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type)`
        );
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)`);

        await db.execute(`COMMIT`);
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
    }
}

async function migrate_v5(db: WorklogDB): Promise<void> {
    // Expand ticket_type CHECK constraint to include: improvement, epic, spike
    // Uses the same table-recreation approach as v4 for SQLite CHECK constraint changes.
    await db.execute(`PRAGMA foreign_keys = OFF`);
    await db.execute(`BEGIN TRANSACTION`);

    try {
        await db.execute(`ALTER TABLE tickets RENAME TO tickets_v4`);

        await db.execute(`
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority    TEXT NOT NULL DEFAULT 'p2'
                            CHECK (priority IN ('p1', 'p2', 'p3')),
                ticket_type TEXT NOT NULL DEFAULT 'feature'
                            CHECK (ticket_type IN ('feature', 'bug', 'chore', 'improvement', 'epic', 'spike')),
                due_date    TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        `);

        await db.execute(`
            INSERT INTO tickets (
                id, board_id, title, description,
                status, priority, ticket_type, due_date,
                labels, comments, created_at, updated_at
            )
            SELECT
                id, board_id, title, description,
                status, priority,
                CASE
                    WHEN ticket_type IN ('feature', 'bug', 'chore', 'improvement', 'epic', 'spike') THEN ticket_type
                    ELSE 'feature'
                END,
                due_date,
                labels, comments, created_at, updated_at
            FROM tickets_v4
        `);

        await db.execute(`DROP TABLE tickets_v4`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)`);

        await db.execute(`COMMIT`);
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
    }
}

async function migrate_v6(db: WorklogDB): Promise<void> {
    // Add position column for ticket sorting
    await db.execute(`ALTER TABLE tickets ADD COLUMN position REAL NOT NULL DEFAULT 0`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_position ON tickets(position)`);
}

async function migrate_v7(db: WorklogDB): Promise<void> {
    // Add start_date column for Gantt start date support
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(tickets)`);
    const hasStartDate = columns.some((column) => column.name === 'start_date');
    if (!hasStartDate) {
        await db.execute(`ALTER TABLE tickets ADD COLUMN start_date TEXT`);
    }
}

async function migrate_v8(db: WorklogDB): Promise<void> {
    // Expand ticket_type CHECK constraint to include: story, task, subtask, incident, design, documentation
    await db.execute(`PRAGMA foreign_keys = OFF`);
    await db.execute(`BEGIN TRANSACTION`);

    try {
        await db.execute(`ALTER TABLE tickets RENAME TO tickets_v7`);

        await db.execute(`
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority    TEXT NOT NULL DEFAULT 'p2'
                            CHECK (priority IN ('p1', 'p2', 'p3')),
                ticket_type TEXT NOT NULL DEFAULT 'feature'
                            CHECK (ticket_type IN ('feature', 'bug', 'chore', 'improvement', 'epic', 'spike', 'story', 'task', 'subtask', 'incident', 'design', 'documentation')),
                position    REAL NOT NULL DEFAULT 0,
                due_date    TEXT,
                start_date  TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        `);

        await db.execute(`
            INSERT INTO tickets (
                id, board_id, title, description,
                status, priority, ticket_type, position, due_date, start_date,
                labels, comments, created_at, updated_at
            )
            SELECT
                id, board_id, title, description,
                status, priority,
                CASE
                    WHEN ticket_type IN ('feature', 'bug', 'chore', 'improvement', 'epic', 'spike', 'story', 'task', 'subtask', 'incident', 'design', 'documentation') THEN ticket_type
                    ELSE 'feature'
                END,
                position, due_date, start_date,
                labels, comments, created_at, updated_at
            FROM tickets_v7
        `);

        await db.execute(`DROP TABLE tickets_v7`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_position ON tickets(position)`);

        await db.execute(`COMMIT`);
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
    }
}

async function migrate_v9(db: WorklogDB): Promise<void> {
    // Add sync_config table for GitHub sync settings
    await db.execute(`
        CREATE TABLE IF NOT EXISTS sync_config (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            remote_url      TEXT NOT NULL DEFAULT '',
            access_token    TEXT NOT NULL DEFAULT '',
            branch          TEXT NOT NULL DEFAULT 'main',
            git_name        TEXT NOT NULL DEFAULT '',
            git_email       TEXT NOT NULL DEFAULT '',
            auto_sync       INTEGER NOT NULL DEFAULT 0,
            auto_sync_interval INTEGER NOT NULL DEFAULT 15,
            last_synced_at  TEXT,
            updated_at      TEXT NOT NULL DEFAULT ''
        )
    `);
}

/**
 * Migration v10:
 * Add git_name and git_email columns to sync_config table for users who
 * already migrated to v9 before those fields were added.
 */
async function migrate_v10(db: WorklogDB) {
    try {
        await db.execute(`ALTER TABLE sync_config ADD COLUMN git_name TEXT NOT NULL DEFAULT ''`);
    } catch {
        // Ignore if column already exists (e.g. from fresh creation of v9 schema)
    }
    
    try {
        await db.execute(`ALTER TABLE sync_config ADD COLUMN git_email TEXT NOT NULL DEFAULT ''`);
    } catch {
        // Ignore if column already exists
    }
}

/**
 * Migration v11:
 * Add auto_sync_interval to sync_config.
 */
async function migrate_v11(db: WorklogDB) {
    try {
        await db.execute(`ALTER TABLE sync_config ADD COLUMN auto_sync_interval INTEGER NOT NULL DEFAULT 15`);
    } catch (e) {
        console.error("migrate_v11 error:", e);
    }
}

/**
 * Migration v12:
 * Create ticket_types table and recreate tickets table without ticket_type CHECK constraint.
 */
async function migrate_v12(db: WorklogDB) {
    // 1. Create ticket_types table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ticket_types (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            color       TEXT NOT NULL,
            icon        TEXT,
            is_default  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )
    `);

    // 2. Recreate tickets table without ticket_type CHECK constraint
    await db.execute(`PRAGMA foreign_keys = OFF`);
    await db.execute(`BEGIN TRANSACTION`);

    try {
        await db.execute(`ALTER TABLE tickets RENAME TO tickets_v11`);

        await db.execute(`
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority    TEXT NOT NULL DEFAULT 'p2'
                            CHECK (priority IN ('p1', 'p2', 'p3')),
                ticket_type TEXT NOT NULL DEFAULT 'feature',
                position    REAL NOT NULL DEFAULT 0,
                due_date    TEXT,
                start_date  TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        `);

        await db.execute(`
            INSERT INTO tickets (
                id, board_id, title, description,
                status, priority, ticket_type, position, due_date, start_date,
                labels, comments, created_at, updated_at
            )
            SELECT
                id, board_id, title, description,
                status, priority, ticket_type, position, due_date, start_date,
                labels, comments, created_at, updated_at
            FROM tickets_v11
        `);

        await db.execute(`DROP TABLE tickets_v11`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_position ON tickets(position)`);

        await db.execute(`COMMIT`);
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
    }
}


/**
 * Migration v13:
 * Add archived_at column to boards for soft-delete / archiving support.
 */
async function migrate_v13(db: WorklogDB) {
    try {
        await db.execute(`ALTER TABLE boards ADD COLUMN archived_at TEXT`);
    } catch {
        // Column may already exist on fresh installations
    }
}

/**
 * Migration v14:
 * Replace sync_config table with new libsql sync schema.
 */
async function migrate_v14(db: WorklogDB) {
    await db.execute(`DROP TABLE IF EXISTS sync_config`);
    await db.execute(`
        CREATE TABLE sync_config (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            primary_url     TEXT NOT NULL DEFAULT '',
            auth_token      TEXT NOT NULL DEFAULT '',
            auto_sync       INTEGER NOT NULL DEFAULT 0,
            last_synced_at  TEXT,
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
    `);
    await db.execute(`INSERT INTO sync_config (id) VALUES (1)`);
}

export async function runMigrations(db: WorklogDB): Promise<void> {
    const rows = await db.select<{ schema_version: number }>(
        `SELECT schema_version FROM workspace_meta WHERE id = 1`
    );

    const current = rows[0]?.schema_version ?? 0;

    if (current === SCHEMA_VERSION) return;

    if (current < 2) {
        await migrate_v2(db);
    }

    if (current < 3) {
        await migrate_v3(db);
    }

    if (current < 4) {
        await migrate_v4(db);
    }

    if (current < 5) {
        await migrate_v5(db);
    }

    if (current < 6) {
        await migrate_v6(db);
    }

    if (current < 7) {
        await migrate_v7(db);
    }

    if (current < 8) {
        await migrate_v8(db);
    }

    if (current < 9) {
        await migrate_v9(db);
    }

    if (current < 10) {
        await migrate_v10(db);
    }

    if (current < 11) {
        await migrate_v11(db);
    }

    if (current < 12) {
        await migrate_v12(db);
    }

    if (current < 13) {
        await migrate_v13(db);
    }

    if (current < 14) {
        await migrate_v14(db);
    }

    await db.execute(
        `UPDATE workspace_meta SET schema_version = ? WHERE id = 1`,
        [SCHEMA_VERSION]
    );
}
