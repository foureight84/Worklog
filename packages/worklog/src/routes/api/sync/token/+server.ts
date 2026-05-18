import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSyncToken, JWT_EXPIRES_IN } from '$lib/server/jwt';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * POST /api/sync/token
 * Generate a JWT sync token for a desktop client.
 *
 * If ADMIN_API_KEY is set, the request must include
 * `Authorization: Bearer <ADMIN_API_KEY>`. In dev (unset), the endpoint
 * is open — protect it behind a reverse proxy or set ADMIN_API_KEY in prod.
 *
 * Request body: { clientId: string }
 * Response: { token: string, expires_in: string }
 */
export const POST: RequestHandler = async ({ request }) => {
    // ── Optional admin auth (production safety) ──────────
    if (ADMIN_API_KEY) {
        const auth = request.headers.get('authorization');
        const expected = `Bearer ${ADMIN_API_KEY}`;
        if (!auth || auth !== expected) {
            throw error(401, 'Unauthorized — ADMIN_API_KEY required');
        }
    }

    // ── Parse and validate body ──────────────────────────
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

    // ── Generate token ───────────────────────────────────
    try {
        const token = await generateSyncToken(clientId);

        return json({
            token,
            expires_in: JWT_EXPIRES_IN,
        });
    } catch (e) {
        console.error('Failed to generate sync token:', e);
        throw error(500, 'Failed to generate sync token');
    }
};
