import '@tanstack/react-start/server-only'
import { HOST_MONITORING_LIMITS } from '@/config/host-monitoring.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import { hostMonitoringService } from './host-monitoring.service.ts'
import { HostMonitoringError } from './host-monitoring.errors.ts'
import type { HostMonitoringHttpDependencies } from './Types/host-monitoring-http.types.ts'

function queryInput(request: Request, history: boolean) {
    const params = new URL(request.url).searchParams
    const allowed = history
        ? ['proxyHostId', 'limit', 'beforeCheckedAt', 'beforeId']
        : ['proxyHostId']
    for (const key of params.keys())
        if (!allowed.includes(key) || params.getAll(key).length !== 1)
            throw new HostMonitoringError('invalid_input')
    if (params.has('beforeCheckedAt') !== params.has('beforeId'))
        throw new HostMonitoringError('invalid_input')
    return {
        proxyHostId: params.get('proxyHostId'),
        ...(params.has('limit') ? { limit: Number(params.get('limit')) } : {}),
        ...(params.has('beforeCheckedAt')
            ? { before: { checkedAt: params.get('beforeCheckedAt'), id: params.get('beforeId') } }
            : {}),
    }
}

function errorResponse(error: unknown, headers: Headers): Response {
    if (isAuthDomainError(error)) {
        if (error.code === 'service_unavailable' || error.code === 'user_not_active')
            return Response.json({ error: 'service_unavailable' }, { status: 503, headers })
        if (error.code === 'invalid_input')
            return Response.json({ error: 'invalid_input' }, { status: 400, headers })
        const unauthenticated = error.code === 'authentication_required'
        return Response.json(
            { error: unauthenticated ? 'authentication_required' : 'permission_denied' },
            { status: unauthenticated ? 401 : 403, headers },
        )
    }
    if (error instanceof RateLimitError) {
        headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))))
        return Response.json({ error: 'rate_limited' }, { status: 429, headers })
    }
    if (error instanceof HostMonitoringError) {
        const status = error.code === 'host_not_found' ? 404 : error.code === 'conflict' ? 409 : 400
        return Response.json({ error: error.code }, { status, headers })
    }
    if (error instanceof ResponseBodyLimitError)
        return Response.json({ error: 'invalid_input' }, { status: 400, headers })
    console.error('[host-monitoring] API temporarily unavailable.')
    return Response.json({ error: 'service_unavailable' }, { status: 503, headers })
}

export function createHostMonitoringHttpHandlers(
    dependencies: HostMonitoringHttpDependencies = {
        service: hostMonitoringService,
        origin: getPublicOrigin,
    },
) {
    async function respond(request: Request, history: boolean): Promise<Response> {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method !== 'GET' && (history || request.method !== 'POST')) {
            headers.set('Allow', history ? 'GET' : 'GET, POST')
            return Response.json({ error: 'invalid_input' }, { status: 405, headers })
        }
        try {
            if (request.method === 'GET')
                return Response.json(
                    history
                        ? await dependencies.service.getHistory(queryInput(request, true))
                        : await dependencies.service.getPolicy(queryInput(request, false)),
                    { headers },
                )
            // Cookie-authenticated writes require the configured origin even for
            // API callers; CORS or a forged Host header cannot authorize a policy.
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
            if (!request.body || new URL(request.url).search !== '')
                throw new HostMonitoringError('invalid_input')
            const bytes = await readBoundedStream(
                request.body,
                HOST_MONITORING_LIMITS.inputLimitBytes,
                request.signal,
            )
            let input: unknown
            try {
                input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
            } catch {
                throw new HostMonitoringError('invalid_input')
            }
            const policy = await dependencies.service.savePolicy(input)
            return Response.json(policy, { headers })
        } catch (error) {
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            return errorResponse(error, headers)
        }
    }
    return {
        policy: (request: Request) => respond(request, false),
        history: (request: Request) => respond(request, true),
    }
}

export const hostMonitoringHttpHandlers = createHostMonitoringHttpHandlers()
