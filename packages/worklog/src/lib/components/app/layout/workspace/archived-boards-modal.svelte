<!-- src/lib/components/app/layout/workspace/archived-boards-modal.svelte -->
<script lang="ts">
    import {
        ComposedModal,
        ModalHeader,
        ModalBody,
        Button,
        InlineLoading,
        Tag,
        Modal,
    } from "carbon-components-svelte";
    import {
        Archive,
        Undo,
        TrashCan,
        FolderOff,
        Launch,
    } from "carbon-icons-svelte";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import type { Board } from "$lib/components/app/types";

    interface ArchivedBoardsModalProps {
        open: boolean;
        onOpenBoard?: (boardId: string) => void;
    }

    let { open = $bindable(false), onOpenBoard }: ArchivedBoardsModalProps =
        $props();

    const { boardsApi } = getWorkspaceShellContext();

    let loadingArchived = $state(false);
    let loadError = $state<string | null>(null);
    let actionError = $state<string | null>(null);

    // Confirm delete
    let deleteBoardId = $state<string | null>(null);
    let deleteModalOpen = $state(false);

    // Per-board action loading state
    let unarchivingId = $state<string | null>(null);
    let deletingId = $state<string | null>(null);

    $effect(() => {
        if (!open) return;
        void (async () => {
            loadingArchived = true;
            loadError = null;
            try {
                await boardsApi.loadArchived();
            } catch (e) {
                loadError = String(e);
            } finally {
                loadingArchived = false;
            }
        })();
    });

    function formatDate(dateStr: string | null | undefined): string {
        if (!dateStr) return "—";
        return new Date(dateStr).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    async function handleUnarchive(board: Board) {
        unarchivingId = board.id;
        actionError = null;
        try {
            await boardsApi.unarchive(board.id);
        } catch (e) {
            actionError = String(e);
        } finally {
            unarchivingId = null;
        }
    }

    function promptDelete(id: string) {
        deleteBoardId = id;
        deleteModalOpen = true;
    }

    async function confirmDelete() {
        if (!deleteBoardId) return;
        deletingId = deleteBoardId;
        actionError = null;
        try {
            await boardsApi.remove(deleteBoardId);
        } catch (e) {
            actionError = String(e);
        } finally {
            deletingId = null;
            deleteModalOpen = false;
            deleteBoardId = null;
        }
    }

    function handleRestoreAndOpen(board: Board) {
        void (async () => {
            await handleUnarchive(board);
            open = false;
            onOpenBoard?.(board.id);
        })();
    }
</script>

<ComposedModal bind:open size="lg">
    <ModalHeader>
        <div class="modal-title-row">
            <Archive size={20} />
            <span>Archived Boards</span>
        </div>
        <p class="modal-subtitle">
            Archived boards are hidden from the sidebar. Restore a board to make
            it active again, or delete it permanently.
        </p>
    </ModalHeader>

    <ModalBody>
        {#if loadingArchived}
            <div class="archive-state">
                <InlineLoading description="Loading archived boards..." />
            </div>
        {:else if loadError}
            <p class="archive-error">{loadError}</p>
        {:else if boardsApi.archivedBoards.length === 0}
            <div class="archive-state archive-empty">
                <FolderOff size={40} />
                <p>No archived boards yet.</p>
                <span
                    >Archive a board from the sidebar context menu to see it
                    here.</span
                >
            </div>
        {:else}
            {#if actionError}
                <p class="archive-error">{actionError}</p>
            {/if}
            <ul class="archive-list">
                {#each boardsApi.archivedBoards as board (board.id)}
                    <li class="archive-item">
                        <div class="archive-item-info">
                            <div class="archive-item-name-row">
                                <span class="archive-item-name"
                                    >{board.name}</span
                                >
                                <Tag size="sm" type="warm-gray">
                                    <span class="tag-inner">
                                        <Archive size={10} />
                                        Archived
                                    </span>
                                </Tag>
                            </div>
                            {#if board.description}
                                <p class="archive-item-desc">
                                    {board.description}
                                </p>
                            {/if}
                            <span class="archive-item-meta">
                                Archived {formatDate(board.archived_at)} · Created
                                {formatDate(board.created_at)}
                            </span>
                        </div>

                        <div class="archive-item-actions">
                            {#if unarchivingId === board.id}
                                <InlineLoading description="Restoring..." />
                            {:else}
                                <Button
                                    kind="ghost"
                                    size="small"
                                    icon={Launch}
                                    iconDescription="Restore and open board"
                                    tooltipPosition="left"
                                    onclick={() => handleRestoreAndOpen(board)}
                                    disabled={!!unarchivingId || !!deletingId}
                                />
                                <Button
                                    kind="ghost"
                                    size="small"
                                    icon={Undo}
                                    iconDescription="Restore to active"
                                    tooltipPosition="left"
                                    onclick={() => handleUnarchive(board)}
                                    disabled={!!unarchivingId || !!deletingId}
                                />
                                <Button
                                    kind="danger-ghost"
                                    size="small"
                                    icon={TrashCan}
                                    iconDescription="Delete permanently"
                                    tooltipPosition="left"
                                    onclick={() => promptDelete(board.id)}
                                    disabled={!!unarchivingId ||
                                        deletingId === board.id}
                                />
                            {/if}
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}
    </ModalBody>
</ComposedModal>

<!-- Permanent delete confirm -->
<Modal
    danger
    size="xs"
    bind:open={deleteModalOpen}
    modalHeading="Delete archived board"
    primaryButtonText={deletingId ? "Deleting..." : "Delete permanently"}
    secondaryButtonText="Cancel"
    primaryButtonDisabled={!!deletingId}
    on:click:button--secondary={() => (deleteModalOpen = false)}
    on:click:button--primary={confirmDelete}
>
    <p>
        This will permanently delete the board and all its tickets. This cannot
        be undone.
    </p>
</Modal>

<style>
    .modal-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1.125rem;
        font-weight: 600;
    }

    .modal-subtitle {
        margin: 0.375rem 0 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.5;
        font-weight: 400;
    }

    /* ── States ──────────────────────────────────────────────────────────────── */
    .archive-state {
        display: flex;
        justify-content: center;
        padding: 2rem 1rem;
    }

    .archive-empty {
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        color: var(--cds-text-helper);
        text-align: center;
    }

    .archive-empty p {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--cds-text-02);
    }

    .archive-empty span {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
        max-width: 28rem;
    }

    .archive-error {
        margin: 0 0 1rem;
        padding: 0.75rem;
        border-radius: 4px;
        background: color-mix(in srgb, var(--cds-support-01) 10%, transparent);
        color: var(--cds-support-01);
        font-size: 0.8125rem;
    }

    /* ── List ────────────────────────────────────────────────────────────────── */
    .archive-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .archive-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.875rem 1rem;
        background: var(--cds-ui-01);
        border: 1px solid var(--cds-ui-03);
        border-radius: 4px;
        transition: border-color 0.15s ease;
    }

    .archive-item:hover {
        border-color: var(--cds-ui-04);
    }

    .archive-item-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .archive-item-name-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .archive-item-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--cds-text-01);
    }

    .tag-inner {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
    }

    .archive-item-desc {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.4;

        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .archive-item-meta {
        font-size: 0.6875rem;
        color: var(--cds-text-helper);
        margin-top: 0.125rem;
    }

    .archive-item-actions {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        flex-shrink: 0;
    }
</style>
