import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { getOidcConnectionsService, unlinkOidcConnectionService } from './oidc-linking.service.ts'
import { oidcProviderFailure } from './oidc-provider-response.server.ts'
import type { OidcConnectionsResponseDependencies } from './Types/oidc-connections.types.ts'

const unlinkSchema = z.strictObject({
    providerId: z.uuid(),
    expectedRevision: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER - 1),
})

/** Applies authenticated same-origin, bounded-input protections to self-service connection operations. */
export function createOidcConnectionsResponseHandler(
    dependencies: OidcConnectionsResponseDependencies,
) {
    return async (request: Request): Promise<Response> => {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        if (request.method !== 'GET' && request.method !== 'POST') {
            headers.set('Allow', 'GET, POST')
            return new Response(null, { status: 405, headers })
        }
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method === 'POST') {
            const origin = dependencies.origin()
            if (!origin || request.headers.get('origin') !== origin)
                return Response.json({ error: 'permission_denied' }, { status: 403, headers })
            if (
                request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                'application/json'
            )
                return Response.json({ error: 'invalid_input' }, { status: 415, headers })
        }
        const signal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(OIDC_LIMITS.inputTimeoutMs),
        ])
        try {
            const connections = await dependencies.get()
            if (request.method === 'GET') return Response.json(connections, { headers })
            if (!request.body)
                return Response.json({ error: 'invalid_input' }, { status: 400, headers })
            const bytes = await readBoundedStream(request.body, 1_024, signal)
            const parsed = unlinkSchema.safeParse(
                JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
            )
            if (!parsed.success)
                return Response.json({ error: 'invalid_input' }, { status: 422, headers })
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            await dependencies.unlink(parsed.data)
            return Response.json({ success: true }, { headers })
        } catch (error) {
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            if (signal.aborted)
                return Response.json({ error: 'input_timeout' }, { status: 408, headers })
            if (error instanceof ResponseBodyLimitError)
                return Response.json({ error: 'invalid_input' }, { status: 413, headers })
            if (error instanceof SyntaxError || error instanceof TypeError)
                return Response.json({ error: 'invalid_input' }, { status: 400, headers })
            return oidcProviderFailure(error, headers)
        }
    }
}

export const handleOidcConnectionsRequest = createOidcConnectionsResponseHandler({
    origin: getPublicOrigin,
    get: getOidcConnectionsService,
    unlink: unlinkOidcConnectionService,
})
