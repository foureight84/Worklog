export interface WorklogDB {
    select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
    execute(sql: string, args?: unknown[]): Promise<number>;
    /** Sync with primary server (no-op for direct connections, delegates to libsql Client.sync() for embedded replicas) */
    sync(): Promise<void>;
    close(): Promise<void>;
}
