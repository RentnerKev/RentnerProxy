import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { getPublicOrigin } from '@/server/env.server.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import { downloadBackupService } from './backups-download.service.ts'

export function createBackupDownloadHttpHandler(
    dependencies = {
        download: downloadBackupService,
        origin: getPublicOrigin,
    },
) {
    return async (request: Request, id: string): Promise<Response> => {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        const failure = (code: string, status: number) => {
            if (
                request.headers.get('sec-fetch-mode') === 'navigate' &&
                request.headers.get('accept')?.includes('text/html')
            ) {
                headers.set('Location', '/backups?downloadError=' + code)
                return new Response(null, { status: 303, headers })
            }
            return Response.json({ error: code }, { status, headers })
        }
        if (request.signal.aborted) return new Response(null, { status: 499, headers })
        if (request.method !== 'GET') {
            headers.set('Allow', 'GET')
            return failure('not_found', 405)
        }
        const origin = dependencies.origin()
        const suppliedOrigin = request.headers.get('origin')
        if (
            !origin ||
            (suppliedOrigin
                ? suppliedOrigin !== origin
                : request.headers.get('sec-fetch-site') !== 'same-origin')
        )
            return failure('permission_denied', 403)
        if (
            new URL(request.url).search !== '' ||
            id !== id.toLowerCase() ||
            !z.uuid().safeParse(id).success
        )
            return failure('not_found', 404)
        try {
            const response = await dependencies.download(id, request.signal)
            if (!response.ok) {
                void response.body?.cancel().catch(() => {})
                return failure(
                    response.status === 404
                        ? 'not_found'
                        : response.status === 409
                          ? 'conflict'
                          : 'unavailable',
                    response.status === 404 ? 404 : response.status === 409 ? 409 : 503,
                )
            }
            headers.set('Content-Type', 'application/x-tar')
            headers.set(
                'Content-Disposition',
                `attachment; filename="rentnerproxy-backup-${id}.tar"`,
            )
            const length = response.headers.get('content-length')
            if (length) headers.set('Content-Length', length)
            return new Response(response.body, { headers })
        } catch (error) {
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            if (isAuthDomainError(error)) {
                const code =
                    error.code === 'authentication_required'
                        ? 'authentication_required'
                        : error.code === 'permission_denied'
                          ? 'permission_denied'
                          : 'unavailable'
                return failure(
                    code,
                    code === 'authentication_required'
                        ? 401
                        : code === 'permission_denied'
                          ? 403
                          : 503,
                )
            }
            if (error instanceof RateLimitError) {
                headers.set(
                    'Retry-After',
                    String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
                )
                return failure('rate_limited', 429)
            }
            return failure('unavailable', 503)
        }
    }
}

export const backupDownloadHttpHandler = createBackupDownloadHttpHandler()
