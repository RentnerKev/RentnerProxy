import '@tanstack/react-start/server-only'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import {
    getBackupsStatusService,
    requestBackupService,
    updateBackupConfigurationService,
    requestBackupSchema,
    updateBackupConfigurationSchema,
} from './backups.service.ts'
import { BackupDomainError } from './backup.errors.ts'
import type { BackupsHttpDependencies } from './Types/backups-http.types.ts'

function failure(error: unknown, headers: Headers): Response {
    if (isAuthDomainError(error)) {
        const code =
            error.code === 'authentication_required'
                ? 'authentication_required'
                : error.code === 'service_unavailable' || error.code === 'user_not_active'
                  ? 'unavailable'
                  : 'permission_denied'
        return Response.json(
            { error: code },
            {
                status:
                    code === 'authentication_required' ? 401 : code === 'unavailable' ? 503 : 403,
                headers,
            },
        )
    }
    if (error instanceof RateLimitError) {
        headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))))
        return Response.json({ error: 'rate_limited' }, { status: 429, headers })
    }
    if (error instanceof BackupDomainError)
        return Response.json(
            { error: error.code },
            {
                status:
                    error.code === 'invalid_input' ? 400 : error.code === 'unavailable' ? 503 : 409,
                headers,
            },
        )
    if (error instanceof ResponseBodyLimitError)
        return Response.json({ error: 'invalid_input' }, { status: 400, headers })
    return Response.json({ error: 'unavailable' }, { status: 503, headers })
}
export function createBackupsHttpHandlers(
    dependencies: BackupsHttpDependencies = {
        service: {
            getBackupsStatusService,
            requestBackupService,
            updateBackupConfigurationService,
        },
        origin: getPublicOrigin,
    },
) {
    async function respond(
        request: Request,
        operation: 'status' | 'start' | 'config',
    ): Promise<Response> {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        const method = operation === 'status' ? 'GET' : 'POST'
        if (request.method !== method) {
            headers.set('Allow', method)
            return Response.json({ error: 'invalid_input' }, { status: 405, headers })
        }
        try {
            if (new URL(request.url).search !== '') throw new BackupDomainError('invalid_input')
            if (operation === 'status')
                return Response.json(await dependencies.service.getBackupsStatusService(), {
                    headers,
                })
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
            if (!request.body) throw new BackupDomainError('invalid_input')
            const bytes = await readBoundedStream(request.body, 2048, request.signal)
            let raw: unknown
            try {
                raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
            } catch {
                throw new BackupDomainError('invalid_input')
            }
            const parsed = (
                operation === 'start' ? requestBackupSchema : updateBackupConfigurationSchema
            ).safeParse(raw)
            if (!parsed.success) throw new BackupDomainError('invalid_input')
            const value =
                operation === 'start'
                    ? await dependencies.service.requestBackupService(parsed.data)
                    : await dependencies.service.updateBackupConfigurationService(parsed.data)
            return Response.json(value, { status: operation === 'start' ? 202 : 200, headers })
        } catch (error) {
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            return failure(error, headers)
        }
    }
    return {
        status: (request: Request) => respond(request, 'status'),
        start: (request: Request) => respond(request, 'start'),
        configure: (request: Request) => respond(request, 'config'),
    }
}
export const backupsHttpHandlers = createBackupsHttpHandlers()
