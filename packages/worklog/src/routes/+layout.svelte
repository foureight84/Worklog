<script lang="ts">
	import { goto } from "$app/navigation";

	import "carbon-components-svelte/css/all.css";
	import { Loading, NotificationQueue } from "carbon-components-svelte";
	import "./layout.css";
	// @ts-ignore
	import AppToolbar from "$lib/components/app/layout/toolbar/app-toolbar.svelte";
	import CommandPalette from "$lib/components/app/layout/command-palette/command-palette.svelte";
	import { useWorkspace } from "$lib/hooks/workspace.svelte";
	import { useCommandPalette } from "$lib/hooks/command-palette.svelte";
	import { useAppZoom } from "$lib/hooks/app-zoom.svelte";
	import { notifications } from "$lib/hooks/notifications.svelte";
	import { isDesktop } from "$lib/environment";
	import {
		buildCommandActions,
		buildShortcuts,
		handleGlobalShortcut,
		type ShortcutDef,
	} from "$lib/hooks/keyboard-shortcuts";
	import { getDb } from "$lib/db";
	import { exportDatabaseToFile } from "$lib/db/export";
	import { importFromFile } from "$lib/db/mappers";

	let { children } = $props();
	const workspace = useWorkspace();
	const palette = useCommandPalette();
	const appZoom = useAppZoom();
	let hasInitializedWorkspace = $state(false);

	// ── App-level callbacks ────────────────────────────────────────────────
	function openSettings() {
		void goto("/workspace/settings");
	}

	function createBoard() {
		// Dispatch a custom event that the workspace sidebar listens for
		window.dispatchEvent(new CustomEvent("worklog:create-board"));
	}

	function createTicket() {
		// Dispatch a custom event that the kanban board listens for
		window.dispatchEvent(new CustomEvent("worklog:create-ticket"));
	}

	function goToWorkspace() {
		void goto("/workspace");
	}

	function toggleTheme() {
		// Dispatch a custom event that the toolbar listens for
		window.dispatchEvent(new CustomEvent("worklog:toggle-theme"));
	}

	function refreshApp() {
		window.location.reload();
	}

	function closeWorkspace() {
		void workspace.close();
		void goto("/");
	}

	function openWorkspaceFolder() {
		void workspace.pick();
	}

	async function exportData() {
		if (workspace.status !== "ready" || !workspace.path) return;
		try {
			const db = await getDb(workspace.path);
			const success = await exportDatabaseToFile(db);
			if (success) {
				notifications.add({
					kind: "success",
					title: "Export Successful",
					subtitle: "Your workspace data has been saved.",
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

	async function importData() {
		if (workspace.status !== "ready" || !workspace.path) return;
		try {
			const db = await getDb(workspace.path);
			const result = await importFromFile(db, 'merge');
			if (result) {
				notifications.add({
					kind: "success",
					title: "Import Successful",
					subtitle: `Created ${result.boardsCreated} boards, ${result.ticketsCreated} tickets. Updated ${result.ticketsUpdated} tickets.`,
					timeout: 5000,
				});
				// Reload the workspace to pick up new data
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

	// ── Command palette actions & shortcuts ────────────────────────────────
	const appCallbacks = {
		openSettings,
		createBoard,
		createTicket,
		goToWorkspace,
		toggleTheme,
		refreshApp,
		closeWorkspace,
		...(isDesktop() ? { openWorkspace: openWorkspaceFolder } : {}),
		exportData,
		importData,
	};

	const commandActions = buildCommandActions(appCallbacks);
	const shortcuts: ShortcutDef[] = buildShortcuts({
		...appCallbacks,
		openCommandPalette: () => palette.toggle(),
	});

	// Register command actions with the palette
	$effect(() => {
		palette.registerActions(commandActions);
	});

// ── Global keyboard handler ────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
	// Zoom Shortcuts (desktop only — browser handles Ctrl+/- natively)
	if (isDesktop() && (e.ctrlKey || e.metaKey)) {
			if (e.key === "=" || e.key === "+") {
				e.preventDefault();
				appZoom.zoomIn();
				return;
			}
			if (e.key === "-") {
				e.preventDefault();
				appZoom.zoomOut();
				return;
			}
			if (e.key === "0") {
				e.preventDefault();
				appZoom.reset();
				return;
			}
		}

		// Let the command palette handle its own internal keys when open
		if (palette.isOpen) return;

		handleGlobalShortcut(e, shortcuts);
	}

// ── Context menu prevention (desktop only) ───────────────────────────────
const handleContextmenu = (event: MouseEvent) => {
	event.preventDefault();
};

$effect(() => {
	if (!isDesktop()) return;
	document.addEventListener("contextmenu", handleContextmenu);

	return () => {
		document.removeEventListener("contextmenu", handleContextmenu);
	};
});

	$effect(() => {
		if (hasInitializedWorkspace) {
			return;
		}

		hasInitializedWorkspace = true;
		void workspace.init();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="layout-shell">
	<AppToolbar
		showSettings={workspace.status === "ready"}
		onOpenSettings={openSettings}
		onOpenPalette={() => palette.toggle()}
	/>
	{@render children()}

	{#if workspace.status === "idle" || workspace.status === "loading"}
		<Loading />
	{/if}
</div>

<!-- Command Palette (deferred rendering) -->
{#if palette.isOpen}
	<CommandPalette />
{/if}

<!-- Global Notifications Queue -->
<NotificationQueue bind:this={notifications.queue} />

<style>
	:global(html),
	:global(body) {
		height: 100%;
	}

	:global(body) {
		overflow: hidden;
		transform: scale(var(--app-zoom, 1));
		transform-origin: top left;
		width: calc(100% / var(--app-zoom, 1)) !important;
		height: calc(100% / var(--app-zoom, 1)) !important;
	}

	.layout-shell {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	:global(.layout-content.bx--content) {
		box-sizing: border-box;
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
	}
</style>
