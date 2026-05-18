# Self-Hosted Webapp + libsql + Desktop Sync — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform Worklog from a Tauri-only desktop app with Git-based sync into a self-hosted Docker webapp with SQLite swapped for libsql, plus automatic bidirectional sync between desktop clients and the server via libsql embedded replicas.

**Architecture:** Single libsql primary (sqld) running in Docker alongside the SvelteKit webapp. Desktop Tauri clients run libsql embedded replicas that sync continuously with the primary. Both webapp and desktop share the same repository layer — only the connection factory differs. All Tauri runtime dependencies (plugin-sql, plugin-fs, plugin-shell, plugin-dialog) are replaced with libsql APIs and SvelteKit server endpoints.

**Auth architecture:**
```
┌─ Docker ───────────────────────────────────────────────────────┐
│  jwt-init (run once): generates /secrets/jwt.key (HS256)       │
│       │                                                        │
│       ▼                                                        │
│  sqld --auth-jwt-key file:/etc/sqld/auth/jwt.key              │
│       ▲ (validates JWT natively)                               │
│       │                                                        │
│  ┌────┴────────────┐                                           │
│  │ internal (no    │  external (JWT required)                  │
│  │ auth needed)    │                                           │
│  │                 │                                           │
│  │ webapp          │  desktop client 1   desktop client 2      │
│  │ @libsql/client  │  @libsql/client    @libsql/client         │
│  │ url: sqld:8080  │  syncUrl: server   syncUrl: server       │
│  │ no authToken    │  authToken: eyJ...  authToken: eyJ...     │
│  └─────────────────┘                                           │
│                                                                 │
│  webapp Settings → /api/sync/token → signs JWT → copy to desktop│
└─────────────────────────────────────────────────────────────────┘
```

Desktop auth flow:
1. `docker compose up` → `jwt-init` generates random key → sqld starts with `--auth-jwt-key`
2. User opens webapp → Settings → Synchronization → clicks "Generate Desktop Token"
3. Webapp reads the shared key, signs a JWT, displays it
4. User copies the JWT into their desktop client's `auth_token` field
5. Desktop client passes it to `createClient({ authToken: 'eyJ...' })`
6. sqld validates the JWT signature on every request — no custom middleware

**Tech Stack:** SvelteKit (adapter-node), @libsql/client, sqld (libsql-server), Bun, Docker, Tauri v2 (desktop only)

**Assumptions:**
- Single-user application (no multi-tenant auth needed)
- Desktop clients will still use Tauri but swap tauri-plugin-sql for @libsql/client
- The libsql primary is the single source of truth — desktop replicas sync against it
- Optimistic concurrency (updated_at guards) handles the rare offline-conflict case
- **Auth:** sqld runs with JWT auth enabled. A shared JWT signing key is generated at first startup and persisted in a Docker volume. The webapp exposes a "Generate Desktop Token" UI that signs a JWT using this key. Desktop clients present the JWT as `authToken` to `createClient()`. sqld validates it natively — no custom auth middleware.

---

## Phase 0: Dependency Setup

### Task 0.1: Add @libsql/client dependency

**Objective:** Install the libsql client library in the SvelteKit project.

**Files:**
- Modify: `packages/worklog/package.json`
- Modify: `packages/worklog/bun.lockb` (auto-generated)

**Step 1: Install @libsql/client**

```bash
cd packages/worklog
bun add @libsql/client
```

**Verification:** `bun pm ls | grep libsql` shows `@libsql/client` in dependencies.

---

## Phase 1: Database Abstraction Layer

### Task 1.1: Define the DB interface types

**Objective:** Create a type that both libsql and the repo layer agree on, so repos don't need to import from a specific driver.

**Files:**
- Create: `packages/worklog/src/lib/db/types.ts`

**Context:** Currently all repos import `Database` from `@tauri-apps/plugin-sql`. The Tauri plugin exposes `.select(query, params)` (returns array) and `.execute(query, params)` (returns void/rowsAffected). libsql uses `.execute({sql, args})` which returns `{rows, rowsAffected}`. We need a unified interface.

**New interface:**

```ts
// db-types.ts
export interface QueryResult {
    rows: Record<string, unknown>[];
    rowsAffected: number;
}

export interface WorklogDB {
    /** Run a SELECT query and return rows */
    select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
    /** Run an INSERT/UPDATE/DELETE, returns rowsAffected */
    execute(sql: string, args?: unknown[]): Promise<number>;
    /** Close the connection */
    close(): Promise<void>;
}
```

The repo functions will accept `WorklogDB` instead of `Database`.

### Task 1.2: Create libsql connection factory (browser/webapp mode)

**Objective:** Implement `createWebDB()` that returns a `WorklogDB` backed by @libsql/client.

**Files:**
- Create: `packages/worklog/src/lib/db/connection-web.ts`

**Connection logic:**
- In Docker/webapp: `createClient({ url: process.env.LIBSQL_URL || 'http://localhost:8080' })` — connects directly to sqld primary over HTTP
- Returns a `WorklogDB` wrapper around the libsql client

```ts
// connection-web.ts
import { createClient, type Client } from '@libsql/client';

export async function createWebDB(dbUrl?: string): Promise<WorklogDB> {
    const url = dbUrl || process.env.LIBSQL_URL || 'http://localhost:8080';
    const client = createClient({ url });

    return {
        async select<T>(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rows.map(row => {
                const obj: Record<string, unknown> = {};
                for (const col of result.columns) {
                    obj[col] = row[result.columns.indexOf(col)];
                }
                return obj as T;
            });
        },
        async execute(sql: string, args?: unknown[]) {
            const result = await client.execute({ sql, args: args as any });
            return result.rowsAffected;
        },
        async close() { client.close(); }
    };
}
```

