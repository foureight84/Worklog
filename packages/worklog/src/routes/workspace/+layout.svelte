<script lang="ts">
    import { goto } from "$app/navigation";
    import { Content } from "carbon-components-svelte";
    import { Dashboard } from "carbon-icons-svelte";

    import WorkspaceSidebar from "$lib/components/app/layout/workspace/workspace-sidebar.svelte";
    import { useBoards } from "$lib/hooks/boards.svelte";
    import { useTicketTypes } from "$lib/hooks/ticket-types.svelte";
    import { setWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import { useWorkspace } from "$lib/hooks/workspace.svelte";
    import { useCommandPalette } from "$lib/hooks/command-palette.svelte";
    import { page } from "$app/state";
    import type { CommandAction } from "$lib/components/app/types";
    import { startSyncScheduler, stopSyncScheduler } from "$lib/sync/sync-scheduler.svelte";
    import { onDestroy } from "svelte";

    let { children } = $props();
    const workspace = useWorkspace();
    const boardsApi = useBoards(() => workspace.path);
    const ticketTypesApi = useTicketTypes(() => workspace.path);
    const palette = useCommandPalette();

    setWorkspaceShellContext({ workspace, boardsApi, ticketTypesApi });

    let lastLoadedWorkspacePath = $state<string | null>(null);
    let boardLoadError = $state<string | null>(null);

    function openSettings() {
        void goto("/workspace/settings");
    }

    function openBoard(boardId: string) {
        void goto(`/workspace/${boardId}`);
    }

    $effect(() => {
        if (
            workspace.status === "no_workspace" ||
            workspace.status === "error"
        ) {
            void goto("/", { replaceState: true });
        }
    });

    $effect(() => {
        const workspacePath = workspace.path;

        if (workspace.status !== "ready" || !workspacePath) {
            lastLoadedWorkspacePath = null;
            return;
        }

        if (workspacePath === lastLoadedWorkspacePath) {
            return;
        }

        lastLoadedWorkspacePath = workspacePath;
        boardLoadError = null;

        void Promise.all([
            boardsApi.load(),
            ticketTypesApi.load()
        ]).catch((error) => {
            boardLoadError = String(error);
            lastLoadedWorkspacePath = null;
        });

        // Load sync config and start auto-sync interval
        import("$lib/db").then(({ getDb }) => {
            getDb(workspacePath).then((db) => {
                import("$lib/sync/sync-config.svelte").then(({ useSyncConfig }) => {
                    useSyncConfig().load(db).then(() => {
                        import("$lib/sync/sync-scheduler.svelte").then(({ startSyncScheduler }) => {
                            // Pass a getDb factory so the scheduler can access the DB for persistence
                            startSyncScheduler(() => getDb(workspacePath));
                        });
                    });
                });
            });
        });
    });

    // ── Dynamic board-switching commands ────────────────────────────────────
    $effect(() => {
        // Read the reactive dependency
        const boards = boardsApi.boards;

        // Build new board actions (or empty list if no boards)
        const boardActions: CommandAction[] = boards.map((board) => ({
            id: `switch-board-${board.id}`,
            label: `Switch to: ${board.name}`,
            subtitle: board.description || "Open this board",
            shortcut: "",
            category: "Boards",
            icon: Dashboard,
            run: () => {
                boardsApi.setActive(board);
                void goto(`/workspace/${board.id}`);
            },
        }));

        // Use queueMicrotask to defer state writes so they don't
        // trigger re-entry into this effect synchronously
        queueMicrotask(() => {
            palette.removeActionsByPrefix("switch-board-");
            if (boardActions.length > 0) {
                palette.appendActions(boardActions);
            }
        });
    });

    const isSettingsRoute = $derived(page.route.id === "/workspace/settings");

    onDestroy(() => {
        stopSyncScheduler();
    });
</script>

<!-- <h1>Hello World</h1>
<h1>Hello World</h1>
<h1>Hello World</h1>
<h1>{JSON.stringify(}</h1> -->

{#if workspace.status === "ready"}
    <WorkspaceSidebar
        isSetting={isSettingsRoute}
        onOpenSettings={openSettings}
        onOpenBoard={openBoard}
    />
{/if}

<Content class="layout-content">
    {#if workspace.status === "ready"}
        {#if boardLoadError}
            <aside class="workspace-load-error" role="alert">
                <strong>Unable to load boards.</strong>
                <span>{boardLoadError}</span>
            </aside>
        {/if}

        {@render children()}
    {:else}
        <main class="workspace-state">
            <article aria-busy="true">Opening workspace...</article>
        </main>
    {/if}
</Content>

<style>
    .workspace-state {
        min-height: 100%;
        display: grid;
        place-items: center;
        padding: var(--cds-spacing-05, 1rem);
    }

    .workspace-load-error {
        margin: var(--cds-spacing-04, 0.75rem);
        padding: var(--cds-spacing-04, 0.75rem);
        display: grid;
        gap: var(--cds-spacing-02, 0.25rem);
        border: 1px solid
            color-mix(in srgb, var(--color-danger, #fa4d56) 40%, transparent);
        border-radius: 0.5rem;
        background: color-mix(
            in srgb,
            var(--color-danger, #fa4d56) 12%,
            transparent
        );
        font-size: 0.875rem;
    }

    /* Ensure content area fills available height for full-height Kanban columns */
    :global(.layout-content.bx--content) {
        display: flex;
        flex-direction: column;
    }
</style>
