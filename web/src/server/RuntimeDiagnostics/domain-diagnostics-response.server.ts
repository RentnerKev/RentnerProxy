import '@tanstack/react-start/server-only'
import { DOMAIN_DIAGNOSTICS_INPUT_LIMIT } from '@/config/domain-diagnostics.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { diagnoseDomainService } from './domain-diagnostics.service.ts'
import { DomainDiagnosticsError } from './domain-diagnostics.errors.ts'

export function createDomainDiagnosticsPostHandler(
    dependencies: {
        readonly diagnose: typeof diagnoseDomainService
        readonly origin: () => string | null
    } = { diagnose: diagnoseDomainService, origin: getPublicOrigin },
) {
    return async (request: Request): Promise<Response> => {
        const headers = { 'Cache-Control': 'private, no-store' }
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method !== 'POST')
            return Response.json({ error: 'invalid_input' }, { status: 405, headers })
        if (
            !request.headers.get('origin') ||
            request.headers.get('origin') !== dependencies.origin()
        )
            return Response.json({ error: 'permission_denied' }, { status: 403, headers })
        if (
            request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
            'application/json'
        )
            return Response.json({ error: 'invalid_input' }, { status: 415, headers })
        try {
            if (!request.body) throw new DomainDiagnosticsError('invalid_input')
            const body = await readBoundedStream(
                request.body,
                DOMAIN_DIAGNOSTICS_INPUT_LIMIT,
                request.signal,
            )
            const input: unknown = JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(body),
            )
            return Response.json(await dependencies.diagnose(input, request.signal), { headers })
        } catch (error) {
            if (
                request.signal.aborted ||
                (error instanceof DomainDiagnosticsError && error.code === 'aborted')
            )
                return new Response(null, { status: 499, headers })
            if (isAuthDomainError(error)) {
                const code =
                    error.code === 'authentication_required'
                        ? 'authentication_required'
                        : 'permission_denied'
                return Response.json(
                    { error: code },
                    { status: code === 'authentication_required' ? 401 : 403, headers },
                )
            }
            if (
                error instanceof SyntaxError ||
                error instanceof TypeError ||
                error instanceof ResponseBodyLimitError
            )
                return Response.json({ error: 'invalid_input' }, { status: 400, headers })
            const code =
                error instanceof DomainDiagnosticsError ? error.code : 'runtime_unavailable'
            const status =
                code === 'invalid_input'
                    ? 400
                    : code === 'configuration_changed'
                      ? 409
                      : code === 'rate_limited' || code === 'busy'
                        ? 429
                        : 503
            return Response.json({ error: code }, { status, headers })
        }
    }
}
export const handleDomainDiagnosticsPost = createDomainDiagnosticsPostHandler()