### Task 1.3: Create libsql connection factory (desktop/Tauri mode with embedded replica)

**Objective:** Implement `createDesktopDB()` that returns a `WorklogDB` backed by @libsql/client in embedded replica mode — local .db file that syncs with the primary.

**Files:**
- Create: `packages/worklog/src/lib/db/connection-desktop.ts`

**Connection logic:**
- Desktop: `createClient({ url: 'file:.worklog/worklog.db', syncUrl: 'http://my-server:8080', authToken: '...' })`
- The libsql client handles bidirectional sync automatically
- Workspace path is determined from Tauri's path resolution or localStorage

```ts
// connection-desktop.ts
import { createClient, type Client } from '@libsql/client';

export async function createDesktopDB(workspacePath: string, syncUrl: string, authToken?: string): Promise<WorklogDB> {
    const dbPath = `${workspacePath}/.worklog/worklog.db`;
    const client = createClient({
        url: `file:${dbPath}`,
        syncUrl,
        authToken,
    });

    // Same WorklogDB wrapper as connection-web.ts
    return wrapLibsqlClient(client);
}
```

### Task 1.4: Extract shared libsql wrapper

**Objective:** Both `createWebDB` and `createDesktopDB` share the same libsql → WorklogDB wrapping logic. Extract it.

**Files:**
- Create: `packages/worklog/src/lib/db/libsql-wrapper.ts`

**Content:** Move the `select`/`execute`/`close` wrapping from Task 1.2 into a shared `wrapLibsqlClient(client: Client): WorklogDB` function. Both connection factories import and use it.

### Task 1.5: Update connection.ts to use the new factories

**Objective:** Replace the old `getDb()` that uses `@tauri-apps/plugin-sql` with a version that delegates to the platform-specific factory.

**Files:**
- Modify: `packages/worklog/src/lib/db/connection.ts`

**Changes:**
- Remove `import Database from '@tauri-apps/plugin-sql'`
- Remove `import { mkdir, exists } from '@tauri-apps/plugin-fs'`
- Add a runtime detection: `if (typeof window !== 'undefined' && window.__TAURI__)` → desktop mode, else → web mode
- `getDb(workspacePath)` calls `createDesktopDB()` or `createWebDB()` accordingly
- File system operations (mkdir, exists) become simple Node/Bun fs calls in web mode
- The cached `_db` variable type changes from `Database` to `WorklogDB`

### Task 1.6: Update all 5 repository files to use WorklogDB

**Objective:** Replace `Database` import from `@tauri-apps/plugin-sql` with `WorklogDB` from `./types`.

**Files:**
- Modify: `packages/worklog/src/lib/db/repositories/workspace.repo.ts`
- Modify: `packages/worklog/src/lib/db/repositories/board.repo.ts`
- Modify: `packages/worklog/src/lib/db/repositories/ticket.repo.ts`
- Modify: `packages/worklog/src/lib/db/repositories/ticket-type.repo.ts`
- Modify: `packages/worklog/src/lib/db/repositories/settings.repo.ts`

**API mapping (mechanical, per file):**

| Tauri plugin API | New WorklogDB API |
|---|---|
| `db.select<T>(sql, params)` | `db.select<T>(sql, params)` — identical signature |
| `db.execute(sql, params)` | `db.execute(sql, params)` → returns `number` (rowsAffected) instead of void |

The old code in repos does `await db.execute(...)` without capturing the return. The new API still works — the return is just ignored.

For ticket.repo.ts `listTickets` — uses `db.select<any[]>(query, params)` — identical.

For board.repo.ts `getBoardById` — uses `db.select<Board[]>(sql, [id])` — identical.

**Every repo file:** Change only the import line from `import type Database from '@tauri-apps/plugin-sql'` to `import type { WorklogDB } from '../types'` and the parameter type from `Database` to `WorklogDB`.

### Task 1.7: Update migrate.ts

**Objective:** `runMigrations()` currently accepts `Database`. Change to `WorklogDB`.

**Files:**
- Modify: `packages/worklog/src/lib/db/migrate.ts`

**Changes:** Import type `WorklogDB` instead of `Database`. No logic changes — the queries are raw SQL strings passed to `.select()`/`.execute()`.

### Task 1.8: Update seed.ts and db/index.ts

**Objective:** Fix type imports.

**Files:**
- Modify: `packages/worklog/src/lib/db/seed.ts`
- Modify: `packages/worklog/src/lib/db/index.ts`

**Changes:** Any remaining `Database` imports → `WorklogDB`. Export `WorklogDB` from index.ts.

### Task 1.9: Add optimistic concurrency to ticket.repo.ts

**Objective:** Add `updated_at` guard to `updateTicket()` to prevent silent overwrites when both server and desktop edit the same ticket while disconnected.

**Files:**
- Modify: `packages/worklog/src/lib/db/repositories/ticket.repo.ts`

**Current updateTicket:**
```ts
await db.execute(`UPDATE tickets SET ... WHERE id = ?`, [...values, id]);
```

**New updateTicket:**
```ts
const rowsAffected = await db.execute(
    `UPDATE tickets SET ... WHERE id = ? AND updated_at = ?`,
    [...values, id, existing.updated_at]
);
if (rowsAffected === 0) {
    throw new Error('Ticket was modified by another client. Refresh and try again.');
}
```

This is a single-line change in the SQL WHERE clause plus a check on rowsAffected. Same pattern applies to `archiveBoard` and `renameBoard` in board.repo.ts.

### Task 1.10: Verify Phase 1 compiles

**Objective:** Run `bun run check` to verify no type errors remain.

