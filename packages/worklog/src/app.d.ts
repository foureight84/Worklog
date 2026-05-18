// See https://svelte.dev/docs/kit/type#type-declarations
// for information about these declarations
import type { WorklogDB } from '$lib/db/types';

declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            db: WorklogDB;
        }
        // interface PageData {}
        // interface PageState {}
        // interface Platform {}
    }
}

export {};
