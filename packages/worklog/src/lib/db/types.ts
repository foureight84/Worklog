export interface WorklogDB {
    select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
    execute(sql: string, args?: unknown[]): Promise<number>;
    close(): Promise<void>;
}
