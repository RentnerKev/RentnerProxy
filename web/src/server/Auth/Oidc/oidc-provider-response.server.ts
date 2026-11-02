import '@tanstack/react-start/server-only'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import { OidcDomainError } from './oidc.errors.ts'
import { getOidcProvidersService, saveOidcProvidersService } from './oidc-providers.service.ts'
import type { OidcProviderResponseDependencies } from './Types/oidc-provider-response.types.ts'

/** Emits fixed response codes while withholding input, credentials, and internal failure details. */
function failure(error: unknown, headers: Headers): Response {
    if (error instanceof RateLimitError) {
        headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))))
        return Response.json({ error: 'rate_limited' }, { status: 429, headers })
    }
    if (isAuthDomainError(error)) {
        if (error.code === 'authentication_required')
            return Response.json({ error: error.code }, { status: 401, headers })
        if (
            ['owner_required', 'permission_denied', 'reauthentication_required'].includes(
                error.code,
            )
        )
            return Response.json({ error: error.code }, { status: 403, headers })
    }
    if (error instanceof OidcDomainError) {
        if (error.code === 'configuration_conflict')
            return Response.json({ error: error.code }, { status: 409, headers })
        if (error.code === 'invalid_input' || error.code === 'identity_not_allowed')
            return Response.json({ error: error.code }, { status: 422, headers })
    }
    return Response.json({ error: 'configuration_unavailable' }, { status: 503, headers })
}

/** Exposes the canonical owner services through a bounded JSON API without requiring an admin UI. */
export function createOidcProviderResponseHandler(dependencies: OidcProviderResponseDependencies) {
    /** Applies same-origin mutation checks and input bounds before delegating exactly once. */
    async function handle(request: Request): Promise<Response> {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method !== 'GET' && request.method !== 'POST') {
            headers.set('Allow', 'GET, POST')
            return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })
        }
        if (request.method === 'GET') {
            try {
                return Response.json(await dependencies.get(), { headers })
            } catch (error) {
                return failure(error, headers)
            }
        }
        const origin = dependencies.origin()
        if (!origin || request.headers.get('origin') !== origin)
            return Response.json({ error: 'permission_denied' }, { status: 403, headers })
        if (
            request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
            'application/json'
        )
            return Response.json({ error: 'invalid_input' }, { status: 415, headers })
        try {
            // Reuse canonical owner/session freshness checks before reading untrusted input.
            // The mutation independently rechecks them under its settings lock.
            await dependencies.get()
        } catch (error) {
            return failure(error, headers)
        }
        const signal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(OIDC_LIMITS.inputTimeoutMs),
        ])
        let input: unknown
        try {
            if (!request.body)
                return Response.json({ error: 'invalid_input' }, { status: 400, headers })
            const bytes = await readBoundedStream(
                request.body,
                OIDC_LIMITS.configurationBytes,
                signal,
            )
            input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch (error) {
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            if (signal.aborted)
                return Response.json({ error: 'input_timeout' }, { status: 408, headers })
            return Response.json(
                { error: 'invalid_input' },
                { status: error instanceof ResponseBodyLimitError ? 413 : 400, headers },
            )
        }
        const parsed = saveOidcProvidersSchema.safeParse(input)
        if (!parsed.success)
            return Response.json({ error: 'invalid_input' }, { status: 422, headers })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        try {
            return Response.json(await dependencies.save(parsed.data), { headers })
        } catch (error) {
            return failure(error, headers)
        }
    }
    return handle
}

export const handleOidcProviderRequest = createOidcProviderResponseHandler({
    origin: getPublicOrigin,
    get: getOidcProvidersService,
    save: saveOidcProvidersService,
})
