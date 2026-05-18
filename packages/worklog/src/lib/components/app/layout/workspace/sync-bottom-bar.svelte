<script lang="ts">
    import {
        Checkmark,
        WarningAltFilled,
        CloudUpload,
    } from "carbon-icons-svelte";
    import { Button } from "carbon-components-svelte";

    import { useSyncConfig } from "$lib/sync/sync-config.svelte";

    const syncConfig = useSyncConfig();

    const isSyncEnabled = $derived(
        !!syncConfig.config.primary_url,
    );
    const status = $derived(syncConfig.status);
    const isWorking = $derived(status === 'syncing');

    function formatLastSynced(dateStr: string | null) {
        if (!dateStr) return "Never";
        const date = new Date(dateStr);
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function getStatusLabel() {
        switch (status) {
            case 'connected': return "Connected";
            case 'disconnected': return "Disconnected";
            case 'syncing': return "Syncing...";
            default: return "Unknown";
        }
    }
</script>

<div class="sync-bar" class:is-syncing={isWorking}>
    {#if !isSyncEnabled}
        <div class="sync-info">
            <div class="status-icon">
                <span class="dot dot-gray"></span>
            </div>
            <div class="status-text">
                <span class="label">Sync not configured</span>
                <span class="subtext">Setup in settings</span>
            </div>
        </div>
    {:else}
        <div class="sync-info">
            <div class="status-icon">
                {#if isWorking}
                    <div class="spinner"></div>
                {:else if status === 'connected'}
                    <Checkmark size={16} class="status-icon-connected" />
                {:else}
                    <WarningAltFilled size={16} class="status-icon-disconnected" />
                {/if}
            </div>
            <div class="status-text">
                <span class="label">{getStatusLabel()}</span>
                <span class="subtext"
                    >Last sync: {formatLastSynced(
                        syncConfig.config.last_synced_at,
                    )}</span
                >
            </div>
        </div>

        <div class="sync-actions">
            <Button
                kind="ghost"
                size="small"
                icon={CloudUpload}
                iconDescription="Sync now"
                tooltipPosition="top"
                tooltipAlignment="end"
                disabled={isWorking}
            />
        </div>
    {/if}
</div>

<style>
    .sync-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        background: var(--cds-ui-01);
        border-top: 1px solid var(--cds-ui-03);
        font-family: var(--cds-label-01-font-family);
        transition: background 0.2s ease;
    }

    .sync-bar.is-syncing {
        background: color-mix(
            in srgb,
            var(--cds-interactive-01) 5%,
            var(--cds-ui-01)
        );
    }

    .sync-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        overflow: hidden;
    }

    .status-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--cds-text-02);
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }

    .dot-gray {
        background: var(--cds-text-03);
        opacity: 0.5;
    }

    .status-text {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
        min-width: 0;
    }

    .label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--cds-text-01);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtext {
        font-size: 0.625rem;
        color: var(--cds-text-03);
    }

    .sync-actions {
        display: flex;
        gap: 0.25rem;
    }

    :global(.sync-actions .bx--btn--ghost) {
        color: var(--cds-text-02) !important;
        padding: 4px !important;
        min-height: 28px !important;
        width: 28px !important;
    }

    :global(.sync-actions .bx--btn--ghost:hover) {
        color: var(--cds-interactive-01) !important;
        background: var(--cds-ui-03) !important;
    }

    .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--cds-interactive-01);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
