<script lang="ts">
    import {
        Settings,
        CopyFile,
        Launch,
        TrashCan,
        Edit,
        Archive,
    } from "carbon-icons-svelte";

    import {
        Button,
        ComposedModal,
        ModalBody,
        ModalFooter,
        ModalHeader,
        RadioTile,
        SideNav,
        SideNavItems,
        TextArea,
        TextInput,
        TileGroup,
        ContextMenu,
        ContextMenuOption,
        ContextMenuDivider,
        Modal,
        InlineLoading,
    } from "carbon-components-svelte";

    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import SyncBottomBar from "./sync-bottom-bar.svelte";
    import { isDesktop } from "$lib/environment";
    import ArchivedBoardsModal from "./archived-boards-modal.svelte";

    interface WorkspaceSidebarProps {
        onOpenSettings?: () => void;
        onOpenBoard?: (boardId: string) => void;
        isSetting?: boolean;
    }

    const noop = () => {};

    let {
        onOpenSettings = noop,
        onOpenBoard = noop,
        isSetting = false,
    }: WorkspaceSidebarProps = $props();

    const { boardsApi } = getWorkspaceShellContext();

    let createModalOpen = $state(false);
    let draftName = $state("");
    let draftDescription = $state("");
    let creatingBoard = $state(false);
    let createError = $state<string | null>(null);
    let showCreateDiscard = $state(false);

    const isCreateDirty = $derived(
        draftName.trim() !== "" || draftDescription.trim() !== "",
    );

    const selectedBoardId = $derived(boardsApi.active?.id ?? undefined);
    const hasBoards = $derived(boardsApi.boards.length > 0);
    const canCreateBoard = $derived(
        draftName.trim().length > 0 && !creatingBoard,
    );

    function selectBoard(boardId: string) {
        const board = boardsApi.boards.find((item) => item.id === boardId);
        if (!board) {
            return;
        }

        boardsApi.setActive(board);
    }

    function openBoard(boardId: string) {
        selectBoard(boardId);
        onOpenBoard(boardId);
    }

    function handleBoardSelection(event: CustomEvent<string>) {
        openBoard(event.detail);
    }

    function handleBoardClick(boardId: string) {
        if (boardId !== selectedBoardId) {
            return;
        }

        openBoard(boardId);
    }

    function openCreateBoardModal() {
        createModalOpen = true;
        createError = null;
    }

    function closeCreateBoardModal(options?: { ignoreDirty?: boolean }) {
        if (!options?.ignoreDirty && isCreateDirty) {
            showCreateDiscard = true;
            return;
        }

        createModalOpen = false;
        showCreateDiscard = false;
    }

    function openSettings() {
        onOpenSettings();
    }

    function handleNameInput(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        draftName = target.value;

        if (createError) {
            createError = null;
        }
    }

    function handleDescriptionInput(event: Event) {
        const target = event.currentTarget as HTMLTextAreaElement;
        draftDescription = target.value;
    }

    async function createBoard() {
        const name = draftName.trim();
        if (!name) {
            createError = "Board name is required.";
            return;
        }

        creatingBoard = true;
        createError = null;

        try {
            const createdBoard = await boardsApi.create({
                name,
                description: draftDescription.trim(),
            });

            closeCreateBoardModal({ ignoreDirty: true });
            onOpenBoard(createdBoard.id);
        } catch (error) {
            createError = String(error);
            creatingBoard = false;
        }
    }

    let loadingMore = $state(false);

    function setupObserver(node: HTMLElement) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (
                    entries[0].isIntersecting &&
                    !loadingMore &&
                    !boardsApi.loading
                ) {
                    void (async () => {
                        loadingMore = true;
                        await boardsApi.loadMore?.();
                        loadingMore = false;
                    })();
                }
            },
            { threshold: 0.1 },
        );

        observer.observe(node);
        return {
            destroy() {
                observer.disconnect();
            },
        };
    }

    $effect(() => {
        if (createModalOpen) {
            return;
        }

        draftName = "";
        draftDescription = "";
        createError = null;
        creatingBoard = false;
    });

    let boardRefs = $state<Record<string, HTMLElement | null>>({});

    function captureRef(node: HTMLElement, boardId: string) {
        boardRefs[boardId] = node.closest(".bx--tile") as HTMLElement;
        return {
            destroy() {
                if (boardRefs[boardId] === node.closest(".bx--tile")) {
                    delete boardRefs[boardId];
                }
            },
        };
    }

    function copyToClipboard(text: string) {
        if (navigator.clipboard) {
            void navigator.clipboard.writeText(text);
        }
    }

    let deleteBoardId = $state<string | null>(null);
    let deleteModalOpen = $state(false);

    let editBoardId = $state<string | null>(null);
    let editModalOpen = $state(false);
    let editDraftName = $state("");
    let editDraftDescription = $state("");
    let editError = $state<string | null>(null);
    let editingBoard = $state(false);
    let showEditDiscard = $state(false);
    let initialEditName = $state("");
    let initialEditDescription = $state("");

    const isEditDirty = $derived(
        editDraftName.trim() !== initialEditName ||
            editDraftDescription.trim() !== initialEditDescription,
    );

    function promptEditBoard(board: {
        id: string;
        name: string;
        description?: string;
    }) {
        editBoardId = board.id;
        initialEditName = board.name;
        initialEditDescription = board.description || "";
        editDraftName = initialEditName;
        editDraftDescription = initialEditDescription;
        editError = null;
        editModalOpen = true;
    }

    function closeEditBoardModal() {
        if (isEditDirty) {
            showEditDiscard = true;
        } else {
            editModalOpen = false;
        }
    }

    async function confirmEditBoard() {
        if (!editBoardId || !editDraftName.trim()) return;

        editingBoard = true;
        editError = null;

        try {
            await boardsApi.rename(
                editBoardId,
                editDraftName.trim(),
                editDraftDescription.trim() || "",
            );
            editModalOpen = false;
        } catch (error) {
            editError = String(error);
        } finally {
            editingBoard = false;
        }
    }

    function forceCloseCreate() {
        draftName = "";
        draftDescription = "";
        showCreateDiscard = false;
        createModalOpen = false;
    }

    function forceCloseEdit() {
        showEditDiscard = false;
        editModalOpen = false;
    }

    function promptDeleteBoard(id: string) {
        deleteBoardId = id;
        deleteModalOpen = true;
    }

    async function confirmDeleteBoard() {
        if (!deleteBoardId) return;
        try {
            await boardsApi.remove(deleteBoardId);
        } catch (error) {
            console.error("Failed to delete board:", error);
        } finally {
            deleteModalOpen = false;
            deleteBoardId = null;
        }
    }

    let archivedModalOpen = $state(false);

    async function promptArchiveBoard(id: string) {
        try {
            await boardsApi.archive(id);
        } catch (error) {
            console.error("Failed to archive board:", error);
        }
    }

    // Listen for create-board events from the command palette / shortcuts
    $effect(() => {
        const handler = () => openCreateBoardModal();
        window.addEventListener("worklog:create-board", handler);
        return () =>
            window.removeEventListener("worklog:create-board", handler);
    });
