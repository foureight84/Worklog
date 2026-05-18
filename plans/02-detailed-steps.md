# Detailed Implementation Steps

> Companion to `01-architecture-overview.md`. Each step is a concrete, copy-pasteable action.
> Ordered to maintain compilability after every phase.

---

## Phase 0: Dependency Setup

### Step 0.1 — Install @libsql/client

```bash
cd packages/worklog
bun add @libsql/client
```

### Step 0.2 — Install adapter-node (replaces adapter-static)

```bash
bun add -D @sveltejs/adapter-node
```

Do NOT remove adapter-static yet — we remove it in Phase 3 after the adapter switch.

---

## Phase 1: Database Abstraction Layer

### Step 1.1 — Create src/lib/db/types.ts

```ts
export interface WorklogDB {
    select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
    execute(sql: string, args?: unknown[]): Promise<number>;
    close(): Promise<void>;
}
```

### Step 1.2 — Create src/lib/db/libsql-wrapper.ts

```ts
import { createClient, type Client } from '@libsql/client';
import type { WorklogDB } from './types';

export function wrapLibsqlClient(client: Client): WorklogDB {
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
        async close() {
            // @libsql/client doesn't expose .close() on Client — no-op
        },
    };
}

export { createClient };
```

### Step 1.3 — Create src/lib/db/connection-web.ts

```ts
import type { WorklogDB } from './types';
import { createClient, wrapLibsqlClient } from './libsql-wrapper';

export function createWebDB(url?: string): WorklogDB {
    const dbUrl = url || process.env.LIBSQL_URL || 'http://localhost:8080';
    const client = createClient({ url: dbUrl });
    return wrapLibsqlClient(client);
}
```

### Step 1.4 — Create src/lib/db/connection-desktop.ts

```ts
import type { WorklogDB } from './types';
import { createClient, wrapLibsqlClient } from './libsql-wrapper';

export interface DesktopDBOptions {
    workspacePath: string;
    syncUrl: string;
    authToken?: string;
}

export function createDesktopDB(options: DesktopDBOptions): WorklogDB {
    const dbPath = `${options.workspacePath}/.worklog/worklog.db`;
    const client = createClient({
        url: `file:${dbPath}`,
        syncUrl: options.syncUrl,
        authToken: options.authToken,
    });
    return wrapLibsqlClient(client);
}
```

### Step 1.5 — Rewrite src/lib/db/connection.ts

Read the current file first. The key changes:

1. Remove `import Database from '@tauri-apps/plugin-sql'`
2. Remove `import { mkdir, exists } from '@tauri-apps/plugin-fs'`
3. Import `WorklogDB` from `./types`
4. Import `createWebDB` from `./connection-web`
5. Import `createDesktopDB` from `./connection-desktop`
6. Replace the `getDb()` function body:

```ts
import type { WorklogDB } from './types';
import { createWebDB } from './connection-web';
import { createDesktopDB } from './connection-desktop';

let _db: WorklogDB | null = null;

function isDesktop(): boolean {
    return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

export async function getDb(workspacePath?: string): Promise<WorklogDB> {
    if (_db) return _db;

    if (isDesktop() && workspacePath) {
        // Desktop: use embedded replica
        const { getSyncConfig } = await import('../sync/sync-config.svelte');
        const config = await getSyncConfig();
        _db = createDesktopDB({
            workspacePath,
            syncUrl: config.primary_url,
            authToken: config.auth_token || undefined,
        });
    } else {
        // Webapp: direct connection to primary
        _db = createWebDB();
    }

    return _db;
}

export function closeDb(): Promise<void> {
    const db = _db;
    _db = null;
    return db ? db.close() : Promise.resolve();
}
```

7. The existing `mkdir`/`exists` calls for `.worklog/` directory: keep the `@tauri-apps/plugin-fs` import and calls but only in the desktop branch. Guard them with `if (isDesktop())`.

### Step 1.6 — Update all 5 repository files

For each of these files, make the same 2 changes:

- `src/lib/db/repositories/workspace.repo.ts`
- `src/lib/db/repositories/board.repo.ts`
- `src/lib/db/repositories/ticket.repo.ts`
- `src/lib/db/repositories/ticket-type.repo.ts`
- `src/lib/db/repositories/settings.repo.ts`