```bash
cd packages/worklog
bun run check
```

Expected: No TypeScript errors. All `Database` references resolved to `WorklogDB`.

---

## Phase 2: Sync Model Overhaul

### Task 2.1: Update sync types

**Objective:** Replace Git-specific sync config with libsql replica config.

**Files:**
- Modify: `packages/worklog/src/lib/sync/types.ts`

**Changes:**
- Remove `SyncConfig` (remote_url, access_token, branch, git_name, git_email)
- Add new `SyncConfig`:
```ts
export interface SyncConfig {
    /** libsql primary URL (e.g. http://my-server:8080) */
    primary_url: string;
    /** Auth token for the primary (empty if no auth) */
    auth_token: string;
    /** Whether to enable continuous sync */
    auto_sync: boolean;
    /** ISO timestamp of last successful sync */
    last_synced_at: string | null;
}
```
- Remove `SyncStatus` members: `pushing`, `pulling` (libsql sync is continuous, not push/pull)
- Add: `'connected' | 'disconnected' | 'syncing'`
- Remove `DEFAULT_SYNC_CONFIG` — replace with libsql defaults

### Task 2.2: Update sync-config.svelte.ts

**Objective:** Update the reactive config hook for libsql fields. The config is still persisted in the database (sync_config table), but with different columns.

**Files:**
- Modify: `packages/worklog/src/lib/sync/sync-config.svelte.ts`

**Changes:**
- Load/save `primary_url`, `auth_token`, `auto_sync`, `last_synced_at` instead of `remote_url`, `access_token`, `branch`, `git_name`, `git_email`, `auto_sync_interval`
- Remove `auto_sync_interval` — libsql sync is continuous, no interval needed
- Remove `setStatus` related to git push/pull states
- Add `setStatus` for connected/disconnected/syncing

### Task 2.3: Rewrite sync-engine.ts for libsql replica sync

**Objective:** Replace the entire Git-based sync engine with a thin wrapper around libsql's built-in sync. On desktop, this calls `client.sync()` to push local WAL and pull remote changes. On webapp (direct connection to primary), sync is a no-op.

**Files:**
- Replace: `packages/worklog/src/lib/sync/sync-engine.ts`

**New content (conceptual):**

```ts
export class SyncEngine {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    /** Push local changes to primary + pull remote changes. No-op if using direct connection. */
    async sync(): Promise<SyncResult> {
        try {
            await this.client.sync();
            return { status: 'success', message: 'Synced', timestamp: new Date().toISOString() };
        } catch (error) {
            return { status: 'error', message: String(error), timestamp: new Date().toISOString() };
        }
    }

    /** Check if sync is available (always true for libsql) */
    async isAvailable(): Promise<boolean> {
        return true;
    }
}
```

The entire `push()`, `pull()`, `forcePush()`, `forcePull()`, `initialize()` methods are **deleted**. The Git module (git init, remote setup, commit, push, pull, conflict handling) is gone.

### Task 2.4: Delete git-client.ts

**Objective:** Remove the Git CLI wrapper entirely.

**Files:**
- Delete: `packages/worklog/src/lib/sync/git-client.ts`

**Verification:** `bun run check` passes with no imports of git-client.

### Task 2.5: Update sync-scheduler.svelte.ts

**Objective:** Replace the interval-based "check every minute if auto-sync is due" with continuous libsql sync on a periodic health-check interval (every 30 seconds, attempt `client.sync()`).

**Files:**
- Modify: `packages/worklog/src/lib/sync/sync-scheduler.svelte.ts`

**Changes:**
- Remove countdown/interval logic (no more git interval config)
- Simplify: every 30 seconds, if auto_sync is enabled and workspace is ready, call `engine.sync()`
- Update status to 'connected' on success, 'disconnected' on failure
- This is ~30 lines instead of the current ~117 lines

### Task 2.6: Update sync-bottom-bar.svelte (UI)

**Objective:** Change the sync status bar from showing "Pushing/Pulling/Failed to sync" to "Connected/Syncing/Disconnected".

**Files:**
- Modify: `packages/worklog/src/lib/components/app/layout/workspace/sync-bottom-bar.svelte`

**Changes:** Update the status display strings and icons. Replace git-specific statuses with libsql connection statuses.

### Task 2.7: Update workspace settings page (sync section)

**Objective:** The sync settings UI now asks for `primary_url` and `auth_token` instead of git remote URL + token + branch + committer name/email.

**Files:**
- Modify: `packages/worklog/src/routes/workspace/settings/+page.svelte`

**Changes:** Replace the git sync configuration form fields (5 fields) with libsql form fields (2 fields: primary_url, auth_token). Remove branch/name/email/interval inputs.

### Task 2.8: Update DB schema for new sync config

**Objective:** The `sync_config` table has columns for git that are no longer needed. Add new columns for libsql.

**Files:**
- Modify: `packages/worklog/src/lib/db/schema.ts`

**Changes to sync_config table:**
```sql
CREATE TABLE IF NOT EXISTS sync_config (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    primary_url     TEXT NOT NULL DEFAULT '',
    auth_token      TEXT NOT NULL DEFAULT '',
    auto_sync       INTEGER NOT NULL DEFAULT 0,
    last_synced_at  TEXT,
    updated_at      TEXT NOT NULL
);
```

Remove columns: `remote_url`, `access_token`, `branch`, `git_name`, `git_email`, `auto_sync_interval`.

Also bump `SCHEMA_VERSION` (13 → 14).

### Task 2.9: Add migration for schema v14

**Objective:** Create a migration that renames/replaces columns in `sync_config` from git to libsql.

