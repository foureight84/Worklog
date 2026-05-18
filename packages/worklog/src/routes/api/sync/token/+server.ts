import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSyncToken } from '$lib/server/jwt';

/**
 * POST /api/sync/token
 * Generate a JWT sync token for a desktop client.
 * 
 * Request body: { clientId: string }
 * Response: { token: string, expires_in: string }
 */
export const POST: RequestHandler = async ({ request }) => {
    try {
        const body = await request.json();
        const clientId = body?.clientId;

        if (!clientId || typeof clientId !== 'string') {
            throw error(400, 'clientId is required (string)');
        }

        const token = await generateSyncToken(clientId);

        return json({
            token,
            expires_in: '24h',
        });
    } catch (e) {
        if (e && typeof e === 'object' && 'status' in e) {
            throw e; // Re-throw SvelteKit errors
        }
        console.error('Failed to generate sync token:', e);
        throw error(500, 'Failed to generate sync token');
    }
};