**Change A:** Replace import line:
```diff
- import type Database from '@tauri-apps/plugin-sql';
+ import type { WorklogDB } from '../types';
```

**Change B:** Replace parameter type `db: Database` → `db: WorklogDB` in every function signature.

That's it. The `.select()` and `.execute()` calls are identical signatures.

### Step 1.7 — Update src/lib/db/migrate.ts

```diff
- import type Database from '@tauri-apps/plugin-sql';
+ import type { WorklogDB } from './types';
```

Replace `db: Database` → `db: WorklogDB` in `runMigrations()` signature and each migration function.

### Step 1.8 — Update src/lib/db/seed.ts

```diff
- import type Database from '@tauri-apps/plugin-sql';
+ import type { WorklogDB } from './types';
```

Replace `db: Database` → `db: WorklogDB` in `seedDatabase()` signature.

### Step 1.9 — Update src/lib/db/index.ts

```diff
- export type { Database } from '@tauri-apps/plugin-sql';
+ export type { WorklogDB } from './types';
```

### Step 1.10 — Verify

```bash
cd packages/worklog
bun run check
```

Should pass. If not, search for remaining `@tauri-apps/plugin-sql` imports.

---

## Phase 2: Sync Model Overhaul

### Step 2.1 — Rewrite src/lib/sync/types.ts

Replace the entire file:

```ts
export interface SyncConfig {
    primary_url: string;
    auth_token: string;
    auto_sync: boolean;
    last_synced_at: string | null;
}

export type SyncStatus = 'connected' | 'disconnected' | 'syncing';

export interface SyncResult {
    status: 'success' | 'error';
    message: string;
    timestamp: string;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    primary_url: '',
    auth_token: '',
    auto_sync: false,
    last_synced_at: null,
};
```

### Step 2.2 — Rewrite src/lib/sync/sync-config.svelte.ts

Read the current file. Key changes:

1. Replace all references to `remote_url`, `access_token`, `branch`, `git_name`, `git_email`, `auto_sync_interval` with `primary_url`, `auth_token`, `auto_sync`, `last_synced_at`
2. Replace `SyncStatus` values: `idle` → `connected`, `pushing`/`pulling` → `syncing`, `error` → `disconnected`
3. The SQL queries that load/save from `sync_config` table must match the new column names

### Step 2.3 — Rewrite src/lib/sync/sync-engine.ts

Replace the entire file with:

```ts
import type { Client } from '@libsql/client';
import type { SyncResult } from './types';

export class SyncEngine {
    constructor(private client: Client | null) {}

    async sync(): Promise<SyncResult> {
        if (!this.client) {
            return { status: 'success', message: 'No sync configured', timestamp: new Date().toISOString() };
        }
        try {
            await (this.client as any).sync();
            return { status: 'success', message: 'Synced', timestamp: new Date().toISOString() };
        } catch (error) {
            return { status: 'error', message: String(error), timestamp: new Date().toISOString() };
        }
    }

    async isAvailable(): Promise<boolean> {
        return !!this.client;
    }
}
```

### Step 2.4 — Delete src/lib/sync/git-client.ts

```bash
rm packages/worklog/src/lib/sync/git-client.ts
```

### Step 2.5 — Simplify src/lib/sync/sync-scheduler.svelte.ts

Replace the interval-based logic with a simple 30-second loop:

```ts
import { onMount, onDestroy } from 'svelte';
import { syncConfig, type SyncStatus } from './sync-config.svelte';
import { SyncEngine } from './sync-engine';

let interval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 30_000;

export function startSyncScheduler(engine: SyncEngine) {
    interval = setInterval(async () => {
        if (!syncConfig.config.auto_sync) return;
        if (!syncConfig.config.primary_url) return;

        syncConfig.setStatus('syncing');
        const result = await engine.sync();

        if (result.status === 'success') {
            syncConfig.setStatus('connected');
            syncConfig.updateLastSynced();
        } else {
            syncConfig.setStatus('disconnected');
        }
    }, SYNC_INTERVAL_MS);
}

export function stopSyncScheduler() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}
```