**Files:**
- Modify: `packages/worklog/src/lib/db/migrate.ts`

**New migration entry:**
```ts
{
    version: 14,
    up: async (db: WorklogDB) => {
        // Drop old git columns, add new libsql columns
        await db.execute(`ALTER TABLE sync_config RENAME COLUMN remote_url TO primary_url`);
        await db.execute(`ALTER TABLE sync_config ADD COLUMN auth_token TEXT NOT NULL DEFAULT ''`);
        // Drop unused git columns (SQLite can't drop columns easily, so we use a workaround or just ignore them)
        // Simpler: just add new columns and leave old ones — they're inert
        // OR: recreate the table
    }
}
```

**Note:** SQLite doesn't support `DROP COLUMN` well before 3.35. Since we're switching to libsql (which does), this is fine. The safest approach: drop the old `sync_config` table and recreate it. User's sync config will be lost and need reconfiguration — acceptable for this migration since the sync model is completely different.

Simpler migration:
```ts
{
    version: 14,
    up: async (db: WorklogDB) => {
        await db.execute(`DROP TABLE IF EXISTS sync_config`);
        await db.execute(CREATE_TABLE_SYNC_CONFIG_V14);
    }
}
```

### Task 2.10: Update workspace_meta.sync_mode

**Objective:** Add 'libsql' as a valid sync mode.

**Files:**
- Modify: `packages/worklog/src/lib/components/app/types.ts`

**Change:** `SyncMode = "local" | "git"` → `SyncMode = "local" | "git" | "libsql"`

### Task 2.11: Add JWT token generation module

**Objective:** Create a server-side module that signs JWTs using the shared key file. The webapp uses this to generate desktop auth tokens. Desktop clients present the JWT to sqld, which validates it natively.

**Auth model:** sqld starts with `--auth-jwt-key file:/var/lib/sqld/jwt.key`. A random key is generated at first startup (via an init container or startup script) and persisted in a Docker volume. The webapp mounts the same volume and reads the key to sign JWTs.

**Files:**
- Create: `packages/worklog/src/lib/server/jwt.ts`

```ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const JWT_KEY_PATH = process.env.JWT_KEY_PATH || '/run/secrets/jwt.key';

let _key: Buffer | null = null;

function getKey(): Buffer {
    if (!_key) {
        _key = readFileSync(JWT_KEY_PATH);
    }
    return _key;
}

/** Base64url encode (JWT-safe) */
function base64url(buf: Buffer): string {
    return buf.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

/** Sign a JWT with HS256 for sqld auth */
export function signDesktopToken(clientId: string): string {
    const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = base64url(Buffer.from(JSON.stringify({
        sub: clientId,
        iat: Math.floor(Date.now() / 1000),
        // No expiry — desktop tokens are long-lived (revocable by key rotation)
    })));
    const signingInput = `${header}.${payload}`;
    const signature = base64url(createHmac('sha256', getKey()).update(signingInput).digest());
    return `${signingInput}.${signature}`;
}

/** Check if the JWT key file exists (i.e., auth is configured) */
export function isJwtKeyAvailable(): boolean {
    try {
        readFileSync(JWT_KEY_PATH);
        return true;
    } catch {
        return false;
    }
}
```

### Task 2.12: Create API endpoint for desktop token generation

**Objective:** Expose a `GET /api/sync/token` endpoint that returns a signed JWT. The user visits the webapp's settings page, clicks "Generate Desktop Token", and copies the token into their desktop client.

**Files:**
- Create: `packages/worklog/src/routes/api/sync/token/+server.ts`

```ts
import { json } from '@sveltejs/kit';
import { signDesktopToken, isJwtKeyAvailable } from '$lib/server/jwt';

export async function GET() {
    if (!isJwtKeyAvailable()) {
        return json({ error: 'JWT auth not configured on this server' }, { status: 500 });
    }
    const clientId = `desktop-${crypto.randomUUID().slice(0, 8)}`;
    const token = signDesktopToken(clientId);
    return json({ token, clientId });
}
```

### Task 2.13: Update sync settings page — add "Generate Desktop Token" UI

**Objective:** In the sync settings form, add a section that calls `/api/sync/token` and displays the resulting JWT for the user to copy into their desktop client.

**Files:**
- Modify: `packages/worklog/src/routes/workspace/settings/+page.svelte`

**Changes to the sync section (after the primary_url + auth_token form):**
- Add a "Desktop Sync Tokens" subsection
- "Generate Token" button calls `fetch('/api/sync/token')` → displays token in a readonly text field
- "Copy" button copies to clipboard
- Note: "Paste this token into the Auth Token field on each desktop client"

New state variables:
```ts
let generatedToken = $state('');
let generatedClientId = $state('');
let generatingToken = $state(false);
```

### Task 2.14: Decouple export/import mappers from sync engine

**Objective:** The sync engine calls `extractSnapshot()` and `importFromFolder()`. These are still useful for manual export/import — they just shouldn't be called by the sync engine anymore. No code changes needed if we just stop calling them from sync.

**Files:**
- No changes to: `extract.ts`, `serialize-json.ts`, `deserialize-json.ts`, `import.ts`, `import-file.ts`, `export.ts`

The export/import code is kept intact for manual backup/restore. The sync engine no longer references them.

### Task 2.15: Verify Phase 2 compiles

```bash
cd packages/worklog
bun run check
```

Expected: No errors. Git-related imports all gone.

---

## Phase 3: Server / Webapp Infrastructure

### Task 3.1: Switch SvelteKit adapter from static to node

**Objective:** Change from SPA mode (adapter-static) to SSR-capable adapter-node so SvelteKit can run as a server with API routes.

**Files:**
- Modify: `packages/worklog/svelte.config.js`

