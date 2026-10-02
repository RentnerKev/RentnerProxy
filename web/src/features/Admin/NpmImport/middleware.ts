import { createServerOnlyFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    applyNpmImportService,
    getNpmImportRunsService,
    NpmImportError,
    previewNpmImportService,
} from '@/server/Admin/NpmImport/npm-import.service.ts'
import { NpmSourceError } from '@/server/Admin/NpmImport/npm-source.ts'
import { withNpmSqliteUpload } from '@/server/Admin/NpmImport/npm-temp.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: {
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

export const handleNpmImportPostHandler = createServerOnlyFn(
    async (request: Request): Promise<Response> => {
        try {
            await requirePermissionService(PERMISSIONS.NPM_IMPORT)
            const origin = request.headers.get('origin')
            const publicOrigin = getPublicOrigin()
            if (
                (origin && publicOrigin && origin !== publicOrigin) ||
                request.headers.get('sec-fetch-site') === 'cross-site'
            ) {
                return json({ error: 'invalid_request' }, 403)
            }
            if (
                request.headers.get('x-rentnerproxy-import') !== 'sqlite' ||
                request.headers.get('content-type') !== 'application/octet-stream'
            ) {
                return json({ error: 'invalid_request' }, 400)
            }
            const url = new URL(request.url)
            const mode = url.searchParams.get('mode')
            if (mode !== 'preview' && mode !== 'apply')
                return json({ error: 'invalid_request' }, 400)
            const result = await withNpmSqliteUpload<unknown>(request, (path, fingerprint) =>
                mode === 'preview'
                    ? previewNpmImportService(path, fingerprint)
                    : applyNpmImportService(
                          path,
                          fingerprint,
                          url.searchParams.get('fingerprint') ?? '',
                          url.searchParams.get('plan') ?? '',
                      ),
            )
            return json(result)
        } catch (error) {
            if (error instanceof AuthDomainError) {
                return json(
                    { error: error.code },
                    error.code === 'authentication_required' ? 401 : 403,
                )
            }
            if (error instanceof NpmSourceError) return json({ error: error.code }, 422)
            if (error instanceof NpmImportError) return json({ error: error.code }, 409)
            return json({ error: 'import_failed' }, 500)
        }
    },
)

export const handleNpmImportGetHandler = createServerOnlyFn(async (): Promise<Response> => {
    try {
        return json(await getNpmImportRunsService())
    } catch (error) {
        if (error instanceof AuthDomainError) {
            return json({ error: error.code }, error.code === 'authentication_required' ? 401 : 403)
        }
        return json({ error: 'import_failed' }, 500)
    }
})