### Step 2.6 — Update src/lib/components/app/layout/workspace/sync-bottom-bar.svelte

Replace status text/icons:
- `pushing` → "Syncing..." with a spinner icon
- `pulling` → "Syncing..." with a spinner icon
- `connected` → "Connected" with a checkmark icon
- `disconnected` → "Disconnected" with a warning icon
- `syncing` → "Syncing..." with a spinner icon

### Step 2.7 — Update src/routes/workspace/settings/+page.svelte

Read the current file. Find the "Synchronization" section (around line 1152-1210). Replace the form:

**Remove these fields:**
- Git Remote URL
- Access Token
- Branch
- Committer Name
- Committer Email
- Sync Interval

**Replace with:**
```svelte
<!-- Primary URL -->
<div class="form-group">
    <label>Server URL</label>
    <input type="text" bind:value={syncConfig.config.primary_url}
           placeholder="http://your-server:8080" />
</div>

<!-- Auth Token -->
<div class="form-group">
    <label>Auth Token</label>
    <input type="password" bind:value={syncConfig.config.auth_token}
           placeholder="Paste JWT token from webapp settings" />
</div>

<!-- Auto Sync toggle (already exists, keep it) -->

<!-- Generate Token button (webapp only) -->
{#if !isDesktop}
<div class="form-group">
    <label>Generate Desktop Token</label>
    <button onclick={generateToken}>Generate New Token</button>
    {#if generatedToken}
    <div class="token-display">
        <code>{generatedToken}</code>
        <button onclick={() => navigator.clipboard.writeText(generatedToken)}>Copy</button>
    </div>
    <p class="hint">Paste this into the Auth Token field on each desktop client.</p>
    {/if}
</div>
{/if}
```

Add the `generateToken` function and state variables near the top of the script block.

### Step 2.8 — Update src/lib/db/schema.ts

Replace the `sync_config` CREATE TABLE statement:

```sql
CREATE TABLE IF NOT EXISTS sync_config (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    primary_url     TEXT NOT NULL DEFAULT '',
    auth_token      TEXT NOT NULL DEFAULT '',
    auto_sync       INTEGER NOT NULL DEFAULT 0,
    last_synced_at  TEXT,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Bump `SCHEMA_VERSION` from 13 to 14.

### Step 2.9 — Add migration v14 in src/lib/db/migrate.ts

Append to the `MIGRATIONS` array:

```ts
{
    version: 14,
    up: async (db: WorklogDB) => {
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
        // Re-insert default row
        await db.execute(`INSERT INTO sync_config (id) VALUES (1)`);
    },
}
```

### Step 2.10 — Update src/lib/components/app/types.ts

```diff
- export type SyncMode = 'local' | 'git';
+ export type SyncMode = 'local' | 'git' | 'libsql';
```

### Step 2.11 — Create src/lib/server/jwt.ts

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

function base64url(buf: Buffer): string {
    return buf.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

export function signDesktopToken(clientId: string): string {
    const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = base64url(Buffer.from(JSON.stringify({
        sub: clientId,
        iat: Math.floor(Date.now() / 1000),
    })));
    const signingInput = `${header}.${payload}`;
    const signature = base64url(
        createHmac('sha256', getKey()).update(signingInput).digest()
    );
    return `${signingInput}.${signature}`;
}

export function isJwtKeyAvailable(): boolean {
    try {
        readFileSync(JWT_KEY_PATH);
        return true;
    } catch {
        return false;
    }
}
```

### Step 2.12 — Create src/routes/api/sync/token/+server.ts

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

### Step 2.13 — Verify

```bash
cd packages/worklog
bun run check
```

---

## Phase 3: Server / Webapp Infrastructure

### Step 3.1 — Switch adapter in svelte.config.js

```diff
- import adapter from '@sveltejs/adapter-static';
+ import adapter from '@sveltejs/adapter-node';
```

Remove the `adapter-static` config options (`pages`, `assets`, `fallback`). adapter-node needs no config.

```bash
bun remove @sveltejs/adapter-static
```