**Changes:**
```js
// Before:
import adapter from "@sveltejs/adapter-static";

// After:
import adapter from "@sveltejs/adapter-node";
```

```bash
cd packages/worklog
bun add -D @sveltejs/adapter-node
bun remove @sveltejs/adapter-static
```

**Verification:** `bun run build` produces a `build/` directory with `index.js` (server entry point).

### Task 3.2: Add server-side environment config

**Objective:** Create a module that reads environment variables (LIBSQL_URL, DATA_DIR, PORT) for the server runtime.

**Files:**
- Create: `packages/worklog/src/lib/server/env.ts`

```ts
export const env = {
    LIBSQL_URL: process.env.LIBSQL_URL || 'http://localhost:8080',
    DATA_DIR: process.env.DATA_DIR || './data',
    PORT: parseInt(process.env.PORT || '3000', 10),
};
```

### Task 3.3: Create server-side DB initialization

**Objective:** When the webapp starts, ensure the libsql database has the schema and seed data. This replaces the desktop's `connection.ts` init logic (mkdir + CREATE_TABLES + seed).

**Files:**
- Create: `packages/worklog/src/lib/server/init-db.ts`

```ts
import { createWebDB } from '$lib/db/connection-web';
import { CREATE_TABLES } from '$lib/db/schema';
import { runMigrations } from '$lib/db/migrate';
import { SettingsRepo } from '$lib/db';

export async function initDatabase(): Promise<WorklogDB> {
    const db = await createWebDB();
    await db.execute(CREATE_TABLES);
    await runMigrations(db);
    // Seed default ticket types
    // ...
    return db;
}
```

### Task 3.4: Create +layout.server.ts for DB singleton

**Objective:** Initialize DB once at server startup and make it available to all API routes and page loads.

**Files:**
- Create: `packages/worklog/src/hooks.server.ts`

```ts
import { initDatabase } from '$lib/server/init-db';

let db: WorklogDB | null = null;

export async function handle({ event, resolve }) {
    if (!db) {
        db = await initDatabase();
    }
    event.locals.db = db;
    return resolve(event);
}
```

### Task 3.5: Add app.d.ts for locals typing

**Objective:** Type the `event.locals.db` so routes can use it.

**Files:**
- Modify or create: `packages/worklog/src/app.d.ts`

```ts
import type { WorklogDB } from '$lib/db/types';

declare global {
    namespace App {
        interface Locals {
            db: WorklogDB;
        }
    }
}
```

### Task 3.6: Update workspace hook for webapp mode

**Objective:** On webapp, there's no "pick folder" dialog. The workspace is server-managed. Simplify the hook.

**Files:**
- Modify: `packages/worklog/src/lib/hooks/workspace.svelte.ts`

**Changes:**
- Remove `pick()` function (no Tauri dialog in webapp)
- Remove `getSavedWorkspacePath()` / `saveWorkspacePath()` (no localStorage path)
- `init()` in webapp mode: workspace path is `/data` on server (set in docker-compose)
- Add runtime detection: `const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__`
- `isDesktop ? pick() : initServer()` pattern
- Remove `import { open } from '@tauri-apps/plugin-dialog'`

### Task 3.7: Update workspace +layout.svelte for webapp

**Objective:** The layout that calls `workspace.init()` on mount — needs to handle the webapp case where init is immediate (no folder pick).

**Files:**
- Modify: `packages/worklog/src/routes/workspace/+layout.svelte`

**Changes:** The onMount handler should call `workspace.init()` with server-side defaults if running in web mode. No folder picker UI.

### Task 3.8: Create Dockerfile

**Objective:** Multi-stage Docker build: install deps with Bun, build SvelteKit, run with Bun in production.

**Files:**
- Create: `packages/worklog/Dockerfile`

```dockerfile
# Build stage
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Runtime stage
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV PORT=3000
ENV LIBSQL_URL=http://sqld:8080
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]
```

**Verification:** `docker build -t worklog-web .` succeeds.

### Task 3.9: Create docker-compose.yml with JWT auth

**Objective:** Orchestrate the webapp + libsql server with JWT-based auth for desktop client sync.

**Files:**
- Create: `packages/worklog/docker-compose.yml`

```yaml
version: '3.8'
services:
  webapp:
    build: .
    ports:
      - "3000:3000"
    environment:
      - LIBSQL_URL=http://sqld:8080
      - JWT_KEY_PATH=/run/secrets/jwt.key
    secrets:
      - jwt_key
    depends_on:
      sqld:
        condition: service_healthy
    restart: unless-stopped

  sqld:
    image: ghcr.io/tursodatabase/libsql-server:latest
    ports:
      - "8080:8080"
    volumes:
      - sqld_data:/var/lib/sqld
      - jwt_key:/etc/sqld/auth:ro
    command: >
      sqld
      --http-listen-addr 0.0.0.0:8080
      --auth-jwt-key file:/etc/sqld/auth/jwt.key
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  # One-time job: generates JWT key if it doesn't exist
  jwt-init:
    image: alpine:latest
    volumes:
      - jwt_key:/keys
    command: >
      sh -c '
        if [ ! -f /keys/jwt.key ]; then
          echo "Generating new JWT signing key..."
          head -c 32 /dev/urandom | base64 > /keys/jwt.key
          chmod 600 /keys/jwt.key
          echo "Done."
        else
          echo "JWT key already exists."
        fi
      '

secrets:
  jwt_key:
    file: ./secrets/jwt.key  # optional pre-existing key

volumes:
  sqld_data:
  jwt_key:
```

**Note on key generation:**