</script>

<SideNav class="workspace-sidebar" isOpen>
    <SideNavItems>
        <header class="workspace-sidebar-header">
            <small>Boards</small>
            <Button kind="ghost" size="small" onclick={openCreateBoardModal}>
                New board
            </Button>
        </header>

        {#if boardsApi.loading}
            <p class="workspace-sidebar-state" aria-busy="true">
                Loading boards...
            </p>
        {:else if !hasBoards}
            <p class="workspace-sidebar-state">
                No boards yet. Create one to get started.
            </p>
        {:else}
            <TileGroup
                class="workspace-board-group"
                legendText="Workspace boards"
                name="workspace-board"
                selected={selectedBoardId}
                on:select={handleBoardSelection}
            >
                {#each boardsApi.boards as board (board.id)}
                    <RadioTile
                        value={board.id}
                        onclick={() => handleBoardClick(board.id)}
                    >
                        <span
                            class="workspace-board-name"
                            use:captureRef={board.id}>{board.name}</span
                        >
                        {#if board.description}
                            <span class="workspace-board-description">
                                {board.description}
                            </span>
                        {/if}
                    </RadioTile>

                    <ContextMenu
                        target={boardRefs[board.id]
                            ? [boardRefs[board.id]]
                            : []}
                    >
                        <ContextMenuOption
                            labelText="Open Board"
                            icon={Launch}
                            on:click={() => openBoard(board.id)}
                        />
                        <ContextMenuOption
                            labelText="Edit Board"
                            icon={Edit}
                            on:click={() => promptEditBoard(board)}
                        />
                        <ContextMenuOption
                            labelText="Copy Board ID"
                            icon={CopyFile}
                            on:click={() => copyToClipboard(board.id)}
                        />
                        <ContextMenuDivider />
                        <ContextMenuOption
                            labelText="Archive Board"
                            icon={Archive}
                            on:click={() => promptArchiveBoard(board.id)}
                        />
                        <ContextMenuDivider />
                        <ContextMenuOption
                            kind="danger"
                            labelText="Delete Board"
                            icon={TrashCan}
                            on:click={() => promptDeleteBoard(board.id)}
                        />
                    </ContextMenu>
                {/each}

                <!-- Sentinel for loading more boards -->
                <div use:setupObserver class="sentinel"></div>

                {#if loadingMore}
                    <div class="sidebar-loading-more">
                        <InlineLoading description="Loading more..." />
                    </div>
                {/if}
            </TileGroup>
        {/if}
    </SideNavItems>

     <div class="sidebar-bottom">
        {#if isDesktop()}
        <SyncBottomBar />
        {/if}
        <div class="archive-bar">
            <Button
                kind="ghost"
                size="small"
                icon={Archive}
                onclick={() => (archivedModalOpen = true)}
            >
                Archived boards
            </Button>
        </div>
    </div>

    <footer class="workspace-sidebar-footer">
        <Button kind="ghost" size="small" onclick={openSettings}>
            <Settings />
            <span>Settings</span>
        </Button>
    </footer>
</SideNav>

<ArchivedBoardsModal
    bind:open={archivedModalOpen}
    onOpenBoard={(id) => {
        archivedModalOpen = false;
        onOpenBoard(id);
    }}
/>

<ComposedModal
    bind:open={createModalOpen}
    size="sm"
    preventCloseOnClickOutside
    on:close={(e) => {
        if (createModalOpen && isCreateDirty) {
            e.preventDefault();
            showCreateDiscard = true;
        }
    }}
>
    <ModalHeader title="Create board" />

    <ModalBody hasForm>
        <TextInput
            labelText="Name"
            placeholder="Board name"
            bind:value={draftName}
            on:input={handleNameInput}
            maxlength={40}
            invalid={Boolean(createError && !draftName.trim())}
            invalidText="Board name is required."
            data-modal-primary-focus
        />

        <TextArea
            labelText="Description"
            placeholder="Short board description"
            bind:value={draftDescription}
            on:input={handleDescriptionInput}
            on:keydown={(e) => {
                if (e.key === "Enter") e.stopPropagation();
            }}
            rows={4}
            maxlength={180}
        />

        {#if createError && draftName.trim()}
            <p class="workspace-modal-error" role="alert">{createError}</p>
        {/if}
    </ModalBody>

    <ModalFooter>
        <Button
            kind="secondary"
            onclick={() => closeCreateBoardModal()}
            disabled={creatingBoard}
        >
            Cancel
        </Button>
        <Button onclick={createBoard} disabled={!canCreateBoard}>
            {creatingBoard ? "Creating..." : "Create board"}
        </Button>
    </ModalFooter>
</ComposedModal>

<ComposedModal
    bind:open={editModalOpen}
    size="sm"
    preventCloseOnClickOutside
    on:close={(e) => {
        if (editModalOpen && isEditDirty) {
            e.preventDefault();
            showEditDiscard = true;
        }
    }}
>
    <ModalHeader title="Edit board" />

    <ModalBody hasForm>
        <TextInput
            labelText="Name"
            placeholder="Board name"
            bind:value={editDraftName}
            maxlength={40}
            invalid={Boolean(editError && !editDraftName.trim())}
            invalidText="Board name is required."
            data-modal-primary-focus
            on:keydown={(e) => {
                if (e.key === "Enter") e.stopPropagation();
            }}
        />

        <TextArea
            labelText="Description"
            placeholder="Short board description"
            bind:value={editDraftDescription}
            on:keydown={(e) => {
                if (e.key === "Enter") e.stopPropagation();
            }}
            rows={4}
            maxlength={180}
        />

        {#if editError && editDraftName.trim()}
            <p class="workspace-modal-error" role="alert">{editError}</p>
        {/if}
    </ModalBody>

    <ModalFooter>
        <Button
            kind="secondary"
            onclick={closeEditBoardModal}
            disabled={editingBoard}
        >
            Cancel
        </Button>
        <Button
            on:click={confirmEditBoard}
            disabled={!editDraftName.trim() || editingBoard}
        >
            {editingBoard ? "Saving..." : "Save changes"}
        </Button>
    </ModalFooter>
</ComposedModal>

<Modal
    danger
    size="xs"
    bind:open={deleteModalOpen}
    modalHeading="Delete board"
    primaryButtonText="Delete"
    secondaryButtonText="Cancel"
    on:click:button--secondary={() => (deleteModalOpen = false)}
    on:click:button--primary={confirmDeleteBoard}
>
    <p>
        Are you sure you want to delete this board? This action cannot be
        undone.
    </p>
</Modal>

<ComposedModal danger bind:open={showCreateDiscard} size="sm">
    <ModalHeader title="Discard unsaved changes?" />
    <ModalBody>
        <p>
            You have unsaved changes in your new board draft. Are you sure you
            want to discard them?
        </p>
    </ModalBody>
    <ModalFooter>
        <Button kind="secondary" onclick={() => (showCreateDiscard = false)}
            >Continue editing</Button
        >
        <Button kind="danger" onclick={forceCloseCreate}>Discard changes</Button
        >
    </ModalFooter>
</ComposedModal>

<ComposedModal danger bind:open={showEditDiscard} size="sm">
    <ModalHeader title="Discard unsaved changes?" />
    <ModalBody>
        <p>
            You have unsaved changes in your board info. Are you sure you want
            to discard them?
        </p>
    </ModalBody>
    <ModalFooter>
        <Button kind="secondary" onclick={() => (showEditDiscard = false)}
            >Continue editing</Button
        >
        <Button kind="danger" onclick={forceCloseEdit}>Discard changes</Button>
    </ModalFooter>
</ComposedModal>

<style>
    :global(.workspace-sidebar.bx--side-nav) {
        display: flex;
        flex-direction: column;
    }

    :global(.workspace-sidebar .bx--side-nav__items) {
        flex: 1 1 auto;
        overflow-y: auto;
    }

    .workspace-sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cds-spacing-03, 0.5rem);
        padding: var(--cds-spacing-04, 0.75rem);
    }

    .workspace-sidebar-header small {
        font-size: 0.75rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        opacity: 0.8;
    }

    .workspace-sidebar-header :global(.bx--btn) {
        margin: 0;
    }

    .workspace-sidebar-state {
        margin: 0;
        padding: 0 var(--cds-spacing-04, 0.75rem) var(--cds-spacing-04, 0.75rem);
        font-size: 0.875rem;
        opacity: 0.9;
    }

    :global(.workspace-board-group.bx--tile-group) {
        padding: 0 var(--cds-spacing-03, 0.5rem) var(--cds-spacing-04, 0.75rem);
    }

    :global(.workspace-board-group .bx--tile-content) {
        display: grid;
        gap: 0.25rem;
    }

    .workspace-board-name {
        font-size: 0.85rem;
        font-weight: 600;
        line-height: 1.2;
    }

    .workspace-board-description {
        font-size: 0.75rem;
        line-height: 1.3;
        opacity: 0.8;
    }

    :global(.bx--modal-content .bx--form-item:not(:last-child)) {
        margin-bottom: var(--cds-spacing-04, 0.75rem);
    }

    .workspace-modal-error {
        margin: 0;
        color: var(--color-danger, #fa4d56);
        font-size: 0.8rem;
    }

    .workspace-sidebar-footer {
        padding: var(--cds-spacing-03, 0.5rem);
        border-top: 1px solid
            color-mix(
                in srgb,
                var(--color-border-primary, #525252) 45%,
                transparent
            );
    }

    .workspace-sidebar-footer :global(.bx--btn) {
        margin: 0;
        width: 100%;
        justify-content: flex-start;
        gap: var(--cds-spacing-03, 0.5rem);
    }

    .workspace-sidebar-footer :global(.bx--btn svg) {
        flex-shrink: 0;
    }
    .sentinel {
        height: 1px;
        width: 100%;
        pointer-events: none;
    }

    .sidebar-loading-more {
        padding: 0.5rem;
        display: flex;
        justify-content: center;
    }

    /* ── Bottom area (sync + archive) ───────────────────────────────────────── */
    .sidebar-bottom {
        flex-shrink: 0;
    }

    .archive-bar {
        padding: 0 var(--cds-spacing-03, 0.5rem);
        border-top: 1px solid
            color-mix(
                in srgb,
                var(--color-border-primary, #525252) 30%,
                transparent
            );
    }

    .archive-bar :global(.bx--btn) {
        margin: 0;
        width: 100%;
        justify-content: flex-start;
        gap: var(--cds-spacing-03, 0.5rem);
        color: var(--cds-text-02) !important;
        font-size: 0.8125rem;
    }

    .archive-bar :global(.bx--btn:hover) {
        color: var(--cds-text-01) !important;
        background: var(--cds-hover-ui) !important;
    }

    .archive-bar :global(.bx--btn svg) {
        flex-shrink: 0;
    }
</style>
