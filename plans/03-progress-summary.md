# Worklog Webapp Migration - Progress Summary

> Generated after two implementation sessions. Covers Steps 0-3.10 of the plan, plus code review + fixes.

---

## WHAT'S DONE

### Phase 0: Dependencies
- `@libsql/client` already installed in dependencies
- `@sveltejs/adapter-node` already installed in devDependencies
- `jose@6.2.3` added for JWT signing/verification

### Phase 1: Database Abstraction Layer (COMPLETE)
- Step 1.1: `src/lib/db/types.ts` - WorklogDB interface (now includes `sync()` method)
- Step 1.2: `src/lib/db/libsql-wrapper.ts` - libsql Client → WorklogDB wrapper (exposes `sync()`)
- Step 1.3: `src/lib/db/connection-web.ts` - Webapp connection factory
- Step 1.4: `src/lib/db/connection-desktop.ts` - Desktop connection factory (skips empty syncUrl)
- Step 1.5: `src/lib/db/connection.ts` - Platform-aware factory
- Step 1.6: Updated all 5 repo files to use `WorklogDB` instead of `Database`
- Step 1.7: Updated `migrate.ts` - import + all function signatures
- Step 1.8: Updated `seed.ts` - import + function signatures
- Step 1.9: Updated `index.ts` - added `export type { WorklogDB }`
- Also fixed: `export.ts`, all 4 `mappers/*.ts` files
- Fixed TypeScript select return type issues: `select<T[]>` → `select<T>`

### Phase 2: Sync Model Overhaul (COMPLETE)
- Step 2.1-2.3: Rewrote sync/types.ts, sync-config.svelte.ts, sync-engine.ts
- Step 2.4: Deleted orphaned `git-client.ts`
- Step 2.5-2.7: Rewrote scheduler, bottom-bar, settings page sync section
- Step 2.8-2.10: Updated schema (v14), migration, SyncMode type
- Step 2.11: Created `src/lib/server/jwt.ts` — JWT signing/verification (HS256, 24h expiry)
- Step 2.12: Created `src/routes/api/sync/token/+server.ts` — POST endpoint for desktop tokens
- Step 2.13: `bun run check` passes (1 pre-existing error, 8 pre-existing CSS warnings)

### Phase 3: Server/Webapp Infrastructure (COMPLETE)
- Step 3.1: Switched `svelte.config.js` from adapter-static to adapter-node
- Step 3.2: Created `src/lib/server/env.ts` — server env config (LIBSQL_URL, JWT_SECRET, PORT)
- Step 3.3: Created `src/lib/server/init-db.ts` — singleton server DB with in-flight promise dedup
- Step 3.4: Created `src/hooks.server.ts` — attaches DB to event.locals.db
- Step 3.5: Created `src/app.d.ts` — typed Locals.db as WorklogDB
- Step 3.6: Updated `workspace.svelte.ts` — webapp mode detects `!__TAURI__`, skips folder picker
- Step 3.8: Created `Dockerfile` — multi-stage Bun build
- Step 3.9: Created `docker-compose.yml` — webapp + sqld services with healthchecks
- Step 3.10: Build succeeded, server boots on port 3000 (verified with `bun build/index.js`)

---

## CODE REVIEW FINDINGS (all fixed)

### Critical
1. **jwt.ts: Eager env evaluation** — `JWT_SECRET` was read at module load → crashes import if missing. **FIXED**: lazy via `getServerEnv()`.
2. **jwt.ts: No claim validation** — `verifySyncToken` blindly cast `payload.clientId as string` without checking existence. **FIXED**: validates all required claims, throws on missing.
3. **init-db.ts: Race condition** — `if (_db) return _db` then async work then `_db = db`. Two concurrent requests both pass check. **FIXED**: in-flight promise pattern (`_initPromise`).
4. **SyncEngine: Always null client** — `new SyncEngine(null)` made sync always return "No sync configured". **FIXED**: accepts `getDb: () => Promise<WorklogDB>`, calls `db.sync()`.
5. **Settings: Wrong HTTP method for token** — GET instead of POST, no `clientId` in body. **FIXED**: POST with `crypto.randomUUID()` as clientId.
6. **sync-scheduler: last_synced_at not persisted** — `updateLastSynced()` only updated memory. **FIXED**: persists to DB via `UPDATE sync_config SET last_synced_at = ?`.

