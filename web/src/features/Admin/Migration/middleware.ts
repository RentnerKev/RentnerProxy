import { createServerOnlyFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    applyImportService,
    getImportRunsService,
    NpmImportError,
    previewImportService,
    type ImportSource,
} from '@/server/Admin/NpmImport/npm-import.service.ts'
import { NpmSourceError } from '@/server/Admin/NpmImport/npm-source.ts'
import { withNpmSqliteUpload } from '@/server/Admin/NpmImport/npm-temp.ts'
import { PortableSourceError } from '@/server/Admin/Migration/portable.ts'
import { exportMigrationConfigurationService } from '@/server/Admin/Migration/migration-export.service.ts'
import { ZoraxySourceError } from '@/server/Admin/Migration/zoraxy.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
}

function errorResponse(error: unknown): Response {
    if (error instanceof AuthDomainError) {
        return json({ error: error.code }, error.code === 'authentication_required' ? 401 : 403)
    }
    if (
        error instanceof NpmSourceError ||
        error instanceof PortableSourceError ||
        error instanceof ZoraxySourceError
    )
        return json({ error: error.code }, 422)
    if (error instanceof NpmImportError) return json({ error: error.code }, 409)
    return json({ error: 'import_failed' }, 500)
}

export const handleMigrationPostHandler = createServerOnlyFn(
    async (request: Request): Promise<Response> => {
        try {
            await requirePermissionService(PERMISSIONS.MIGRATION)
            const origin = request.headers.get('origin')
            const publicOrigin = getPublicOrigin()
            if (
                (origin && publicOrigin && origin !== publicOrigin) ||
                request.headers.get('sec-fetch-site') === 'cross-site'
            )
                return json({ error: 'invalid_request' }, 403)
            const url = new URL(request.url)
            const mode = url.searchParams.get('mode')
            const source = url.searchParams.get('source')
            if (
                (mode !== 'preview' && mode !== 'apply') ||
                (source !== 'npm' && source !== 'rentnerproxy' && source !== 'zoraxy') ||
                request.headers.get('content-type') !== 'application/octet-stream' ||
                request.headers.get('x-rentnerproxy-import') !== source
            )
                return json({ error: 'invalid_request' }, 400)
            const selectedSource: ImportSource = source
            const result = await withNpmSqliteUpload<unknown>(request, (path, fingerprint) =>
                mode === 'preview'
                    ? previewImportService(path, fingerprint, selectedSource, PERMISSIONS.MIGRATION)
                    : applyImportService(
                          path,
                          fingerprint,
                          url.searchParams.get('fingerprint') ?? '',
                          url.searchParams.get('plan') ?? '',
                          selectedSource,
                          PERMISSIONS.MIGRATION,
                      ),
            )
            return json(result)
        } catch (error) {
            return errorResponse(error)
        }
    },
)

export const handleMigrationGetHandler = createServerOnlyFn(async (): Promise<Response> => {
    try {
        return json(await getImportRunsService(PERMISSIONS.MIGRATION))
    } catch (error) {
        return errorResponse(error)
    }
})

export const handleMigrationExportHandler = createServerOnlyFn(async (): Promise<Response> => {
    try {
        const actor = await requirePermissionService(PERMISSIONS.MIGRATION)
        const body = await exportMigrationConfigurationService(actor.id)
        return new Response(body, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="rentnerproxy-config-${new Date().toISOString().slice(0, 10)}.json"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        })
    } catch (error) {
        return errorResponse(error)
    }
})
