<script lang="ts">
    import {
        Close,
        Maximize,
        Minimize,
        Settings,
        Subtract,
        Asleep,
        LightFilled,
        Renew,
        Search,
    } from "carbon-icons-svelte";

    import {
        Header,
        HeaderUtilities,
        Button,
        ImageLoader,
        SkipToContent,
    } from "carbon-components-svelte";

    import { Theme } from "carbon-components-svelte";
    import { useSyncConfig } from "$lib/sync/sync-config.svelte";

    type WindowControlAction = "minimize" | "toggle-maximize" | "close";

    interface AppToolbarProps {
        showSettings?: boolean;
        onOpenSettings?: () => void;
        onOpenPalette?: () => void;
    }

    const noop = () => {};

    let {
        showSettings = false,
        onOpenSettings = noop,
        onOpenPalette = noop,
    }: AppToolbarProps = $props();

    let isMaximized = $state(false);

    const runWindowControl = async (action: WindowControlAction) => {
        try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const appWindow = getCurrentWindow();

            if (action === "minimize") {
                await appWindow.minimize();
                return;
            }

            if (action === "toggle-maximize") {
                if (await appWindow.isMaximized()) {
                    await appWindow.unmaximize();
                } else {
                    await appWindow.maximize();
                }

                isMaximized = await appWindow.isMaximized();
                return;
            }

            await appWindow.close();
        } catch (error) {
            console.error("Window control action failed", action, error);
        }
    };

    $effect(() => {
        let unlistenResize: (() => void) | undefined;
        let isAlive = true;

        (async () => {
            try {
                const { getCurrentWindow } = await import(
                    "@tauri-apps/api/window"
                );
                const appWindow = getCurrentWindow();

                isMaximized = await appWindow.isMaximized();
                unlistenResize = await appWindow.onResized(async () => {
                    if (!isAlive) {
                        return;
                    }

                    isMaximized = await appWindow.isMaximized();
                });
            } catch (error) {
                console.error(
                    "Unable to subscribe to window state changes",
                    error,
                );
            }
        })();

        return () => {
            isAlive = false;
            unlistenResize?.();
        };
    });

    type ThemeName = "g10" | "g100";
    let theme = $state<ThemeName>("g10");
    function toggleTheme() {
        if (theme == "g100") {
            theme = "g10";
            return;
        }
        theme = "g100";
    }

    let logo = $derived(
        theme === "g100" ? "/logo-white.png" : "/logo-black.png",
    );

    // Listen for theme toggle events from the command palette / shortcuts
    $effect(() => {
        const handler = () => toggleTheme();
        window.addEventListener("worklog:toggle-theme", handler);
        return () =>
            window.removeEventListener("worklog:toggle-theme", handler);
    });

    // @ts-ignore
    const version = __APP_VERSION__;

    const syncConfig = useSyncConfig();

    const formattedSyncTime = $derived.by(() => {
        if (syncConfig.status === 'syncing') return "Syncing...";
        if (syncConfig.status === 'connected') return "Connected";
        if (syncConfig.status === 'disconnected') return "Disconnected";
        return "";
    });
</script>

<Theme bind:theme persist persistKey="__carbon-theme" />

<Header companyName="" platformName="" isSideNavOpen>
    <svelte:fragment slot="skipToContent"><SkipToContent /></svelte:fragment>

    <img
        style="position: absolute; margin: 0 1rem;"
        src={logo}
        width="100px"
        alt=""
        srcset=""
    />
    <div
        aria-hidden="true"
        class="toolbar-drag-region"
        data-tauri-drag-region
        ondblclick={() => runWindowControl("toggle-maximize")}
    ></div>

    {#if formattedSyncTime}
        <div class="sync-status">
            {formattedSyncTime}
        </div>
    {/if}

    <HeaderUtilities>
        <Button
            onclick={onOpenPalette}
            kind="ghost"
            aria-label="Open Command Palette"
        >
            <Search />
        </Button>

        <Button
            onclick={() => {
                window.location.reload();
            }}
            kind="ghost"
            aria-label="Refresh Application"
        >
            <Renew />
        </Button>

        <Button onclick={toggleTheme} kind="ghost" aria-label="Toggle theme">
            {#if theme == "g100"}
                <LightFilled />
            {:else}
                <Asleep />
            {/if}
        </Button>

        {#if showSettings}
            <Button
                aria-label="Open settings"
                onclick={onOpenSettings}
                kind="ghost"
            >
                <Settings />
            </Button>
        {/if}

        <Button onclick={() => runWindowControl("minimize")} kind="ghost">
            <Subtract />
        </Button>

        <Button
            onclick={() => runWindowControl("toggle-maximize")}
            kind="ghost"
        >
            {#if isMaximized}
                <Minimize />
            {:else}
                <Maximize />
            {/if}
        </Button>

        <Button onclick={() => runWindowControl("close")} kind="danger-ghost">
            <Close />
        </Button>
    </HeaderUtilities>
</Header>

<style>
    .toolbar-drag-region {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
    }

    :global(.bx--header__global) {
        margin-left: 0;
    }
    .sync-status {
        position: absolute;
        right: 25rem;
        top: 0;
        height: 3rem;
        display: flex;
        align-items: center;
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
        opacity: 0.8;
    }
</style>