### Moderate
7. **jwt.ts: Duplicate env reading** — Had its own `envSecret()` instead of using `getServerEnv()`. **FIXED**: uses shared `getServerEnv()`.
8. **workspace.svelte.ts: Redundant runMigrations** — `getDb()` already runs migrations; called again in `open_workspace`/`open_workspace_web`. **FIXED**: removed duplicate calls + import.
9. **connection-desktop.ts: Empty syncUrl** — Passed empty string as syncUrl to libsql Client. **FIXED**: only passes syncUrl/authToken if non-empty.
10. **token endpoint: JSON parse → 500** — `request.json()` threw on malformed JSON caught as 500. **FIXED**: separate try/catch for JSON parse → 400.
11. **sync-config.svelte.ts: `any` type** — `db.select<any>(...)` on load. **FIXED**: proper inline type `{ primary_url: string; auth_token: string; auto_sync: number; last_synced_at: string | null }`.

### Minor
12. **docker-compose: No healthchecks** — Webapp could start before sqld ready. **FIXED**: added healthchecks + `depends_on: condition: service_healthy`.
13. **WorklogDB interface: Missing sync()** — Required for SyncEngine to trigger replication. **FIXED**: added `sync(): Promise<void>` to interface + wrapper implementation.

---

## NOT DONE (out of scope for current task)
- Phase 4: Desktop client adaptation (remove Tauri SQL plugin fully)
- Phase 5: Cleanup (remove shell plugin)
- Phase 6: Testing
- Docker is not installed on this WSL system — Dockerfiles not verified with actual `docker compose up`

---

## FILES CHANGED SUMMARY

### New files created (9):
- `src/lib/server/jwt.ts` — JWT signing/verification
- `src/lib/server/env.ts` — Server env config
- `src/lib/server/init-db.ts` — Server DB initialization
- `src/routes/api/sync/token/+server.ts` — Token generation endpoint
- `src/hooks.server.ts` — SvelteKit server hooks
- `src/app.d.ts` — App type declarations
- `Dockerfile` — Multi-stage Bun build
- `docker-compose.yml` — sqld + webapp services
- `.dockerignore` — Docker build exclusions

### Rewritten files (4):
- `src/lib/sync/types.ts` — New SyncConfig, SyncStatus, SyncResult
- `src/lib/sync/sync-config.svelte.ts` — Full rewrite with DB persistence
- `src/lib/sync/sync-engine.ts` — Uses WorklogDB.sync()
- `src/lib/sync/sync-scheduler.svelte.ts` — Accepts getDb factory, persists last_synced_at
- `src/lib/components/app/layout/workspace/sync-bottom-bar.svelte`

### Modified files (~18):
- `src/lib/db/types.ts` — Added sync() method
- `src/lib/db/libsql-wrapper.ts` — Implemented sync()
- `src/lib/db/connection-desktop.ts` — Conditional syncUrl
- `src/lib/db/connection.ts`, `schema.ts`, `migrate.ts`, `seed.ts`, `index.ts`, `export.ts`
- All 5 `repositories/*.ts`, 4 `mappers/*.ts`
- `src/lib/hooks/workspace.svelte.ts` — Webapp mode, removed redundant migrations
- `src/lib/components/app/types.ts` — SyncMode update
- `src/lib/components/app/layout/toolbar/app-toolbar.svelte`
- `src/routes/workspace/+layout.svelte` — Updated sync scheduler setup
- `src/routes/workspace/settings/+page.svelte` — Token generation POST, fixed null type
- `svelte.config.js` — adapter-node

### Deleted files (1):
- `src/lib/sync/git-client.ts` (orphaned, no imports)

---

## PRE-EXISTING ISSUES (not introduced by this migration)
1. Unused `@ts-expect-error` in vite.config.js line 5
2. 8 unused CSS selectors across settings page and sync-bottom-bar (from removed Git sync UI)
3. `@tauri-apps/plugin-sql` still in package.json dependencies (Phase 4 will remove)
