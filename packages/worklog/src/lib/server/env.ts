/**
 * Server-side environment configuration.
 * Loaded at server startup to validate required env vars.
 */

export interface ServerEnv {
    /** libsql primary server URL (e.g. http://sqld:8080) */
    libsqlUrl: string;
    /** JWT secret for signing/verifying sync tokens */
    jwtSecret: string;
    /** Port the SvelteKit server listens on */
    port: number;
}

function getEnv(name: string, fallback?: string): string {
    const value = process.env[name];
    if (!value && fallback !== undefined) return fallback;
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

function getEnvInt(name: string, fallback?: number): number {
    const value = process.env[name];
    if (value) return parseInt(value, 10);
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
}

let _env: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
    if (_env) return _env;

    _env = {
        libsqlUrl: getEnv('LIBSQL_URL', 'http://localhost:8080'),
        jwtSecret: getEnv('JWT_SECRET'),
        port: getEnvInt('PORT', 3000),
    };

    return _env;
}
