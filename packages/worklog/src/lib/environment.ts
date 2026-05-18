/**
 * Shared environment detection for desktop (Tauri) vs webapp (browser) modes.
 *
 * Both the desktop app and the webapp share a single codebase. This module
 * provides the canonical way to detect which environment the app is running
 * in, so UI components can conditionally render desktop-only features.
 */

export function isDesktop(): boolean {
    return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

export function isWebApp(): boolean {
    return !isDesktop();
}