### Step 3.2 — Create src/lib/server/env.ts

```ts
export const serverEnv = {
    LIBSQL_URL: process.env.LIBSQL_URL || 'http://localhost:8080',
    JWT_KEY_PATH: process.env.JWT_KEY_PATH || '/run/secrets/jwt.key',
    PORT: parseInt(process.env.PORT || '3000', 10),
};
```

### Step 3.3 — Create src/lib/server/init-db.ts

```ts
import type { WorklogDB } from '$lib/db/types';
import { createWebDB } from '$lib/db/connection-web';
import { CREATE_TABLES } from '$lib/db/schema';
import { runMigrations } from '$lib/db/migrate';
import { seedDatabase } from '$lib/db/seed';
import { serverEnv } from './env';

let _initialized = false;

export async function initDatabase(): Promise<WorklogDB> {
    if (_initialized) {
        return createWebDB(serverEnv.LIBSQL_URL);
    }
    const db = createWebDB(serverEnv.LIBSQL_URL);
    await db.execute(CREATE_TABLES);
    await runMigrations(db);
    await seedDatabase(db);
    _initialized = true;
    return db;
}
```

### Step 3.4 — Create src/hooks.server.ts

```ts
import type { Handle } from '@sveltejs/kit';
import { initDatabase } from '$lib/server/init-db';
import type { WorklogDB } from '$lib/db/types';

let db: WorklogDB | null = null;

export const handle: Handle = async ({ event, resolve }) => {
    if (!db) {
        db = await initDatabase();
    }
    event.locals.db = db;
    return resolve(event);
};
```

### Step 3.5 — Update src/app.d.ts

```ts
import type { WorklogDB } from '$lib/db/types';

declare global {
    namespace App {
        interface Locals {
            db: WorklogDB;
        }
    }
}

export {};
```

### Step 3.6 — Update src/lib/hooks/workspace.svelte.ts

Add `isDesktop` detection. In webapp mode, skip the folder picker and just initialize with the server DB. Key changes:

1. Add `const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__;`
2. In `init()`: if `isDesktop`, do the existing folder-pick flow. If not, call `getDb()` directly (webapp path) and proceed to `open_workspace()`.
3. Remove `import { open } from '@tauri-apps/plugin-dialog'` — guard it behind `if (isDesktop)`.

### Step 3.7 — Update src/routes/workspace/+layout.svelte

The `onMount` → `workspace.init()` call is already there. No change needed if workspace.svelte.ts handles the branching internally.

### Step 3.8 — Create packages/worklog/Dockerfile

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

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

### Step 3.9 — Create packages/worklog/docker-compose.yml

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
    file: ./secrets/jwt.key

volumes:
  sqld_data:
  jwt_key:
```

### Step 3.10 — Verify webapp builds and runs

```bash
cd packages/worklog
bun run build
# Check that build/ directory contains index.js
docker compose up jwt-init    # generate key
docker compose up -d
curl http://localhost:3000     # should return HTML
curl http://localhost:8080/health  # should return OK
curl http://localhost:3000/api/sync/token  # should return JWT
```

---

## Phase 4: Desktop Client Adaptation

### Step 4.1 — Update src-tauri/Cargo.toml

Remove:
```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

### Step 4.2 — Update src-tauri/src/lib.rs

Remove the plugin registration:
```diff
- .plugin(tauri_plugin_sql::Builder::new().build())
```

Remove the import:
```diff
- use tauri_plugin_sql;
```

### Step 4.3 — Update src-tauri/capabilities/default.json

Remove these 4 permissions:
- `sql:allow-execute`
- `sql:allow-select`
- `sql:allow-load`
- `sql:allow-close`

Keep shell permissions for now (remove in Phase 5).

### Step 4.4 — Ensure .worklog/ directory creation in desktop mode

In `connection.ts` desktop branch, before calling `createDesktopDB()`:

```ts
if (isDesktop()) {
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const worklogDir = `${workspacePath}/.worklog`;
    const dirExists = await exists(worklogDir);
    if (!dirExists) {
        await mkdir(worklogDir, { recursive: true });
    }
}
```

