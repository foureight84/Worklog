<script lang="ts">
    import { goto } from "$app/navigation";
    import {
        Button,
        TextArea,
        TextInput,
        RadioButtonGroup,
        RadioButton,
        ButtonSet,
        Tabs,
        Tab,
        TabContent,
        Toggle,
        Select,
        SelectItem,
        PasswordInput,
        InlineLoading,
        Tag,
    } from "carbon-components-svelte";
    import { useWorkspace } from "$lib/hooks/workspace.svelte";
    import { getDb } from "$lib/db";
    import {
        exportDatabaseWithOptions,
        type ExportOptions,
    } from "$lib/db/export";
    import { importFromFile } from "$lib/db/mappers";
    import { notifications } from "$lib/hooks/notifications.svelte";
    import {
        checkForUpdate,
        RELEASES_URL,
        type UpdateState,
    } from "$lib/updater";
    import type { ExportFormat, ExportMode } from "$lib/db/mappers";
    import { useSyncConfig } from "$lib/sync/sync-config.svelte";
      import type { SyncStatus } from "$lib/sync/types";
    import { useAppZoom } from "$lib/hooks/app-zoom.svelte";
    import ZoomControls from "$lib/components/app/layout/workspace/zoom-controls.svelte";
    import {
        Settings,
        View,
        DataBase,
        Cloud,
        Code,
        Search,
        ArrowLeft,
        Renew,
        MagicWand,
        ColorPalette,
        WarningAlt,
        Launch,
        TrashCan,
        Add,
        Checkmark,
        Close,
        CheckmarkOutline,
    } from "carbon-icons-svelte";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import { seedDatabase, seedLazyLoadingTest } from "$lib/db/seed";

    type SettingsCategory =
        | "general"
        | "appearance"
        | "customization"
        | "data"
        | "sync"
        | "debug"
        | "advanced";
    let activeCategory = $state<SettingsCategory>("general");

    const categories = [
        { id: "general", label: "General", icon: Settings },
        { id: "appearance", label: "Appearance", icon: View },
        { id: "customization", label: "Customization", icon: MagicWand },
        { id: "data", label: "Data Management", icon: DataBase },
        { id: "sync", label: "Synchronization", icon: Cloud },
        // { id: "debug", label: "Debug", icon: Code },
        { id: "advanced", label: "Advanced", icon: Settings },
    ] as const;
    let searchQuery = $state("");

    const workspace = useWorkspace();
    const { ticketTypesApi } = getWorkspaceShellContext();
    const syncConfig = useSyncConfig();
    const appZoom = useAppZoom();

    const workspaceName = $derived(workspace.meta?.name ?? "Workspace");
    const workspacePath = $derived(workspace.path ?? "Not available");
    const workspaceStatus = $derived(workspace.status);
    const schemaVersion = $derived(workspace.meta?.schema_version ?? "Unknown");

    let exportFormat = $state<ExportFormat>("json");
    let exportMode = $state<ExportMode>("single-file");

    // ── Updater State ─────────────────────────────────────────────────────
    let updateState = $state<UpdateState>({
        status: "idle",
        info: null,
        progress: { downloaded: 0, contentLength: 0, percent: 0 },
        errorMessage: null,
    });

    // ── Customization State ───────────────────────────────────────────────
    let newTypeName = $state("");
    let newTypeColor = $state("#525252");
    let editingTypeId = $state<string | null>(null);
    let editingTypeName = $state("");
    let editingTypeColor = $state("");

    async function handleAddType() {
        if (!newTypeName.trim()) return;
        await ticketTypesApi.create({
            name: newTypeName.trim(),
            color: newTypeColor,
            is_default: ticketTypesApi.types.length === 0,
        });
        newTypeName = "";
    }

    async function handleUpdateType(id: string) {
        if (!editingTypeName.trim()) return;
        await ticketTypesApi.update(id, {
            name: editingTypeName.trim(),
            color: editingTypeColor,
        });
        editingTypeId = null;
    }

    async function handleDeleteType(id: string) {
        await ticketTypesApi.remove(id);
    }

    async function handleSetDefaultType(id: string) {
        await ticketTypesApi.update(id, { is_default: true });
    }

    // ── Sync state ─────────────────────────────────────────────────────────
    let syncPrimaryUrl = $state("");
    let syncAuthToken = $state("");
    let syncAutoSync = $state(false);
    let syncLoading = $state(false);
    let syncLoadingMessage = $state("");
    let generatedToken = $state<string | null>(null);

    // Load sync config on mount
    $effect(() => {
        if (workspace.status === "ready" && workspace.path) {
            void loadSyncConfig();
        }
    });

    async function loadSyncConfig() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            await syncConfig.load(db);
            syncPrimaryUrl = syncConfig.config.primary_url;
            syncAuthToken = syncConfig.config.auth_token;
            syncAutoSync = syncConfig.config.auto_sync;
        } catch (e) {
            console.error("Failed to load sync config", e);
        }
    }

    async function saveSyncConfig() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            syncConfig.config = {
                primary_url: syncPrimaryUrl,
                auth_token: syncAuthToken,
                auto_sync: syncAutoSync,
                last_synced_at: syncConfig.config.last_synced_at,
            };
            await syncConfig.save(db);
            notifications.add({
                kind: "success",
                title: "Sync Settings Saved",
                subtitle: "Your sync configuration has been updated.",
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: "Save Failed",
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleGenerateToken() {
        try {
            // Generate a unique client ID for the desktop app
            const clientId = crypto.randomUUID();
            const resp = await fetch("/api/sync/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            const data = await resp.json();
            if (data.token) {
                generatedToken = data.token;
                notifications.add({
                    kind: "success",
                    title: "Token Generated",
                    subtitle: "Copy this token into your desktop client.",
                    timeout: 5000,
                });
            } else {
                notifications.add({
                    kind: "error",
                    title: "Token Generation Failed",
                    subtitle: data.error || "Unknown error",
                    timeout: 5000,
                });
            }
        } catch (error) {
            notifications.add({
                kind: "error",
                title: "Token Generation Failed",
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    // ── Navigation ─────────────────────────────────────────────────────────
    function goToBoards() {
        void goto("/workspace");
    }

    function refreshWorkspaceState() {
        void workspace.init();
    }

    // ── Export / Import ────────────────────────────────────────────────────
    async function handleExport() {
        if (workspace.status !== "ready" || !workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            const options: ExportOptions = {
                format: exportFormat,
                mode: exportMode,
            };
            const success = await exportDatabaseWithOptions(db, options);
            if (success) {
                notifications.add({
                    kind: "success",
                    title: "Export Successful",
                    subtitle: `Workspace exported as ${exportFormat.toUpperCase()} (${exportMode}).`,
                    timeout: 3000,
                });
            }
        } catch (error) {
            console.error("Failed to export data", error);
            notifications.add({
                kind: "error",
                title: "Export Failed",
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleImport() {
        if (workspace.status !== "ready" || !workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            const result = await importFromFile(db, "merge");
            if (result) {
                notifications.add({
                    kind: "success",
                    title: "Import Successful",
                    subtitle: `Created ${result.boardsCreated} boards, ${result.ticketsCreated} tickets. Updated ${result.ticketsUpdated} tickets.`,
                    timeout: 5000,
                });
                window.location.reload();
            }
        } catch (error) {
            console.error("Failed to import data", error);
            notifications.add({
                kind: "error",
                title: "Import Failed",
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleCheckForUpdates() {
        await checkForUpdate((s) => {
            updateState = s;
        });
    }

    async function openReleasesPage() {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(RELEASES_URL);
    }

    function formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    // ── Derived ────────────────────────────────────────────────────────────
    const syncConfigured = $derived(
        syncPrimaryUrl.length > 0,
    );
    const syncStatusLabel = $derived.by(() => {
        const s = syncConfig.status;
        if (s === "connected") return "Connected";
        if (s === "syncing") return "Syncing...";
        if (s === "disconnected") return "Disconnected";
        return s;
    });
    const syncStatusColor = $derived.by(
        (): "green" | "red" | "blue" | "warm-gray" => {
            const s = syncConfig.status;
            if (s === "connected") return "green";
            if (s === "syncing") return "blue";
            if (s === "disconnected") return "red";
            return "warm-gray";
        },
    );

    async function handleSeedPerformance() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            notifications.add({
                kind: "info",
                title: "Seeding...",
                subtitle:
                    "Creating 200 performance test tickets. This may take a moment.",
                timeout: 3000,
            });
            await seedLazyLoadingTest(db);
            notifications.add({
                kind: "success",
                title: "Seeding Complete",
                subtitle: "Performance test board and 200 tickets created.",
                timeout: 5000,
            });
            void workspace.init(); // Refresh workspace state
        } catch (e) {
            notifications.add({
                kind: "error",
                title: "Seeding Failed",
                subtitle: String(e),
                timeout: 5000,
            });
        }
    }

    // @ts-ignore
    const version = __APP_VERSION__;
    function matchesSearch(text: string) {
        if (!searchQuery) return true;
        return text.toLowerCase().includes(searchQuery.toLowerCase());
    }
</script>

<div class="settings-layout">
    <!-- Sidebar -->
    <aside class="settings-sidebar">
        <header class="sidebar-header">
            <Button
                kind="ghost"
                iconDescription="Back"
                icon={ArrowLeft}
                onclick={goToBoards}
            />
            <span>Settings</span>
        </header>

        <nav class="sidebar-nav">
            {#each categories as category}
                <button
                    class="nav-item"
                    class:active={activeCategory === category.id}
                    onclick={() => (activeCategory = category.id)}
                >
                    <category.icon size={20} />
                    <span>{category.label}</span>
                </button>
            {/each}
        </nav>

        <footer class="sidebar-footer">
            <div class="app-version">
                v{version}
            </div>
            <Button
                kind="ghost"
                size="small"
                icon={Renew}
                onclick={refreshWorkspaceState}
            >
                Refresh
            </Button>
        </footer>
    </aside>

    <!-- Main Content -->
    <main class="settings-content">
        <header class="content-header">
            <div class="search-container">
                <Search size={16} />
                <input
                    type="text"
                    placeholder="Search settings..."
                    bind:value={searchQuery}
                />
            </div>
            <div class="breadcrumbs">
                Settings &gt; {categories.find((c) => c.id === activeCategory)
                    ?.label}
            </div>
        </header>

        <div class="content-body">
            <!-- ── General Category ────────────────────────────────────── -->
            {#if activeCategory === "general"}
                <div class="category-view">
                    {#if matchesSearch("Workspace Information Database schema version Worklog version")}
                        <section class="settings-section">
                            <h2>Workspace Information</h2>
                            <div class="settings-grid">
                                <TextInput
                                    id="workspace-name"
                                    labelText="Workspace name"
                                    value={workspaceName}
                                    readonly
                                />
                                <TextInput
                                    id="workspace-status"
                                    labelText="Workspace status"
                                    value={workspaceStatus}
                                    readonly
                                />
                                <TextInput
                                    id="workspace-schema"
                                    labelText="Database schema version"
                                    value={schemaVersion}
                                    readonly
                                />
                                <TextArea
                                    id="workspace-path"
                                    labelText="Workspace path"
                                    value={workspacePath}
                                    rows={3}
                                    readonly
                                />
                                <TextInput
                                    id="app-version"
                                    labelText="Worklog version"
                                    value={version}
                                    readonly
                                />
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Updates Check for updates Application")}
                        <section class="settings-section">
                            <h2>Application Updates</h2>
                            <p class="section-desc">
                                Check for updates and relaunch after the install
                                completes.
                            </p>

                            <div class="updater-card">
                                {#if updateState.status === "idle"}
                                    <!-- Idle: show check button -->
                                    <div class="updater-idle">
                                        <div class="updater-current">
                                            <span class="updater-label"
                                                >Current version</span
                                            >
                                            <span class="updater-version"
                                                >v{version}</span
                                            >
                                        </div>
                                        <Button
                                            kind="primary"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            Check for updates
                                        </Button>
                                    </div>
                                {:else if updateState.status === "checking"}
                                    <!-- Checking: spinner -->
                                    <div class="updater-status-row">
                                        <InlineLoading
                                            description="Checking for updates…"
                                        />
                                    </div>
                                {:else if updateState.status === "no-update"}
                                    <!-- No update: success state -->
                                    <div
                                        class="updater-status-row updater-success"
                                    >
                                        <CheckmarkOutline size={20} />
                                        <div class="updater-status-text">
                                            <strong>You're up to date!</strong>
                                            <span
                                                >Worklog v{version} is the latest
                                                version.</span
                                            >
                                        </div>
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            Check again
                                        </Button>
                                    </div>
                                {:else if updateState.status === "update-available"}
                                    <!-- Update available: show info + manual download button -->
                                    <div class="updater-available">
                                        <div class="updater-available-header">
                                            <div class="updater-version-badge">
                                                <Tag type="green" size="sm"
                                                    >New version</Tag
                                                >
                                                <span
                                                    class="updater-new-version"
                                                    >v{updateState.info
                                                        ?.version}</span
                                                >
                                            </div>
                                            {#if updateState.info?.date}
                                                <span class="updater-date">
                                                    {new Date(
                                                        updateState.info.date,
                                                    ).toLocaleDateString(
                                                        undefined,
                                                        {
                                                            year: "numeric",
                                                            month: "short",
                                                            day: "numeric",
                                                        },
                                                    )}
                                                </span>
                                            {/if}
                                        </div>
                                        {#if updateState.info?.body}
                                            <div class="updater-notes">
                                                <span
                                                    class="updater-notes-label"
                                                    >Release notes</span
                                                >
                                                <p class="updater-notes-body">
                                                    {updateState.info.body}
                                                </p>
                                            </div>
                                        {/if}
                                        <div class="updater-actions">
                                            <Button
                                                kind="primary"
                                                icon={Launch}
                                                onclick={openReleasesPage}
                                            >
                                                Go to Download Page
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                onclick={() => {
                                                    updateState = {
                                                        status: "idle",
                                                        info: null,
                                                        progress: {
                                                            downloaded: 0,
                                                            contentLength: 0,
                                                            percent: 0,
                                                        },
                                                        errorMessage: null,
                                                    };
                                                }}
                                            >
                                                Dismiss
                                            </Button>
                                        </div>
                                    </div>
                                {:else if updateState.status === "install-failed"}
                                    <!-- Install failed: offer manual download -->
                                    <div class="updater-install-failed">
                                        <div
                                            class="updater-status-row updater-error"
                                        >
                                            <WarningAlt size={20} />
                                            <div class="updater-status-text">
                                                <strong
                                                    >Auto-update unavailable</strong
                                                >
                                                <span
                                                    >{updateState.errorMessage}</span
                                                >
                                            </div>
                                        </div>
                                        <div class="updater-actions">
                                            <Button
                                                kind="primary"
                                                icon={Launch}
                                                onclick={openReleasesPage}
                                            >
                                                Download manually
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                onclick={() => {
                                                    updateState = {
                                                        status: "idle",
                                                        info: null,
                                                        progress: {
                                                            downloaded: 0,
                                                            contentLength: 0,
                                                            percent: 0,
                                                        },
                                                        errorMessage: null,
                                                    };
                                                }}
                                            >
                                                Dismiss
                                            </Button>
                                        </div>
                                    </div>
                                {:else if updateState.status === "error"}
                                    <!-- Error state -->
                                    <div
                                        class="updater-status-row updater-error"
                                    >
                                        <WarningAlt size={20} />
                                        <div class="updater-status-text">
                                            <strong>Update failed</strong>
                                            <span
                                                >{updateState.errorMessage ??
                                                    "An unknown error occurred."}</span
                                            >
                                        </div>
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            Retry
                                        </Button>
                                    </div>
                                {/if}
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Appearance Category ────────────────────────────────── -->
            {#if activeCategory === "appearance"}
                <div class="category-view">
                    {#if matchesSearch("Application Zoom global scale")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>Application Zoom</h2>
                                <Tag type="teal" size="sm">Experimental</Tag>
                            </div>
                            <p class="section-desc">
                                Adjust the global scale of the application
                                interface. You can also use <kbd>Ctrl</kbd> +
                                <kbd>+</kbd> and <kbd>Ctrl</kbd> + <kbd>-</kbd>
                                anywhere.
                            </p>
                            <div class="control-box">
                                <ZoomControls />
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Customization Category ──────────────────────────────── -->
            {#if activeCategory === "customization"}
                <div class="category-view">
                    {#if matchesSearch("Ticket Types Customization Colors Icons")}
                        <section class="settings-section">
                            <h2>Ticket Types</h2>
                            <p class="section-desc">
                                Manage the types of tickets available in your
                                workspace. Each type can have its own color and
                                icon.
                            </p>

                            <div class="type-management-list">
                                {#each ticketTypesApi.types as type}
                                    <div
                                        class="type-item"
                                        class:is-default={type.is_default}
                                    >
                                        {#if editingTypeId === type.id}
                                            <div class="type-edit-form">
                                                <TextInput
                                                    size="sm"
                                                    bind:value={editingTypeName}
                                                />
                                                <input
                                                    type="color"
                                                    bind:value={
                                                        editingTypeColor
                                                    }
                                                    class="color-input-sm"
                                                />
                                                <Button
                                                    size="small"
                                                    kind="ghost"
                                                    icon={Checkmark}
                                                    iconDescription="Save"
                                                    onclick={() =>
                                                        handleUpdateType(
                                                            type.id,
                                                        )}
                                                />
                                                <Button
                                                    size="small"
                                                    kind="ghost"
                                                    icon={Close}
                                                    iconDescription="Cancel"
                                                    onclick={() =>
                                                        (editingTypeId = null)}
                                                />
                                            </div>
                                        {:else}
                                            <div class="type-display">
                                                <div
                                                    class="type-color-dot"
                                                    style="background-color: {type.color}"
                                                ></div>
                                                <span class="type-name"
                                                    >{type.name}</span
                                                >
                                                {#if type.is_default}
                                                    <Tag size="sm" type="blue"
                                                        >Default</Tag
                                                    >
                                                {/if}
                                            </div>
                                            <div class="type-actions">
                                                {#if !type.is_default}
                                                    <Button
                                                        size="small"
                                                        kind="ghost"
                                                        onclick={() =>
                                                            handleSetDefaultType(
                                                                type.id,
                                                            )}
                                                    >
                                                        Set Default
                                                    </Button>
                                                {/if}
                                                <Button
                                                    size="small"
                                                    kind="ghost"
                                                    icon={Code}
                                                    iconDescription="Edit"
                                                    onclick={() => {
                                                        editingTypeId = type.id;
                                                        editingTypeName =
                                                            type.name;
                                                        editingTypeColor =
                                                            type.color;
                                                    }}
                                                />
                                                <Button
                                                    size="small"
                                                    kind="ghost"
                                                    icon={TrashCan}
                                                    iconDescription="Delete"
                                                    onclick={() =>
                                                        handleDeleteType(
                                                            type.id,
                                                        )}
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>

                            <div class="add-type-form">
                                <h3>Add New Type</h3>
                                <div class="add-type-inputs">
                                    <TextInput
                                        labelText="Name"
                                        placeholder="e.g. Research"
                                        bind:value={newTypeName}
                                    />
                                    <div class="color-picker-group">
                                        <label for="new-type-color">Color</label
                                        >
                                        <input
                                            id="new-type-color"
                                            type="color"
                                            bind:value={newTypeColor}
                                        />
                                    </div>
                                    <Button
                                        kind="secondary"
                                        icon={Add}
                                        onclick={handleAddType}
                                    >
                                        Add Type
                                    </Button>
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Data Category ──────────────────────────────────────── -->
            {#if activeCategory === "data"}
                <div class="category-view">
                    {#if matchesSearch("Export Import Data Management JSON CSV")}
                        <section class="settings-section">
                            <h2>Export / Import</h2>
                            <p class="section-desc">
                                Export or import your workspace data as JSON or
                                CSV.
                            </p>

                            <div class="data-controls">
                                <div class="data-control-group">
                                    <RadioButtonGroup
                                        legendText="Format"
                                        bind:selected={exportFormat}
                                    >
                                        <RadioButton
                                            labelText="JSON"
                                            value="json"
                                        />
                                        <RadioButton
                                            labelText="CSV"
                                            value="csv"
                                        />
                                    </RadioButtonGroup>
                                </div>

                                <div class="data-control-group">
                                    <RadioButtonGroup
                                        legendText="Mode"
                                        bind:selected={exportMode}
                                    >
                                        <RadioButton
                                            labelText="Single file"
                                            value="single-file"
                                        />
                                        <RadioButton
                                            labelText="Per-board folder"
                                            value="folder"
                                        />
                                    </RadioButtonGroup>
                                </div>
                            </div>

                            <ButtonSet>
                                <Button kind="primary" onclick={handleExport}>
                                    Export
                                </Button>
                                <Button kind="tertiary" onclick={handleImport}>
                                    Import
                                </Button>
                            </ButtonSet>
                        </section>
                    {/if}
                </div>
            {/if}

           <!-- ── Sync Category ──────────────────────────────────────── -->
            {#if activeCategory === "sync"}
                <div class="category-view">
                    {#if matchesSearch("Git Synchronization Personal Access Token GitHub Auto-sync Server URL Auth Token")}
                        <section class="settings-section">
                            <div class="header-with-status">
                                <div class="header-with-tag">
                                    <h2>Synchronization</h2>
                                </div>
                                <Tag type={syncStatusColor} size="sm"
                                    >{syncStatusLabel}</Tag
                                >
                            </div>
                            <p class="section-desc">
                                Connect desktop clients to this server via libsql sync.
                            </p>

                            <div class="sync-form">
                                <TextInput
                                    id="sync-primary-url"
                                    labelText="Server URL"
                                    placeholder="http://your-server:8080"
                                    bind:value={syncPrimaryUrl}
                                />

                                <PasswordInput
                                    id="sync-auth-token"
                                    labelText="Auth Token"
                                    placeholder="Paste JWT token from webapp settings"
                                    bind:value={syncAuthToken}
                                />

                                <div class="sync-options">
                                    <Toggle
                                        id="sync-auto-sync"
                                        labelText="Auto-sync"
                                        labelA="Off"
                                        labelB="On"
                                        bind:toggled={syncAutoSync}
                                    />
                                </div>

                                {#if syncConfig.config.last_synced_at}
                                    <TextInput
                                        id="sync-last-synced"
                                        labelText="Last synced"
                                        value={new Date(
                                            syncConfig.config.last_synced_at,
                                        ).toLocaleString()}
                                        readonly
                                    />
                                {/if}
                            </div>

                            <div class="actions-group">
                                <Button
                                    kind="primary"
                                    onclick={saveSyncConfig}
                                >
                                    Save Configuration
                                </Button>

                                <div class="manual-actions">
                                    <h3>Desktop Token</h3>
                                    <p class="section-desc">
                                        Generate a token for desktop clients to authenticate with this server.
                                    </p>
                                    <Button
                                        kind="tertiary"
                                        onclick={handleGenerateToken}
                                    >
                                        Generate New Token
                                    </Button>
                                    {#if generatedToken}
                                        <div class="token-display">
                                            <code>{generatedToken}</code>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                onclick={() => navigator.clipboard.writeText(generatedToken!)}
                                            >
                                                Copy
                                            </Button>
                                        </div>
                                        <p class="section-desc">
                                            Paste this into the Auth Token field on each desktop client.
                                        </p>
                                    {/if}
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Debug Category ────────────────────────────────────── -->
            {#if activeCategory === "debug"}
                <div class="category-view">
                    {#if matchesSearch("Performance Testing Seeding Lazy Loading")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>Performance Testing</h2>
                                <Tag type="magenta" size="sm">Debug Only</Tag>
                            </div>
                            <p class="section-desc">
                                Tools to test application performance with large
                                datasets.
                            </p>

                            <div class="debug-card">
                                <h3>Seed Large Board</h3>
                                <p>
                                    Create a new board named "Performance Test
                                    Board" with 200 tickets (50 per status).
                                    This is useful for verifying lazy loading,
                                    infinite scroll, and deferred rendering.
                                </p>
                                <div class="debug-actions">
                                    <Button
                                        kind="tertiary"
                                        icon={MagicWand}
                                        onclick={handleSeedPerformance}
                                    >
                                        Seed 200 Tickets
                                    </Button>
                                </div>
                            </div>

                            <div class="debug-card" style="margin-top: 1.5rem;">
                                <h3>How to Verify Lazy Loading</h3>
                                <ul class="debug-guide">
                                    <li>
                                        <strong>Infinite Scroll:</strong> Open the
                                        "Performance Test Board". Scroll down any
                                        column. You should see an "Inline Loading"
                                        spinner briefly at the bottom before more
                                        tickets appear.
                                    </li>
                                    <li>
                                        <strong>Deferred Rendering:</strong> Open
                                        the browser/Tauri inspector (F12). Look at
                                        the DOM for tickets far down the list. Their
                                        body content should be empty (skeleton) until
                                        you scroll near them.
                                    </li>
                                    <li>
                                        <strong>Network/DB Activity:</strong> Observe
                                        the database logs or debug console to see
                                        paginated SQL queries (LIMIT/OFFSET) being
                                        executed as you scroll.
                                    </li>
                                </ul>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Advanced Category ──────────────────────────────────── -->
            {#if activeCategory === "advanced"}
                <div class="category-view">
                    {#if matchesSearch("Developer Tools Experimental Advanced Diagnostics")}
                        <section class="settings-section">
                            <h2>Developer Tools</h2>
                            <p class="section-desc">
                                Advanced tools for troubleshooting and database
                                diagnostics.
                            </p>
                            <div class="advanced-grid">
                                <Button
                                    kind="ghost"
                                    onclick={refreshWorkspaceState}
                                >
                                    Force State Re-init
                                </Button>
                                <p class="help-text">
                                    Re-scans the workspace directory and reloads
                                    all board metadata.
                                </p>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}
        </div>
    </main>
</div>

<style>
    .settings-layout {
        height: 100vh;
        display: flex;
        overflow: hidden;
        background: var(--cds-ui-01);
    }

    /* ── Sidebar ───────────────────────────────────────────────────────── */
    .settings-sidebar {
        width: 260px;
        flex-shrink: 0;
        /* background: var(--cds-ui-02); */
        border-right: 1px solid var(--cds-ui-03);
        display: flex;
        flex-direction: column;
    }

    .sidebar-header {
        height: 48px;
        display: flex;
        align-items: center;
        padding-left: 0.5rem;
        gap: 0.5rem;
        font-weight: 600;
        font-size: 0.875rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .sidebar-nav {
        flex: 1;
        padding: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.75rem;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--cds-text-secondary);
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.1s ease;
        text-align: left;
    }

    .nav-item:hover {
        background: var(--cds-ui-03);
        color: var(--cds-text-primary);
    }

    .nav-item.active {
        background: var(--cds-interactive-01);
        color: white;
        font-weight: 500;
    }

    .sidebar-footer {
        padding: 1rem;
        border-top: 1px solid var(--cds-ui-03);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .app-version {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        font-family: var(--cds-code-01-font-family);
    }

    /* ── Main Content ──────────────────────────────────────────────────── */
    .settings-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .content-header {
        padding: 1.5rem 2rem;
        background: var(--cds-ui-01);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .search-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: var(--cds-field-01);
        border: 1px solid var(--cds-ui-03);
        padding: 0.5rem 0.75rem;
        border-radius: 4px;
        max-width: 600px;
    }

    .search-container input {
        border: none;
        background: transparent;
        color: var(--cds-text-primary);
        font-size: 0.875rem;
        flex: 1;
        outline: none;
    }

    .breadcrumbs {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .content-body {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
    }

    .category-view {
        max-width: 800px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 3rem;
    }

    .settings-section {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .settings-section h2 {
        font-size: 1.25rem;
        font-weight: 400;
        margin: 0;
    }

    .settings-section h3 {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0;
    }

    .section-desc {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        margin: -0.75rem 0 0.5rem 0;
        max-width: 600px;
    }

    .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
    }

    .control-box {
        background: var(--cds-ui-02);
        padding: 1.5rem;
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
    }

    .header-with-tag,
    .header-with-status {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .header-with-status {
        justify-content: space-between;
    }

    .data-controls {
        display: flex;
        gap: 3rem;
        padding: 1rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .sync-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .sync-options {
        display: flex;
        align-items: flex-end;
        gap: 2rem;
        padding: 1rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .actions-group {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        margin-top: 1rem;
    }

    .manual-actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        border-top: 1px solid var(--cds-ui-03);
        background: var(--cds-ui-02);
        border-radius: 0 0 4px 4px;
    }

    .advanced-grid {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 1.5rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .help-text {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
        margin: 0;
    }

    /* ── Customization Category ────────────────────────────────────────── */
    .type-management-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: var(--cds-ui-02);
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
    }

    .type-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        background: var(--cds-ui-01);
        border-radius: 4px;
        border: 1px solid transparent;
        transition: all 0.1s ease;
    }

    .type-item:hover {
        border-color: var(--cds-ui-03);
    }

    .type-item.is-default {
        border-left: 4px solid var(--cds-interactive-01);
    }

    .type-display,
    .type-edit-form {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex: 1;
    }

    .type-color-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .type-name {
        font-size: 0.875rem;
        color: var(--cds-text-primary);
        font-weight: 500;
    }

    .type-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .color-input-sm {
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
    }

    .add-type-form {
        margin-top: 1rem;
        padding: 1.5rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .add-type-inputs {
        display: flex;
        align-items: flex-end;
        gap: 1.5rem;
    }

    .color-picker-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .color-picker-group label {
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
    }

    .color-picker-group input {
        width: 40px;
        height: 40px;
        padding: 0;
        border: 1px solid var(--cds-ui-03);
        background: var(--cds-ui-01);
        border-radius: 4px;
        cursor: pointer;
    }

    /* ── Updater Card ──────────────────────────────────────────────────── */
    .updater-card {
        background: var(--cds-ui-02);
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        padding: 1.5rem;
        transition: border-color 0.15s ease;
    }

    .updater-idle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
    }

    .updater-current {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .updater-label {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .updater-version {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--cds-text-primary);
        font-family: var(--cds-code-01-font-family);
    }

    .updater-status-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .updater-status-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .updater-status-text strong {
        font-size: 0.875rem;
        color: var(--cds-text-primary);
    }

    .updater-status-text span {
        font-size: 0.8125rem;
        color: var(--cds-text-secondary);
    }

    .updater-success {
        color: var(--cds-support-success, #24a148);
    }

    .updater-error {
        color: var(--cds-support-error, #da1e28);
    }

    .updater-available {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    .updater-available-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .updater-version-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .updater-new-version {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--cds-text-primary);
        font-family: var(--cds-code-01-font-family);
    }

    .updater-date {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
    }

    .updater-notes {
        background: var(--cds-ui-01);
        border: 1px solid var(--cds-ui-03);
        border-radius: 4px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .updater-notes-label {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .updater-notes-body {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        margin: 0;
        line-height: 1.5;
        white-space: pre-wrap;
    }

    .updater-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .updater-install-failed {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    /* ── Debug Category ────────────────────────────────────────────────── */
    .debug-card {
        background: var(--cds-ui-02);
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .debug-card h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--cds-text-primary);
        margin: 0;
    }

    .debug-card p {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        line-height: 1.5;
        margin: 0;
    }

    .debug-actions {
        display: flex;
        justify-content: flex-start;
        padding-top: 0.5rem;
    }

    .debug-guide {
        list-style-type: disc;
        padding-left: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .debug-guide li {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        line-height: 1.5;
    }

    .debug-guide li strong {
        color: var(--cds-text-primary);
        display: block;
        margin-bottom: 0.125rem;
    }
</style>