The `jwt-init` service runs once at first `docker compose up`. It generates a 32-byte random key at `/var/lib/docker/volumes/worklog_jwt_key/_data/jwt.key`. On subsequent starts, it detects the existing key and exits cleanly.

If the user wants to pre-provision a key (e.g., for reproducibility), create `secrets/jwt.key` before starting:

```bash
mkdir -p secrets
head -c 32 /dev/urandom | base64 > secrets/jwt.key
```

**Key rotation (revoking all desktop tokens):**
```bash
rm /var/lib/docker/volumes/worklog_jwt_key/_data/jwt.key
docker compose up -d jwt-init   # generates new key
docker compose restart sqld webapp
# All existing desktop tokens are now invalid — reissue from settings page
```

**Verification:** 
```bash
docker compose up -d
docker compose logs jwt-init     # should show "Generating new JWT signing key..."
docker compose ps                # all services healthy
curl http://localhost:8080/health  # OK
curl http://localhost:3000/api/sync/token  # returns {"token":"eyJ...", "clientId":"desktop-..."}
```

---

## Phase 3.5: Webapp UI Cleanup — Hide Desktop-Only Features

**Context:** The current webapp shares a single codebase with the desktop app, which causes desktop-only UI to leak into the webapp. This phase conditionally hides desktop-specific features when running in browser mode (non-Tauri). The `isWebApp()` / `isDesktop()` guard already exists in `connection.ts` and `workspace.svelte.ts` — this phase applies it systematically across the UI layer.

**Decision: Conditional rendering** — not separate directories. Desktop and webapp share 90%+ of code (components, repos, hooks). A single `isDesktop()` check at each divergence point is sufficient.

**Detection helper** (consolidate into a shared location):

```ts
// src/lib/environment.ts (NEW)
export function isDesktop(): boolean {
    return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}
export function isWebApp(): boolean {
    return !isDesktop();
}
```

### Task 3.5.1: Create shared environment detection module

**Objective:** Single source of truth for desktop/webapp detection. Replace inline `isWebApp()` / `isDesktop()` checks scattered across the codebase.

**Files:**
- Create: `packages/worklog/src/lib/environment.ts`

### Task 3.5.2: Hide window controls in webapp

**Objective:** Minimize, maximize, and close buttons only work in Tauri. Hide them in the webapp.

**Files:**
- Modify: `packages/worklog/src/lib/components/app/layout/toolbar/app-toolbar.svelte`

**Changes:**
- Import `isDesktop` from `$lib/environment`
- Wrap the three window control buttons (Subtract, Minimize/Maximize, Close) in `{#if isDesktop()}`
- Wrap the Tauri drag region div (`data-tauri-drag-region`) in `{#if isDesktop()}`
- Skip the `$effect` that subscribes to window resize events when `!isDesktop()`

### Task 3.5.3: Fix toolbar status for webapp

**Objective:** The toolbar shows "Disconnected" in webapp mode because sync is not configured. The webapp IS the server — show "Server" or nothing.

**Files:**
- Modify: `packages/worklog/src/lib/components/app/layout/toolbar/app-toolbar.svelte`

**Changes:**
- Import `isDesktop` from `$lib/environment`
- Modify `formattedSyncTime` to return `"Server"` or empty when `!isDesktop()`, or hide the sync status div entirely

### Task 3.5.4: Hide sync bottom bar in webapp

**Objective:** The sync bottom bar shows desktop replica sync status. On the webapp (primary), there is no sync — hide it entirely.

**Files:**
- Modify: `packages/worklog/src/lib/components/app/layout/workspace/workspace-sidebar.svelte` (line 406, where `<SyncBottomBar />` is rendered)

**Changes:**
- Import `isDesktop` from `$lib/environment`
- Wrap `<SyncBottomBar />` in `{#if isDesktop()}`

### Task 3.5.5: Fix settings → Synchronization page for webapp

**Objective:** The current sync settings form is desktop-oriented (asks for Server URL, Auth Token — these are what a desktop client fills in to connect to the server). In the webapp, show the admin view: server connection info + token generation for desktop clients.

**Files:**
- Modify: `packages/worklog/src/routes/workspace/settings/+page.svelte`

**Changes:**
- Import `isDesktop` from `$lib/environment`
- In the "Synchronization" section:
  - **Webapp mode:** Show a "Server" info block (libsql URL, JWT auth status). Keep the "Desktop Token" generation section. Hide "Server URL", "Auth Token", "Auto-sync" fields.
  - **Desktop mode:** Keep existing form (Server URL, Auth Token, Auto-sync). Hide the "Desktop Token" generation section (tokens are generated on the server, not on the client).

### Task 3.5.6: Hide updater section in webapp

**Objective:** The updater uses `@tauri-apps/plugin-updater` which doesn't exist in browser.

**Files:**
- Modify: `packages/worklog/src/routes/workspace/settings/+page.svelte`

**Changes:**
- Wrap the updater section (check for updates button, release notes) in `{#if isDesktop()}`
- Remove or conditionally import `checkForUpdate` from `$lib/updater`

### Task 3.5.7: Disable right-click prevention in webapp

**Objective:** Desktop Tauri apps prevent the native context menu. In a browser, users expect right-click to work.

**Files:**
- Modify: `packages/worklog/src/routes/+layout.svelte`

**Changes:**
- Import `isDesktop` from `$lib/environment`
- Only add the `contextmenu` event listener when `isDesktop()`

### Task 3.5.8: Disable app zoom in webapp

**Objective:** The CSS transform zoom conflicts with native browser zoom (Ctrl+/-). Let the browser handle zoom natively.

**Files:**
- Modify: `packages/worklog/src/routes/+layout.svelte`