### Step 4.5 — Verify desktop builds

```bash
cd packages/worklog
bun run tauri dev
```

Open the app, create a workspace, verify tickets can be created and saved.

---

## Phase 5: Cleanup

### Step 5.1 — Remove shell permissions from Tauri

In `src-tauri/capabilities/default.json`, remove:
- `shell:allow-execute`
- `shell:allow-spawn`

In `src-tauri/Cargo.toml`, remove:
```toml
tauri-plugin-shell
```

In `src-tauri/src/lib.rs`, remove:
```diff
- .plugin(tauri_plugin_shell::init())
```

In `package.json`, remove:
```json
"@tauri-apps/plugin-shell"
```

### Step 5.2 — Verify desktop still builds after removing shell plugin

```bash
cd packages/worklog
bun run tauri dev
```

---

## Phase 6: Testing

### Step 6.1 — Webapp integration test

```bash
docker compose up -d
# Open http://localhost:3000
# Create board → create ticket → move ticket → refresh → verify persistence
docker compose restart webapp
# Refresh → verify data still there
```

### Step 6.2 — Desktop sync test

```bash
# Server running from step 6.1
# Get a token
curl http://localhost:3000/api/sync/token
# Paste token into desktop app sync settings
# Create ticket on webapp → wait 30s → verify on desktop
# Create ticket on desktop → verify on webapp
```

### Step 6.3 — Optimistic concurrency test

```bash
# Disconnect desktop network
# Edit ticket T on webapp
# Edit ticket T on desktop
# Reconnect desktop
# Verify conflict notification appears
```

---

## File Change Summary

### New files (12)
1. `src/lib/db/types.ts` — WorklogDB interface
2. `src/lib/db/libsql-wrapper.ts` — Shared libsql → WorklogDB wrapper
3. `src/lib/db/connection-web.ts` — Webapp connection factory
4. `src/lib/db/connection-desktop.ts` — Desktop connection factory
5. `src/lib/server/env.ts` — Server environment config
6. `src/lib/server/init-db.ts` — Server DB initialization
7. `src/lib/server/jwt.ts` — JWT signing for desktop tokens
8. `src/routes/api/sync/token/+server.ts` — Token generation API
9. `src/hooks.server.ts` — SvelteKit server hooks
10. `Dockerfile` — Multi-stage Docker build
11. `docker-compose.yml` — Docker compose with JWT auth
12. `scripts/generate-jwt-key.sh` — Manual key gen helper (optional)

### Modified files (20)
1. `package.json` — deps
2. `svelte.config.js` — adapter
3. `src/lib/db/connection.ts` — platform-aware factory
4. `src/lib/db/schema.ts` — sync_config table + SCHEMA_VERSION
5. `src/lib/db/migrate.ts` — v14 migration + WorklogDB type
6. `src/lib/db/seed.ts` — WorklogDB type
7. `src/lib/db/index.ts` — export WorklogDB
8. `src/lib/db/repositories/workspace.repo.ts`
9. `src/lib/db/repositories/board.repo.ts`
10. `src/lib/db/repositories/ticket.repo.ts` + optimistic concurrency
11. `src/lib/db/repositories/ticket-type.repo.ts`
12. `src/lib/db/repositories/settings.repo.ts`
13. `src/lib/sync/types.ts` — new SyncConfig
14. `src/lib/sync/sync-config.svelte.ts` — new fields
15. `src/lib/sync/sync-engine.ts` — libsql sync
16. `src/lib/sync/sync-scheduler.svelte.ts` — simplified
17. `src/lib/hooks/workspace.svelte.ts` — desktop/web branching
18. `src/lib/components/app/types.ts` — SyncMode
19. `src/routes/workspace/settings/+page.svelte` — new sync form + token gen
20. `src/lib/components/app/layout/workspace/sync-bottom-bar.svelte` — status display
21. `src/app.d.ts` — locals typing
22. `src-tauri/Cargo.toml` — remove plugins
23. `src-tauri/src/lib.rs` — remove plugin registration
24. `src-tauri/capabilities/default.json` — remove permissions

### Deleted files (1)
1. `src/lib/sync/git-client.ts`
