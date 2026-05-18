import type { WorklogDB } from '../types';
import type { Board, CreateBoardInput } from '$lib/components/app/types';
import { generateId } from '$lib/utils';

export async function listBoards(
    db: WorklogDB,
    options: { limit?: number; offset?: number; archived?: boolean } = {}
): Promise<Board[]> {
    const archived = options.archived ?? false;
    const whereClause = archived
        ? `archived_at IS NOT NULL`
        : `archived_at IS NULL`;

    let query = `SELECT * FROM boards WHERE ${whereClause} ORDER BY created_at ASC`;
    const params: any[] = [];

    if (options.limit !== undefined) {
        query += ` LIMIT ?`;
        params.push(options.limit);
    }
    if (options.offset !== undefined) {
        query += ` OFFSET ?`;
        params.push(options.offset);
    }

    return db.select<Board>(query, params);
}

export async function getBoardById(db: WorklogDB, id: string): Promise<Board | null> {
    const rows = await db.select<Board>(
        `SELECT * FROM boards WHERE id = ?`, [id]
    );
    return rows[0] ?? null;
}

export async function createBoard(db: WorklogDB, input: CreateBoardInput): Promise<Board> {
    const board: Board = {
        id: generateId('BRD'),
        name: input.name,
        description: input.description ?? '',
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await db.execute(
        `INSERT INTO boards (id, name, description, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
        [board.id, board.name, board.description, board.archived_at, board.created_at, board.updated_at]
    );

    return board;
}

export async function deleteBoard(db: WorklogDB, id: string): Promise<void> {
    // Tickets cascade-deleted automatically via FK
    await db.execute(`DELETE FROM boards WHERE id = ?`, [id]);
}

export async function archiveBoard(db: WorklogDB, id: string): Promise<Board | null> {
    const archivedAt = new Date().toISOString();
    await db.execute(
        `UPDATE boards SET archived_at = ?, updated_at = ? WHERE id = ?`,
        [archivedAt, archivedAt, id]
    );
    return getBoardById(db, id);
}

export async function unarchiveBoard(db: WorklogDB, id: string): Promise<Board | null> {
    const updatedAt = new Date().toISOString();
    await db.execute(
        `UPDATE boards SET archived_at = NULL, updated_at = ? WHERE id = ?`,
        [updatedAt, id]
    );
    return getBoardById(db, id);
}

export async function renameBoard(
    db: WorklogDB,
    id: string,
    name: string,
    description: string,
): Promise<Board | null> {
    const updatedAt = new Date().toISOString();

    await db.execute(
        `UPDATE boards
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ?`,
        [name, description, updatedAt, id],
    );

    return getBoardById(db, id);
}