**Changes:**
- Import `isDesktop` from `$lib/environment`
- Only apply `transform: scale(var(--app-zoom))` and the width/height calc when `isDesktop()`
- Keep keyboard shortcuts but make them no-op in webapp (browser handles Ctrl+/- natively)
- Keep `overflow: hidden` on body (the layout needs it regardless)

### Task 3.5.9: Guard openWorkspaceFolder in webapp

**Objective:** The "Open Workspace Folder" command palette action calls `workspace.pick()` which uses Tauri dialog. Should be hidden in webapp.

**Files:**
- Modify: `packages/worklog/src/routes/+layout.svelte`

**Changes:**
- Remove `openWorkspace` from command palette actions when `isWebApp()`, or make `workspace.pick()` a no-op in webapp mode.

### Task 3.5.10: Consolidate inline detection checks

**Objective:** Replace scattered `!!(window as any).__TAURI__` and inline `isWebApp()` checks with imports from `$lib/environment.ts`.

**Files:**
- Modify: `packages/worklog/src/lib/db/connection.ts` — replace inline `isDesktop()` with import
- Modify: `packages/worklog/src/lib/hooks/workspace.svelte.ts` — replace inline `isWebApp()` with import

### Task 3.5.11: Verify webapp UI compiles and runs clean

```bash
cd packages/worklog
bun run check
```

Expected: 0 errors, 0 warnings. All desktop-only UI hidden in webapp mode.

---

## Phase 4: Desktop Client Adaptation

### Task 4.1: Update Tauri Cargo.toml — swap SQL plugin for nothing (libsql is JS-side)

**Objective:** Remove `tauri-plugin-sql` from Rust dependencies since the desktop client now uses @libsql/client on the JS side.

**Files:**
- Modify: `packages/worklog/src-tauri/Cargo.toml`

**Changes:**
- Remove: `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`
- No Cargo replacement needed — libsql runs in the JS layer, not Rust

### Task 4.2: Update Tauri lib.rs — remove SQL plugin registration

**Objective:** Remove `.plugin(tauri_plugin_sql::...)` from the Tauri builder.

**Files:**
- Modify: `packages/worklog/src-tauri/src/lib.rs`

**Changes:**
- Remove `tauri_plugin_sql` import
- Remove `.plugin(tauri_plugin_sql::Builder::new().build())` line
- Keep all other plugins (fs, shell, dialog, etc. — still needed for file operations and the git CLI until sync is replaced)

### Task 4.3: Update Tauri capabilities — remove SQL permissions

**Objective:** Remove `sql:allow-execute`, `sql:allow-select`, `sql:allow-load`, `sql:allow-close` permissions.

**Files:**
- Modify: `packages/worklog/src-tauri/capabilities/default.json`

**Changes:** Delete these 4 permission entries. Keep shell permissions (git is still needed temporarily until sync engine is fully replaced, then remove in Phase 5 cleanup).

### Task 4.4: Ensure desktop workspace init creates local DB directory

**Objective:** `connection.ts` → `createDesktopDB()` needs to ensure `.worklog/` directory exists before opening the libsql file. Use Tauri fs plugin or simple mkdir.

**Files:**
- Modify: `packages/worklog/src/lib/db/connection.ts`

**Changes:** In the desktop branch, before calling `createDesktopDB()`, use `mkdir` from `@tauri-apps/plugin-fs` to create `.worklog/` directory (existing behavior preserved).

### Task 4.5: Desktop sync initialization on workspace open

**Objective:** When the user opens a workspace on desktop, if sync is configured (primary_url is set), start the libsql embedded replica sync.

**Files:**
- Modify: `packages/worklog/src/lib/hooks/workspace.svelte.ts`

**Changes:** After `open_workspace()` creates the DB connection, if `syncConfig.config.primary_url` is set, create the libsql client in embedded replica mode with `syncUrl` pointing to the primary.

### Task 4.6: Verify desktop app builds and runs

**Objective:** `bun run tauri:build` succeeds. The app starts, opens a workspace, and can read/write tickets.

```bash
cd packages/worklog
bun run tauri:build
```

---

## Phase 5: Cleanup (Optional Polish)

### Task 5.1: Remove git shell permissions from Tauri capabilities

**Objective:** Once libsql sync is confirmed working, the git CLI is no longer needed. Remove shell permissions.

**Files:**
- Modify: `packages/worklog/src-tauri/capabilities/default.json`

**Changes:** Remove the two `shell:allow-execute` and `shell:allow-spawn` entries for `git`.

### Task 5.2: Remove @tauri-apps/plugin-shell dependency

**Objective:** If no other shell usage remains, drop the dependency.

**Files:**
- Modify: `packages/worklog/src-tauri/Cargo.toml` — remove `tauri-plugin-shell`
- Modify: `packages/worklog/package.json` — remove `@tauri-apps/plugin-shell`
- Modify: `packages/worklog/src-tauri/src/lib.rs` — remove plugin registration

### Task 5.3: Remove unused JSON mappers (if not needed for export)

**Objective:** If the sync engine was the only consumer, some mapper files may be dead.

**Verification:** Search for imports of `extractSnapshot`, `snapshotToFolderJsonFiles`, `importFromFolder`. If only `export.ts` uses them, keep (manual export is valuable). If nothing uses them, delete.

### Task 5.4: Add litestream for backup (docker-compose)

**Objective:** Optional continuous backup of the libsql database.

**Files:**
- Modify: `packages/worklog/docker-compose.yml`

Add a `litestream` service that continuously backs up the sqld data to a local directory or S3.

---

## Phase 6: Testing & Verification

### Task 6.1: Webapp integration test

**Objective:** Verify the full webapp flow works end-to-end.

