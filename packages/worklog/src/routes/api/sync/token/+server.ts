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
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw error(400, 'Request body must be valid JSON');
    }

    if (!body || typeof body !== 'object') {
        throw error(400, 'Request body must be a JSON object');
    }

    const clientId = (body as Record<string, unknown>).clientId;
    if (!clientId || typeof clientId !== 'string') {
        throw error(400, 'clientId is required (string)');
    }

    try {
        const token = await generateSyncToken(clientId);

        return json({
            token,
            expires_in: '24h',
        });
    } catch (e) {
        console.error('Failed to generate sync token:', e);
        throw error(500, 'Failed to generate sync token');
    }
};
