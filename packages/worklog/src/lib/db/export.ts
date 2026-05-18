/**
 * Legacy export module — delegates to the new mappers infrastructure.
 * Kept for backward compatibility with existing callers.
 */
import type { WorklogDB } from './types';
import { exportToFile, type ExportOptions } from './mappers';

export type { ExportOptions };

/**
 * Exports the full database to a single JSON file.
 * This is the default export behavior used by the command palette and settings page.
 */
export async function exportDatabaseToFile(db: WorklogDB): Promise<boolean> {
    return exportToFile(db, { format: 'json', mode: 'single-file' });
}

/**
 * Exports the database with custom format and mode options.
 */
export async function exportDatabaseWithOptions(db: WorklogDB, options: ExportOptions): Promise<boolean> {
    return exportToFile(db, options);
}