1. `docker compose up -d`
2. Open `http://localhost:3000`
3. Create a board
4. Create a ticket
5. Move ticket across columns
6. Verify persistence (restart container, data still there)

### Task 6.2: Desktop sync test

**Objective:** Verify desktop ↔ server sync.

1. Start Docker webapp
2. Open desktop app, configure sync to `http://localhost:8080`
3. Create ticket on webapp
4. Wait 30 seconds
5. Desktop shows the ticket
6. Create ticket on desktop
7. Webapp shows the ticket within seconds

### Task 6.3: Optimistic concurrency test

**Objective:** Verify the `updated_at` guard prevents silent overwrites.

1. Open webapp and desktop side by side
2. Disconnect desktop network
3. Edit ticket T on webapp (sets updated_at = t1)
4. Edit ticket T on desktop (sets updated_at = t2, older)
5. Reconnect desktop
6. Desktop sync fails for ticket T with "modified by another client" error
7. UI shows conflict notification

---

## File Change Summary

### New files (12)
| File | Purpose |
|---|---|
| `src/lib/db/types.ts` | WorklogDB interface |
| `src/lib/db/connection-web.ts` | libsql direct connection factory |
| `src/lib/db/connection-desktop.ts` | libsql embedded replica factory |
| `src/lib/db/libsql-wrapper.ts` | Shared libsql → WorklogDB wrapper |
| `src/lib/server/env.ts` | Server environment config |
| `src/lib/server/init-db.ts` | Server DB initialization |
| `src/lib/server/jwt.ts` | JWT signing module for desktop auth tokens |
| `src/routes/api/sync/token/+server.ts` | API endpoint: generate desktop auth token |
| `src/hooks.server.ts` | SvelteKit server hooks (DB init) |
| `Dockerfile` | Multi-stage Docker build |
| `docker-compose.yml` | Docker compose with sqld + JWT auth + key gen |
| `scripts/generate-jwt-key.sh` | (optional) manual key generation helper |

### Modified files (20)
| File | Change |
|---|---|
| `package.json` | Add @libsql/client, @sveltejs/adapter-node; remove adapter-static |
| `svelte.config.js` | Switch adapter from static to node |
| `src/lib/db/connection.ts` | Replace Tauri SQL with platform-aware factory |
| `src/lib/db/schema.ts` | sync_config table rewrite + bump SCHEMA_VERSION |
| `src/lib/db/migrate.ts` | Add v14 migration |
| `src/lib/db/index.ts` | Export WorklogDB type |
| `src/lib/db/repositories/workspace.repo.ts` | Database → WorklogDB |
| `src/lib/db/repositories/board.repo.ts` | Database → WorklogDB + updated_at guard |
| `src/lib/db/repositories/ticket.repo.ts` | Database → WorklogDB + updated_at guard |
| `src/lib/db/repositories/ticket-type.repo.ts` | Database → WorklogDB |
| `src/lib/db/repositories/settings.repo.ts` | Database → WorklogDB |
| `src/lib/sync/types.ts` | Rewrite for libsql config |
| `src/lib/sync/sync-engine.ts` | Replace Git with libsql sync |
| `src/lib/sync/sync-config.svelte.ts` | Rewrite for libsql fields |
| `src/lib/sync/sync-scheduler.svelte.ts` | Simplify to continuous sync loop |
| `src/lib/hooks/workspace.svelte.ts` | Remove Tauri dialog; add desktop/web branching |
| `src/lib/components/app/types.ts` | Add 'libsql' SyncMode |
| `src/routes/workspace/+layout.svelte` | Webapp workspace init path |
| `src/routes/workspace/settings/+page.svelte` | libsql sync settings form |
| `src/lib/components/app/layout/workspace/sync-bottom-bar.svelte` | Connected/Disconnected status |
| `src-tauri/Cargo.toml` | Remove tauri-plugin-sql |
| `src-tauri/src/lib.rs` | Remove SQL plugin registration |
| `src-tauri/capabilities/default.json` | Remove SQL + shell permissions |

### Deleted files (1)
| File | Reason |
|---|---|
| `src/lib/sync/git-client.ts` | Replaced by libsql sync |

---

## Risks & Open Questions

1. **libsql embedded replica maturity**: The JS client's embedded replica sync is relatively new. Test thoroughly with the "offline for hours" scenario. Fallback: if replica sync is unreliable, fall back to direct HTTP connection (desktop connects directly to sqld primary, no local .db — requires always-online).

2. **Tauri fs plugin still needed?**: The desktop app still calls `mkdir` and `exists` for `.worklog/` directory creation. These could be replaced with Bun/Node `fs.mkdirSync` since the desktop runs in a Tauri webview which has Node-compatible APIs via the SvelteKit dev server. However, Tauri's security model prefers plugin-based fs access. Keep the fs plugin for now.

3. **Authentication (resolved):** sqld runs with `--auth-jwt-key` enabled. A random HS256 key is generated at first Docker startup. The webapp's settings page generates signed JWTs that desktop clients use as `authToken`. sqld validates JWTs natively — no custom auth middleware. Key rotation (deleting and regenerating the key file) revokes all existing desktop tokens instantly. The webapp connects to sqld internally (same Docker network) without auth — only desktop clients present tokens.

4. **Schema compatibility**: SQLite-specific features used in the current schema (AUTOINCREMENT, CHECK constraints, FK ON DELETE CASCADE) are all supported by libsql. No migration risks.

5. **Vite dev server in Docker**: The Dockerfile uses `bun run build` (production). For development, mount the source dir and run `bun run dev -- --host 0.0.0.0`. Add a `docker-compose.dev.yml` with volume mounts.
