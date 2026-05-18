import type { WorklogDB } from '../types';

export interface TicketType {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export async function getAll(db: WorklogDB): Promise<TicketType[]> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types ORDER BY name ASC"
    );
    return rows.map(mapRow);
}

export async function getById(db: WorklogDB, id: string): Promise<TicketType | null> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types WHERE id = ?",
        [id]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getDefault(db: WorklogDB): Promise<TicketType | null> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types WHERE is_default = 1 LIMIT 1"
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function create(db: WorklogDB, type: Partial<TicketType>): Promise<void> {
    const now = new Date().toISOString();
    const id = type.id || crypto.randomUUID();
    
    // If setting as default, unset others
    if (type.is_default) {
        await db.execute("UPDATE ticket_types SET is_default = 0");
    }

    await db.execute(
        "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, type.name, type.color, type.icon, type.is_default ? 1 : 0, now, now]
    );
}

export async function update(db: WorklogDB, id: string, type: Partial<TicketType>): Promise<void> {
    const now = new Date().toISOString();
    
    if (type.is_default) {
        await db.execute("UPDATE ticket_types SET is_default = 0");
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (type.name !== undefined) { fields.push("name = ?"); values.push(type.name); }
    if (type.color !== undefined) { fields.push("color = ?"); values.push(type.color); }
    if (type.icon !== undefined) { fields.push("icon = ?"); values.push(type.icon); }
    if (type.is_default !== undefined) { fields.push("is_default = ?"); values.push(type.is_default ? 1 : 0); }
    
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    await db.execute(
        `UPDATE ticket_types SET ${fields.join(", ")} WHERE id = ?`,
        values
    );
}

export async function remove(db: WorklogDB, id: string): Promise<void> {
    await db.execute("DELETE FROM ticket_types WHERE id = ?", [id]);
}

function mapRow(row: any): TicketType {
    return {
        ...row,
        is_default: row.is_default === 1
    };
}
