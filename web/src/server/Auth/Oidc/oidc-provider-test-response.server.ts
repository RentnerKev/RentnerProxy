import '@tanstack/react-start/server-only'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { testOidcProviderSchema } from '@/lib/Auth/Oidc/validation.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { getOidcProvidersService } from './oidc-providers.service.ts'
import { oidcProviderFailure } from './oidc-provider-response.server.ts'
import { testOidcProviderService } from './oidc-provider-test.service.ts'
import type { OidcProviderTestResponseDependencies } from './Types/oidc-provider-test.types.ts'

/** Authenticates before reading a bounded body; accepts only saved-provider references. */
export function createOidcProviderTestResponseHandler(
    dependencies: OidcProviderTestResponseDependencies,
) {
    /** Authenticates and validates the saved-provider test request before invoking the probe. */
    return async function handle(request: Request): Promise<Response> {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method !== 'POST') {
            headers.set('Allow', 'POST')
            return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })
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
            await dependencies.authorize()
        } catch (error) {
            return oidcProviderFailure(error, headers)
        }
        const signal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(OIDC_LIMITS.inputTimeoutMs),
        ])
        let input: unknown
        try {
            if (!request.body)
                return Response.json({ error: 'invalid_input' }, { status: 400, headers })
            const bytes = await readBoundedStream(request.body, OIDC_LIMITS.startBodyBytes, signal)
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
        const parsed = testOidcProviderSchema.safeParse(input)
        if (!parsed.success)
            return Response.json({ error: 'invalid_input' }, { status: 422, headers })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        try {
            return Response.json(await dependencies.test(parsed.data), { headers })
        } catch (error) {
            return oidcProviderFailure(error, headers)
        }
    }
}
export const handleOidcProviderTestRequest = createOidcProviderTestResponseHandler({
    origin: getPublicOrigin,
    authorize: getOidcProvidersService,
    test: testOidcProviderService,
})
